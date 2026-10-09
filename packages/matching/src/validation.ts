import type { Fit, Gcp } from "@georeferencing/core";
import { fitTransform, forward, validateDomain } from "@georeferencing/core";
import {
  area,
  corners,
  distance,
  hull,
  intersect,
  inverse,
  signedArea,
  transform,
} from "./geometry.js";
import type { Sample } from "./pixels.js";
import { luminance } from "./pixels.js";
import type {
  Correspondence,
  MatchCandidate,
  MatchOptions,
  Matrix3,
  ReferenceSnapshot,
  Region,
  XY,
} from "./types.js";
export function distributed(
  pairs: Correspondence[],
  limit: number,
): Correspondence[] {
  if (!pairs.length) return [];
  const chosen = [pairs[0]],
    remaining = pairs.slice(1);
  while (chosen.length < limit && remaining.length) {
    let best = 0,
      value = -1;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.min(
        ...chosen.map((p) => distance(p.query, remaining[i].query)),
      );
      if (d > value) {
        value = d;
        best = i;
      }
    }
    chosen.push(remaining.splice(best, 1)[0]);
  }
  return chosen;
}
export function independent(pairs: Correspondence[]): Correspondence[] {
  const result: Correspondence[] = [];
  for (const pair of [...pairs].sort((a, b) => a.distance - b.distance))
    if (
      !result.some(
        (p) =>
          distance(p.query, pair.query) < 3 ||
          distance(p.reference, pair.reference) < 3,
      )
    )
      result.push(pair);
  return result;
}
export function toGcps(pairs: Correspondence[]): Gcp[] {
  return pairs.map((p, i) => ({
    id: `match-${i}`,
    label: i + 1,
    enabled: true,
    image: p.query,
    target: p.reference,
    crs: "pixels",
  }));
}
/** Core Helmert fits image-down to map-up. Matching has downwards Y on both sides. */
function fitPixels(gcps: Gcp[], model: MatchCandidate["model"]): Fit {
  if (model !== "helmert") return fitTransform(gcps, model);
  const fit = fitTransform(
    gcps.map((g) => ({ ...g, target: [g.target[0], -g.target[1]] })),
    model,
  );
  return {
    ...fit,
    target: {
      ...fit.target,
      center: [fit.target.center[0], -fit.target.center[1]],
    },
    y: fit.y.map((value) => -value),
    residuals: fit.residuals.map((r) => ({
      ...r,
      vector: [r.vector[0], -r.vector[1]],
    })),
  };
}
export function fitMatrix(f: Fit): Matrix3 {
  if (f.model === "projective") {
    const s = f.source.scale,
      t = f.target.scale,
      [sx, sy] = f.source.center,
      [tx, ty] = f.target.center,
      h = f.x;
    const g = h[6] / s,
      k = h[7] / s,
      l = h[8] - g * sx - k * sy;
    return [
      (t * h[0]) / s + tx * g,
      (t * h[1]) / s + tx * k,
      t * (h[2] - (h[0] * sx) / s - (h[1] * sy) / s) + tx * l,
      (t * h[3]) / s + ty * g,
      (t * h[4]) / s + ty * k,
      t * (h[5] - (h[3] * sx) / s - (h[4] * sy) / s) + ty * l,
      g,
      k,
      l,
    ];
  }
  const a = forward(f, [0, 0]),
    b = forward(f, [1, 0]),
    c = forward(f, [0, 1]);
  return [
    b[0] - a[0],
    c[0] - a[0],
    a[0],
    b[1] - a[1],
    c[1] - a[1],
    a[1],
    0,
    0,
    1,
  ];
}
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] ?? Infinity;
/**
 * Refits use disjoint spatially distributed subsets, then evaluate held-out evidence.
 *
 * @param pairs - Inliers of one geometric hypothesis.
 * @param tentative - All descriptor pairs of the job. Support is judged against
 * the pairs whose reference point falls inside this candidate's footprint, so
 * the inlier ratio does not shrink as the search area grows.
 */
export function validateCandidate(
  pairs: Correspondence[],
  tentative: Correspondence[],
  region: Region,
  reference: ReferenceSnapshot,
  options: MatchOptions,
  querySample: Sample,
  referenceSample: Sample,
): MatchCandidate {
  const evidence = independent(pairs);
  if (evidence.length < options.minInliers) throw Error("independent-support");
  const selected = distributed(evidence, 96),
    train = selected.filter((_, i) => i % 3 !== 0),
    test = selected.filter((_, i) => i % 3 === 0),
    gcps = toGcps(selected);
  let chosen:
    | { fit: Fit; h: Matrix3; error: number; stability: number }
    | undefined;
  const boundary = corners(region);
  for (const model of ["helmert", "polynomial1", "projective"] as const) {
    try {
      // Held-out error uses a 2/3 training fit; stability compares fits on the disjoint even/odd halves.
      const fit = fitPixels(gcps, model),
        a = fitPixels(toGcps(train), model),
        even = fitPixels(toGcps(selected.filter((_, i) => i % 2 === 0)), model),
        odd = fitPixels(toGcps(selected.filter((_, i) => i % 2 === 1)), model);
      validateDomain(fit, region.x + region.width, region.y + region.height);
      const error = percentile(
        test.map((p) => distance(forward(a, p.query), p.reference)),
        0.95,
      );
      const stability = Math.max(
        ...boundary.map((p) => distance(forward(even, p), forward(odd, p))),
      );
      if (
        error > options.reprojectionThreshold ||
        stability > Math.max(3, options.reprojectionThreshold * 2)
      )
        continue;
      if (
        !chosen ||
        (error < chosen.error * 0.7 && chosen.error - error > 0.15)
      ) {
        chosen = { fit, h: fitMatrix(fit), error, stability };
      }
    } catch {
      /* Degenerate model: try remaining models, never return its matrix. */
    }
  }
  if (!chosen) throw Error("unstable-model");
  const { h, fit, stability } = chosen;
  const footprint = boundary.map((p) => transform(h, p)),
    denominators = boundary.map((p) => h[6] * p[0] + h[7] * p[1] + h[8]);
  if (Math.min(...denominators) <= 0 && Math.max(...denominators) >= 0)
    throw Error("projective-pole");
  const lengths = footprint.map(
    (p, i) =>
      distance(p, footprint[(i + 1) % 4]) /
      [region.width, region.height, region.width, region.height][i],
  );
  if (
    Math.min(...lengths) < 0.05 ||
    Math.max(...lengths) > 20 ||
    Math.max(...lengths) / Math.min(...lengths) > 5 ||
    area(footprint) < region.width * region.height * 0.0025
  )
    throw Error("implausible-geometry");
  // A mirrored placement reverses the boundary's vertex order; plans are never mirrored.
  if (signedArea(footprint) <= 0) throw Error("reflected-geometry");
  const search = corners({
      x: 0,
      y: 0,
      width: reference.width,
      height: reference.height,
    }),
    overlap = intersect(footprint, search),
    inv = inverse(h),
    observable = overlap.map((p) => transform(inv, p)),
    visibleArea = area(observable),
    overlapFraction = Math.min(1, visibleArea / (region.width * region.height));
  if (visibleArea < 1) throw Error("outside-search");
  const supportCoverage = Math.min(
    1,
    area(hull(evidence.map((p) => p.query))) / visibleArea,
  );
  const minX = Math.min(...observable.map((p) => p[0])),
    maxX = Math.max(...observable.map((p) => p[0])),
    minY = Math.min(...observable.map((p) => p[1])),
    maxY = Math.max(...observable.map((p) => p[1]));
  const bins = new Set(
    evidence.map(
      (p) =>
        `${Math.min(3, Math.floor((4 * (p.query[0] - minX)) / (maxX - minX)))},${Math.min(3, Math.floor((4 * (p.query[1] - minY)) / (maxY - minY)))}`,
    ),
  );
  if (supportCoverage < 0.12 || bins.size < 5) throw Error("spatial-support");
  let validArea = 0;
  for (const t of reference.tiles)
    if (t.valid !== false)
      validArea += area(
        intersect(
          footprint,
          corners({ x: t.x, y: t.y, width: t.width, height: t.height }),
        ).map((p) => transform(inv, p)),
      );
  // Alpha availability and structural evidence are measured on a deterministic grid in QUERY space.
  let available = 0,
    inside = 0,
    edges = 0,
    agreed = 0;
  const step = Math.max(1, Math.max(region.width, region.height) / 160);
  for (let y = region.y + step / 2; y < region.y + region.height; y += step)
    for (let x = region.x + step / 2; x < region.x + region.width; x += step) {
      const q: XY = [x, y],
        r = transform(h, q);
      if (
        r[0] < 0 ||
        r[1] < 0 ||
        r[0] >= reference.width ||
        r[1] >= reference.height
      )
        continue;
      inside++;
      if (referenceSample(...r)[3] === 0) continue;
      available++;
      if (querySample(x, y)[3] === 0) continue;
      const edge = Math.max(
        Math.abs(
          luminance(querySample(x - 1, y)) - luminance(querySample(x + 1, y)),
        ),
        Math.abs(
          luminance(querySample(x, y - 1)) - luminance(querySample(x, y + 1)),
        ),
      );
      if (edge < 12) continue;
      edges++;
      let low = 255,
        high = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const v = luminance(referenceSample(r[0] + dx, r[1] + dy));
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
      if (high - low >= 12) agreed++;
    }
  const structuralAgreement = edges ? agreed / edges : 0;
  if (edges < 12 || structuralAgreement < 0.2)
    throw Error("structural-agreement");
  const referenceDataCoverage = Math.min(
    overlapFraction,
    validArea / (region.width * region.height),
    overlapFraction * (inside ? available / inside : 0),
  );
  // Pairs that could support this placement: reference point inside the footprint.
  const local = Math.max(
    evidence.length,
    tentative.filter((p) => {
      const [x, y] = transform(inv, p.reference);
      return (
        x >= region.x &&
        y >= region.y &&
        x <= region.x + region.width &&
        y <= region.y + region.height
      );
    }).length,
  );
  const errors = evidence.map((p) =>
      distance(transform(h, p.query), p.reference),
    ),
    medianError = percentile(errors, 0.5),
    p95Error = percentile(errors, 0.95);
  if (
    p95Error > options.reprojectionThreshold ||
    evidence.length / local < 0.025
  )
    throw Error("residual-support");
  const extentStatus = footprint.every(
    (p) =>
      p[0] >= -1 &&
      p[1] >= -1 &&
      p[0] <= reference.width + 1 &&
      p[1] <= reference.height + 1,
  )
    ? "complete"
    : "partial";
  const distinctiveness =
    1 -
    percentile(
      evidence.map((p) => p.distance),
      0.5,
    );
  const score =
    (Math.log2(1 + evidence.length) *
      (0.4 + 0.6 * supportCoverage) *
      (0.5 + 0.5 * structuralAgreement) *
      (0.6 + 0.4 * distinctiveness)) /
    (1 + medianError * 0.2 + stability * 0.05);
  return {
    id: "",
    rank: 0,
    score,
    model: fit.model as MatchCandidate["model"],
    transform: h,
    footprint,
    overlap,
    extentStatus,
    overlapFraction,
    referenceDataCoverage,
    independentInliers: evidence.length,
    tentativeMatches: local,
    inlierRatio: evidence.length / local,
    supportCoverage,
    medianError,
    p95Error,
    stability,
    structuralAgreement,
    correspondences: evidence.map(({ query, reference, distance }) => ({
      query,
      reference,
      distance,
    })),
    warnings: [
      ...(extentStatus === "partial"
        ? ["Placement outside the search area is extrapolated."]
        : []),
      ...(referenceDataCoverage < overlapFraction - 0.02
        ? ["Reference data is incomplete within the search overlap."]
        : []),
    ],
  };
}
