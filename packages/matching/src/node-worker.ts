import { parentPort } from "node:worker_threads";
import { MatchingEngine } from "./engine.js";
import type { RequestMessage } from "./executor.js";

const engine = new MatchingEngine();
parentPort!.on("message", async ({ id, request, assetUrl }: RequestMessage) => {
  try {
    parentPort!.postMessage({
      id,
      result: await engine.match(
        request,
        { onProgress: (progress) => parentPort!.postMessage({ id, progress }) },
        assetUrl,
      ),
    });
  } catch (error) {
    parentPort!.postMessage({
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
});
