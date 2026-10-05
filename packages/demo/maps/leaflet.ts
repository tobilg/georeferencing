import { leaflet } from "@georeferencing/leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type CreateDemoMap,
  INITIAL_VIEW,
  OSM_ATTRIBUTION,
  OSM_TILES,
  zoomFor,
} from "./types.js";

export const createDemoMap: CreateDemoMap = (container, onTileError) => {
  const [lon, lat] = INITIAL_VIEW.center;
  const map = L.map(container, {
    center: [lat, lon],
    zoom: zoomFor(INITIAL_VIEW.resolution, 256),
    // Leaflet snaps to whole zoom levels by default; allow the exact shared scale.
    zoomSnap: 0,
  });
  const tiles = L.tileLayer(OSM_TILES, {
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
  }).addTo(map);
  tiles.on("tileerror", onTileError);
  return {
    map,
    adapter: leaflet(map, { lib: L }),
    fitBounds: ([w, s, e, n]) =>
      map.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { padding: [12, 12] },
      ),
    retryTiles: () => tiles.redraw(),
    // Leaflet renders tiles as DOM images, so PDF reports omit the map page.
    dispose: () => map.remove(),
  };
};
