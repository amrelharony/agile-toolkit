import { VISITOR_TIME_LIMIT_FINISH } from "./contract";

/**
 * The visitor route's own time limit for one answer.
 *
 * The platform stops a function at its maxDuration without a word: the stream
 * just ends, and the browser can't tell a finished answer from one cut in the
 * middle. So the route ends a long answer itself, a little earlier, and says
 * so: it closes the stream with one last event whose finish_reason is
 * VISITOR_TIME_LIMIT_FINISH, and the chat shows the visitor a note.
 */

/**
 * How long one request may run, from the moment it arrives, before the route
 * ends the answer. Must stay well under the route's maxDuration (300 s), so the
 * last event is out before the platform stops the function;
 * test/api/agent-visitor-route.test.ts checks the gap.
 */
export const VISITOR_STREAM_DEADLINE_MS = 285_000;

/**
 * The last bytes of an answer ended at the time limit. The blank line first
 * closes an event the gateway was half way through (the browser drops the
 * broken event; an empty one is ignored), then the finish event and [DONE].
 */
export function timeLimitTail(): Uint8Array {
  const finish = {
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: VISITOR_TIME_LIMIT_FINISH }],
  };
  return new TextEncoder().encode(`\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`);
}

/**
 * Pass `source` through until `timeoutMs` from now. At that moment, send `tail`,
 * close the stream cleanly (never an error: the reader keeps what it has), stop
 * reading the source and call `onDeadline`. A source that ends, fails or is
 * cancelled first clears the timer, and `stop()` does the same from outside
 * (the visitor left).
 *
 * The clock also goes off the moment the source itself is over (closed with
 * nothing left to read, or failed), read or not. A reader that has stopped
 * reading would otherwise hide that end until its next read, and the limit
 * would add its tail to an answer that had already ended another way. At the
 * limit only what this stream already holds goes out before the tail; anything
 * the source still had waiting is dropped with it, the model's own finish
 * included.
 *
 * Unlike idleTimeoutStream (lib/agent/upstream.ts), the clock is never renewed
 * by a chunk: it is the whole answer's limit, not the gap between two chunks.
 */
export function deadlineStream(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number,
  tail: Uint8Array,
  onDeadline: () => void
): { stream: ReadableStream<Uint8Array>; stop: () => void } {
  const reader = source.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  // The source is over, whether or not anyone is reading this stream: the next
  // read passes that end on, so the limit has nothing left to end.
  reader.closed.then(stop, stop);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(
        () => {
          timer = undefined;
          if (finished) return;
          finished = true;
          try {
            controller.enqueue(tail);
            controller.close();
          } catch {
            // Already closed or cancelled by the reader: nothing to tell it.
          }
          reader.cancel().catch(() => {});
          onDeadline();
        },
        Math.max(0, timeoutMs)
      );
    },
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        if (finished) return;
        finished = true;
        stop();
        controller.error(err);
        return;
      }
      // The deadline passed while this read was waiting: the stream is closed.
      if (finished) return;
      if (result.done) {
        finished = true;
        stop();
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      finished = true;
      stop();
      return reader.cancel(reason).catch(() => {});
    },
  });

  return { stream, stop };
}
