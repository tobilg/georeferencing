import { createWorkerEngine } from "@georeferencing/core/engine";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import {
  ALL_CONTROLS,
  Georeferencer,
  GeoreferencerController,
} from "@georeferencing/react";
import OLMap from "ol/Map.js";
import View from "ol/View.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import gridUrl from "../../fixtures/grid.png?url";
import { fixture } from "../../fixtures/models.js";
import { harnessExports } from "./exports.js";
import "ol/ol.css";
import "@georeferencing/react/styles.css";

// ?controls=all enables every optional control; otherwise the minimal default applies.
const all =
  new URLSearchParams(window.location.search).get("controls") === "all";
const api = { gridUrl, fixture } as {
  gridUrl: string;
  fixture: typeof fixture;
  controller?: GeoreferencerController;
  map?: OLMap;
};
declare global {
  interface Window {
    guided: typeof api;
  }
}
window.guided = api;

function App() {
  const [map] = useState(
    () =>
      new OLMap({
        view: new View({
          projection: "EPSG:3857",
          center: [1115, 1860],
          resolution: 1,
        }),
      }),
  );
  const [controller] = useState(
    () =>
      new GeoreferencerController({
        workingCrs: "EPSG:3857",
        previewMode: "manual",
        digitizing: true,
        engine: createWorkerEngine({
          workerFactory: () => new GeoreferencingWorker(),
        }),
        exports: harnessExports(() => map),
        onSave: async () => {},
        onSaveDraft: async () => {},
      }),
  );
  useEffect(() => {
    Object.assign(api, { controller, map });
    return () => map.setTarget(undefined);
  }, [controller, map]);
  const target = useCallback(
    (element: HTMLDivElement | null) => map.setTarget(element ?? undefined),
    [map],
  );
  return (
    <Georeferencer
      controller={controller}
      referenceMap={map}
      controls={all ? ALL_CONTROLS : undefined}
      referenceView={
        <div
          ref={target}
          role="application"
          aria-label="Reference map"
          style={{ height: 360 }}
        />
      }
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
