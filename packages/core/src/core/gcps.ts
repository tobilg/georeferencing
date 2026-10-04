import type { Gcp } from "./types.js";
import { fail, MAX_GCPS } from "./types.js";

const isPair = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

/**
 * Whether a value is a structurally valid control point: nonempty string ID, positive
 * integer label, boolean enabled flag, finite image/target pairs and a nonempty CRS.
 * @internal
 */
export function isValidGcp(p: unknown): p is Gcp {
  const g = p as Gcp | null;
  return Boolean(
    g &&
      typeof g === "object" &&
      typeof g.id === "string" &&
      g.id &&
      Number.isSafeInteger(g.label) &&
      g.label >= 1 &&
      typeof g.enabled === "boolean" &&
      isPair(g.image) &&
      isPair(g.target) &&
      typeof g.crs === "string" &&
      g.crs.trim() &&
      (g.reference === undefined ||
        (g.reference &&
          typeof g.reference.sourceId === "string" &&
          (g.reference.featureId === undefined ||
            typeof g.reference.featureId === "string"))),
  );
}

/**
 * Validate a complete control-point list before committing it.
 * @param gcps - Candidate list.
 * @param maxGcps - Effective point budget, never above {@link MAX_GCPS}.
 * @throws {@link GeoreferenceError} With code `BUDGET`, `COORDINATE` or `IDENTITY`.
 * @internal
 */
export function validateGcps(gcps: readonly Gcp[], maxGcps: number): void {
  if (!Array.isArray(gcps))
    fail("COORDINATE", "Control points must be a list.");
  const limit = Math.min(maxGcps, MAX_GCPS);
  if (gcps.length > limit) fail("BUDGET", `Maximum ${limit} GCPs.`);
  if (!gcps.every(isValidGcp))
    fail(
      "COORDINATE",
      "Control points require finite image/target coordinates, a CRS, a positive label and an enabled flag.",
    );
  if (new Set(gcps.map((p) => p.id)).size !== gcps.length)
    fail("IDENTITY", "Control point IDs must be unique.");
}
