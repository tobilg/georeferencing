import { captureOpenLayersMap, openLayers } from "@georeferencing/openlayers";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import TileLayer from "ol/layer/Tile.js";
import OLMap from "ol/Map.js";
import { fromLonLat, transformExtent } from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import View from "ol/View.js";
import "ol/ol.css";
import { type CreateDemoMap, INITIAL_VIEW } from "./types.js";

export const createDemoMap: CreateDemoMap = (container, onTileError) => {
  // OSM supplies the standard tile URL, anonymous CORS and visible attribution.
  const source = new OSM();
  source.on("tileloaderror", onTileError);
  const map = new OLMap({
    target: container,
    // OpenLayers' Map default only pans/zooms by mouse after a focusable target has
    // keyboard focus; allow both immediately while keeping keyboard navigation.
    interactions: defaultInteractions({ onFocusOnly: false }),
    layers: [new TileLayer({ source })],
    view: new View({
      projection: "EPSG:3857",
      center: fromLonLat(INITIAL_VIEW.center),
      resolution: INITIAL_VIEW.resolution,
    }),
  });
  return {
    map,
    adapter: openLayers(map),
    fitBounds: (bounds) =>
      map.getView().fit(transformExtent(bounds, "EPSG:4326", "EPSG:3857"), {
        padding: [12, 12, 12, 12],
      }),
    retryTiles: () => source.refresh(),
    capture: () => captureOpenLayersMap(map),
    dispose() {
      map.setTarget(undefined);
      map.dispose();
      source.dispose();
    },
  };
};
