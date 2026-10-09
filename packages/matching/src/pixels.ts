import { validateSearchExtent } from "./geometry.js";
import type {
  MatchOptions,
  MatchRequest,
  PixelImage,
  ReferenceSnapshot,
  Region,
} from "./types.js";
import { DEFAULT_MATCH_OPTIONS, MatchingError } from "./types.js";
export function validateImage(image: PixelImage, limit: number): void {
  if (!image || typeof image !== "object")
    throw new MatchingError("INPUT", "Expected a pixel image.");
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  )
    throw new MatchingError(
      "INPUT",
      "Image dimensions must be positive integers.",
    );
  if (
    image.width * image.height > limit ||
    Math.max(image.width, image.height) > 32768
  )
    throw new MatchingError("BUDGET", "Image pixel budget exceeded.");
  if (
    !(
      image.data instanceof Uint8Array ||
      image.data instanceof Uint8ClampedArray
    ) ||
    image.data.length !== image.width * image.height * 4
  )
    throw new MatchingError("INPUT", "Expected tightly packed RGBA bytes.");
}
/** Change-detection digest of tile bytes (FNV-1a over 32-bit words); not cryptographic. */
export function contentDigest(tiles: readonly PixelImage[]): string {
  let hash = 2166136261;
  for (const { data } of tiles)
    if (data.byteOffset % 4 === 0 && data.length % 4 === 0) {
      const words = new Uint32Array(
        data.buffer,
        data.byteOffset,
        data.length / 4,
      );
      for (let i = 0; i < words.length; i++)
        hash = Math.imul(hash ^ words[i], 16777619);
    } else for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/** Includes retained inputs + structured-clone copies, capped WASM heap, grayscale and descriptors. */
export function estimateMemoryBytes(
  queryPixels: number,
  referencePixels: number,
  options: Pick<MatchOptions, "maxFeatures">,
): number {
  return (
    (queryPixels + referencePixels) * 8 +
    512 * 1024 * 1024 +
    options.maxFeatures * 128 * 4 * 2 +
    32 * 1024 * 1024
  );
}
export function validateRequest(request: MatchRequest): {
  options: MatchOptions;
  region: Region;
  estimatedMemoryBytes: number;
} {
  if (
    !request?.query ||
    !request.reference ||
    !Array.isArray(request.reference.tiles)
  )
    throw new MatchingError(
      "INPUT",
      "Query pixels and reference snapshot are required.",
    );
  const options = { ...DEFAULT_MATCH_OPTIONS, ...request.options },
    q = request.query,
    r = request.reference;
  for (const k of [
    "maxCandidates",
    "maxQueryPixels",
    "maxReferencePixels",
    "maxMemoryBytes",
    "tileSize",
    "maxFeatures",
    "featuresPerTile",
    "minInliers",
  ] as const)
    if (!Number.isSafeInteger(options[k]) || options[k] <= 0)
      throw new MatchingError("INPUT", `Invalid ${k}.`);
  if (
    options.tileSize < 128 ||
    options.tileSize > 1024 ||
    options.minInliers < 12 ||
    options.maxCandidates > 20 ||
    options.maxFeatures > 48000 ||
    options.featuresPerTile > 4000
  )
    throw new MatchingError(
      "BUDGET",
      "Unsupported extraction or candidate budget.",
    );
  if (
    !["sift", "akaze"].includes(options.detector) ||
    !["generic", "technical-plan"].includes(options.profile) ||
    !(options.ratio > 0 && options.ratio < 1) ||
    !(
      options.reprojectionThreshold > 0 && options.reprojectionThreshold <= 6
    ) ||
    !(options.ambiguityGap >= 0 && options.ambiguityGap <= 1)
  )
    throw new MatchingError(
      "INPUT",
      "Invalid detector, profile or thresholds.",
    );
  validateImage(q, options.maxQueryPixels);
  const region = request.queryRegion ?? {
    x: 0,
    y: 0,
    width: q.width,
    height: q.height,
  };
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > q.width ||
    region.y + region.height > q.height
  )
    throw new MatchingError(
      "INPUT",
      "Plan region must lie inside the normalized image.",
    );
  if (
    !Number.isSafeInteger(r.width) ||
    !Number.isSafeInteger(r.height) ||
    r.width <= 0 ||
    r.height <= 0 ||
    r.width * r.height > options.maxReferencePixels ||
    Math.max(r.width, r.height) > 32768 ||
    r.tiles.length > 4096
  )
    throw new MatchingError(
      "BUDGET",
      "Reference search pixel budget exceeded.",
    );
  if (
    !r.id ||
    !r.crs ||
    !r.source?.id ||
    !r.source.revision ||
    !Array.isArray(r.pixelToMap) ||
    r.pixelToMap.length !== 9 ||
    !r.pixelToMap.every(Number.isFinite) ||
    !Array.isArray(r.extent) ||
    r.extent.length !== 4 ||
    !r.extent.every(Number.isFinite) ||
    r.extent[0] >= r.extent[2] ||
    r.extent[1] >= r.extent[3]
  )
    throw new MatchingError(
      "INPUT",
      "Snapshot needs identity, CRS, extent and exact pixel mapping.",
    );
  let pixels = 0;
  validateSearchExtent(r.extent, r.crs);
  for (let i = 0; i < r.tiles.length; i++) {
    const t = r.tiles[i];
    validateImage(t, options.maxReferencePixels);
    if (
      !Number.isSafeInteger(t.x) ||
      !Number.isSafeInteger(t.y) ||
      t.x < 0 ||
      t.y < 0 ||
      t.x + t.width > r.width ||
      t.y + t.height > r.height
    )
      throw new MatchingError("INPUT", "Invalid reference tile placement.");
    for (let j = 0; j < i; j++) {
      const u = r.tiles[j];
      if (
        t.x < u.x + u.width &&
        u.x < t.x + t.width &&
        t.y < u.y + u.height &&
        u.y < t.y + t.height
      )
        throw new MatchingError(
          "INPUT",
          "Reference tiles must partition the snapshot.",
        );
    }
    pixels += t.width * t.height;
  }
  if (pixels !== r.width * r.height)
    throw new MatchingError(
      "INPUT",
      "Represent missing reference tiles explicitly with valid=false.",
    );
  const estimatedMemoryBytes = estimateMemoryBytes(
    q.width * q.height,
    pixels,
    options,
  );
  if (estimatedMemoryBytes > options.maxMemoryBytes)
    throw new MatchingError(
      "BUDGET",
      `Matching reserves ${Math.ceil(estimatedMemoryBytes / 1048576)} MiB; increase the explicit memory budget or reduce the search.`,
    );
  return { options, region, estimatedMemoryBytes };
}
export type Pixel = [number, number, number, number];
/** RGBA at a pixel-edge coordinate. Returns a buffer reused by every call: read it before sampling again. */
export type Sample = (x: number, y: number) => Pixel;
const MISSING: Readonly<Pixel> = Object.freeze([255, 255, 255, 0]);
export function imageSampler(image: PixelImage): Sample {
  const out: Pixel = [0, 0, 0, 0],
    { data, width, height } = image;
  return (x, y) => {
    const i =
      (Math.max(0, Math.min(height - 1, Math.floor(y))) * width +
        Math.max(0, Math.min(width - 1, Math.floor(x)))) *
      4;
    out[0] = data[i];
    out[1] = data[i + 1];
    out[2] = data[i + 2];
    out[3] = data[i + 3];
    return out;
  };
}
/** Largest index whose value is at most `v` in an ascending list, or -1. */
function floorIndex(values: number[], v: number): number {
  let lo = 0,
    hi = values.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= v) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
export function referenceSampler(r: ReferenceSnapshot): Sample {
  const samplers = r.tiles.map((t) => imageSampler(t));
  // Horizontal bands between tile edges, each listing its tiles by x: O(log n) lookup.
  const ys = [...new Set(r.tiles.flatMap((t) => [t.y, t.y + t.height]))].sort(
      (a, b) => a - b,
    ),
    bands = ys.slice(0, -1).map((y) => {
      const tiles = r.tiles
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.y <= y && y < t.y + t.height)
        .sort((a, b) => a.t.x - b.t.x);
      return {
        xs: tiles.map(({ t }) => t.x),
        indices: tiles.map(({ i }) => i),
      };
    });
  const find = (x: number, y: number) => {
    const band = bands[floorIndex(ys, y)];
    if (!band) return -1;
    const k = floorIndex(band.xs, x),
      i = band.indices[k] ?? -1;
    return i >= 0 && x < r.tiles[i].x + r.tiles[i].width ? i : -1;
  };
  let last = 0;
  return (x, y) => {
    let t = r.tiles[last];
    if (!(x >= t.x && y >= t.y && x < t.x + t.width && y < t.y + t.height)) {
      const i = find(x, y);
      if (i < 0) return MISSING as Pixel;
      last = i;
      t = r.tiles[i];
    }
    return t.valid === false
      ? (MISSING as Pixel)
      : samplers[last](x - t.x, y - t.y);
  };
}
export const luminance = (p: Readonly<Pixel>) =>
  ((0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) * p[3] + 255 * (255 - p[3])) /
  255;
export function grayscale(
  sample: Sample,
  region: Region,
  width: number,
  height: number,
  options: MatchOptions,
): { gray: Uint8Array; mask: Uint8Array } {
  const gray = new Uint8Array(width * height),
    mask = new Uint8Array(width * height);
  let min = 255,
    max = 0;
  const usable = (p: Readonly<Pixel>) =>
    p[3] > 0 &&
    (!options.suppressColor ||
      Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) < 80);
  const fx = region.width / width,
    fy = region.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (fx <= 1 && fy <= 1) {
        const p = sample(region.x + (x + 0.5) * fx, region.y + (y + 0.5) * fy);
        gray[i] = Math.round(luminance(p));
        mask[i] = usable(p) ? 255 : 0;
      } else {
        // Area average when reducing, so thin plan lines fade instead of aliasing away.
        const x0 = Math.floor(region.x + x * fx),
          x1 = Math.max(x0 + 1, Math.ceil(region.x + (x + 1) * fx)),
          y0 = Math.floor(region.y + y * fy),
          y1 = Math.max(y0 + 1, Math.ceil(region.y + (y + 1) * fy));
        let sum = 0,
          valid = 0;
        for (let v = y0; v < y1; v++)
          for (let u = x0; u < x1; u++) {
            const p = sample(u + 0.5, v + 0.5);
            sum += luminance(p);
            if (usable(p)) valid++;
          }
        const n = (x1 - x0) * (y1 - y0);
        gray[i] = Math.round(sum / n);
        mask[i] = valid * 2 >= n ? 255 : 0;
      }
      if (mask[i]) {
        min = Math.min(min, gray[i]);
        max = Math.max(max, gray[i]);
      }
    }
  if (max - min < 3) {
    mask.fill(0);
    return { gray, mask };
  }
  if (options.profile === "technical-plan")
    for (let i = 0; i < gray.length; i++)
      gray[i] = Math.max(
        0,
        Math.min(255, ((gray[i] - min) * 255) / (max - min)),
      );
  return { gray, mask };
}
