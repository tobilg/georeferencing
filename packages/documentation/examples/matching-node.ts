import type { PixelImage, ReferenceSnapshot } from "@georeferencing/matching";
import { createNodeMatcher } from "@georeferencing/matching/node";

export async function matchInNode(
  query: PixelImage,
  reference: ReferenceSnapshot,
  signal?: AbortSignal,
) {
  const matcher = createNodeMatcher();
  try {
    return await matcher.match(
      { query, reference, options: { maxMemoryBytes: 1024 ** 3 } },
      { signal },
    );
  } finally {
    matcher.dispose();
  }
}
