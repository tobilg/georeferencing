import type { Extent, OutputSettings } from "@georeferencing/core";
import { fail } from "@georeferencing/core";
/**
 * Supported TIFF strip creation and no-data options, shared with raster output settings.
 */
export type TiffOptions = Pick<
  OutputSettings,
  "compression" | "noData" | "rowsPerStrip" | "predictor"
>;
const compressionCodes = { none: 1, deflate: 8, packbits: 32773 };
/**
 * Validate byte no-data, strip height, compression and predictor compatibility before
 * encoding.
 */
export function validateTiffOptions(options: TiffOptions): void {
  if (!Object.hasOwn(compressionCodes, options.compression ?? "none"))
    fail("OUTPUT", "Unsupported TIFF compression.");
  if (
    options.noData !== undefined &&
    (!Number.isInteger(options.noData) ||
      options.noData < 0 ||
      options.noData > 255)
  )
    fail("NODATA", "Byte-image no-data must be an integer from 0 to 255.");
  if (
    options.rowsPerStrip !== undefined &&
    (!Number.isInteger(options.rowsPerStrip) ||
      options.rowsPerStrip < 1 ||
      options.rowsPerStrip > 4096)
  )
    fail("OUTPUT", "Rows per strip must be an integer from 1 to 4096.");
  if (
    ![1, 2].includes(options.predictor ?? 1) ||
    (options.predictor === 2 && options.compression !== "deflate")
  )
    fail("OUTPUT", "Horizontal prediction requires Deflate compression.");
}
function check(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: Extent,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  )
    fail("RASTER", "Raster buffer dimensions disagree.");
  if (
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    fail("EXTENT", "Invalid TIFF bounds.");
}
/**
 * Encode an uncompressed north-up RGBA GeoTIFF synchronously using PixelIsArea. Allocates a complete ArrayBuffer; prefer encodeGeoTiffBlob for bounded-strip encoding.
 * @param data - Row-major 8-bit RGBA with unassociated alpha.
 * @param width - Positive integer pixel width.
 * @param height - Positive integer pixel height.
 * @param bounds - Outer pixel-edge extent in the output CRS, with row zero at maxY.
 * @param crs - EPSG identifier with numeric code below 32767. Custom WKT GeoKeys are not supported.
 * @param geographic - True for geographic CRS GeoKeys, false for projected CRS GeoKeys; must agree with crs.
 * @returns Encoded TIFF with CRS, tiepoint, pixel scale and unassociated-alpha metadata.
 */
export function encodeGeoTiff(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: Extent,
  crs: string,
  geographic: boolean,
): ArrayBuffer {
  check(data, width, height, bounds);
  const header = tiffHeader(
    width,
    height,
    bounds,
    crs,
    geographic,
    {},
    [data.length],
    height,
    4,
  );
  const output = new Uint8Array(header.byteLength + data.byteLength);
  output.set(new Uint8Array(header));
  output.set(data, header.byteLength);
  return output.buffer;
}
/**
 * Encode a north-up GeoTIFF as bounded strips assembled into a Blob, avoiding a second concatenated full TIFF buffer.
 * @param data - Row-major 8-bit RGBA with unassociated alpha.
 * @param width - Positive integer pixel width.
 * @param height - Positive integer pixel height.
 * @param bounds - Outer pixel-edge extent in the output CRS, with row zero at maxY.
 * @param crs - EPSG identifier with numeric code below 32767. Custom WKT GeoKeys are not supported.
 * @param geographic - True for geographic CRS GeoKeys, false for projected CRS GeoKeys; must agree with crs.
 * @param options - Compression, strip height, predictor and optional RGB no-data.
 * @param progress - Encoding progress fraction per completed strip.
 * @throws {@link core.GeoreferenceError} For invalid layouts/settings, unavailable Deflate or partial transparency with numeric no-data.
 */
export async function encodeGeoTiffBlob(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: Extent,
  crs: string,
  geographic: boolean,
  options: TiffOptions = {},
  progress?: (value: number) => void,
): Promise<Blob> {
  check(data, width, height, bounds);
  validateTiffOptions(options);
  const channels = options.noData === undefined ? 4 : 3;
  const rows = Math.min(height, options.rowsPerStrip ?? 256),
    strips: Blob[] = [];
  const compression = options.compression ?? "none";
  if (compression === "deflate" && typeof CompressionStream === "undefined")
    fail(
      "CAPABILITY",
      "Deflate is unavailable; select uncompressed or PackBits output.",
    );
  for (let y = 0; y < height; y += rows) {
    const count = Math.min(rows, height - y),
      pixels = new Uint8Array(width * count * channels);
    for (let i = 0; i < width * count; i++) {
      const p = (y * width + i) * 4;
      if (channels === 3 && data[p + 3] !== 0 && data[p + 3] !== 255)
        fail(
          "NODATA_ALPHA",
          "Numeric no-data cannot preserve partial transparency; select alpha output.",
        );
      for (let c = 0; c < channels; c++)
        pixels[i * channels + c] =
          channels === 3 && data[p + 3] === 0 ? options.noData! : data[p + c];
    }
    if (options.predictor === 2)
      for (let row = 0; row < count; row++)
        for (let x = width - 1; x > 0; x--)
          for (let c = 0; c < channels; c++) {
            const p = (row * width + x) * channels + c;
            pixels[p] -= pixels[p - channels];
          }
    let blob = new Blob([
      compression === "packbits" ? packBits(pixels) : pixels,
    ]);
    if (compression === "deflate")
      blob = await new Response(
        blob.stream().pipeThrough(new CompressionStream("deflate")),
      ).blob();
    strips.push(blob);
    progress?.(Math.min(1, (y + count) / height));
  }
  const header = tiffHeader(
    width,
    height,
    bounds,
    crs,
    geographic,
    options,
    strips.map((s) => s.size),
    rows,
    channels,
  );
  return new Blob([header, ...strips], { type: "image/tiff" });
}
/**
 * Convenience ArrayBuffer encoder wrapping encodeGeoTiffBlob. Materializes a complete output copy; the worker uses the Blob API.
 * @param data - Row-major 8-bit RGBA with unassociated alpha.
 * @param width - Positive integer pixel width.
 * @param height - Positive integer pixel height.
 * @param bounds - Outer pixel-edge extent in the output CRS, with row zero at maxY.
 * @param crs - EPSG identifier with numeric code below 32767. Custom WKT GeoKeys are not supported.
 * @param geographic - True for geographic CRS GeoKeys, false for projected CRS GeoKeys; must agree with crs.
 * @param compression - Strip codec; defaults to none.
 */
export async function encodeGeoTiffOutput(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: Extent,
  crs: string,
  geographic: boolean,
  compression: NonNullable<OutputSettings["compression"]> = "none",
): Promise<ArrayBuffer> {
  return (
    await encodeGeoTiffBlob(data, width, height, bounds, crs, geographic, {
      compression,
    })
  ).arrayBuffer();
}
/**
 * Encode TIFF PackBits literal/repeated runs of at most 128 bytes, with a bounded
 * worst-case output allocation.
 */
function packBits(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + Math.ceil(data.length / 128) + 2);
  let cursor = 0;
  for (let i = 0; i < data.length; ) {
    let run = 1;
    while (run < 128 && i + run < data.length && data[i + run] === data[i])
      run++;
    if (run >= 3) {
      out[cursor++] = 257 - run;
      out[cursor++] = data[i];
      i += run;
      continue;
    }
    const start = i;
    i += run;
    while (i < data.length && i - start < 128) {
      run = 1;
      while (run < 3 && i + run < data.length && data[i + run] === data[i])
        run++;
      if (run >= 3) break;
      i += Math.min(run, 128 - (i - start));
    }
    out[cursor++] = i - start - 1;
    out.set(data.subarray(start, i), cursor);
    cursor += i - start;
  }
  return out.subarray(0, cursor);
}
/**
 * Build a little-endian classic TIFF IFD with PixelIsArea, upper-left tiepoint, GeoKeys
 * and strip offsets. Rejects offsets reaching the 4 GiB classic-TIFF limit.
 */
function tiffHeader(
  width: number,
  height: number,
  bounds: Extent,
  crs: string,
  geographic: boolean,
  options: TiffOptions,
  lengths: number[],
  rows: number,
  channels: number,
): ArrayBuffer {
  const epsg = Number(/^EPSG:(\d+)$/.exec(crs)?.[1]);
  if (!epsg || epsg >= 32767)
    fail(
      "CRS",
      "GeoTIFF requires an EPSG code below 32767 with a registered definition.",
    );
  const keys = [
    1,
    1,
    0,
    3,
    1024,
    0,
    1,
    geographic ? 2 : 1,
    1025,
    0,
    1,
    1,
    geographic ? 2048 : 3072,
    0,
    1,
    epsg,
  ];
  const entries: [number, number, number[]][] = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, Array(channels).fill(8)],
    [259, 3, [compressionCodes[options.compression ?? "none"]]],
    [262, 3, [2]],
    [273, 4, lengths.map(() => 0)],
    [274, 3, [1]],
    [277, 3, [channels]],
    [278, 4, [rows]],
    [279, 4, lengths],
    [284, 3, [1]],
    [339, 3, Array(channels).fill(1)],
    [
      33550,
      12,
      [(bounds[2] - bounds[0]) / width, (bounds[3] - bounds[1]) / height, 0],
    ],
    [33922, 12, [0, 0, 0, bounds[0], bounds[3], 0]],
    [34735, 3, keys],
  ];
  if (channels === 4) entries.push([338, 3, [2]]);
  if (options.predictor === 2) entries.push([317, 3, [2]]);
  if (options.noData !== undefined)
    entries.push([
      42113,
      2,
      [...new TextEncoder().encode(String(options.noData)), 0],
    ]);
  entries.sort((a, b) => a[0] - b[0]);
  const size = (type: number) =>
    type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 8;
  const align = (n: number) => Math.ceil(n / 8) * 8;
  let end = align(8 + 2 + 12 * entries.length + 4);
  for (const [, type, values] of entries)
    if (values.length * size(type) > 4)
      end = align(end + values.length * size(type));
  let offset = end;
  entries.find((e) => e[0] === 273)![2] = lengths.map((n) => {
    const start = offset;
    offset += n;
    return start;
  });
  if (offset >= 0xffffffff)
    fail(
      "OUTPUT_BUDGET",
      "Classic TIFF is limited to 4 GiB. Reduce output dimensions.",
    );
  const header = new ArrayBuffer(end),
    view = new DataView(header);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries.length, true);
  let payload = align(8 + 2 + 12 * entries.length + 4);
  entries.forEach(([tag, type, values], index) => {
    const p = 10 + index * 12,
      bytes = values.length * size(type),
      dest = bytes <= 4 ? p + 8 : payload;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, values.length, true);
    if (bytes > 4) {
      view.setUint32(p + 8, payload, true);
      payload = align(payload + bytes);
    }
    values.forEach((v, i) => {
      if (type === 2) view.setUint8(dest + i, v);
      else if (type === 3) view.setUint16(dest + i * 2, v, true);
      else if (type === 4) view.setUint32(dest + i * 4, v, true);
      else view.setFloat64(dest + i * 8, v, true);
    });
  });
  return header;
}
