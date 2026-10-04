import { MODELS } from "@georeferencing/core/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { registerProjections } from "@georeferencing/core/openlayers";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";
import { Georeferencer, GeoreferencerController } from "@georeferencing/react";
import VectorLayer from "ol/layer/Vector.js";
import OLMap from "ol/Map.js";
import VectorSource from "ol/source/Vector.js";
import View from "ol/View.js";
import { StrictMode, useEffect, useState } from "react";
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
      {map && visible && (
        <Georeferencer referenceMap={map} controller={controller} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
