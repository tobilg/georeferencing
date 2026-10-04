/**
 * Optional session, QGIS points, world-file and accuracy exports.
 * @module @georeferencing/plugins/data
 * @group @georeferencing/plugins
 */
import type { Definitions, ExportFormat } from "@georeferencing/core";
import { normalizeCrs } from "@georeferencing/core";
import type { WorldFileOptions } from "./serializers.js";
import { worldFileModels } from "./serializers.js";

export type { WorldFileOptions } from "./serializers.js";

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

/**
 * Register original-resolution normalized PNG, world file and explicit CRS sidecar.
 * @param options - Set `affine` to also offer world files for Polynomial 1 fits.
 */
export function worldFile(options: WorldFileOptions = {}): ExportFormat {
  const models = worldFileModels(options);
  return {
    id: "world-file",
    label: "World file & CRS",
    unavailable: (doc) =>
      models.includes(doc.model) &&
      normalizeCrs(doc.workingCrs) === normalizeCrs(doc.output.crs)
        ? null
        : options.affine
          ? "World-file output requires a Linear, Helmert or affine fit without reprojection."
          : "World-file output requires Linear/Helmert without reprojection.",
    load: async () =>
      (await import("./data-export.js")).worldFileExporter(options),
  };
}
