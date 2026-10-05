import { captureMapLibreMap, maplibre } from "@georeferencing/maplibre";
import {
  Map as MapLibreMap,
  type RasterTileSource,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Vite does not emit MapLibre's worker on its own; point MapLibre at the bundled file.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  type CreateDemoMap,
  INITIAL_VIEW,
  OSM_ATTRIBUTION,
  OSM_TILES,
  zoomFor,
} from "./types.js";

setWorkerUrl(workerUrl);

export const createDemoMap: CreateDemoMap = (container, onTileError) => {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: [OSM_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: OSM_ATTRIBUTION,
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
    center: INITIAL_VIEW.center,
    zoom: zoomFor(INITIAL_VIEW.resolution, 512),
  });
  map.on("error", (event) => {
    if ((event as { sourceId?: string }).sourceId === "osm") onTileError();
  });
  return {
    map,
    adapter: maplibre(map),
    fitBounds: ([w, s, e, n]) =>
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 12 },
      ),
    retryTiles: () =>
      (map.getSource("osm") as RasterTileSource | undefined)?.setTiles([
        OSM_TILES,
      ]),
    capture: () => captureMapLibreMap(map),
    dispose: () => map.remove(),
  };
};
