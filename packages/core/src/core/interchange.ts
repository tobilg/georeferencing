import { assertJson, validateFeatures } from "./geometry.js";
import type { Document, Gcp } from "./types.js";
import { fail, MODELS, uid } from "./types.js";

/**
 * Parse comma- or tab-delimited QGIS `.points` text, including sourceX/sourceY and legacy pixelX/pixelY headers.
 * @param text - File text; optional BOM and `#CRS:` header are supported.
 * @param fallbackCrs - Required if the file has no CRS header. Does not override an existing header.
 * @returns Newly identified GCPs in canonical y-down image pixels and the file's target CRS.
 * @throws {@link core.GeoreferenceError} For missing CRS, invalid columns or nonfinite/invalid rows.
 */
export function importPoints(
  text: string,
  fallbackCrs?: string,
): {
  /**
   * Imported control points with fresh IDs, sequential labels and canonical y-down source
   * coordinates.
   */
  gcps: Gcp[];
  /** Target CRS read from the header or supplied fallback. */
  crs: string;
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const crsLine = lines
    .find((l) => l.startsWith("#CRS:"))
    ?.slice(5)
    .trim();
  /** Target CRS read from the header or supplied fallback. */
  const crs = crsLine || fallbackCrs;
  if (!crs) fail("CRS", "The points file requires an explicit target CRS.");
  const data = lines.filter((l) => !l.startsWith("#") && l.trim());
  const delimiter = data[0]?.includes("\t") ? "\t" : ",";
  const header =
    data
      .shift()
      ?.split(delimiter)
      .map((s) => s.trim()) ?? [];
  // QGIS 3.44 writes sourceX/sourceY; older raster-only files use pixelX/pixelY.
  for (let i = 0; i < header.length; i++) {
    if (header[i] === "sourceX") header[i] = "pixelX";
    if (header[i] === "sourceY") header[i] = "pixelY";
  }
  if (!["mapX", "mapY", "pixelX", "pixelY"].every((k) => header.includes(k)))
    fail("POINTS", "Missing QGIS .points header columns.");
  /**
   * Imported control points with fresh IDs, sequential labels and canonical y-down source
   * coordinates.
   */
  const gcps = data.map((line, i): Gcp => {
    const fields = line.split(delimiter),
      value = (key: string) =>
        key === "enable" && !header.includes("enable")
          ? 1
          : Number(fields[header.indexOf(key)]);
    if (
      fields.length < header.length ||
      !["mapX", "mapY", "pixelX", "pixelY", "enable"].every(
        (k) =>
          (k === "enable" && !header.includes(k)) ||
          (fields[header.indexOf(k)]?.trim() && Number.isFinite(value(k))),
      ) ||
      ![0, 1].includes(value("enable"))
    )
      return fail("POINTS", `Invalid .points row ${i + 2}.`);
    return {
      id: uid(),
      label: i + 1,
      enabled: value("enable") === 1,
      image: [value("pixelX"), -value("pixelY") || 0],
      target: [value("mapX"), value("mapY")],
      crs: crs!,
    };
  });
  return {
    /**
     * Imported control points with fresh IDs, sequential labels and canonical y-down
     * source coordinates.
     */
    gcps,
    /** Target CRS read from the header or supplied fallback. */
    crs: crs!,
  };
}
/**
 * Parse and validate a version-1 JSON session without restoring image bytes or trusting cached fits.
 *
 * Unknown schema versions, invalid identities, stale confirmation, inconsistent provenance and structurally invalid drafts are rejected. Use the controller's `restoreSession` to verify the matching original image.
 * @throws SyntaxError For malformed JSON.
 * @throws {@link core.GeoreferenceError} For invalid session data.
 */
export function parseSession(text: string): Document {
  const d = JSON.parse(text) as Document;
  assertJson(d);
  if (!d || typeof d !== "object" || d.schemaVersion !== 1)
    fail("SCHEMA", "Unsupported session schema; expected version 1.");
  if (
    typeof d.id !== "string" ||
    !d.id ||
    typeof d.workingCrs !== "string" ||
    !d.workingCrs.trim() ||
    !Object.hasOwn(MODELS, d.model) ||
    !Array.isArray(d.gcps) ||
    !d.output ||
    typeof d.output.crs !== "string" ||
    !d.output.crs.trim() ||
    !["nearest", "bilinear", "cubic", "cubicSpline", "lanczos"].includes(
      d.output.resampler,
    ) ||
    !["none", "deflate", "packbits"].includes(d.output.compression ?? "none")
  )
    fail("SCHEMA", "Incomplete session document.");
  const byte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 255;
  if (
    (d.output.noData !== undefined && !byte(d.output.noData)) ||
    (d.output.sourceNoData !== undefined &&
      (Array.isArray(d.output.sourceNoData)
        ? d.output.sourceNoData.length !== 3 ||
          !d.output.sourceNoData.every(byte)
        : !byte(d.output.sourceNoData))) ||
    (d.output.rowsPerStrip !== undefined &&
      (!Number.isInteger(d.output.rowsPerStrip) ||
        d.output.rowsPerStrip < 1 ||
        d.output.rowsPerStrip > 4096)) ||
    ![1, 2].includes(d.output.predictor ?? 1) ||
    (d.output.predictor === 2 && d.output.compression !== "deflate")
  )
    fail("SCHEMA", "Invalid raster creation or no-data settings.");
  for (const revision of [
    d.documentRevision,
    d.alignmentRevision,
    d.featureRevision,
  ])
    if (!Number.isSafeInteger(revision) || revision < 0)
      fail("SCHEMA", "Invalid session revision.");
  for (const revision of [
    d.confirmedAlignmentRevision,
    d.featuresReviewedAgainstAlignmentRevision,
  ])
    if (revision !== null && revision !== d.alignmentRevision)
      fail("SCHEMA", "Stale confirmation/review in session.");
  if (
    new Set(d.gcps.map((p) => p?.id)).size !== d.gcps.length ||
    d.gcps.some(
      (p) =>
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        typeof p.enabled !== "boolean" ||
        !Number.isSafeInteger(p.label) ||
        p.label < 1 ||
        !Array.isArray(p.image) ||
        p.image.length !== 2 ||
        !Array.isArray(p.target) ||
        p.target.length !== 2 ||
        ![...p.image, ...p.target].every(Number.isFinite) ||
        typeof p.crs !== "string" ||
        !p.crs.trim(),
    )
  )
    fail("SCHEMA", "Invalid session control points.");
  if (
    d.sourceImage &&
    (typeof d.sourceImage.id !== "string" ||
      !d.sourceImage.id ||
      typeof d.sourceImage.name !== "string" ||
      !Number.isSafeInteger(d.sourceImage.sizeBytes) ||
      d.sourceImage.sizeBytes < 1 ||
      !["png", "jpeg", "webp", "tiff"].includes(d.sourceImage.format) ||
      !Number.isInteger(d.sourceImage.orientation) ||
      d.sourceImage.orientation < 1 ||
      d.sourceImage.orientation > 8 ||
      !Number.isSafeInteger(d.sourceImage.originalWidth) ||
      d.sourceImage.originalWidth < 1 ||
      !Number.isSafeInteger(d.sourceImage.originalHeight) ||
      d.sourceImage.originalHeight < 1 ||
      typeof d.sourceImage.georeferenced !== "boolean" ||
      !/^[a-f0-9]{64}$/.test(d.sourceImage.fingerprint) ||
      d.sourceImage.pixelConvention !== "normalized-top-left-corner-y-down" ||
      !Number.isSafeInteger(d.sourceImage.width) ||
      !Number.isSafeInteger(d.sourceImage.height) ||
      d.sourceImage.width <= 0 ||
      d.sourceImage.height <= 0)
  )
    fail("SCHEMA", "Invalid image identity or coordinate convention.");
  if (
    d.sourceImage === undefined ||
    (!d.sourceImage &&
      (d.confirmedAlignmentRevision !== null ||
        d.featuresReviewedAgainstAlignmentRevision !== null))
  )
    fail("SCHEMA", "Invalid source/confirmation relationship.");
  const errors = validateFeatures(d.features, "draft");
  if (errors.length) fail("GEOMETRY", errors.join(" "));
  if (!d.sourceImage && (d.gcps.length || d.features.features.length))
    fail("SCHEMA", "Image-dependent data has no source identity.");
  if (
    !d.provenanceByFeatureId ||
    d.features.features.some(
      (f) => !Object.hasOwn(d.provenanceByFeatureId, f.id!),
    )
  )
    fail("SCHEMA", "Missing feature provenance.");
  for (const f of d.features.features) {
    const p = d.provenanceByFeatureId[String(f.id)];
    if (
      !p ||
      p.sourceImageId !== d.sourceImage?.id ||
      !Number.isSafeInteger(p.createdAgainstAlignmentRevision) ||
      p.createdAgainstAlignmentRevision < 0 ||
      p.createdAgainstAlignmentRevision > d.alignmentRevision ||
      (p.lastReviewedAgainstAlignmentRevision !== null &&
        p.lastReviewedAgainstAlignmentRevision !== d.alignmentRevision)
    )
      fail("SCHEMA", "Invalid feature provenance revisions or image identity.");
  }
  if (
    d.output.resolution &&
    (!Array.isArray(d.output.resolution) ||
      d.output.resolution.length !== 2 ||
      d.output.resolution.some((v) => !Number.isFinite(v) || v <= 0))
  )
    fail("SCHEMA", "Invalid output resolution.");
  if (
    d.output.bounds &&
    (!Array.isArray(d.output.bounds) ||
      d.output.bounds.length !== 4 ||
      !d.output.bounds.every(Number.isFinite) ||
      d.output.bounds[0] >= d.output.bounds[2] ||
      d.output.bounds[1] >= d.output.bounds[3])
  )
    fail("SCHEMA", "Invalid output bounds.");
  return d;
}
