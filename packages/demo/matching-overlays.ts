/** Demo-owned candidate styling; reference acquisition never captures this layer. */

import type { MatchResult, ReferenceSnapshot } from "@georeferencing/matching";
import { densifyBoundary, transform } from "@georeferencing/matching";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import VectorLayer from "ol/layer/Vector.js";
import type OLMap from "ol/Map.js";
import { transform as project } from "ol/proj.js";
import VectorSource from "ol/source/Vector.js";
import { Fill, Stroke, Style } from "ol/style.js";

/** Transient footprints; the provider never captures this editor-owned layer. */
export function showOpenLayersCandidates(
  map: OLMap,
  result: MatchResult,
  snapshot: ReferenceSnapshot,
  selectedId?: string,
): () => void {
  const features = result.candidates
    .flatMap((candidate) =>
      [false, true].map((observed) => {
        const points = densifyBoundary(
          observed ? candidate.overlap : candidate.footprint,
          (p) =>
            project(
              transform(snapshot.pixelToMap, p),
              snapshot.crs,
              map.getView().getProjection(),
            ) as [number, number],
          (map.getView().getResolution() ?? 1) / 2,
        );
        if (!points.length) return null;
        const f = new Feature(new Polygon([[...points, points[0]]]));
        f.setStyle(
          new Style({
            stroke: new Stroke({
              color: observed ? "#087f8c" : "#ba6420",
              width: candidate.id === selectedId ? 3 : 1,
              lineDash: observed ? undefined : [6, 4],
            }),
            fill: observed
              ? new Fill({ color: "rgba(8,127,140,.08)" })
              : undefined,
          }),
        );
        return f;
      }),
    )
    .filter((f): f is Feature<Polygon> => !!f);
  const source = new VectorSource({ features }),
    layer = new VectorLayer({ source });
  map.addLayer(layer);
  return () => {
    map.removeLayer(layer);
    source.dispose();
    layer.dispose();
  };
}
