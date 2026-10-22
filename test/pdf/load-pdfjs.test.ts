import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pdfjs } from "@/lib/pdf/load-pdfjs";

/**
 * The shared pdf.js loader: error classification by name (errors cross the
 * worker boundary as structured clones, so `instanceof` is unreliable) and
 * the browser-only, retry-after-failure singleton.
 */

const mockState = vi.hoisted(() => ({ fail: false, loads: 0 }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  mockState.loads++;
  if (mockState.fail) throw new Error("chunk load failed");
  return { GlobalWorkerOptions: { workerSrc: "" }, version: "test" };
});

/** Mirrors pdf.js's own createResponseError (missing = status 404). */
function createResponseError(pdfjs: Pdfjs, status: number) {
  return new pdfjs.ResponseException(
    `Unexpected server response (${status})`,
    status,
    status === 404
  );
}

/** Shaped like pdf.js's BaseException: a plain object with a `name`. */
function pdfError(name: string, extra: Record<string, unknown> = {}) {
  return Object.assign(Object.create(Error.prototype), { name, message: name, ...extra });
}

describe("pdfErrorKind", () => {
  it("maps a 404 ResponseException to missing", async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    expect(pdfErrorKind(pdfError("ResponseException", { status: 404, missing: true }))).toBe(
      "missing"
    );
    expect(pdfErrorKind(pdfError("ResponseException", { status: 404 }))).toBe("missing");
    expect(pdfErrorKind(pdfError("ResponseException", { status: 0, missing: true }))).toBe(
      "missing"
    );
  });

  it("treats other HTTP failures as other", async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    expect(pdfErrorKind(pdfError("ResponseException", { status: 500, missing: false }))).toBe(
      "other"
    );
  });

  it("still recognises the pre-5.x MissingPDFException", async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    expect(pdfErrorKind(pdfError("MissingPDFException"))).toBe("missing");
  });

  it("maps invalid, password and cancellation errors", async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    expect(pdfErrorKind(pdfError("InvalidPDFException"))).toBe("invalid");
    expect(pdfErrorKind(pdfError("PasswordException", { code: 1 }))).toBe("password");
    expect(pdfErrorKind(pdfError("RenderingCancelledException"))).toBe("cancelled");
    expect(pdfErrorKind(pdfError("AbortException"))).toBe("cancelled");
    // A structured-clone lookalike (no Error prototype) classifies the same.
    expect(pdfErrorKind({ name: "InvalidPDFException", message: "bad" })).toBe("invalid");
  });

  // Imports the real pdf.js build, which can outlast the default 5 s under a
  // full parallel run.
  it("agrees with the installed pdf.js exception classes", { timeout: 30_000 }, async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    const real = await vi.importActual<Pdfjs>("pdfjs-dist/legacy/build/pdf.mjs");
    const notFound = createResponseError(real, 404);
    expect(pdfErrorKind(notFound)).toBe("missing");
    expect(pdfErrorKind(createResponseError(real, 503))).toBe("other");
    expect(pdfErrorKind(new real.InvalidPDFException("bad xref"))).toBe("invalid");
    expect(pdfErrorKind(new real.AbortException("destroyed"))).toBe("cancelled");
    expect(pdfErrorKind(new real.RenderingCancelledException("cancelled"))).toBe("cancelled");
  });

  it("falls back to other for anything else", async () => {
    const { pdfErrorKind } = await import("@/lib/pdf/load-pdfjs");
    expect(pdfErrorKind(new Error("boom"))).toBe("other");
    expect(pdfErrorKind(new TypeError("x is not a function"))).toBe("other");
    expect(pdfErrorKind(pdfError("UnknownErrorException"))).toBe("other");
    expect(pdfErrorKind("InvalidPDFException")).toBe("other");
    expect(pdfErrorKind(null)).toBe("other");
    expect(pdfErrorKind(undefined)).toBe("other");
  });
});

describe("loadPdfjs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockState.fail = false;
  });

  it("refuses to load outside the browser", async () => {
    const { loadPdfjs } = await import("@/lib/pdf/load-pdfjs");
    vi.stubGlobal("window", undefined);
    await expect(loadPdfjs()).rejects.toThrow(/browser/);
  });

  it("retries after a failed import, then shares one module with the legacy worker", async () => {
    vi.resetModules();
    const { loadPdfjs, PDF_WORKER_SRC } = await import("@/lib/pdf/load-pdfjs");
    expect(PDF_WORKER_SRC).toBe("/pdf.worker.legacy.min.mjs");

    mockState.fail = true;
    await expect(loadPdfjs()).rejects.toThrow();
    const failedLoads = mockState.loads;

    mockState.fail = false;
    const first = loadPdfjs();
    const second = loadPdfjs();
    expect(second).toBe(first);
    const pdfjs = await first;
    // The failed promise was dropped, so the import really ran again.
    expect(mockState.loads).toBe(failedLoads + 1);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(PDF_WORKER_SRC);
    expect(await loadPdfjs()).toBe(pdfjs);
  });
});
