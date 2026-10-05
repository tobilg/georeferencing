import type { FeatureCollection, Geometry, Position } from "geojson";
import type { Extent, XY } from "../core/types.js";
import type { SnapOptions } from "./references.js";

/** Reference features offered for snapping, in the coordinates `toScreen` accepts. */
export interface SnapSource {
  /** Reference provider ID, recorded as snapping provenance. */
  id: string;
  /** Candidate features. */
  data: FeatureCollection;
  /** Vertex/edge rules and pixel tolerance. */
  options: SnapOptions;
}
/** Result of {@link snapToReferences}. */
export interface SnapResult {
  /** Snapped coordinate, in the coordinates of the source data. */
  coordinate: XY;
  /** Provenance for `Gcp.reference`. */
  reference: {
    /** Reference provider ID. */
    sourceId: string;
    /** Feature ID, when the feature has one. */
    featureId?: string;
  };
}

const boxes = new WeakMap<object, Extent>();
function lines(
  geometry: Geometry | null,
  out: Position[][] = [],
): Position[][] {
  if (!geometry) return out;
  switch (geometry.type) {
    case "Point":
      out.push([geometry.coordinates]);
      break;
    case "MultiPoint":
      for (const p of geometry.coordinates) out.push([p]);
      break;
    case "LineString":
      out.push(geometry.coordinates);
      break;
    case "MultiLineString":
    case "Polygon":
      out.push(...geometry.coordinates);
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) out.push(...polygon);
      break;
    case "GeometryCollection":
      for (const child of geometry.geometries) lines(child, out);
  }
  return out;
}
function bbox(feature: FeatureCollection["features"][number]): Extent {
  let box = boxes.get(feature);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const line of lines(feature.geometry))
      for (const p of line) {
        box[0] = Math.min(box[0], p[0]);
        box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]);
        box[3] = Math.max(box[3], p[1]);
      }
    boxes.set(feature, box);
  }
  return box;
}

/**
 * Find the nearest reference vertex (and optionally edge point) within each source's
 * pixel tolerance of a pointer position.
 * @param pointer - Pointer position in screen pixels.
 * @param sources - Candidate reference features with their snapping rules.
 * @param toScreen - Project a data coordinate to screen pixels.
 * @param searchExtent - Optional data-coordinate box around the pointer (covering the
 *   largest tolerance). Features outside it are skipped without projecting them.
 * @returns The nearest candidate, or null when nothing is within tolerance.
 */
export function snapToReferences(
  pointer: XY,
  sources: readonly SnapSource[],
  toScreen: (coordinate: XY) => XY,
  searchExtent?: Extent,
): SnapResult | null {
  let best: SnapResult | null = null,
    bestDistance = Infinity;
  for (const source of sources) {
    const tolerance = source.options.tolerancePx ?? 10,
      vertices = source.options.vertices !== false,
      edges = source.options.edges ?? false;
    for (const feature of source.data.features) {
      if (searchExtent) {
        const box = bbox(feature);
        if (
          box[0] > searchExtent[2] ||
          box[2] < searchExtent[0] ||
          box[1] > searchExtent[3] ||
          box[3] < searchExtent[1]
        )
          continue;
      }
      const consider = (coordinate: XY, screen: XY) => {
        const distance = Math.hypot(
          screen[0] - pointer[0],
          screen[1] - pointer[1],
        );
        if (distance <= tolerance && distance < bestDistance) {
          bestDistance = distance;
          best = {
            coordinate,
            reference: {
              sourceId: source.id,
              ...(feature.id !== undefined
                ? { featureId: String(feature.id) }
                : {}),
            },
          };
        }
      };
      for (const line of lines(feature.geometry)) {
        const screen = line.map((p) => toScreen([p[0], p[1]]));
        for (let i = 0; i < line.length; i++) {
          if (vertices) consider([line[i][0], line[i][1]], screen[i]);
          if (!edges || i === 0) continue;
          // Closest point on the projected segment, interpolated in data coordinates.
          const a = screen[i - 1],
            b = screen[i],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            length = dx * dx + dy * dy;
          const t = length
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((pointer[0] - a[0]) * dx + (pointer[1] - a[1]) * dy) /
                    length,
                ),
              )
            : 0;
          const p = line[i - 1],
            q = line[i];
          consider(
            [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t],
            [a[0] + dx * t, a[1] + dy * t],
          );
        }
      }
    }
  }
  return best;
}
