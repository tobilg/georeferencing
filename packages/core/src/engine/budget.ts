import type { Limits } from "../core/types.js";
import { fail } from "../core/types.js";

/**
 * Check input/output pixel limits and a conservative byte reservation before allocating full buffers.
 *
 * Estimate: input pixels × 20 + output pixels × (24 for Deflate, otherwise 12) + compressed file bytes × 2. This accounts for expected copies, not measured heap or GPU use.
 * @returns Estimated peak bytes.
 * @throws {@link core.GeoreferenceError} For invalid dimensions or exceeded budgets.
 */
export function checkBudget(
  width: number,
  height: number,
  limits: Limits,
  fileBytes = 0,
  outputPixels = 0,
  compressedOutput = false,
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    fail("FORMAT", "Invalid image dimensions.");
  if (width * height > limits.maxInputPixels)
    fail(
      "INPUT_BUDGET",
      `Image is ${width} × ${height}; input limit is ${limits.maxInputPixels.toLocaleString()} pixels.`,
    );
  if (outputPixels > limits.maxOutputPixels)
    fail(
      "OUTPUT_BUDGET",
      `Output exceeds ${limits.maxOutputPixels.toLocaleString()} pixels. Increase resolution size or reduce bounds.`,
    );
  // Conservative reservation: decoder/source/canvas/copies + output and encoding.
  const estimate =
    width * height * 20 +
    outputPixels * (compressedOutput ? 24 : 12) +
    fileBytes * 2;
  if (estimate > limits.maxMemoryBytes)
    fail(
      "MEMORY_BUDGET",
      `Estimated ${Math.ceil(estimate / 1048576)} MiB exceeds the configured memory budget.`,
    );
  return estimate;
}
