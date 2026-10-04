import type { OutputSettings } from "@georeferencing/core";
import { fail, normalizeCrs } from "@georeferencing/core";

/**
 * Supported TIFF strip creation and no-data options, shared with raster output settings.
 */
export type TiffOptions = Pick<
  OutputSettings,
  "compression" | "noData" | "rowsPerStrip" | "predictor"
>;
/** TIFF compression tag values by setting. @internal */
export const compressionCodes = { none: 1, deflate: 8, packbits: 32773 };
/**
 * Return the GeoTIFF EPSG code for a CRS identifier, accepting EPSG URI/URN aliases, or
 * null when the CRS cannot be written as a GeoKey (custom WKT or codes from 32767).
 */
export function geoTiffEpsg(crs: string): number | null {
  const code = Number(/^EPSG:(\d+)$/.exec(normalizeCrs(crs))?.[1]);
  return code > 0 && code < 32767 ? code : null;
}
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
/**
 * Explain why GeoTIFF output is unavailable for these settings, or return null. Runs
 * before rendering, so ineligible settings never cost a full-resolution render.
 * @internal
 */
export function geoTiffUnavailable(output: OutputSettings): string | null {
  if (!geoTiffEpsg(output.crs))
    return "GeoTIFF output requires an EPSG output CRS with a code below 32767.";
  try {
    validateTiffOptions(output);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
