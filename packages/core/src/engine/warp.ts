import type { Definitions } from "../core/projection.js";
import { createConverter, normalizeCrs } from "../core/projection.js";
import type { Fit } from "../core/transform.js";
import { backward, forward, validateDomain } from "../core/transform.js";
import type {
  Extent,
  ImageMetadata,
  Limits,
  OutputSettings,
  Resampler,
  XY,
} from "../core/types.js";
import { fail } from "../core/types.js";
import { checkBudget } from "./budget.js";
import type { Pixels } from "./image.js";

/**
 * North-up RGBA raster with pixel-area georeferencing and its processing-budget estimate.
 */
export interface Raster extends Pixels {
  /**
   * Outer pixel-edge `[minX, minY, maxX, maxY]` extent in `crs`; row zero starts at maxY.
   */
  bounds: Extent;
  /** Output coordinate reference system. */
  crs: string;
  /**
   * Conservative processing allocation estimate, not the encoded file size or a heap
   * measurement.
   */
  estimatedBytes: number;
}
const sinc = (x: number) =>
  x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
function kernel(x: number, method: Resampler): number {
  x = Math.abs(x);
  if (method === "bilinear") return Math.max(0, 1 - x);
  if (method === "lanczos") return x < 3 ? sinc(x) * sinc(x / 3) : 0;
  if (method === "cubicSpline")
    return x < 1
      ? (4 - 6 * x * x + 3 * x ** 3) / 6
      : x < 2
        ? (2 - x) ** 3 / 6
        : 0;
  return x < 1
    ? 1.5 * x ** 3 - 2.5 * x * x + 1
    : x < 2
      ? -0.5 * x ** 3 + 2.5 * x * x - 4 * x + 2
      : 0;
}
/**
 * Sample byte RGBA using GDAL-compatible kernels and write four channels into a caller-owned output buffer.
 *
 * Source positions use pixel-corner coordinates: `[0.5, 0.5]` is the first centre. Invalid/outside samples leave output unchanged, so initialize it transparent. GDAL notices and tested tolerances are in the package documentation.
 * @param input - Source pixels.
 * @param x - Source x in the actual decoded buffer's pixel space.
 * @param y - Source y in that same space.
 * @param method - Interpolation kernel.
 * @param out - Destination RGBA buffer.
 * @param offset - Byte offset of the destination pixel.
 * @param scale - Output/source scale used for downsampling filter support; defaults to `[1, 1]`.
 */
export function sample(
  input: Pixels,
  x: number,
  y: number,
  method: Resampler,
  out: Uint8ClampedArray,
  offset: number,
  scale: XY = [1, 1],
): void {
  if (x < 0 || y < 0 || x + 1e-10 > input.width || y + 1e-10 > input.height)
    return;
  const center =
    (Math.min(input.height - 1, Math.floor(y + 1e-10)) * input.width +
      Math.min(input.width - 1, Math.floor(x + 1e-10))) *
    4;
  if (input.data[center + 3] === 0) return;
  if (method === "nearest") {
    for (let c = 0; c < 4; c++) out[offset + c] = input.data[center + c];
    return;
  }
  // A billionth of a source pixel stabilizes discontinuous Lanczos reduction ties.
  x = Math.round(x * 1e9) / 1e9 - 0.5;
  y = Math.round(y * 1e9) / 1e9 - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  let sx = Math.min(1, scale[0]),
    sy = Math.min(1, scale[1]);
  const fourSample = scale[0] >= 0.95 && scale[1] >= 0.95;
  if ((method === "bilinear" || method === "cubic") && fourSample) {
    sx = 1;
    sy = 1;
  }
  if (method === "cubic" && fourSample) {
    let valid =
      ix >= 1 && iy >= 1 && ix + 2 < input.width && iy + 2 < input.height;
    if (valid)
      for (let j = -1; j <= 2; j++)
        for (let i = -1; i <= 2; i++)
          if (input.data[((iy + j) * input.width + ix + i) * 4 + 3] === 0)
            valid = false;
    if (!valid) method = "bilinear";
  }
  const radius = method === "bilinear" ? 1 : method === "lanczos" ? 3 : 2;
  const rx = Math.ceil(radius / sx),
    ry = Math.ceil(radius / sy);
  let x0 = Math.max(-ix, ((radius + 1) % 2) - rx),
    x1 = Math.min(rx, input.width - ix - 1);
  let y0 = Math.max(-iy, ((radius + 1) % 2) - ry),
    y1 = Math.min(ry, input.height - iy - 1);
  if (method === "lanczos") {
    while ((x0 - (sx < 1 ? 0 : fx)) * sx < -3) x0++;
    while ((x1 - (sx < 1 ? 0 : fx)) * sx > 3) x1--;
    while ((y0 - (sy < 1 ? 0 : fy)) * sy < -3) y0++;
    while ((y1 - (sy < 1 ? 0 : fy)) * sy > 3) y1--;
  }
  let weight = 0,
    alpha = 0,
    r = 0,
    g = 0,
    b = 0,
    valid = 0;
  for (let j = y0; j <= y1; j++) {
    // GDAL 3.8 Lanczos reduction weights are centered on the integer source sample.
    const wy = kernel(
      (j - (method === "lanczos" && sy < 1 ? 0 : fy)) * sy,
      method,
    );
    for (let i = x0; i <= x1; i++) {
      const p = ((iy + j) * input.width + ix + i) * 4,
        a = input.data[p + 3];
      if (a === 0) continue;
      valid++;
      const w =
        wy *
        kernel((i - (method === "lanczos" && sx < 1 ? 0 : fx)) * sx, method);
      weight += w;
      alpha += a * w;
      r += input.data[p] * w;
      g += input.data[p + 1] * w;
      b += input.data[p + 2] * w;
    }
  }
  if (
    weight < 1e-6 ||
    alpha < 1e-6 ||
    (method === "lanczos" &&
      valid < Math.floor(((x1 - x0 + 1) * (y1 - y0 + 1)) / 2))
  )
    return;
  out[offset] = Math.floor(r / weight + 0.5);
  out[offset + 1] = Math.floor(g / weight + 0.5);
  out[offset + 2] = Math.floor(b / weight + 0.5);
  // GDAL overlays the unified source density at the containing sample.
  out[offset + 3] = input.data[center + 3];
}
/** Match GDAL's 21-point boundary sampling and clipped source-window filter scale. */
function filterScale(
  input: Pixels,
  grid: Omit<Raster, "data">,
  toSource: (p: XY) => XY | null,
): XY {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 21; i++)
    for (const p of [
      [(i * grid.width) / 20, 0],
      [(i * grid.width) / 20, grid.height],
      [0, (i * grid.height) / 20],
      [grid.width, (i * grid.height) / 20],
    ] as XY[]) {
      const q = toSource(p);
      if (!q) continue;
      bounds[0] = Math.min(bounds[0], q[0]);
      bounds[1] = Math.min(bounds[1], q[1]);
      bounds[2] = Math.max(bounds[2], q[0]);
      bounds[3] = Math.max(bounds[3], q[1]);
    }
  return [input.width, input.height].map((size, i) => {
    const lo =
      Math.abs(bounds[i] - Math.round(bounds[i])) < 1e-6
        ? Math.round(bounds[i])
        : bounds[i];
    const hi =
      Math.abs(bounds[i + 2] - Math.round(bounds[i + 2])) < 1e-6
        ? Math.round(bounds[i + 2])
        : bounds[i + 2];
    const raw = Math.max(
      1,
      Math.min(size - Math.trunc(Math.max(0, lo)), hi - lo),
    );
    let scale = (i === 0 ? grid.width : grid.height) / raw;
    if (scale < 1) {
      const inverse = 1 / scale,
        rounded = Math.round(inverse);
      if (Math.abs(inverse - rounded) < 0.05) scale = 1 / rounded;
    }
    return Math.max(1e-3, scale);
  }) as XY;
}
/**
 * Validate the warp domain and compute a bounded north-up raster grid without allocating its pixel buffer.
 *
 * Default resolution uses the transformed centre-pixel area. Default bounds use adaptive edge subdivision and interior sampling. Explicit bounds may expand at the right/bottom edges to fit whole pixels.
 * @param fit - Transformation from canonical image pixels to working CRS.
 * @param metadata - Inspected original-resolution dimensions.
 * @param workingCrs - Fit coordinate system.
 * @param options - Output CRS, optional bounds/resolution and encoding settings.
 * @param limits - Pixel and estimated-memory budgets.
 * @param definitions - Additional projection definitions.
 * @param preview - Reduce dimensions to the configured preview limit when true.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For invalid domains, projections, grids, encoding settings or budgets.
 */
export function outputGrid(
  fit: Fit,
  metadata: ImageMetadata,
  workingCrs: string,
  options: OutputSettings,
  limits: Limits,
  definitions: Definitions = {},
  preview = false,
): Omit<Raster, "data"> {
  if (
    !["nearest", "bilinear", "cubic", "cubicSpline", "lanczos"].includes(
      options.resampler,
    )
  )
    fail("OUTPUT", "Unsupported resampler or TIFF compression.");
  if (
    options.approximationError !== undefined &&
    !(
      Number.isFinite(options.approximationError) &&
      options.approximationError >= 0 &&
      options.approximationError <= 1
    )
  )
    fail("OUTPUT", "Approximation error must be from 0 to 1 source pixels.");
  validateDomain(fit, metadata.width, metadata.height);
  const toOutput = createConverter(workingCrs, options.crs, definitions);
  const convert = (p: XY) => {
    const q = toOutput(forward(fit, p));
    if (!q.every(Number.isFinite))
      fail("CRS", "Projection produced nonfinite coordinates.");
    return q;
  };
  const center: XY = [metadata.width / 2, metadata.height / 2],
    c = convert(center),
    cx = convert([center[0] + 1, center[1]]),
    cy = convert([center[0], center[1] + 1]);
  const suggested = Math.sqrt(
    Math.abs((cx[0] - c[0]) * (cy[1] - c[1]) - (cx[1] - c[1]) * (cy[0] - c[0])),
  );
  let resolution = options.resolution ?? [suggested, suggested];
  if (resolution.some((v) => !Number.isFinite(v) || v <= 0))
    fail(
      "RESOLUTION",
      "Output resolution must be finite and positive in output CRS units.",
    );
  let bounds: Extent = options.bounds
    ? [...options.bounds]
    : [Infinity, Infinity, -Infinity, -Infinity];
  if (!options.bounds) {
    const add = (q: XY) => {
      bounds[0] = Math.min(bounds[0], q[0]);
      bounds[1] = Math.min(bounds[1], q[1]);
      bounds[2] = Math.max(bounds[2], q[0]);
      bounds[3] = Math.max(bounds[3], q[1]);
    };
    const edge = (a: XY, b: XY, depth: number) => {
      const q = convert(a),
        r = convert(b),
        m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        s = convert(m);
      add(q);
      add(r);
      add(s);
      const error = Math.hypot(
        s[0] - (q[0] + r[0]) / 2,
        s[1] - (q[1] + r[1]) / 2,
      );
      if (error > Math.min(...resolution) * 0.05) {
        if (depth >= 14)
          fail(
            "DOMAIN",
            "Output boundary cannot be bounded at this resolution.",
          );
        edge(a, m, depth + 1);
        edge(m, b, depth + 1);
      }
    };
    const w = metadata.width,
      h = metadata.height;
    for (let i = 0; i < 16; i++) {
      edge([(w * i) / 16, 0], [(w * (i + 1)) / 16, 0], 0);
      edge([(w * i) / 16, h], [(w * (i + 1)) / 16, h], 0);
      edge([0, (h * i) / 16], [0, (h * (i + 1)) / 16], 0);
      edge([w, (h * i) / 16], [w, (h * (i + 1)) / 16], 0);
    }
    for (let y = 1; y < 32; y++)
      for (let x = 1; x < 32; x++) add(convert([(w * x) / 32, (h * y) / 32]));
  }
  if (
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    fail("EXTENT", "Invalid output extent.");
  if (
    options.crs === "EPSG:4326" &&
    (bounds[0] < -180 ||
      bounds[2] > 180 ||
      bounds[2] - bounds[0] > 180 ||
      bounds[1] < -90 ||
      bounds[3] > 90)
  )
    fail("WRAP", "Wrapped or polar geographic raster bounds are unsupported.");
  if (preview) {
    const factor = Math.max(
      1,
      (bounds[2] - bounds[0]) / resolution[0] / limits.previewMaxDimension,
      (bounds[3] - bounds[1]) / resolution[1] / limits.previewMaxDimension,
    );
    resolution = [resolution[0] * factor, resolution[1] * factor];
  }
  const width = Math.max(
      1,
      Math.ceil((bounds[2] - bounds[0]) / resolution[0] - 1e-9),
    ),
    height = Math.max(
      1,
      Math.ceil((bounds[3] - bounds[1]) / resolution[1] - 1e-9),
    );
  bounds = [
    bounds[0],
    bounds[3] - height * resolution[1],
    bounds[0] + width * resolution[0],
    bounds[3],
  ];
  const estimatedBytes = checkBudget(
    metadata.width,
    metadata.height,
    limits,
    metadata.sizeBytes,
    width * height,
    !preview && options.compression === "deflate",
  );
  return { width, height, bounds, crs: options.crs, estimatedBytes };
}
/**
 * Default maximum error, in source pixels, of the approximate transformer used for
 * expensive final-output inverse mappings. Small enough to keep pinned QGIS/GDAL raster
 * parity; set `OutputSettings.approximationError` to trade accuracy for speed.
 */
export const DEFAULT_APPROXIMATION_ERROR = 0.0001;
/** Approximation tolerance for reduced previews, in preview pixels; the GDAL warper default. */
export const PREVIEW_APPROXIMATION_ERROR = 0.125;
/**
 * Synchronously backward-map output pixel centres through the fit and resample the source. Use the worker engine for interactive applications.
 *
 * When the inverse is expensive (thin plate spline or a reprojected output CRS), source positions are computed exactly at a few positions per row and linearly interpolated in between wherever the interpolation error at the segment midpoint stays within `maxError` source pixels, as the GDAL approximate transformer does. Other models are always mapped exactly.
 * @param input - Orientation-normalized RGBA; may be a reduced-resolution preview.
 * @param metadata - Original canonical dimensions, used to scale coordinates into the decoded buffer.
 * @param fit - Same fit used for preview and final export.
 * @param workingCrs - Coordinate system in which the fit operates.
 * @param grid - Validated output from outputGrid; this function allocates width × height × 4 bytes.
 * @param method - Interpolation kernel.
 * @param definitions - Host projection definitions.
 * @param progress - Synchronous progress fractions, reported every 32 rows and at completion.
 * @param maxError - Approximation tolerance in decoded source pixels; 0 maps every pixel exactly.
 * @returns Newly allocated raster; the input is not mutated.
 */
export function warp(
  input: Pixels,
  metadata: ImageMetadata,
  fit: Fit,
  workingCrs: string,
  grid: Omit<Raster, "data">,
  method: Resampler,
  definitions: Definitions = {},
  progress?: (v: number) => void,
  maxError = DEFAULT_APPROXIMATION_ERROR,
): Raster {
  const data = new Uint8ClampedArray(grid.width * grid.height * 4);
  const dx = (grid.bounds[2] - grid.bounds[0]) / grid.width,
    dy = (grid.bounds[3] - grid.bounds[1]) / grid.height;
  const reprojected = normalizeCrs(workingCrs) !== normalizeCrs(grid.crs),
    toWorking = createConverter(grid.crs, workingCrs, definitions);
  const sx = input.width / metadata.width,
    sy = input.height / metadata.height;
  const toSource = (pixel: XY): XY | null => {
    const q: XY = [
      grid.bounds[0] + pixel[0] * dx,
      grid.bounds[3] - pixel[1] * dy,
    ];
    const p = backward(fit, reprojected ? toWorking(q) : q);
    return p ? [p[0] * sx, p[1] * sy] : null;
  };
  const scale = filterScale(input, grid, toSource);
  const width = grid.width,
    rowX = new Float64Array(width),
    rowY = new Float64Array(width);
  const approximate =
    maxError > 0 && (fit.model === "thinPlateSpline" || reprojected);
  let y = 0;
  const exact = (i: number) => {
    const p = toSource([i + 0.5, y + 0.5]);
    rowX[i] = p ? p[0] : Number.NaN;
    rowY[i] = p ? p[1] : Number.NaN;
  };
  // Recursive midpoint refinement between exactly mapped columns a and b.
  const refine = (a: number, b: number) => {
    if (b - a < 2) return;
    const m = (a + b) >> 1;
    exact(m);
    const t = (m - a) / (b - a),
      ex = rowX[a] + (rowX[b] - rowX[a]) * t - rowX[m],
      ey = rowY[a] + (rowY[b] - rowY[a]) * t - rowY[m];
    if (Math.hypot(ex, ey) <= maxError) {
      // NaN errors (an invalid endpoint) never pass, so both ends are valid here.
      for (let i = a + 1; i < b; i++) {
        if (i === m) continue;
        const u = (i - a) / (b - a);
        rowX[i] = rowX[a] + (rowX[b] - rowX[a]) * u;
        rowY[i] = rowY[a] + (rowY[b] - rowY[a]) * u;
      }
      return;
    }
    refine(a, m);
    refine(m, b);
  };
  for (; y < grid.height; y++) {
    if (approximate) {
      exact(0);
      exact(width - 1);
      refine(0, width - 1);
    } else for (let x = 0; x < width; x++) exact(x);
    for (let x = 0; x < width; x++)
      if (!Number.isNaN(rowX[x]))
        sample(
          input,
          rowX[x],
          rowY[x],
          method,
          data,
          (y * width + x) * 4,
          scale,
        );
    if (y % 32 === 0) progress?.(y / grid.height);
  }
  progress?.(1);
  return { ...grid, data };
}
