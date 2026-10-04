/**
 * Optional session, QGIS points, world-file and accuracy exports.
 * @module data
 */
import type { Definitions, ExportFormat } from "@georeferencing/core";

/** Register a complete version-1 JSON session download, even before a valid fit. */
export function session(): ExportFormat {
  return {
    id: "session",
    label: "Export session",
    requiresFit: false,
    load: async () => (await import("./data-export.js")).sessionExporter,
  };
}

/** Register QGIS .points download, projecting targets with the supplied definitions. */
export function points(definitions: Definitions = {}): ExportFormat {
  return {
    id: "points",
    label: "Export .points",
    requiresFit: false,
    load: async () =>
      (await import("./data-export.js")).pointsExporter(definitions),
  };
}

/** Register a full-precision JSON alignment report with training residual formulas. */
export function accuracy(): ExportFormat {
  return {
    id: "accuracy",
    label: "Accuracy report",
    load: async () => (await import("./data-export.js")).accuracyExporter,
  };
}

/** Register original-resolution normalized PNG, world file and explicit CRS sidecar. */
export function worldFile(): ExportFormat {
  return {
    id: "world-file",
    label: "World file & CRS",
    unavailable: (doc) =>
      ["linear", "helmert"].includes(doc.model) &&
      doc.workingCrs === doc.output.crs
        ? null
        : "World-file output requires Linear/Helmert without reprojection.",
    load: async () => (await import("./data-export.js")).worldFileExporter,
  };
}
