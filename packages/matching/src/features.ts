import type { Cv } from "./backend.js";
import { distance, processingToQuery, transform } from "./geometry.js";
import type { Sample } from "./pixels.js";
import { grayscale } from "./pixels.js";
import type { Correspondence, MatchOptions, Region, XY } from "./types.js";
export interface Features {
  points: XY[];
  /** Keypoint orientation in degrees, as OpenCV reports it. */
  angles: number[];
  /** Keypoint diameter in original image pixels. */
  sizes: number[];
  descriptors: Float32Array | Uint8Array;
  columns: number;
}
/** A coarse level (when the region exceeds 1024 px) plus haloed processing tiles. */
export function extractionWindows(
  region: Region,
  options: Pick<MatchOptions, "tileSize">,
): { region: Region; width: number; height: number }[] {
  const windows: { region: Region; width: number; height: number }[] = [];
  const scale = Math.min(1, 1024 / Math.max(region.width, region.height));
  if (scale < 1)
    windows.push({
      region,
      width: Math.max(1, Math.round(region.width * scale)),
      height: Math.max(1, Math.round(region.height * scale)),
    });
  const size = options.tileSize,
    halo = 96;
  for (let y = region.y; y < region.y + region.height; y += size)
    for (let x = region.x; x < region.x + region.width; x += size) {
      const x0 = Math.max(region.x, x - halo),
        y0 = Math.max(region.y, y - halo),
        x1 = Math.min(region.x + region.width, x + size + halo),
        y1 = Math.min(region.y + region.height, y + size + halo);
      windows.push({
        region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        width: Math.ceil(x1 - x0),
        height: Math.ceil(y1 - y0),
      });
    }
  return windows;
}
/** Overlapping extraction windows share ONE global coordinate space, independent of acquisition tiles. */
export function extract(
  cv: Cv,
  sample: Sample,
  region: Region,
  options: MatchOptions,
  progress: () => void,
): Features {
  const points: XY[] = [],
    angles: number[] = [],
    sizes: number[] = [],
    seen = new Map<string, XY[]>();
  let columns = 0;
  let descriptors: Float32Array | Uint8Array | undefined;
  const windows = extractionWindows(region, options);
  // Round-robin spatial budgets keep dense text from consuming every descriptor.
  const perWindow = Math.min(
    options.featuresPerTile,
    Math.floor(options.maxFeatures / windows.length),
  );
  const detector =
    options.detector === "sift"
      ? new cv.SIFT(options.featuresPerTile * 2)
      : new cv.AKAZE();
  try {
    for (const window of windows) {
      const p = grayscale(
          sample,
          window.region,
          window.width,
          window.height,
          options,
        ),
        gray = cv.matFromArray(window.height, window.width, cv.CV_8UC1, p.gray),
        mask = cv.matFromArray(window.height, window.width, cv.CV_8UC1, p.mask),
        keys = new cv.KeyPointVector(),
        desc = new cv.Mat();
      try {
        detector.detectAndCompute(gray, mask, keys, desc);
        columns = desc.cols || columns;
        if (columns && !descriptors)
          descriptors =
            options.detector === "sift"
              ? new Float32Array(options.maxFeatures * columns)
              : new Uint8Array(options.maxFeatures * columns);
        const factor = window.region.width / window.width;
        const candidates = Array.from({ length: keys.size() }, (_, i) => {
          const k = keys.get(i);
          return {
            i,
            angle: k.angle as number,
            size: (k.size as number) * factor,
            point: transform(
              processingToQuery(window.region, window.width, window.height),
              [k.pt.x, k.pt.y],
            ),
            response: k.response,
          };
        }).sort((a, b) => b.response - a.response || a.i - b.i);
        const bins = new Map<string, number>();
        let count = 0;
        for (const item of candidates) {
          if (count >= perWindow) break;
          const p = item.point,
            key = `${Math.floor(p[0] / 3)},${Math.floor(p[1] / 3)}`;
          let duplicate = false;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (
                seen
                  .get(
                    `${Math.floor(p[0] / 3) + dx},${Math.floor(p[1] / 3) + dy}`,
                  )
                  ?.some((q) => distance(p, q) < 3)
              )
                duplicate = true;
          if (duplicate) continue;
          const bin = `${Math.floor(((p[0] - window.region.x) / window.region.width) * 4)},${Math.floor(((p[1] - window.region.y) / window.region.height) * 4)}`;
          if ((bins.get(bin) ?? 0) >= Math.ceil(perWindow / 12)) continue;
          bins.set(bin, (bins.get(bin) ?? 0) + 1);
          const data = options.detector === "sift" ? desc.data32F : desc.data;
          descriptors!.set(
            data.subarray(item.i * desc.cols, (item.i + 1) * desc.cols),
            points.length * columns,
          );
          points.push(p);
          angles.push(item.angle);
          sizes.push(item.size);
          seen.set(key, [...(seen.get(key) ?? []), p]);
          count++;
        }
      } finally {
        gray.delete();
        mask.delete();
        keys.delete();
        desc.delete();
      }
      progress();
    }
  } finally {
    detector.delete();
  }
  return {
    points,
    angles,
    sizes,
    columns,
    descriptors:
      descriptors?.subarray(0, points.length * columns) ?? new Uint8Array(),
  };
}
/**
 * Minimum descriptor distance from a query feature to its nearest OTHER query
 * feature. OpenCV SIFT descriptors have an L2 norm of about 512, so 80 is about
 * 16% of it; AKAZE's 486-bit descriptors make 10 bits about 2%. Closer twins are
 * repeated glyphs, not independent location evidence. Absolute, because the
 * query's own distance distribution says nothing about which twins are harmful;
 * the repeated-glyph regression test pins these values.
 */
const SELF_DISTINCT = { sift: 80, akaze: 10 } as const;
/** A tentative pair with the relative keypoint rotation (degrees) and log2 scale it implies. */
export interface Pair extends Correspondence {
  rotation: number;
  scale: number;
}
/** Reverse ratio test retains multiple distinct reference copies of each query feature. */
export function pairFeatures(
  cv: Cv,
  q: Features,
  r: Features,
  o: MatchOptions,
): Pair[] {
  if (q.points.length < 2 || r.points.length < 2) return [];
  const type = o.detector === "sift" ? cv.CV_32F : cv.CV_8U,
    a = cv.matFromArray(q.points.length, q.columns, type, q.descriptors),
    b = cv.matFromArray(r.points.length, r.columns, type, r.descriptors),
    matcher = new cv.BFMatcher(
      o.detector === "sift" ? cv.NORM_L2 : cv.NORM_HAMMING,
      false,
    ),
    matches = new cv.DMatchVectorVector(),
    selfMatches = new cv.DMatchVectorVector();
  try {
    // Near-identical glyphs are not independent location evidence. Test ambiguity
    // within the query, while preserving multiple copies in the reference.
    matcher.knnMatch(a, a, selfMatches, 2);
    const distinctive = new Set<number>();
    for (let i = 0; i < selfMatches.size(); i++) {
      const row = selfMatches.get(i);
      try {
        if (
          row.size() === 2 &&
          row.get(1).distance >= SELF_DISTINCT[o.detector]
        )
          distinctive.add(i);
      } finally {
        row.delete();
      }
    }
    matcher.knnMatch(b, a, matches, 2);
    const result: Pair[] = [];
    for (let i = 0; i < matches.size(); i++) {
      const v = matches.get(i);
      try {
        if (v.size() < 2) continue;
        const x = v.get(0),
          y = v.get(1);
        if (distinctive.has(x.trainIdx) && x.distance < o.ratio * y.distance)
          result.push({
            query: q.points[x.trainIdx],
            reference: r.points[x.queryIdx],
            distance: x.distance / Math.max(1, y.distance),
            rotation:
              (((r.angles[x.queryIdx] - q.angles[x.trainIdx]) % 360) + 360) %
              360,
            scale: Math.log2(r.sizes[x.queryIdx] / q.sizes[x.trainIdx]),
          });
      } finally {
        v.delete();
      }
    }
    return result;
  } finally {
    a.delete();
    b.delete();
    matcher.delete();
    matches.delete();
    selfMatches.delete();
  }
}
