import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { Extent, Gcp, Model, XY } from "./types.js";
import { DEFAULT_LIMITS, fail, MODELS } from "./types.js";

/** Translation and uniform scale used to condition the numerical system. */
export interface Normalization {
  /** Arithmetic centroid in the original coordinate space. */
  center: XY;
  /** Root-mean-square distance from the centroid in original units. */
  scale: number;
}
/**
 * Serializable fitted transformation and training-point diagnostics. Treat coefficients
 * as opaque and evaluate with `forward` and `backward`.
 */
export interface Fit {
  /** Model used to produce these coefficients. */
  model: Model;
  /** Normalization of canonical image pixel coordinates. */
  source: Normalization;
  /** Normalization of target coordinates in the working CRS. */
  target: Normalization;
  /**
   * Normalized x-output coefficients; for projective fits, the complete row-major 3×3
   * homography.
   */
  x: number[];
  /** Normalized y-output coefficients; unused for projective fits. */
  y: number[];
  /** Normalized source GCP locations for TPS radial terms; absent for other models. */
  knots?: XY[];
  /** Reverse affine least-squares coefficients used to initialize Newton inversion. */
  seed: number[][];
  /**
   * Condition estimate of the normalized fitting system; values above 1e10 are rejected.
   */
  condition: number;
  /**
   * Separately fitted reverse polynomial for GDAL/QGIS-compatible polynomial raster
   * sampling.
   */
  reversePolynomial?: {
    /** Normalized reverse x coefficients in polynomial basis order. */
    x: number[];
    /** Normalized reverse y coefficients in polynomial basis order. */
    y: number[];
  };
  /** Diagnostics for enabled GCPs only, in input order. */
  residuals: {
    /** Stable GCP identifier. */
    id: string;
    /** Forward residual `T(image) - target` in working-CRS units. */
    vector: XY;
    /** Euclidean length of the forward residual in working-CRS units. */
    distance: number;
    /**
     * Distance between the backward-mapped target and source point in original pixels, or
     * null when inversion fails.
     */
    pixels: number | null;
  }[];
  /**
   * Training RMSE: `sqrt(sum(distance²) / enabledCount)` in working-CRS units. This is
   * not an independent accuracy estimate.
   */
  rmse: number;
  /** Backward-mapping convention used for preview/export and pixel residuals. */
  backward: "reverse-polynomial" | "analytic-or-newton";
}
const dot = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0);
/**
 * Centre and scale each coordinate space before solving to reduce sensitivity to large
 * CRS offsets.
 */
function normalize(points: XY[]): Normalization {
  const center = points.reduce<XY>(
    (a, p) => [a[0] + p[0] / points.length, a[1] + p[1] / points.length],
    [0, 0],
  );
  const scale = Math.sqrt(
    points.reduce(
      (s, p) => s + (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2,
      0,
    ) / points.length,
  );
  if (!(scale > 1e-12))
    fail("RANK", "Control points have no usable coordinate variation.");
  return { center, scale };
}
const norm = (p: XY, n: Normalization): XY => [
  (p[0] - n.center[0]) / n.scale,
  (p[1] - n.center[1]) / n.scale,
];
/**
 * Solve the normalized least-squares system using SVD, rejecting deficient rank and
 * excessive conditioning.
 */
function solve(
  a: number[][],
  b: number[][],
): { solution: number[][]; condition: number } {
  const svd = new SingularValueDecomposition(new Matrix(a), {
    autoTranspose: true,
  });
  if (
    svd.rank < a[0].length ||
    !Number.isFinite(svd.condition) ||
    svd.condition > 1e10
  )
    fail(
      "RANK",
      "GCP arrangement is singular or ill-conditioned. Spread points across the image.",
    );
  return {
    solution: svd.solve(new Matrix(b)).to2DArray(),
    condition: svd.condition,
  };
}
/**
 * Polynomial terms in coefficient order: 1, x, y, x², xy, y², x³, x²y, xy², y³ as
 * required by degree.
 */
function basis(p: XY, model: Model): number[] {
  const [x, y] = p;
  const row = [1, x, y];
  if (model === "polynomial2" || model === "polynomial3")
    row.push(x * x, x * y, y * y);
  if (model === "polynomial3") row.push(x ** 3, x * x * y, x * y * y, y ** 3);
  return row;
}
/**
 * Thin-plate-spline radial basis `r² log(r²)`, with its continuous value zero at
 * coincident knots.
 */
function radial(a: XY, b: XY): number {
  const r2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  return r2 ? r2 * Math.log(r2) : 0;
}

/**
 * Fit one of the seven supported models using enabled point pairs.
 *
 * All targets must already be in the same working CRS: this numerical function does not convert `Gcp.crs`. The worker engine performs that conversion. Validate the full image domain with `validateDomain` before rendering.
 * @param gcps - Canonical image coordinates paired with working-CRS target coordinates.
 * @param model - Exact model to fit; no fallback is performed.
 * @returns Coefficients and training residuals for enabled points.
 * @throws {@link core.GeoreferenceError} For insufficient, duplicate, nonfinite, degenerate or ill-conditioned input.
 */
export function fitTransform(gcps: Gcp[], model: Model): Fit {
  if (!MODELS[model]) fail("MODEL", "Unknown transformation.");
  const points = gcps.filter((p) => p.enabled);
  if (points.length < MODELS[model].minimum)
    fail(
      "COUNT",
      `${MODELS[model].label} requires at least ${MODELS[model].minimum} enabled GCPs.`,
    );
  if (points.length > DEFAULT_LIMITS.maxGcps)
    fail("BUDGET", "At most 128 enabled GCPs are supported.");
  for (let i = 0; i < points.length; i++) {
    if (![...points[i].image, ...points[i].target].every(Number.isFinite))
      fail("COORDINATE", "GCP coordinates must be finite.");
    for (let j = 0; j < i; j++)
      if (
        Math.hypot(
          points[i].image[0] - points[j].image[0],
          points[i].image[1] - points[j].image[1],
        ) < 1e-9 ||
        Math.hypot(
          points[i].target[0] - points[j].target[0],
          points[i].target[1] - points[j].target[1],
        ) < 1e-12
      )
        fail("DUPLICATE", "Duplicate or conflicting enabled control points.");
  }
  const source = normalize(points.map((p) => p.image)),
    target = normalize(points.map((p) => p.target));
  const ps = points.map((p) => norm(p.image, source)),
    qs = points.map((p) => norm(p.target, target));
  let x: number[] = [],
    y: number[] = [],
    condition = 1;
  if (model === "linear") {
    const sx = solve(
      ps.map((p) => [1, p[0]]),
      qs.map((p) => [p[0]]),
    );
    const sy = solve(
      ps.map((p) => [1, p[1]]),
      qs.map((p) => [p[1]]),
    );
    // QGIS fits in y-up source coordinates, then takes absolute axis scales.
    const ax = Math.abs(sx.solution[1][0]),
      ay = -Math.abs(sy.solution[1][0]);
    x = [
      sx.solution[0][0] +
        ((ax - sx.solution[1][0]) * source.center[0]) / source.scale,
      ax,
      0,
    ];
    y = [
      sy.solution[0][0] +
        ((ay - sy.solution[1][0]) * source.center[1]) / source.scale,
      0,
      ay,
    ];
    condition = Math.max(sx.condition, sy.condition);
  } else if (model === "helmert") {
    const a = ps.flatMap(([u, v]) => [
      [1, 0, u, v],
      [0, 1, -v, u],
    ]);
    const s = solve(
      a,
      qs.flatMap((q) => [[q[0]], [q[1]]]),
    );
    const [tx, ty, aa, bb] = s.solution.map((r) => r[0]);
    x = [tx, aa, bb];
    y = [ty, bb, -aa];
    condition = s.condition;
  } else if (model === "projective") {
    const a = ps.flatMap(([u, v], i) => {
      const [X, Y] = qs[i];
      return [
        [u, v, 1, 0, 0, 0, -X * u, -X * v, -X],
        [0, 0, 0, u, v, 1, -Y * u, -Y * v, -Y],
      ];
    });
    // Pad minimal 8x9 homogeneous system to 9x9 to retain its null space.
    if (a.length === 8) a.push(Array(9).fill(0));
    const svd = new SingularValueDecomposition(new Matrix(a));
    const singular = svd.diagonal;
    condition = singular[0] / singular[7];
    if (!Number.isFinite(condition) || condition > 1e10)
      fail("RANK", "Projective control points are degenerate.");
    const h = svd.rightSingularVectors.getColumn(8);
    if (Math.abs(h[8]) < 1e-12)
      fail("DOMAIN", "Projective pole at normalized image center.");
    x = h.map((v) => v / h[8]);
  } else if (model === "thinPlateSpline") {
    const n = ps.length;
    const a = ps.map((p) => [...ps.map((k) => radial(p, k)), 1, ...p]);
    a.push(
      [...ps.map(() => 1), 0, 0, 0],
      [...ps.map((p) => p[0]), 0, 0, 0],
      [...ps.map((p) => p[1]), 0, 0, 0],
    );
    const s = solve(a, [...qs, [0, 0], [0, 0], [0, 0]]);
    x = s.solution.map((r) => r[0]);
    y = s.solution.map((r) => r[1]);
    condition = s.condition;
    if (x.length !== n + 3) fail("FIT", "TPS coefficient count mismatch.");
  } else {
    const s = solve(
      ps.map((p) => basis(p, model)),
      qs,
    );
    x = s.solution.map((r) => r[0]);
    y = s.solution.map((r) => r[1]);
    condition = s.condition;
  }
  const f: Fit = {
    model,
    source,
    target,
    x,
    y,
    knots: model === "thinPlateSpline" ? ps : undefined,
    seed: [],
    condition,
    residuals: [],
    rmse: 0,
    backward: "analytic-or-newton",
  };
  if (model.startsWith("polynomial")) {
    // GDAL/QGIS fit the reverse polynomial separately; it is not the exact inverse.
    const reverse = solve(
      qs.map((p) => basis(p, model)),
      ps,
    );
    f.reversePolynomial = {
      x: reverse.solution.map((r) => r[0]),
      y: reverse.solution.map((r) => r[1]),
    };
    f.backward = "reverse-polynomial";
  }
  // Inverse affine seed; two-point models use their exact local Jacobian instead.
  if (ps.length >= 3) {
    try {
      f.seed = solve(
        qs.map((p) => [1, ...p]),
        ps,
      ).solution;
    } catch {
      /* Domain validation below handles collapse. */
    }
  }
  for (const p of points) {
    const q = forward(f, p.image);
    const r: XY = [q[0] - p.target[0], q[1] - p.target[1]];
    const back = backward(f, p.target);
    f.residuals.push({
      id: p.id,
      vector: r,
      distance: Math.hypot(...r),
      pixels: back
        ? Math.hypot(back[0] - p.image[0], back[1] - p.image[1])
        : null,
    });
  }
  f.rmse = Math.sqrt(
    f.residuals.reduce((s, p) => s + p.distance ** 2, 0) / points.length,
  );
  if (!Number.isFinite(f.rmse)) fail("FIT", "Nonfinite transformation.");
  return f;
}
function evaluate(f: Fit, p: XY): XY {
  if (f.model === "projective") {
    const h = f.x,
      d = h[6] * p[0] + h[7] * p[1] + h[8];
    return [
      (h[0] * p[0] + h[1] * p[1] + h[2]) / d,
      (h[3] * p[0] + h[4] * p[1] + h[5]) / d,
    ];
  }
  const b = f.knots
    ? [...f.knots.map((k) => radial(p, k)), 1, ...p]
    : basis(p, f.model);
  return [dot(b, f.x), dot(b, f.y)];
}
/**
 * Map original-resolution canonical image pixels to the fit's working CRS. Points outside
 * the validated domain may produce nonfinite coordinates.
 */
export function forward(f: Fit, p: XY): XY {
  const q = evaluate(f, norm(p, f.source));
  return [
    q[0] * f.target.scale + f.target.center[0],
    q[1] * f.target.scale + f.target.center[1],
  ];
}
/**
 * Map a working-CRS coordinate back to canonical image pixels.
 * @param f - Fit returned by `fitTransform`.
 * @param q - Target coordinate in the fit's working CRS.
 * @param exactInverse - Use the actual inverse rather than a separately fitted reverse polynomial. Default false matches the raster path.
 * @returns Source pixels, or null for a singular, divergent or nonconvergent inverse.
 */
export function backward(f: Fit, q: XY, exactInverse = false): XY | null {
  const t = norm(q, f.target);
  let p: XY = f.seed.length
    ? [
        dot(
          [1, ...t],
          f.seed.map((r) => r[0]),
        ),
        dot(
          [1, ...t],
          f.seed.map((r) => r[1]),
        ),
      ]
    : [0, 0];
  if (f.reversePolynomial && !exactInverse) {
    const b = basis(t, f.model);
    p = [dot(b, f.reversePolynomial.x), dot(b, f.reversePolynomial.y)];
  } else if (f.model === "projective") {
    const h = f.x,
      a = h[0] - t[0] * h[6],
      b = h[1] - t[0] * h[7],
      c = h[3] - t[1] * h[6],
      d = h[4] - t[1] * h[7],
      u = t[0] * h[8] - h[2],
      v = t[1] * h[8] - h[5],
      det = a * d - b * c;
    if (Math.abs(det) < 1e-14) return null;
    p = [(u * d - b * v) / det, (a * v - u * c) / det];
  } else if (!f.knots && f.x.length === 3) {
    const det = f.x[1] * f.y[2] - f.x[2] * f.y[1];
    if (Math.abs(det) < 1e-14) return null;
    const u = t[0] - f.x[0],
      v = t[1] - f.y[0];
    p = [(u * f.y[2] - f.x[2] * v) / det, (f.x[1] * v - u * f.y[1]) / det];
  } else {
    let converged = false;
    for (let i = 0; i < 30; i++) {
      const v = evaluate(f, p),
        rx = v[0] - t[0],
        ry = v[1] - t[1];
      if (Math.hypot(rx, ry) < 1e-10) {
        converged = true;
        break;
      }
      const eps = 1e-5,
        px = evaluate(f, [p[0] + eps, p[1]]),
        py = evaluate(f, [p[0], p[1] + eps]);
      const a = (px[0] - v[0]) / eps,
        b = (py[0] - v[0]) / eps,
        c = (px[1] - v[1]) / eps,
        d = (py[1] - v[1]) / eps,
        det = a * d - b * c;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
      p = [p[0] - (d * rx - b * ry) / det, p[1] - (a * ry - c * rx) / det];
      if (Math.hypot(...p) > 1e6) return null;
    }
    if (!converged) return null;
  }
  return [
    p[0] * f.source.scale + f.source.center[0],
    p[1] * f.source.scale + f.source.center[1],
  ];
}

/**
 * Validate a fit across a 33×33 image grid and return sampled bounds in working-CRS units.
 *
 * Rejects local collapse, folds, unstable inverses and projective poles. Sampling is a conservative guard, not a proof of global injectivity.
 * @param f - Fit to validate.
 * @param width - Canonical image width in original pixels.
 * @param height - Canonical image height in original pixels.
 * @throws {@link core.GeoreferenceError} When the sampled domain is unsafe.
 */
export function validateDomain(f: Fit, width: number, height: number): Extent {
  let sign = 0;
  const extent: Extent = [Infinity, Infinity, -Infinity, -Infinity];
  for (let j = 0; j <= 32; j++)
    for (let i = 0; i <= 32; i++) {
      const p: XY = [(width * i) / 32, (height * j) / 32],
        q = forward(f, p);
      const ex = Math.max(width * 1e-6, 1e-4),
        ey = Math.max(height * 1e-6, 1e-4);
      const x = forward(f, [p[0] + ex, p[1]]),
        y = forward(f, [p[0], p[1] + ey]);
      const det =
        ((x[0] - q[0]) * (y[1] - q[1]) - (y[0] - q[0]) * (x[1] - q[1])) /
        (ex * ey);
      const scale = f.target.scale / f.source.scale;
      if (
        !q.every(Number.isFinite) ||
        !Number.isFinite(det) ||
        Math.abs(det) < scale * scale * 1e-9 ||
        (sign && sign !== Math.sign(det))
      )
        fail(
          "DOMAIN",
          "Warp is folded, singular, or crosses a projective pole. Add distributed GCPs or change model.",
        );
      sign = Math.sign(det);
      const back = backward(f, q, true);
      if (!back || Math.hypot(back[0] - p[0], back[1] - p[1]) > 0.01)
        fail(
          "DOMAIN",
          "Warp has an ambiguous or unstable inverse over the image.",
        );
      extent[0] = Math.min(extent[0], q[0]);
      extent[1] = Math.min(extent[1], q[1]);
      extent[2] = Math.max(extent[2], q[0]);
      extent[3] = Math.max(extent[3], q[1]);
    }
  if (f.model === "projective") {
    const ds = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map((p) => {
      const n = norm(p as XY, f.source);
      return f.x[6] * n[0] + f.x[7] * n[1] + f.x[8];
    });
    if (Math.min(...ds) <= 0 && Math.max(...ds) >= 0)
      fail("DOMAIN", "Projective pole intersects the image.");
  }
  return extent;
}
