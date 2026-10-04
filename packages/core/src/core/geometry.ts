import type { Extent, Features, XY } from "./types.js";
import { fail } from "./types.js";
/**
 * Validate finite, acyclic JSON data, rejecting functions, undefined values and class instances.
 * @param value - Value to validate without mutation.
 * @param seen - Ancestor set used during recursion; callers normally omit this.
 * @throws {@link "@georeferencing/core".GeoreferenceError} If the value cannot be safely persisted as JSON.
 */
export function assertJson(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (
    typeof value !== "object" ||
    seen.has(value) ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    fail("JSON", "Properties must contain finite, acyclic JSON values only.");
  seen.add(value);
  for (const v of Object.values(value as object)) assertJson(v, seen);
  seen.delete(value);
}
const cross = (a: XY, b: XY, c: XY) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  if (o[0] * o[1] < 0 && o[2] * o[3] < 0) return true;
  const on = (p: XY, u: XY, v: XY) =>
    p[0] >= Math.min(u[0], v[0]) &&
    p[0] <= Math.max(u[0], v[0]) &&
    p[1] >= Math.min(u[1], v[1]) &&
    p[1] <= Math.max(u[1], v[1]);
  return (
    (o[0] === 0 && on(c, a, b)) ||
    (o[1] === 0 && on(d, a, b)) ||
    (o[2] === 0 && on(a, c, d)) ||
    (o[3] === 0 && on(b, c, d))
  );
}
function inside(p: XY, ring: XY[]): boolean {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if (
      ring[i][1] > p[1] !== ring[j][1] > p[1] &&
      p[0] <
        ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) /
          (ring[j][1] - ring[i][1]) +
          ring[i][0]
    )
      value = !value;
  return value;
}
/**
 * Validate identified Point, LineString and Polygon features in longitude/latitude.
 * @param features - Collection to check without mutation.
 * @param mode - `draft` checks structure and serializability while allowing editable topology errors; `accepted` also checks ring topology and antimeridian segments.
 * @returns Unique human-readable errors; an empty array means the requested checks passed.
 */
export function validateFeatures(
  features: Features,
  mode: "draft" | "accepted" = "accepted",
): string[] {
  const errors: string[] = [],
    ids = new Set<string>();
  if (
    features?.type !== "FeatureCollection" ||
    !Array.isArray(features.features)
  )
    return ["Expected a GeoJSON FeatureCollection."];
  for (const f of features.features) {
    if (f?.type !== "Feature") {
      errors.push("Expected a GeoJSON Feature.");
      continue;
    }
    const id = String(f.id ?? "?");
    if (typeof f.id !== "string" || !f.id || ids.has(f.id))
      errors.push(`${id}: features require unique string IDs.`);
    ids.add(id);
    try {
      assertJson(f.properties);
      if (
        !f.properties ||
        Array.isArray(f.properties) ||
        typeof f.properties !== "object"
      )
        throw Error();
    } catch {
      errors.push(`${id}: invalid properties object.`);
    }
    if (
      !f.geometry ||
      !["Point", "LineString", "Polygon"].includes(f.geometry.type)
    ) {
      errors.push(`${id}: unsupported geometry.`);
      continue;
    }
    const rings =
      f.geometry.type === "Point"
        ? [[f.geometry.coordinates]]
        : f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.coordinates;
    if (
      !Array.isArray(rings) ||
      !rings.length ||
      rings.some(
        (ring) =>
          !Array.isArray(ring) ||
          !ring.length ||
          !ring.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              p.every(Number.isFinite) &&
              Math.abs(p[0]) <= 180 &&
              Math.abs(p[1]) <= 90,
          ),
      )
    ) {
      errors.push(`${id}: use nonempty finite longitude/latitude coordinates.`);
      continue;
    }
    for (const ring of rings) {
      if (
        (f.geometry.type === "LineString" && ring.length < 2) ||
        (f.geometry.type === "Polygon" &&
          (ring.length < 4 ||
            ring[0].join(",") !== ring[ring.length - 1].join(",")))
      ) {
        errors.push(
          `${id}: lines require two vertices; polygon rings require four vertices and closure.`,
        );
        continue;
      }
      if (mode === "draft") continue;
      const distinct = new Set(ring.map((p) => p.join(","))).size;
      if (
        distinct <
        (f.geometry.type === "Point"
          ? 1
          : f.geometry.type === "LineString"
            ? 2
            : 3)
      )
        errors.push(`${id}: too few distinct vertices.`);
      for (let i = 1; i < ring.length; i++)
        if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180)
          errors.push(
            `${id}: antimeridian-crossing segments require splitting.`,
          );
      if (f.geometry.type === "Polygon") {
        const area = ring
          .slice(1)
          .reduce((s, p, i) => s + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
        if (Math.abs(area) < 1e-20)
          errors.push(`${id}: polygon ring has zero area.`);
        for (let i = 0; i < ring.length - 1; i++)
          for (let j = i + 2; j < ring.length - 1; j++)
            if (
              !(i === 0 && j === ring.length - 2) &&
              intersects(
                ring[i] as XY,
                ring[i + 1] as XY,
                ring[j] as XY,
                ring[j + 1] as XY,
              )
            )
              errors.push(`${id}: self-intersecting ring.`);
      }
    }
    if (
      mode === "accepted" &&
      f.geometry.type === "Polygon" &&
      rings.length > 1
    ) {
      for (let i = 1; i < rings.length; i++)
        if (!inside(rings[i][0] as XY, rings[0] as XY[]))
          errors.push(`${id}: hole is outside shell.`);
      for (let i = 0; i < rings.length; i++)
        for (let j = i + 1; j < rings.length; j++) {
          for (let a = 0; a < rings[i].length - 1; a++)
            for (let b = 0; b < rings[j].length - 1; b++)
              if (
                intersects(
                  rings[i][a] as XY,
                  rings[i][a + 1] as XY,
                  rings[j][b] as XY,
                  rings[j][b + 1] as XY,
                )
              )
                errors.push(`${id}: intersecting polygon rings.`);
          if (
            i > 0 &&
            (inside(rings[i][0] as XY, rings[j] as XY[]) ||
              inside(rings[j][0] as XY, rings[i] as XY[]))
          )
            errors.push(`${id}: nested/overlapping holes.`);
        }
    }
  }
  return [...new Set(errors)];
}
/**
 * Whether any vertex of a structurally valid collection lies outside a
 * longitude/latitude extent. Boundary vertices are inside.
 * @param features - Collection validated in at least `draft` mode.
 * @param bounds - `[minLon, minLat, maxLon, maxLat]`.
 */
export function outsideBounds(features: Features, bounds: Extent): boolean {
  return features.features.some((f) => {
    const g = f.geometry;
    const coordinates =
      g.type === "Point"
        ? [g.coordinates]
        : g.type === "LineString"
          ? g.coordinates
          : g.coordinates.flat();
    return coordinates.some(
      (p) =>
        p[0] < bounds[0] ||
        p[0] > bounds[2] ||
        p[1] < bounds[1] ||
        p[1] > bounds[3],
    );
  });
}
