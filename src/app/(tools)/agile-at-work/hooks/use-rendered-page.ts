"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageUrlCache, pageCacheKey } from "@/lib/comic/page-url-cache";
import { scaleForBucket } from "@/lib/comic/reader-math";
import { pdfErrorKind } from "@/lib/pdf/load-pdfjs";

/** Two at once keeps the worker busy without starving the visible page. */
const MAX_CONCURRENT_RENDERS = 2;
const JPEG_QUALITY = 0.92;

// Pinning must happen before the browser paints a new view; the server
// render has nothing to pin and would only warn about useLayoutEffect.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function cancelledError(): Error {
  // Named like pdf.js's own abort so pdfErrorKind() reads it as "cancelled".
  return Object.assign(new Error("Page render cancelled"), { name: "AbortException" });
}

function isCancelled(err: unknown): boolean {
  return pdfErrorKind(err) === "cancelled";
}

/**
 * Draw one page into a JPEG blob URL.
 *
 * Each render gets its own offscreen canvas (pdf.js refuses to share one
 * across concurrent renders). The canvas is filled white first: JPEG has no
 * alpha, so a page with a transparent background would otherwise encode as
 * black. Afterwards the canvas is shrunk to 0×0 — iOS counts canvas memory
 * against a small budget until the element is collected — and the page's
 * parsed resources are released.
 */
async function renderPageToUrl(
  doc: PDFDocumentProxy,
  pageNumber: number,
  bucket: number,
  signal: AbortSignal
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (signal.aborted) throw cancelledError();
    const base = page.getViewport({ scale: 1 });
    const scale = scaleForBucket(bucket, base.width, base.height);
    if (!(scale > 0)) throw new Error(`Page ${pageNumber} has no usable size.`);
    const viewport = page.getViewport({ scale });
    const target = document.createElement("canvas");
    canvas = target;
    target.width = Math.max(1, Math.floor(viewport.width));
    target.height = Math.max(1, Math.floor(viewport.height));
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("The browser refused to allocate a canvas.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target.width, target.height);

    const task = page.render({ canvas: target, viewport });
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw cancelledError();

    const blob = await new Promise<Blob | null>((resolve) =>
      target.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) throw new Error(`Page ${pageNumber} could not be encoded.`);
    if (signal.aborted) throw cancelledError();
    return URL.createObjectURL(blob);
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    page.cleanup();
  }
}

type Priority = "visible" | "prefetch";

interface RenderJob {
  key: string;
  page: number;
  bucket: number;
  priority: Priority;
  controller: AbortController;
  started: boolean;
  promise: Promise<string>;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

/**
 * Renders pages for one document, at most two at a time, visible pages
 * first. Finished URLs go into the LRU; a request for a page already being
 * drawn shares that job. Work nobody wants any more is cancelled via
 * AbortController → `renderTask.cancel()`.
 */
class PageRenderQueue {
  private readonly jobs = new Map<string, RenderJob>();
  private readonly waiting: RenderJob[] = [];
  private readonly running = new Set<RenderJob>();
  private destroyed = false;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly cache: PageUrlCache
  ) {}

  request(page: number, bucket: number, priority: Priority): Promise<string> {
    if (this.destroyed) return Promise.reject(cancelledError());
    const key = pageCacheKey(page, bucket);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.jobs.get(key);
    if (existing) {
      if (priority === "visible" && existing.priority === "prefetch") {
        existing.priority = "visible";
        this.sortWaiting();
      }
      return existing.promise;
    }

    let resolve!: (url: string) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Prefetches are fire-and-forget; never let a cancel surface as an
    // unhandled rejection. Callers that care attach their own handlers.
    promise.catch(() => {});
    const job: RenderJob = {
      key,
      page,
      bucket,
      priority,
      controller: new AbortController(),
      started: false,
      promise,
      resolve,
      reject,
    };
    this.jobs.set(key, job);
    this.waiting.push(job);
    this.sortWaiting();
    this.pump();
    return promise;
  }

  /** Cancel every queued or running render whose key is not in `keys`. */
  retain(keys: ReadonlySet<string>): void {
    for (const job of Array.from(this.jobs.values())) {
      if (!keys.has(job.key)) this.cancel(job);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const job of Array.from(this.jobs.values())) this.cancel(job);
  }

  private cancel(job: RenderJob): void {
    this.jobs.delete(job.key);
    const i = this.waiting.indexOf(job);
    if (i !== -1) this.waiting.splice(i, 1);
    job.controller.abort();
    // A running job rejects on its own once pdf.js stops drawing.
    if (!job.started) job.reject(cancelledError());
  }

  private sortWaiting(): void {
    // Array#sort is stable, so equal priorities keep request order.
    this.waiting.sort(
      (a, b) => Number(a.priority === "prefetch") - Number(b.priority === "prefetch")
    );
  }

  private pump(): void {
    while (!this.destroyed && this.running.size < MAX_CONCURRENT_RENDERS && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.start(job);
    }
  }

  private start(job: RenderJob): void {
    job.started = true;
    this.running.add(job);
    const { signal } = job.controller;
    renderPageToUrl(this.doc, job.page, job.bucket, signal)
      .then(
        (url) => {
          if (signal.aborted) {
            URL.revokeObjectURL(url);
            job.reject(cancelledError());
            return;
          }
          this.cache.set(job.key, url);
          job.resolve(url);
        },
        (err: unknown) => job.reject(err)
      )
      .finally(() => {
        this.running.delete(job);
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.pump();
      });
  }
}

/** Run `cb` when the browser is idle; Safari has no requestIdleCallback. */
function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const timer = setTimeout(cb, 200);
  return () => clearTimeout(timer);
}

interface LatestRender {
  key: string;
  url: string;
}

export interface RenderedPages {
  /**
   * Blob URL per visible page. While a new width bucket renders, a page
   * keeps showing its previous rendering instead of flashing a skeleton.
   */
  urls: ReadonlyMap<number, string>;
  /** Visible pages whose render failed (not cancelled). */
  failed: ReadonlySet<number>;
  retry: (page: number) => void;
}

/**
 * Turn the visible pages into images, and prefetch the neighbouring view
 * once they are done and the browser is idle.
 *
 * `bucket` is the target pixel width rounded up to 256 px, so resizing the
 * window within a bucket reuses the existing images. One LRU + render
 * queue lives per document; both are torn down (URLs revoked, renders
 * cancelled) when the document changes or the reader unmounts.
 */
export function useRenderedPages({
  doc,
  visible,
  prefetch,
  bucket,
}: {
  doc: PDFDocumentProxy | null;
  visible: readonly number[];
  prefetch: readonly number[];
  bucket: number;
}): RenderedPages {
  const cacheRef = useRef<PageUrlCache | null>(null);
  const queueRef = useRef<PageRenderQueue | null>(null);
  // page → its latest finished rendering (any bucket). The URL is kept
  // alongside the key so that re-rendering a page the LRU evicted (same key,
  // fresh URL) still counts as a change and re-renders the reader.
  const [latest, setLatest] = useState<ReadonlyMap<number, LatestRender>>(() => new Map());
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const failedRef = useRef(failed);
  failedRef.current = failed;
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!doc) return;
    const cache = new PageUrlCache();
    const queue = new PageRenderQueue(doc, cache);
    cacheRef.current = cache;
    queueRef.current = queue;
    return () => {
      queue.destroy();
      cache.clear();
      cacheRef.current = null;
      queueRef.current = null;
      setLatest(new Map());
      setFailed(new Set());
    };
  }, [doc]);

  const visibleKey = visible.join(",");
  const prefetchKey = prefetch.join(",");

  // Keep whatever is (or is about to be) on screen out of LRU eviction.
  useIsomorphicLayoutEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    const keys: string[] = [];
    for (const page of visible) {
      if (bucket > 0) keys.push(pageCacheKey(page, bucket));
      const shown = latest.get(page);
      if (shown) keys.push(shown.key);
    }
    cache.pin(keys);
    // `visible` is tracked through visibleKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, visibleKey, bucket, latest]);

  useEffect(() => {
    const queue = queueRef.current;
    if (!doc || !queue || bucket <= 0) return;
    let active = true;
    const wanted = new Set([...visible, ...prefetch].map((page) => pageCacheKey(page, bucket)));
    queue.retain(wanted);

    // A failure is remembered only while its page stays on screen, so
    // leaving and coming back tries again (as does the Retry button).
    const stillFailed = new Set(Array.from(failedRef.current).filter((p) => visible.includes(p)));
    if (stillFailed.size !== failedRef.current.size) setFailed(stillFailed);

    const requests = visible
      .filter((page) => !stillFailed.has(page))
      .map((page) =>
        queue.request(page, bucket, "visible").then(
          (url) => {
            if (!active) return;
            const key = pageCacheKey(page, bucket);
            setLatest((prev) => {
              if (prev.get(page)?.url === url) return prev;
              const next = new Map(prev);
              next.set(page, { key, url });
              return next;
            });
          },
          (err: unknown) => {
            if (!active || isCancelled(err)) return;
            setFailed((prev) => new Set(prev).add(page));
          }
        )
      );

    let cancelIdle = () => {};
    void Promise.all(requests).then(() => {
      if (!active) return;
      cancelIdle = whenIdle(() => {
        for (const page of prefetch) queue.request(page, bucket, "prefetch").catch(() => {});
      });
    });

    return () => {
      active = false;
      cancelIdle();
    };
    // `visible` / `prefetch` are tracked through their joined keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, bucket, visibleKey, prefetchKey, retryToken]);

  const retry = useCallback((page: number) => {
    setFailed((prev) => {
      if (!prev.has(page)) return prev;
      const next = new Set(prev);
      next.delete(page);
      return next;
    });
    setRetryToken((n) => n + 1);
  }, []);

  // Only hand out URLs the cache still holds — a revoked blob URL would
  // render as a broken image.
  const cache = cacheRef.current;
  const urls = new Map<number, string>();
  if (cache) {
    for (const page of visible) {
      const shown = latest.get(page);
      const url =
        (bucket > 0 ? cache.peek(pageCacheKey(page, bucket)) : undefined) ??
        (shown ? cache.peek(shown.key) : undefined);
      if (url) urls.set(page, url);
    }
  }
  const visibleFailed = new Set(visible.filter((page) => failed.has(page) && !urls.has(page)));

  return { urls, failed: visibleFailed, retry };
}
