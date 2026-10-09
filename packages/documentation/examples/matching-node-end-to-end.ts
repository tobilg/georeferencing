import type {
  Extent,
  PixelImage,
  ReferenceSelection,
  XY,
} from "@georeferencing/matching";
import {
  createSnapshot,
  createWmsProvider,
  transform,
} from "@georeferencing/matching";
import { createNodeMatcher } from "@georeferencing/matching/node";

/** Any decoder that returns packed RGBA with EXIF orientation applied. */
export type Decode = (input: Blob | Uint8Array) => Promise<PixelImage>;

// Fetch the search area from a WMS server, locate the plan in it and return the
// plan's corners in map coordinates.
export async function locatePlan(
  planFile: Uint8Array,
  selection: ReferenceSelection,
  decode: Decode,
  signal?: AbortSignal,
) {
  const query = await decode(planFile);
  const reference = await createWmsProvider({
    url: "https://example.org/wms",
    source: {
      id: "orthophoto",
      revision: "2026",
      layers: [...selection.layers],
    },
    decode,
  }).acquire(selection, signal);

  const matcher = createNodeMatcher();
  try {
    const result = await matcher.match({ query, reference }, { signal });
    const best = result.candidates[0];
    if (result.status !== "matched" || !best) return { status: result.status };

    // Plan pixel → reference pixel (candidate) → map coordinates (snapshot).
    const toMap = (p: XY) =>
      transform(reference.pixelToMap, transform(best.transform, p));
    const { width, height } = query;
    return {
      status: result.status,
      crs: reference.crs,
      corners: (
        [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ] as XY[]
      ).map(toMap),
    };
  } finally {
    matcher.dispose();
  }
}

// Alternative reference: a north-up georeferenced image you already have, such as
// a decoded orthophoto whose extent and CRS you know.
export function orthophotoReference(
  pixels: PixelImage,
  extent: Extent,
  crs: string,
) {
  return createSnapshot({
    id: "orthophoto-2026",
    width: pixels.width,
    height: pixels.height,
    crs,
    extent,
    source: { id: "orthophoto", revision: "2026", layers: ["orthophoto"] },
    tiles: [{ ...pixels, x: 0, y: 0 }],
  });
}
