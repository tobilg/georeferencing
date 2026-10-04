import type Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Definitions } from "../core/projection.js";
import { project } from "../core/projection.js";
import type { Features, XY } from "../core/types.js";
import { fail } from "../core/types.js";
/**
 * Convert an OpenLayers Point, LineString or Polygon into longitude/latitude GeoJSON, preserving ID and properties.
 *
 * Adaptive subdivision preserves straight map-space segments when projection curves them. It rejects antimeridian crossings and subdivision-budget exhaustion instead of silently distorting geometry.
 * @param feature - Host-map geometry in mapCrs; not mutated.
 * @param mapCrs - Explicit geometry CRS.
 * @param tolerance - Positive allowed midpoint deviation in map units.
 * @param definitions - Additional host projection definitions.
 */
export function toGeographicFeature(
  feature: Feature,
  mapCrs: string,
  tolerance: number,
  definitions: Definitions = {},
): Features["features"][number] {
  if (!(tolerance > 0))
    fail(
      "GEOMETRY",
      "Geometry conversion tolerance must be positive in map units.",
    );
  const json = new GeoJSON().writeFeatureObject(
    feature,
  ) as Features["features"][number];
  let vertices = 0;
  const convert = (p: XY) => project(p, mapCrs, "EPSG:4326", definitions);
  const segment = (a: XY, b: XY, depth = 0): XY[] => {
    if (++vertices > 20000)
      return fail(
        "GEOMETRY_BUDGET",
        "Reprojected geometry exceeds 20,000 vertices. Use a coarser tolerance or smaller features.",
      );
    const x = convert(a),
      y = convert(b),
      middle: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.abs(x[0] - y[0]) > 180)
      return fail(
        "WRAP",
        "Split antimeridian-crossing geometries before saving.",
      );
    const projectedChord = project(
      [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2],
      "EPSG:4326",
      mapCrs,
      definitions,
    );
    if (
      Math.hypot(
        projectedChord[0] - middle[0],
        projectedChord[1] - middle[1],
      ) <= tolerance
    )
      return [x];
    if (depth >= 16)
      return fail("GEOMETRY", "Cannot meet geometry projection tolerance.");
    return [...segment(a, middle, depth + 1), ...segment(middle, b, depth + 1)];
  };
  const line = (points: number[][]): XY[] => [
    ...points.slice(1).flatMap((p, i) => segment(points[i] as XY, p as XY)),
    convert(points[points.length - 1] as XY),
  ];
  if (json.geometry.type === "Point")
    json.geometry.coordinates = convert(json.geometry.coordinates as XY);
  else if (json.geometry.type === "LineString")
    json.geometry.coordinates = line(json.geometry.coordinates);
  else if (json.geometry.type === "Polygon")
    json.geometry.coordinates = json.geometry.coordinates.map(line);
  else fail("GEOMETRY", "Unsupported draft geometry.");
  return json;
}
