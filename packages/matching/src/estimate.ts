import type { Cv } from "./backend.js";
import type { Pair } from "./features.js";
import { distance, transform } from "./geometry.js";
import type { Correspondence, Matrix3, Region } from "./types.js";
/** A geometric hypothesis and the pairs within the reprojection threshold of it. */
export interface Hypothesis {
  matrix: Matrix3;
  inliers: Correspondence[];
}
/** Forward residual in reference pixels; nonfinite at a projective pole. */
export const residual = (h: Matrix3, p: Correspondence) =>
  distance(transform(h, p.query), p.reference);
/**
 * Robustly fit one model with OpenCV RANSAC. A similarity needs 2-point samples,
 * so it still converges when only a few percent of the pairs are correct, where
 * 4-point homography sampling does not.
 */
export function estimate(
  cv: Cv,
  pairs: Correspondence[],
  kind: "similarity" | "homography",
  threshold: number,
): Hypothesis | undefined {
  if (pairs.length < (kind === "similarity" ? 2 : 4)) return;
  const a = cv.matFromArray(
      pairs.length,
      1,
      cv.CV_32FC2,
      pairs.flatMap((p) => p.query),
    ),
    b = cv.matFromArray(
      pairs.length,
      1,
      cv.CV_32FC2,
      pairs.flatMap((p) => p.reference),
    ),
    mask = new cv.Mat();
  let model: ReturnType<Cv["matFromArray"]> | undefined;
  try {
    model =
      kind === "similarity"
        ? cv.estimateAffinePartial2D(
            a,
            b,
            mask,
            cv.RANSAC,
            threshold,
            5000,
            0.995,
            10,
          )
        : cv.findHomography(a, b, cv.RANSAC, threshold, mask, 5000, 0.995);
    if (model.empty()) return;
    const data = Array.from(model.data64F as Float64Array),
      matrix = (data.length === 6 ? [...data, 0, 0, 1] : data) as Matrix3;
    if (!matrix.every(Number.isFinite)) return;
    return { matrix, inliers: pairs.filter((_, i) => mask.data[i]) };
  } finally {
    a.delete();
    b.delete();
    mask.delete();
    model?.delete();
  }
}
/**
 * Local optimisation: refit a homography on the current support and re-collect
 * support from all pairs until it stops growing. A similarity seed found on a
 * perspective plan only covers part of it; refinement extends it to the whole.
 */
export function refine(
  cv: Cv,
  seed: Hypothesis,
  pairs: Correspondence[],
  threshold: number,
): Hypothesis {
  let best: Hypothesis = {
    matrix: seed.matrix,
    inliers: pairs.filter((p) => residual(seed.matrix, p) <= threshold),
  };
  for (let round = 0; round < 4; round++) {
    const fit = estimate(cv, best.inliers, "homography", threshold);
    if (!fit) break;
    const inliers = pairs.filter((p) => residual(fit.matrix, p) <= threshold);
    if (inliers.length <= best.inliers.length) break;
    best = { matrix: fit.matrix, inliers };
  }
  return best;
}
/**
 * Best refined hypothesis from several deterministic generators; ties keep the
 * earlier generator. Subsets (for example a rotation/scale vote peak) only seed
 * a hypothesis; its support is always collected from all remaining pairs.
 */
export function strongest(
  cv: Cv,
  pairs: Correspondence[],
  subsets: Correspondence[][],
  threshold: number,
): Hypothesis | undefined {
  let best: Hypothesis | undefined;
  const seeds = [
    ...subsets.map((s) => estimate(cv, s, "similarity", threshold)),
    estimate(cv, pairs, "similarity", threshold),
    estimate(cv, pairs, "homography", threshold),
  ];
  for (const seed of seeds) {
    if (!seed) continue;
    const refined = refine(cv, seed, pairs, threshold);
    if (!best || refined.inliers.length > best.inliers.length) best = refined;
  }
  return best;
}
/**
 * Lowe-style Hough vote. Each pair's keypoint rotation and scale, applied to its
 * query offset from the region centre, predicts where that centre lands in the
 * reference. Votes go to the two nearest bins in rotation (30°), scale (one
 * octave) and predicted x/y (a quarter of the region size at that scale). Correct
 * pairs of one placement share a bin while false pairs spread over the whole
 * search area, so the peak seeds RANSAC with a far higher inlier ratio. Returns
 * nothing when the peak is too small or not selective.
 */
export function votePeak(
  pairs: Pair[],
  minimum: number,
  region: Region,
): Pair[] | undefined {
  const cx = region.x + region.width / 2,
    cy = region.y + region.height / 2,
    size = Math.max(region.width, region.height),
    bins = new Map<string, Pair[]>();
  // The two nearest bins of a value measured in bin widths.
  const near = (v: number) => {
    const b = Math.floor(v - 0.5);
    return [b, b + 1];
  };
  for (const p of pairs) {
    const s = 2 ** p.scale,
      t = (p.rotation * Math.PI) / 180,
      dx = cx - p.query[0],
      dy = cy - p.query[1],
      x = p.reference[0] + s * (Math.cos(t) * dx - Math.sin(t) * dy),
      y = p.reference[1] + s * (Math.sin(t) * dx + Math.cos(t) * dy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    for (const a of near(p.rotation / 30))
      for (const o of near(p.scale)) {
        const cell = 0.25 * size * 2 ** (o + 0.5);
        for (const i of near(x / cell))
          for (const j of near(y / cell)) {
            const key = `${(a + 12) % 12},${o},${i},${j}`,
              members = bins.get(key);
            if (members) members.push(p);
            else bins.set(key, [p]);
          }
      }
  }
  let peak: Pair[] = [];
  for (const members of bins.values())
    if (members.length > peak.length) peak = members;
  return peak.length >= minimum && peak.length < pairs.length
    ? peak
    : undefined;
}
