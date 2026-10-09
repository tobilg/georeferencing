import { MatchingError } from "./types.js";
// OpenCV's generated Embind surface is checked at runtime; declarations cannot prove exports.
// biome-ignore lint/suspicious/noExplicitAny: isolated generated WASM ABI
export type Cv = Record<string, any>;
export const BACKEND_VERSION = "opencv/4.12.0-georeferencing.1";
export function checkCapabilities(cv: Cv): void {
  const required = [
    "Mat",
    "KeyPointVector",
    "DMatchVectorVector",
    "SIFT",
    "AKAZE",
    "BFMatcher",
    "findHomography",
    "perspectiveTransform",
    "matFromArray",
  ];
  const missing = required.filter((k) => typeof cv[k] !== "function");
  if (missing.length)
    throw new MatchingError(
      "BACKEND",
      `OpenCV backend is missing: ${missing.join(", ")}. Use the matching package's pinned artifact.`,
    );
}
export function backendError(cv: Cv | undefined, error: unknown): Error {
  if (error instanceof Error) return error;
  const pointer =
    typeof error === "number"
      ? error
      : error && typeof error === "object" && "excPtr" in error
        ? error.excPtr
        : undefined;
  let message = "OpenCV operation failed within its memory/geometry limits.";
  if (typeof pointer === "number" && cv?.exceptionFromPtr) {
    try {
      message = String(cv.exceptionFromPtr(pointer).msg ?? message);
    } catch {
      /* Unknown C++ exception type. */
    }
  }
  return new MatchingError(
    /memory|alloc/i.test(message) ? "BUDGET" : "BACKEND",
    message,
  );
}
export async function loadBackend(assetUrl?: string): Promise<Cv> {
  try {
    const { default: factory } = await import("./vendor/opencv.js");
    const cv = await factory(assetUrl ? { locateFile: () => assetUrl } : {});
    checkCapabilities(cv);
    const point = cv.matFromArray(1, 1, cv.CV_32FC2, [2, 3]),
      matrix = cv.matFromArray(3, 3, cv.CV_64F, [1, 0, 7, 0, 1, 9, 0, 0, 1]),
      output = new cv.Mat();
    try {
      cv.perspectiveTransform(point, output, matrix);
      if (output.data32F[0] !== 9 || output.data32F[1] !== 12)
        throw new MatchingError(
          "BACKEND",
          "Point transformation capability failed.",
        );
    } finally {
      point.delete();
      matrix.delete();
      output.delete();
    }
    return cv;
  } catch (error) {
    if (error instanceof MatchingError) throw error;
    throw new MatchingError(
      "BACKEND",
      `Cannot initialize local OpenCV WASM: ${String(error)}`,
    );
  }
}
