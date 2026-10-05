import { maplibre } from "@georeferencing/maplibre";
import {
  Georeferencer,
  type GeoreferencerController,
} from "@georeferencing/react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Bundlers do not emit MapLibre's worker on their own; this is the Vite syntax.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "@georeferencing/react/styles.css";
import { type HostMap, useHostMap } from "./use-host-map.js";

setWorkerUrl(workerUrl);

function createMap(container: HTMLDivElement): HostMap<MapLibreMap> {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
    center: [9.986, 53.542],
    zoom: 15,
  });
  return { map, adapter: maplibre(map), dispose: () => map.remove() };
}

export function MapLibreEditor({
  controller,
}: {
  controller: GeoreferencerController;
}) {
  const hostMap = useHostMap(createMap);
  return (
    <Georeferencer
      controller={controller}
      map={hostMap.adapter}
      referenceView={<div ref={hostMap.ref} style={{ height: 480 }} />}
    />
  );
}
