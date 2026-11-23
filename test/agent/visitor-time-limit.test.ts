// @vitest-environment node
/**
 * lib/visitor-ai/time-limit.ts: the visitor route's own end for an answer that
 * runs too long.
 *
 * The platform stops a function at maxDuration without a word, so the route
 * ends a long answer itself, earlier, with a last event the chat understands.
 * What matters here: the clock runs from the start and is never renewed by a
 * chunk; at the limit the stream closes cleanly (never an error) with the tail
 * after everything already sent; the source is told to stop; and the timer is
 * gone however the stream ends first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VISITOR_TIME_LIMIT_FINISH } from "@/lib/visitor-ai/contract";
import {
  VISITOR_STREAM_DEADLINE_MS,
  deadlineStream,
  timeLimitTail,
} from "@/lib/visitor-ai/time-limit";

const enc = new TextEncoder();
const dec = new TextDecoder();
const TAIL = enc.encode("<tail>");

/** A source the test drives by hand, plus whether the wrapper cancelled it. */
function manualSource() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
    cancel,
  });
  return {
    stream,
    cancel,
    push: (s: string) => ctl.enqueue(enc.encode(s)),
    close: () => ctl.close(),
    fail: (e: Error) => ctl.error(e),
  };
}

describe("timeLimitTail", () => {
  const tail = dec.decode(timeLimitTail());

  it("is a finish event with the route's own reason, then [DONE]", () => {
    const events = tail.split("\n\n").filter((e) => e.length > 0);
    expect(events).toHaveLength(2);
    expect(events[0].startsWith("data: ")).toBe(true);
    expect(JSON.parse(events[0].slice(6))).toEqual({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: VISITOR_TIME_LIMIT_FINISH }],
    });
    expect(events[1]).toBe("data: [DONE]");
    expect(tail.endsWith("\n\n")).toBe(true);
  });

  it("starts with a blank line, so an event the gateway was half way through can't swallow it", () => {
    expect(tail.startsWith("\n\n")).toBe(true);
    const half = 'data: {"choices":[{"delta":{"con';
    const events = (half + tail).split("\n\n").filter((e) => e.length > 0);
    // The half event stays on its own (the chat drops what doesn't parse).
    expect(events[0]).toBe(half);
    expect(JSON.parse(events[1].slice(6)).choices[0].finish_reason).toBe(VISITOR_TIME_LIMIT_FINISH);
    expect(events[2]).toBe("data: [DONE]");
  });

  it("uses a reason no model sends", () => {
    for (const real of ["stop", "length", "tool_calls", "content_filter", "function_call"]) {
      expect(VISITOR_TIME_LIMIT_FINISH).not.toBe(real);
    }
  });
});

describe("the limit itself", () => {
  it("is a whole number of seconds, long enough for a full answer", () => {
    expect(VISITOR_STREAM_DEADLINE_MS % 1000).toBe(0);
    expect(VISITOR_STREAM_DEADLINE_MS).toBeGreaterThanOrEqual(240_000);
  });
});

describe("deadlineStream", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a stream that ends in time through whole, and leaves no timer", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const { stream } = deadlineStream(src.stream, 100, TAIL, onDeadline);
    const text = new Response(stream).text();
    src.push("a");
    await vi.advanceTimersByTimeAsync(40);
    src.push("b");
    await vi.advanceTimersByTimeAsync(40);
    src.push("c");
    src.close();
    expect(await text).toBe("abc");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();
    expect(src.cancel).not.toHaveBeenCalled();
  });

  it("ends a lively stream at the limit: chunks never renew the clock", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const { stream } = deadlineStream(src.stream, 100, TAIL, onDeadline);
    let ended = false;
    // text() rejects on a stream error, so this also checks the close is clean.
    const text = new Response(stream).text().finally(() => (ended = true));
    // A chunk every 30 ms, well inside the limit each time.
    for (const chunk of ["a", "b", "c"]) {
      await vi.advanceTimersByTimeAsync(30);
      src.push(chunk);
    }
    await vi.advanceTimersByTimeAsync(9);
    expect(ended).toBe(false);
    expect(onDeadline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(await text).toBe("abc<tail>");
    expect(onDeadline).toHaveBeenCalledTimes(1);
    expect(src.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a silent stream at the limit too, with only the tail", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const text = new Response(deadlineStream(src.stream, 50, TAIL, onDeadline).stream).text();
    await vi.advanceTimersByTimeAsync(50);
    expect(await text).toBe("<tail>");
    expect(onDeadline).toHaveBeenCalledTimes(1);
  });

  it("sends the tail after chunks the reader hasn't taken yet", async () => {
    const src = manualSource();
    const reader = deadlineStream(src.stream, 50, TAIL, vi.fn()).stream.getReader();
    src.push("waiting");
    // Nobody reads until after the limit.
    await vi.advanceTimersByTimeAsync(50);
    const got: string[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      got.push(dec.decode(r.value));
    }
    expect(got.join("")).toBe("waiting<tail>");
  });

  it("drops what the source still held at the limit: only its own waiting chunk goes before the tail", async () => {
    const src = manualSource();
    const reader = deadlineStream(src.stream, 50, TAIL, vi.fn()).stream.getReader();
    // Nobody reads, so only the first chunk moves into this stream; the other
    // two stay in the source, and go when the limit cancels it.
    src.push("one");
    src.push("two");
    src.push("three");
    await vi.advanceTimersByTimeAsync(50);
    const got: string[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      got.push(dec.decode(r.value));
    }
    expect(got).toEqual(["one", "<tail>"]);
    expect(src.cancel).toHaveBeenCalledTimes(1);
  });

  it("a limit already passed ends the stream at once", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const text = new Response(deadlineStream(src.stream, -5000, TAIL, onDeadline).stream).text();
    await vi.advanceTimersByTimeAsync(0);
    expect(await text).toBe("<tail>");
    expect(onDeadline).toHaveBeenCalledTimes(1);
    expect(src.cancel).toHaveBeenCalledTimes(1);
  });

  it("stops the timer and passes the error on when the source fails first", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const reader = deadlineStream(src.stream, 100, TAIL, onDeadline).stream.getReader();
    src.push("first");
    expect(dec.decode((await reader.read()).value)).toBe("first");
    const next = reader.read().then(
      () => "data",
      (e: Error) => e.message
    );
    src.fail(new Error("upstream_idle_timeout"));
    expect(await next).toBe("upstream_idle_timeout");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();
  });

  it("stops the timer when the source ends while nobody is reading", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const reader = deadlineStream(src.stream, 100, TAIL, onDeadline).stream.getReader();
    src.push("last");
    await vi.advanceTimersByTimeAsync(10);
    // This stream holds the chunk and has stopped asking the source for more,
    // so no read of its own will tell it the source is over.
    expect(vi.getTimerCount()).toBe(1);
    src.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();
    expect(src.cancel).not.toHaveBeenCalled();

    // A reader that comes back gets the answer as the source ended it: no tail.
    expect(dec.decode((await reader.read()).value)).toBe("last");
    expect((await reader.read()).done).toBe(true);
  });

  it("stops the timer when the source fails while nobody is reading, and passes the error on later", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const reader = deadlineStream(src.stream, 100, TAIL, onDeadline).stream.getReader();
    src.push("last");
    await vi.advanceTimersByTimeAsync(10);
    src.fail(new Error("terminated"));
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();

    // Never a clean "time limit" end for an answer that broke.
    expect(dec.decode((await reader.read()).value)).toBe("last");
    await expect(reader.read()).rejects.toThrow("terminated");
  });

  it("keeps the clock on while an ended source still holds chunks nobody took", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const reader = deadlineStream(src.stream, 100, TAIL, onDeadline).stream.getReader();
    src.push("one");
    src.push("two");
    src.close();
    await vi.advanceTimersByTimeAsync(10);
    // "two" is still waiting in the source, so the answer isn't over yet.
    expect(vi.getTimerCount()).toBe(1);

    // Read in time, it comes through whole and the clock goes off.
    const got: string[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      got.push(dec.decode(r.value));
    }
    expect(got).toEqual(["one", "two"]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();
  });

  it("stops the timer when the reader cancels (the browser went away)", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const reader = deadlineStream(src.stream, 100, TAIL, onDeadline).stream.getReader();
    src.push("first");
    await reader.read();
    await reader.cancel("gone");
    expect(src.cancel).toHaveBeenCalledWith("gone");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDeadline).not.toHaveBeenCalled();
  });

  it("stop() turns the clock off but keeps passing chunks through", async () => {
    const src = manualSource();
    const onDeadline = vi.fn();
    const { stream, stop } = deadlineStream(src.stream, 50, TAIL, onDeadline);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    const text = new Response(stream).text();
    await vi.advanceTimersByTimeAsync(200);
    src.push("late");
    src.close();
    expect(await text).toBe("late");
    expect(onDeadline).not.toHaveBeenCalled();
  });
});
