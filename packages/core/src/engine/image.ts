import type { ImageMetadata, Limits } from "../core/types.js";
import { fail, uid } from "../core/types.js";

import { checkBudget } from "./budget.js";

/**
 * Read the orientation tag from an embedded TIFF IFD without relying on browser
 * auto-orientation.
 */
function exifOrientation(view: DataView, start: number): number {
  const little = view.getUint16(start) === 0x4949;
  if (!little && view.getUint16(start) !== 0x4d4d) return 1;
  const ifd = start + view.getUint32(start + 4, little),
    n = view.getUint16(ifd, little);
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12;
    if (view.getUint16(p, little) === 274) return view.getUint16(p + 8, little);
  }
  return 1;
}
/** Read bounded RIFF chunks before decoding WebP; animated images are not a single raster. */
function webpChunks(
  bytes: ArrayBuffer,
): { tag: number; offset: number; length: number; data: DataView }[] {
  const view = new DataView(bytes),
    chunks = [];
  if (view.getUint32(4, true) + 8 !== bytes.byteLength)
    fail("FORMAT", "Truncated or inconsistent WebP RIFF length.");
  for (let p = 12; p < bytes.byteLength; ) {
    const tag = view.getUint32(p),
      length = view.getUint32(p + 4, true);
    if (p + 8 + length + (length % 2) > bytes.byteLength)
      fail("FORMAT", "Truncated WebP chunk.");
    chunks.push({
      tag,
      offset: p,
      length,
      data: new DataView(bytes, p + 8, length),
    });
    p += 8 + length + (length % 2);
  }
  return chunks;
}
/**
 * Inspect supported file headers, enforce compressed/pixel/memory budgets and compute
 * SHA-256 before decoding. Rejects unsupported sample layouts and records
 * orientation-normalized dimensions.
 */
export async function inspectImage(
  file: File,
  limits: Limits,
): Promise<ImageMetadata> {
  if (file.size > limits.maxFileBytes)
    fail(
      "FILE_BUDGET",
      `Image exceeds the ${limits.maxFileBytes.toLocaleString()} byte limit (25 MiB by default).`,
    );
  if (file.size < 24)
    fail("FORMAT", "File is too short to be a supported image.");
  const bytes = await file.arrayBuffer(),
    view = new DataView(bytes);
  let width = 0,
    height = 0,
    orientation = 1,
    format: ImageMetadata["format"],
    georeferenced = false,
    noData: number | undefined;
  try {
    if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
      format = "png";
      width = view.getUint32(16);
      height = view.getUint32(20);
      if (view.getUint8(24) !== 8)
        fail("FORMAT", "Only 8-bit PNG input is supported.");
      for (let p = 8; p + 12 <= bytes.byteLength; ) {
        const length = view.getUint32(p),
          tag = view.getUint32(p + 4);
        if (p + 12 + length > bytes.byteLength)
          fail("FORMAT", "Truncated PNG chunk.");
        if (tag === 0x65584966)
          orientation = exifOrientation(new DataView(bytes, p + 8, length), 0);
        if (tag === 0x6163544c) fail("FORMAT", "Animated PNG is unsupported.");
        p += 12 + length;
      }
    } else if (view.getUint16(0) === 0xffd8) {
      format = "jpeg";
      for (let p = 2; p + 4 <= bytes.byteLength; ) {
        if (view.getUint8(p) !== 255) break;
        const marker = view.getUint8(p + 1);
        if (marker === 0xda || marker === 0xd9) break;
        const length = view.getUint16(p + 2);
        if (length < 2 || p + 2 + length > bytes.byteLength)
          fail("FORMAT", "Truncated JPEG segment.");
        if (marker === 0xe1 && view.getUint32(p + 4) === 0x45786966)
          orientation = exifOrientation(view, p + 10);
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          if (
            view.getUint8(p + 4) !== 8 ||
            ![1, 3].includes(view.getUint8(p + 9))
          )
            fail("FORMAT", "Only 8-bit grayscale/RGB JPEG is supported.");
          height = view.getUint16(p + 5);
          width = view.getUint16(p + 7);
        }
        p += length + 2;
      }
    } else if (
      view.getUint32(0) === 0x52494646 &&
      view.getUint32(8) === 0x57454250
    ) {
      format = "webp";
      let canvasWidth = 0,
        canvasHeight = 0,
        frames = 0;
      for (const { tag, data } of webpChunks(bytes)) {
        if (tag === 0x414e494d || tag === 0x414e4d46)
          fail("FORMAT", "Animated WebP is unsupported.");
        if (tag === 0x56503858) {
          if (data.getUint8(0) & 2)
            fail("FORMAT", "Animated WebP is unsupported.");
          const uint24 = (p: number) =>
            data.getUint8(p) +
            (data.getUint8(p + 1) << 8) +
            (data.getUint8(p + 2) << 16);
          canvasWidth = uint24(4) + 1;
          canvasHeight = uint24(7) + 1;
        } else if (tag === 0x56503820) {
          if (
            data.getUint8(0) & 1 ||
            data.getUint8(3) !== 0x9d ||
            data.getUint16(4) !== 0x012a
          )
            fail("FORMAT", "Invalid WebP VP8 frame header.");
          width = data.getUint16(6, true) & 0x3fff;
          height = data.getUint16(8, true) & 0x3fff;
          frames++;
        } else if (tag === 0x5650384c) {
          const bits = data.getUint32(1, true);
          if (data.getUint8(0) !== 0x2f || bits >>> 29)
            fail("FORMAT", "Invalid WebP lossless header.");
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
          frames++;
        } else if (tag === 0x45584946) {
          orientation = exifOrientation(
            data,
            data.getUint32(0) === 0x45786966 ? 6 : 0,
          );
        }
      }
      if (
        frames !== 1 ||
        (canvasWidth && (canvasWidth !== width || canvasHeight !== height))
      )
        fail(
          "FORMAT",
          "WebP must contain one image matching its declared canvas dimensions.",
        );
    } else if ([0x49492a00, 0x4d4d002a].includes(view.getUint32(0))) {
      format = "tiff";
      const { fromArrayBuffer } = await import("geotiff");
      const tiff = await fromArrayBuffer(bytes);
      if ((await tiff.getImageCount()) !== 1)
        fail(
          "FORMAT",
          "Multi-page TIFF is unsupported; select a single page before import.",
        );
      const image = await tiff.getImage(),
        d = image.getFileDirectory();
      width = image.getWidth();
      height = image.getHeight();
      orientation = (await d.loadValue("Orientation")) ?? 1;
      const bands = image.getSamplesPerPixel(),
        bits = d.getValue("BitsPerSample") ?? [8],
        samples = d.getValue("SampleFormat") ?? [1];
      const compression = d.getValue("Compression") ?? 1,
        photo = d.getValue("PhotometricInterpretation") ?? 0;
      if (
        !(
          (photo === 1 && bands === 1) ||
          (photo === 2 && [3, 4].includes(bands))
        )
      )
        fail(
          "FORMAT",
          "TIFF bands do not match supported grayscale/RGB photometric interpretation.",
        );
      if (
        !Array.from(bits).every((v) => v === 8) ||
        !Array.from(samples).every((v) => v === 1) ||
        ![1, 3, 4].includes(bands) ||
        ![1, 5, 8, 32946, 32773].includes(compression) ||
        ![1, 2].includes(photo) ||
        orientation !== 1 ||
        (d.getValue("PlanarConfiguration") ?? 1) !== 1 ||
        (bands === 4 && d.getValue("ExtraSamples")?.[0] !== 2)
      )
        fail(
          "FORMAT",
          "Supported TIFF: single-page, orientation 1, chunky uint8 grayscale/RGB/unassociated RGBA, uncompressed/LZW/Deflate/PackBits.",
        );
      georeferenced = Boolean(image.getGeoKeys());
      noData = image.getGDALNoData() ?? undefined;
    } else
      return fail(
        "FORMAT",
        "Unsupported file signature. Select PNG, JPEG, WebP, or supported ordinary TIFF.",
      );
  } catch (e) {
    if (e instanceof RangeError)
      return fail("FORMAT", "Image header is corrupt or truncated.");
    throw e;
  }
  if (orientation < 1 || orientation > 8)
    fail("ORIENTATION", "Invalid EXIF orientation.");
  checkBudget(width, height, limits, file.size);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    id: uid(),
    name: file.name,
    sizeBytes: file.size,
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    originalWidth: width,
    originalHeight: height,
    orientation,
    format,
    georeferenced,
    ...(noData !== undefined ? { noData } : {}),
    fingerprint: Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    pixelConvention: "normalized-top-left-corner-y-down",
  };
}
/**
 * Row-major interleaved 8-bit RGBA pixels with a top-left origin and y increasing
 * downwards.
 */
export interface Pixels {
  /**
   * Four bytes per pixel, with unassociated alpha in the fourth channel; zero alpha marks
   * an invalid sample.
   */
  data: Uint8ClampedArray;
  /** Buffer width in pixels. */
  width: number;
  /** Buffer height in pixels. */
  height: number;
}
/**
 * Mutate alpha to zero where all three RGB channels match the supplied byte value(s).
 * Undefined leaves pixels unchanged.
 */
export function maskSourceNoData(
  pixels: Pixels,
  value: number | [number, number, number] | undefined,
): void {
  if (value === undefined) return;
  const rgb = Array.isArray(value) ? value : [value, value, value];
  if (
    rgb.length !== 3 ||
    rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    fail(
      "NODATA",
      "Source no-data requires one or three byte values from 0 to 255.",
    );
  for (let i = 0; i < pixels.data.length; i += 4)
    if (rgb.every((v, c) => pixels.data[i + c] === v)) pixels.data[i + 3] = 0;
}
/**
 * Decode supported inspected bytes to orientation-normalized RGBA, optionally downsampled for preview.
 *
 * Call inspectImage/checkBudget first. EXIF is stripped from temporary decode copies and applied explicitly for consistent browser behavior; original bytes remain untouched. Embedded ICC profiles and gamma are not applied. Browser bitmap/canvas resources are released after extraction.
 *
 * Browser canvases store premultiplied alpha, so color samples of partially transparent PNG/WebP pixels can be rounded; fully opaque and fully transparent pixels are exact. TIFF input is decoded without a canvas.
 */
export async function decodeImage(
  file: File,
  metadata: ImageMetadata,
  maxDimension?: number,
  maxMemoryBytes = 768 * 1024 * 1024,
): Promise<Pixels> {
  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(metadata.width, metadata.height))
    : 1;
  const width = Math.max(1, Math.round(metadata.width * scale)),
    height = Math.max(1, Math.round(metadata.height * scale));
  if (metadata.format === "tiff") {
    const { fromArrayBuffer } = await import("geotiff");
    const tiff = await fromArrayBuffer(await file.arrayBuffer()),
      img = await tiff.getImage();
    const samples = await img.readRasters({ width, height, interleave: true });
    const n = img.getSamplesPerPixel(),
      rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = Number(samples[i * n]);
      rgba[i * 4 + 1] = Number(samples[i * n + (n === 1 ? 0 : 1)]);
      rgba[i * 4 + 2] = Number(samples[i * n + (n === 1 ? 0 : 2)]);
      rgba[i * 4 + 3] = n === 4 ? Number(samples[i * n + 3]) : 255;
      if (
        metadata.noData !== undefined &&
        [0, 1, 2].every((c) => rgba[i * 4 + c] === metadata.noData)
      )
        rgba[i * 4 + 3] = 0;
    }
    return { data: rgba, width, height };
  }
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (!ctx)
    fail(
      "MEMORY_BUDGET",
      "The browser could not allocate the requested image canvas.",
    );
  // Strip EXIF from a temporary decode copy and apply its matrix ourselves.
  // Browser worker decoders disagree on from-image (notably mirrored JPEGs).
  let decodeSource: Blob = file;
  if (metadata.format === "jpeg") {
    const bytes = new Uint8Array(await file.arrayBuffer()),
      view = new DataView(bytes.buffer),
      parts: BlobPart[] = [bytes.slice(0, 2)];
    let p = 2;
    while (p + 4 <= bytes.length) {
      const marker = bytes[p + 1];
      if (bytes[p] !== 255 || marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(p + 2);
      if (!(marker === 0xe1 && view.getUint32(p + 4) === 0x45786966))
        parts.push(bytes.slice(p, p + length + 2));
      p += length + 2;
    }
    parts.push(bytes.slice(p));
    decodeSource = new Blob(parts, { type: "image/jpeg" });
  }
  if (metadata.format === "png") {
    const bytes = new Uint8Array(await file.arrayBuffer()),
      view = new DataView(bytes.buffer),
      parts: BlobPart[] = [bytes.subarray(0, 8)];
    let p = 8;
    while (p + 12 <= bytes.length) {
      const length = view.getUint32(p);
      if (p + length + 12 > bytes.length)
        fail("FORMAT", "Truncated PNG chunk.");
      if (view.getUint32(p + 4) !== 0x65584966)
        parts.push(bytes.subarray(p, p + length + 12));
      p += length + 12;
    }
    decodeSource = new Blob(parts, { type: "image/png" });
  }
  if (metadata.format === "webp") {
    const bytes = await file.arrayBuffer(),
      header = bytes.slice(0, 12);
    const parts = webpChunks(bytes)
      .filter(({ tag }) => tag !== 0x45584946)
      .map(({ tag, offset, length }) => {
        const chunk = bytes.slice(offset, offset + 8 + length + (length % 2));
        if (tag === 0x56503858) new Uint8Array(chunk)[8] &= ~8;
        return chunk;
      });
    new DataView(header).setUint32(
      4,
      4 + parts.reduce((n, p) => n + p.byteLength, 0),
      true,
    );
    decodeSource = new Blob([header, ...parts], { type: "image/webp" });
  }
  let bitmap: ImageBitmap | OffscreenCanvas;
  try {
    // Keep encoded sample values: no ICC/gamma conversion and no premultiplication
    // before drawing, matching GDAL, which ignores embedded color profiles.
    bitmap = await createImageBitmap(decodeSource, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
  } catch (error) {
    if (metadata.format !== "jpeg") throw error;
    const { decode } = await import("jpeg-js");
    const pixels = decode(await decodeSource.arrayBuffer(), {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP:
        (metadata.originalWidth * metadata.originalHeight) / 1_000_000 + 1,
      maxMemoryUsageInMB: maxMemoryBytes / 1048576,
    });
    bitmap = new OffscreenCanvas(pixels.width, pixels.height);
    bitmap
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(
            pixels.data.buffer as ArrayBuffer,
            pixels.data.byteOffset,
            pixels.data.byteLength,
          ),
          pixels.width,
          pixels.height,
        ),
        0,
        0,
      );
  }
  try {
    if (
      bitmap.width !== metadata.originalWidth ||
      bitmap.height !== metadata.originalHeight
    )
      fail(
        "ORIENTATION",
        "Browser decoder disagrees with original image dimensions.",
      );
    const w = metadata.originalWidth,
      h = metadata.originalHeight;
    const matrices: [number, number, number, number, number, number][] = [
      [1, 0, 0, 1, 0, 0],
      [-1, 0, 0, 1, w, 0],
      [-1, 0, 0, -1, w, h],
      [1, 0, 0, -1, 0, h],
      [0, 1, 1, 0, 0, 0],
      [0, 1, -1, 0, h, 0],
      [0, -1, -1, 0, h, w],
      [0, -1, 1, 0, 0, w],
    ];
    // Previews are reduced; full-resolution draws use integer transforms and stay exact.
    ctx.imageSmoothingQuality = "high";
    ctx.scale(width / metadata.width, height / metadata.height);
    ctx.transform(...matrices[metadata.orientation - 1]);
    ctx.drawImage(bitmap, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    if ("close" in bitmap) bitmap.close();
    else {
      bitmap.width = 0;
      bitmap.height = 0;
    }
    canvas.width = 0;
    canvas.height = 0;
  }
}
