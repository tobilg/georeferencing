import type { PixelImage, ReferenceSnapshot } from "@georeferencing/matching";
import { createBrowserMatcher } from "@georeferencing/matching/browser";

// Buffers use EXIF-normalized original pixel edges. Acquisition/decoding is host-owned.
export async function matchInBrowser(
  query: PixelImage,
  reference: ReferenceSnapshot,
  signal?: AbortSignal,
) {
  const matcher = createBrowserMatcher();
  try {
    return await matcher.match({ query, reference }, { signal });
  } finally {
    matcher.dispose();
  }
}
