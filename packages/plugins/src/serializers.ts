/**
 * Pure serializers for QGIS points, world files and alignment accuracy reports.
 * Import from `@georeferencing/plugins/serializers`; no workers or UI are loaded.
 * @module @georeferencing/plugins/serializers
 * @group @georeferencing/plugins
 */
import type { Definitions, Document, Fit } from "@georeferencing/core";
import {
  ENGINE_VERSION,
  fail,
  forward,
  normalizeCrs,
  project,
} from "@georeferencing/core";

/**
 * Export a QGIS-compatible `.points` text file. Targets are projected into the document working CRS; canonical image y is negated to QGIS source y-up coordinates.
 *
 * Residual columns are placeholders set to zero; use `accuracyReport` for actual diagnostics. IDs and snap provenance are not represented by this format.
 */
export function exportPoints(
  doc: Document,
  definitions: Definitions = {},
): string {
  return (
    `#CRS: ${doc.workingCrs}\nmapX,mapY,sourceX,sourceY,enable,dX,dY,residual\n` +
    doc.gcps
      .map((p) =>
        [
          ...project(p.target, p.crs, doc.workingCrs, definitions),
          p.image[0],
          -p.image[1],
          p.enabled ? 1 : 0,
          0,
          0,
          0,
        ].join(","),
      )
      .join("\n") +
    "\n"
  );
}
/** Options for world-file placement. */
export interface WorldFileOptions {
  /**
   * Also accept Polynomial 1 (affine) fits. A world file represents any affine transform
   * exactly, including rotation and shear; QGIS offers world files only for Linear and
   * Helmert, so this is opt-in.
   * @defaultValue `false`
   */
  affine?: boolean;
}
/** Models a world file can represent with the given options. @internal */
export function worldFileModels(options: WorldFileOptions = {}): string[] {
  return options.affine
    ? ["linear", "helmert", "polynomial1"]
    : ["linear", "helmert"];
}
/**
 * Create a six-line world file plus an explicit CRS sidecar value for Linear or Helmert fits (and optionally affine fits) without reprojection.
 *
 * Line order is A, D, B, E, C, F. The final two values locate the first pixel centre, `[0.5, 0.5]`. A world file alone contains no CRS.
 * @param options - Set `affine` to also accept Polynomial 1 fits.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For ineligible models or different working/output CRSs.
 */
export function worldFile(
  fit: Fit,
  workingCrs: string,
  outputCrs: string,
  options: WorldFileOptions = {},
): {
  /**
   * Six newline-separated values in A, D, B, E, C, F order, including the pixel-centre
   * offset.
   */
  text: string;
  /** Explicit CRS to retain beside the world file. */
  crs: string;
} {
  if (
    !worldFileModels(options).includes(fit.model) ||
    normalizeCrs(workingCrs) !== normalizeCrs(outputCrs)
  )
    fail(
      "WORLD_FILE",
      options.affine
        ? "World-file-only output requires a Linear, Helmert or affine fit without reprojection."
        : "World-file-only output requires Linear/Helmert without reprojection.",
    );
  const a = forward(fit, [0, 0]),
    b = forward(fit, [1, 0]),
    c = forward(fit, [0, 1]),
    center = forward(fit, [0.5, 0.5]);
  return {
    /**
     * Six newline-separated values in A, D, B, E, C, F order, including the pixel-centre
     * offset.
     */
    text: `${[
      b[0] - a[0],
      b[1] - a[1],
      c[0] - a[0],
      c[1] - a[1],
      ...center,
    ].join("\n")}\n`,
    /** Explicit CRS to retain beside the world file. */
    crs: workingCrs,
  };
}
/**
 * Serialize the supplied document, fit, residual formulas and engine identity as readable JSON.
 *
 * The caller must supply a fit for this exact document revision. Training residuals do not certify independent accuracy; the report explicitly records that limitation and does not claim plain GDAL CLI equivalence.
 */
export function accuracyReport(doc: Document, fit: Fit): string {
  return JSON.stringify(
    {
      document: doc,
      engine: ENGINE_VERSION,
      diagnostics: {
        definition:
          "r = T(image) - target; RMSE = sqrt(sum(||r||²)/enabledCount)",
        units: doc.workingCrs,
        independentAccuracy:
          "Not measured; training residuals do not certify accuracy.",
        ...fit,
      },
      reproducibility: {
        inverse: fit.backward,
        recipe:
          "Restore this document and matching SHA-256 image using this package version. Plain GDAL CLI equivalence is unverified.",
      },
    },
    null,
    2,
  );
}
