import type {
  Definitions,
  Gcp,
  GeoreferencerController,
  XY,
} from "@georeferencing/core";
import {
  createConverter,
  fitTransform,
  validateDomain,
} from "@georeferencing/core";
import { transform } from "./geometry.js";
import type {
  MatchCandidate,
  MatchResult,
  ReferenceSnapshot,
} from "./types.js";
import { MatchingError } from "./types.js";
import { distributed } from "./validation.js";
/**
 * Capture of the controller and host configuration before reference acquisition.
 * Retain with the resulting snapshot/candidates; do not regenerate at application
 * time, since that would conceal intervening edits. This is a revision guard,
 * not an authorization token, and contains no credentials.
 */
export interface ApplicationToken {
  /** Controller document identity at job start. */
  documentId: string;
  /** Normalized source-image identity; empty if no image was loaded. */
  imageId: string;
  /** Alignment revision before the job; point or model edits invalidate it. */
  alignmentRevision: number;
  /** Host revision for source data, style, layers, area, resolution and query region. */
  configurationRevision: string;
}
/**
 * Record the state against which a future result may be explicitly applied.
 *
 * @param controller - Existing authoritative editor controller.
 * @param configurationRevision - Host-managed identity of all matching inputs;
 * change it when reference content/configuration or the selected region changes.
 * @returns A token to retain unchanged alongside the matching job and result.
 */
export function createApplicationToken(
  controller: GeoreferencerController,
  configurationRevision: string,
): ApplicationToken {
  const d = controller.getSnapshot().document;
  return {
    documentId: d.id,
    imageId: d.sourceImage?.id ?? "",
    alignmentRevision: d.alignmentRevision,
    configurationRevision,
  };
}
/** Explicit application policy and coordinate conversion supplied by the host. */
export interface ApplyCandidateOptions {
  /** Current host configuration revision; must equal the captured token's value. */
  configurationRevision: string;
  /** Preserve manual points with `merge` (default); use `replace` only after explicit user choice. */
  mode?: "merge" | "replace";
  /**
   * Fit model after application. `keep` retains the document's model; `candidate`
   * switches to the matched model (similarity, affine or projective). Defaults to
   * `keep` when merging into existing points, so a manual fit such as a thin-plate
   * spline is never silently replaced, and to `candidate` otherwise.
   */
  model?: "keep" | "candidate";
  /** Maximum proposed, spatially distributed points; default 16, further capped by free core slots. */
  maxPoints?: number;
  /** Additional definitions used by core when converting snapshot/point CRS to the working CRS. */
  definitions?: Definitions;
  /**
   * Optional exact nonlinear mapping from reference pixel edges to `snapshot.crs`.
   * Defaults to the snapshot's matrix. This host callback is never sent to workers;
   * use the same mapping when drawing candidate footprints in your application.
   */
  pixelToMap?: (point: XY) => XY;
}
/**
 * Apply a reviewed candidate as distributed control points in one undoable edit.
 *
 * No dialog or UI is supplied: invoke only after the user explicitly accepts a
 * candidate. Matching alone does not modify the controller. Existing points and
 * their fit model are preserved by default. All points are fitted/validated in the working CRS through
 * core before mutation; the full source-image projective domain must remain valid.
 * A pixel-space similarity may become affine after map-coordinate conversion.
 * The operation adds source/backend provenance and respects the core GCP limit.
 *
 * @param controller - Existing controller with the original query image loaded.
 * @param result - Result retained from the completed matching job.
 * @param candidate - Exact object selected from `result.candidates` (not a copy).
 * @param snapshot - Reference snapshot used for that result, including its CRS.
 * @param token - Token captured before acquiring pixels and starting the job.
 * @param options - Current revision, merge/replace policy and optional projection mapping.
 * @throws {@link MatchingError} with `STALE` if inputs/revisions no longer agree,
 * or `BUDGET` when fewer than six proposed point slots are available. Core fitting,
 * projection or domain validation can also throw; no controller edit precedes them.
 */
export function applyCandidate(
  controller: GeoreferencerController,
  result: MatchResult,
  candidate: MatchCandidate,
  snapshot: ReferenceSnapshot,
  token: ApplicationToken,
  options: ApplyCandidateOptions,
): void {
  const d = controller.getSnapshot().document;
  if (
    !d.sourceImage ||
    d.id !== token.documentId ||
    d.sourceImage.id !== token.imageId ||
    d.alignmentRevision !== token.alignmentRevision ||
    token.configurationRevision !== options.configurationRevision ||
    result.referenceSnapshotId !== snapshot.id ||
    !result.candidates.includes(candidate)
  )
    throw new MatchingError(
      "STALE",
      "Image, alignment or reference configuration changed. Run matching again.",
    );
  const existing = options.mode === "replace" ? [] : [...d.gcps],
    limit = Math.min(128, controller.options.engine.limits?.maxGcps ?? 128),
    count = Math.min(options.maxPoints ?? 16, limit - existing.length);
  if (count < 6)
    throw new MatchingError(
      "BUDGET",
      "At least six available control-point slots are required. Explicitly replace points or remove some first.",
    );
  const mapping =
    options.pixelToMap ??
    ((point: XY) => transform(snapshot.pixelToMap, point));
  const gcps: Gcp[] = distributed(candidate.correspondences, count).map(
    (pair, i) => ({
      id: crypto.randomUUID(),
      label: Math.max(0, ...existing.map((p) => p.label)) + i + 1,
      enabled: true,
      image: [...pair.query],
      target: mapping(pair.reference),
      crs: snapshot.crs,
      reference: {
        sourceId: `matching:${snapshot.source.id}:${snapshot.id}`,
        featureId: `${candidate.id}:${result.diagnostics.backend}:${result.diagnostics.detector}`,
      },
    }),
  );
  const all = [...existing, ...gcps],
    working = all.map((g) => ({
      ...g,
      target: createConverter(
        g.crs,
        d.workingCrs,
        options.definitions,
      )(g.target),
    }));
  // Reuse core fitting/domain validation in the actual working CRS, including nonlinear projections.
  const h = snapshot.pixelToMap;
  const mapSimilarity =
    Math.abs(h[6]) + Math.abs(h[7]) < 1e-12 &&
    Math.abs(h[0] * h[1] + h[3] * h[4]) < 1e-8 &&
    Math.abs(Math.hypot(h[0], h[3]) - Math.hypot(h[1], h[4])) < 1e-8 &&
    h[0] * h[4] - h[1] * h[3] < 0;
  const useCandidate =
    (options.model ?? (existing.length ? "keep" : "candidate")) === "candidate";
  const model = !useCandidate
    ? d.model
    : candidate.model === "helmert" &&
        (options.pixelToMap || snapshot.crs !== d.workingCrs || !mapSimilarity)
      ? "polynomial1"
      : candidate.model;
  const fit = fitTransform(working, model);
  validateDomain(fit, d.sourceImage.width, d.sourceImage.height);
  controller.replaceGcps(all, useCandidate ? model : undefined);
}
