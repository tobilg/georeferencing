/**
 * Optional lazy export formats. Prefer per-format imports to give bundlers the
 * narrowest dependency graph. Register descriptors with ControllerOptions.exports.
 * @module @georeferencing/plugins
 * @group @georeferencing/plugins
 */

export type { WorldFileOptions } from "./data.js";
export { accuracy, points, session, worldFile } from "./data.js";
export { geoTiff } from "./geotiff.js";
export { jpeg } from "./jpeg.js";
export type {
  PdfOptions,
  ReportMap,
  ReportOptions,
  ReportView,
} from "./pdf.js";
export { pdf } from "./pdf.js";
export type { JpegOptions, RasterPluginOptions } from "./types.js";
