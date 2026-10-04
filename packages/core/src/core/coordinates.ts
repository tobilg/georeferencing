import { validateFeatures } from "./geometry.js";
import type { Definitions } from "./projection.js";
import { project } from "./projection.js";
import type { Features, XY } from "./types.js";
import { fail } from "./types.js";
/**
 * Explicit projected-coordinate envelope. Its feature geometries use `crs` and must not
 * be presented as RFC 7946 GeoJSON.
 */
export interface ProjectedFeatures {
  /** Discriminator preventing confusion with standard geographic GeoJSON. */
  type: "ProjectedFeatureCollection";
  /** Coordinate reference system of every returned geometry. */
  crs: string;
  /**
   * Cloned features with IDs and properties preserved and segment vertices densified
   * where necessary.
   */
  features: Features["features"];
}
/**
 * Convert accepted geographic features into an explicit projected envelope without changing the document.
 * @param features - Valid RFC 7946 features in longitude/latitude.
 * @param crs - Destination CRS.
 * @param tolerance - Positive midpoint-deviation tolerance in output-CRS units.
 * @param definitions - Host projection definitions.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For invalid geometry, wrapped segments, missing projections or subdivision-budget exhaustion.
 */
export function featuresInCrs(
  features: Features,
  crs: string,
  tolerance: number,
  definitions: Definitions = {},
): ProjectedFeatures {
  const errors = validateFeatures(features);
  if (errors.length) fail("GEOMETRY", errors.join(" "));
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    fail(
      "GEOMETRY",
      "Projection tolerance must be positive in output CRS units.",
    );
  let count = 0;
  const convert = (p: XY) => project(p, "EPSG:4326", crs, definitions);
  const segment = (a: XY, b: XY, depth = 0): XY[] => {
    if (++count > 20000)
      return fail(
        "GEOMETRY_BUDGET",
        "Projected collection exceeds 20,000 subdivision vertices.",
      );
    if (Math.abs(a[0] - b[0]) > 180)
      return fail(
        "WRAP",
        "Split antimeridian-crossing features before projection.",
      );
    const x = convert(a),
      y = convert(b),
      mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      q = convert(mid);
    if (
      Math.hypot(q[0] - (x[0] + y[0]) / 2, q[1] - (x[1] + y[1]) / 2) <=
      tolerance
    )
      return [x];
    if (depth >= 16)
      return fail(
        "GEOMETRY",
        "Cannot meet output geometry projection tolerance.",
      );
    return [...segment(a, mid, depth + 1), ...segment(mid, b, depth + 1)];
  };
  const line = (coordinates: number[][]): XY[] => [
    ...coordinates
      .slice(1)
      .flatMap((p, i) => segment(coordinates[i] as XY, p as XY)),
    convert(coordinates.at(-1)! as XY),
  ];
  const result = structuredClone(features.features);
  for (const f of result) {
    const g = f.geometry;
    if (g.type === "Point") g.coordinates = convert(g.coordinates as XY);
    else if (g.type === "LineString") g.coordinates = line(g.coordinates);
    else g.coordinates = g.coordinates.map(line);
  }
  return { type: "ProjectedFeatureCollection", crs, features: result };
}
