import { openLayers } from "@georeferencing/openlayers";
import {
  Georeferencer,
  type GeoreferencerController,
} from "@georeferencing/react";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import TileLayer from "ol/layer/Tile.js";
import OLMap from "ol/Map.js";
import { fromLonLat } from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import View from "ol/View.js";
import "ol/ol.css";
import "@georeferencing/react/styles.css";
import { type HostMap, useHostMap } from "./use-host-map.js";

function createMap(container: HTMLDivElement): HostMap<OLMap> {
  const map = new OLMap({
    target: container,
    // With a focusable target, OpenLayers otherwise pans and zooms only after focus.
    interactions: defaultInteractions({ onFocusOnly: false }),
    layers: [new TileLayer({ source: new OSM() })],
    view: new View({ center: fromLonLat([9.986, 53.542]), zoom: 16 }),
  });
  return {
    map,
    adapter: openLayers(map),
    dispose() {
      map.setTarget(undefined);
      map.dispose();
    },
  };
}

export function OpenLayersEditor({
  controller,
}: {
  controller: GeoreferencerController;
}) {
  const hostMap = useHostMap(createMap);
  return (
    <Georeferencer
      controller={controller}
      map={hostMap.adapter}
      referenceView={
        <div
          ref={hostMap.ref}
          style={{ height: 480 }}
          role="application"
          aria-label="Reference map"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: OpenLayers adds keyboard navigation to the map target.
          tabIndex={0}
        />
      }
    />
  );
}
