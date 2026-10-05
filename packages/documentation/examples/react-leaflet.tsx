import { leaflet } from "@georeferencing/leaflet";
import {
  Georeferencer,
  type GeoreferencerController,
} from "@georeferencing/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@georeferencing/react/styles.css";
import { type HostMap, useHostMap } from "./use-host-map.js";

function createMap(container: HTMLDivElement): HostMap<L.Map> {
  const map = L.map(container, { center: [53.542, 9.986], zoom: 16 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  return {
    map,
    // The adapter takes the Leaflet module instead of importing it.
    adapter: leaflet(map, { lib: L }),
    dispose: () => map.remove(),
  };
}

export function LeafletEditor({
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
