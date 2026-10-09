import { MatchingEngine } from "./engine.js";
import type { RequestMessage, ResponseMessage } from "./executor.js";

const engine = new MatchingEngine();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<RequestMessage>) => void;
  postMessage: (value: ResponseMessage) => void;
};
scope.onmessage = async ({ data: { id, request, assetUrl } }) => {
  try {
    scope.postMessage({
      id,
      result: await engine.match(
        request,
        { onProgress: (progress) => scope.postMessage({ id, progress }) },
        assetUrl,
      ),
    });
  } catch (error) {
    scope.postMessage({
      id,
      error: {
        code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "BACKEND",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
