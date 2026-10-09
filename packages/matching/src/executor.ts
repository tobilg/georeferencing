import { validateRequest } from "./pixels.js";
import type {
  ImageMatcher,
  MatchExecution,
  MatchProgress,
  MatchRequest,
  MatchResult,
} from "./types.js";
import { MatchingError } from "./types.js";
export interface WorkerPort {
  postMessage(value: unknown): void;
  terminate(): void;
  listen(
    message: (value: ResponseMessage) => void,
    error: (error: Error) => void,
  ): void;
}
export interface RequestMessage {
  id: number;
  request: MatchRequest;
  assetUrl?: string;
}
export type ResponseMessage =
  | { id: number; progress: MatchProgress }
  | { id: number; result: MatchResult }
  | { id: number; error: { code: string; message: string } };
/** Clone-on-post preserves caller buffers. One active job; abort terminates even synchronous WASM. */
export function createExecutor(
  factory: () => WorkerPort,
  assetUrl?: string,
): ImageMatcher {
  let worker: WorkerPort | undefined,
    disposed = false,
    id = 0,
    pending: ((error: Error) => void) | undefined;
  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };
  return {
    match(request: MatchRequest, execution: MatchExecution = {}) {
      if (disposed)
        return Promise.reject(
          new MatchingError("DISPOSED", "Matcher is disposed."),
        );
      if (pending)
        return Promise.reject(
          new MatchingError(
            "BUSY",
            "One matching job is allowed per instance.",
          ),
        );
      try {
        validateRequest(request);
        execution.signal?.throwIfAborted();
      } catch (e) {
        return Promise.reject(e);
      }
      return new Promise<MatchResult>((resolve, reject) => {
        const job = ++id;
        let settled = false;
        const finish = (error?: Error, result?: MatchResult) => {
          if (settled) return;
          settled = true;
          execution.signal?.removeEventListener("abort", abort);
          pending = undefined;
          if (error) reject(error);
          else resolve(result!);
        };
        const abort = () => {
          stop();
          finish(new DOMException("Matching cancelled", "AbortError"));
        };
        pending = (error) => {
          stop();
          finish(error);
        };
        execution.signal?.addEventListener("abort", abort, { once: true });
        try {
          worker ??= factory();
          worker.listen(
            (value) => {
              if (value.id !== job || settled) return;
              if ("progress" in value) execution.onProgress?.(value.progress);
              else if ("result" in value) finish(undefined, value.result);
              else {
                stop();
                finish(
                  new MatchingError(
                    value.error.code as MatchingError["code"],
                    value.error.message,
                  ),
                );
              }
            },
            (error) => {
              stop();
              finish(error);
            },
          );
          worker.postMessage({ id: job, request, assetUrl });
        } catch (e) {
          stop();
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending?.(new MatchingError("DISPOSED", "Matcher disposed."));
      stop();
    },
  };
}
