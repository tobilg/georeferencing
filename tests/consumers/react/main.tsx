import { MODELS } from "@georeferencing/core/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { openLayers, registerProjections } from "@georeferencing/openlayers";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";
import { Georeferencer, GeoreferencerController } from "@georeferencing/react";
import VectorLayer from "ol/layer/Vector.js";
import OLMap from "ol/Map.js";
import VectorSource from "ol/source/Vector.js";
import View from "ol/View.js";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@georeferencing/react/styles.css";
import "ol/ol.css";

registerProjections({});
const engine = createWorkerEngine();
const controller = new GeoreferencerController({
  workingCrs: "EPSG:3857",
  engine,
  digitizing: true,
  exports: [geoTiff(), jpeg(), pdf()],
  onSave: async (s) => {
    Object.assign(window, { receipt: s });
  },
});
function App() {
  const [map, setMap] = useState<OLMap | null>(null),
    [visible, setVisible] = useState(true);
  const adapter = useMemo(() => (map ? openLayers(map) : null), [map]);
  useEffect(() => {
    const hostLayer = new VectorLayer({ source: new VectorSource() });
    const map = new OLMap({
      target: "map",
      layers: [hostLayer],
      view: new View({
        projection: "EPSG:3857",
        center: [1100, 1850],
        resolution: 1,
      }),
    });
    setMap(map);
    Object.assign(window, {
      consumer: { map, controller, engine, setVisible, models: MODELS },
    });
    return () => {
      map.dispose();
    };
  }, []);
  return (
    <>
      <div id="map" style={{ height: 400 }} />
      {adapter && visible && (
        <Georeferencer map={adapter} controller={controller} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// This function is called only after the manual/export consumer gates, proving lazy assets.
Object.assign(window, {
  consumerMatching: async () => {
    const { createBrowserMatcher } = await import(
      "@georeferencing/matching/browser"
    );
    const { createSnapshot } = await import("@georeferencing/matching");
    const { syntheticPlan, cropPixels } = await import("./matching-fixture.js");
    const image = syntheticPlan(),
      matcher = createBrowserMatcher();
    try {
      return await matcher.match({
        query: cropPixels(image, 130, 160, 250, 260),
        reference: createSnapshot({
          id: "packed",
          width: 640,
          height: 640,
          extent: [0, 0, 640, 640],
          crs: "EPSG:3857",
          source: { id: "plan", revision: "1", layers: ["plan"] },
          tiles: [{ ...image, x: 0, y: 0 }],
        }),
      });
    } finally {
      matcher.dispose();
    }
  },
});
