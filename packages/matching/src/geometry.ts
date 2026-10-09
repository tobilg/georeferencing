import { projectExtent } from "@georeferencing/core";
import type { Extent, Matrix3, Region, XY } from "./types.js";
import { MatchingError } from "./types.js";
/** Preserve core's recognized geographic wrapping restrictions before acquisition or search. */
export function validateSearchExtent(extent: Extent, crs: string): void {
  if (crs === "EPSG:4326") {
    try {
      projectExtent(extent, crs, crs);
    } catch (error) {
      throw new MatchingError(
        "INPUT",
        error instanceof Error
          ? error.message
          : "Unsupported geographic extent.",
      );
    }
  }
}
export const identity = (): Matrix3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  return Array.from({ length: 9 }, (_, i) =>
    [0, 1, 2].reduce(
      (s, k) => s + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + (i % 3)],
      0,
    ),
  ) as Matrix3;
}
/**
 * Apply a row-major homogeneous 3×3 matrix to an XY column vector.
 *
 * @param h - Mapping from the point's coordinate space to the destination space.
 * @param p - Source point; matching matrices use original pixel-edge coordinates.
 * @returns Perspective-divided destination point. This low-level helper does not
 * validate the matrix/domain: a projective pole may yield nonfinite coordinates.
 * Use validated candidates and check host projection domains before drawing.
 */
export function transform(h: Matrix3, p: XY): XY {
  const d = h[6] * p[0] + h[7] * p[1] + h[8];
  return [
    (h[0] * p[0] + h[1] * p[1] + h[2]) / d,
    (h[3] * p[0] + h[4] * p[1] + h[5]) / d,
  ];
}
export function inverse(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m,
    r: Matrix3 = [
      e * i - f * h,
      c * h - b * i,
      b * f - c * e,
      f * g - d * i,
      a * i - c * g,
      c * d - a * f,
      d * h - e * g,
      b * g - a * h,
      a * e - b * d,
    ];
  const det = a * r[0] + b * r[3] + c * r[6];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new MatchingError("GEOMETRY", "Singular transform");
  return r.map((x) => x / det) as Matrix3;
}
export const corners = (r: Region): XY[] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x + r.width, r.y + r.height],
  [r.x, r.y + r.height],
];
/** Shoelace area; positive when vertices run in the same order as {@link corners}. */
export function signedArea(p: XY[]): number {
  return (
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2
  );
}
export const area = (p: XY[]): number => Math.abs(signedArea(p));
export const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Convex polygon clipping; clip corners are counter-clockwise in numerical XY. */
export function intersect(subject: XY[], clip: XY[]): XY[] {
  let result = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length],
      input = result;
    result = [];
    const side = (p: XY) =>
      (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < input.length; j++) {
      const p = input[j],
        q = input[(j + 1) % input.length],
        sp = side(p),
        sq = side(q);
      if (sp >= -1e-8) result.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return result;
}
export function hull(points: XY[]): XY[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ps: XY[]) => {
    const h: XY[] = [];
    for (const v of ps) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], v) <= 0)
        h.pop();
      h.push(v);
    }
    return h.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}
/**
 * Map OpenCV feature centres in a resized crop to original query pixel edges.
 *
 * @param region - Crop bounds in the EXIF-normalized full-resolution query.
 * @param width - Positive resized processing width, before feature extraction.
 * @param height - Positive resized processing height, before feature extraction.
 * @returns Scale/offset matrix including the half-pixel centre correction. Integer
 * OpenCV centre `(0, 0)` maps to the centre of the crop's first processing pixel;
 * with no resize, that is `(region.x + 0.5, region.y + 0.5)`.
 */
export const processingToQuery = (
  region: Region,
  width: number,
  height: number,
): Matrix3 => [
  region.width / width,
  0,
  region.x + region.width / width / 2,
  0,
  region.height / height,
  region.y + region.height / height / 2,
  0,
  0,
  1,
];
/**
 * Adaptively transform polygon edges through a potentially nonlinear mapping.
 *
 * This numerical helper supplies points only; hosts decide styling and rendering.
 * Subdivision compares mapped midpoints with straight segments in destination
 * space, which avoids treating nonlinear CRS conversion as a single matrix.
 *
 * @param polygon - Boundary vertices in order, without repeating the first vertex.
 * @param convert - Exact source-to-destination coordinate mapping.
 * @param tolerance - Positive maximum midpoint deviation in destination units.
 * @returns Transformed/subdivided boundary without a repeated closing vertex.
 * @throws Error on nonfinite projection output, more than 20,000 segment visits,
 * or failure to meet tolerance within 16 subdivision levels. Do not draw a
 * misleading straight-edge footprint after a projection-domain failure.
 */
export function densifyBoundary(
  polygon: readonly (readonly [number, number])[],
  convert: (point: [number, number]) => [number, number],
  tolerance: number,
): [number, number][] {
  let count = 0;
  const segment = (
    a: [number, number],
    b: [number, number],
    depth: number,
  ): [number, number][] => {
    if (++count > 20000)
      throw new Error(
        "Projected matching boundary exceeds subdivision budget.",
      );
    const x = convert(a),
      y = convert(b);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const q = convert(mid);
    if (![...x, ...y, ...q].every(Number.isFinite))
      throw new Error(
        "Matching boundary is outside the map projection domain.",
      );
    if (
      Math.hypot(q[0] - (x[0] + y[0]) / 2, q[1] - (x[1] + y[1]) / 2) <=
      tolerance
    )
      return [x];
    if (depth >= 16)
      throw new Error(
        "Cannot project matching boundary within display tolerance.",
      );
    return [...segment(a, mid, depth + 1), ...segment(mid, b, depth + 1)];
  };
  return polygon.flatMap((p, i) =>
    segment([...p], [...polygon[(i + 1) % polygon.length]], 0),
  );
}
