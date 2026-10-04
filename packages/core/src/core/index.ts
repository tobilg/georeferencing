/**
 * Serializable documents, editor state, coordinate transforms and interchange.
 * Import from `@georeferencing/core` (or its `/core` alias) for headless integrations.
 * @module @georeferencing/core
 * @group @georeferencing/core
 */
export * from "./controller.js";
export * from "./coordinates.js";
export type {
  ExportContent,
  ExportContext,
  Exporter,
  ExportFile,
  ExportFormat,
  ExportResult,
} from "./exports.js";
export * from "./geometry.js";
export * from "./interchange.js";
export * from "./projection.js";
export * from "./transform.js";
export * from "./types.js";
