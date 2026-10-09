import {
  createLeafletProvider,
  leafletSelection,
} from "@georeferencing/matching/leaflet";
import {
  createMapLibreProvider,
  mapLibreSelection,
} from "@georeferencing/matching/maplibre";
import {
  createOpenLayersProvider,
  openLayersSelection,
} from "@georeferencing/matching/openlayers";
import type * as L from "leaflet";
import type { Map as MapLibreMap } from "maplibre-gl";
import type BaseLayer from "ol/layer/Base.js";
import type OLMap from "ol/Map.js";

// Each provider reads the WMS configuration of a layer the application already
// shows; each selection helper turns the current view into the search area.

export function openLayersReference(map: OLMap, wmsLayer: BaseLayer) {
  const provider = createOpenLayersProvider([
    { id: "ortho", layer: wmsLayer, revision: "2026" },
  ]);
  return provider.acquire(openLayersSelection(map, ["ortho"]));
}

export function leafletReference(map: L.Map, wmsLayer: L.TileLayer.WMS) {
  const provider = createLeafletProvider([
    { id: "ortho", layer: wmsLayer, revision: "2026" },
  ]);
  return provider.acquire(leafletSelection(map, ["ortho"]));
}

// `layer` is the style layer ID of a raster layer whose source tiles are WMS
// GetMap URLs with `{bbox-epsg-3857}`.
export function mapLibreReference(map: MapLibreMap, layer: string) {
  const provider = createMapLibreProvider([
    { id: "ortho", map, layer, revision: "2026" },
  ]);
  return provider.acquire(mapLibreSelection(map, ["ortho"]));
}
