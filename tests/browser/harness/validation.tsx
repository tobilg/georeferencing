import { project, registerDatumGrids } from "@georeferencing/core/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import { describeWfsFeatureType, discoverWfs } from "@georeferencing/core/map";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import type { BindingOptions, Reference } from "@georeferencing/openlayers";
import {
  loadWfs,
  openLayers,
  registerProjections,
  toGeographicFeature,
} from "@georeferencing/openlayers";
import { Georeferencer, GeoreferencerController } from "@georeferencing/react";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import OLMap from "ol/Map.js";
import VectorSource from "ol/source/Vector.js";
import View from "ol/View.js";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import gridUrl from "../../fixtures/grid.png?url";
import { fixture } from "../../fixtures/models.js";
import { harnessExports } from "./exports.js";
import "ol/ol.css";
import "@georeferencing/react/styles.css";

const definitions = {
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
};
registerProjections(definitions);
const engineFactory = (
  datumGrids?: Record<string, ArrayBuffer>,
  extraDefinitions: Record<string, string> = {},
) =>
  createWorkerEngine({
    definitions: { ...definitions, ...extraDefinitions },
    datumGrids,
    workerFactory: () => new GeoreferencingWorker(),
  });
const editors: {
  controller: GeoreferencerController;
  map: OLMap;
  host: VectorLayer<VectorSource<Feature>>;
  setReferences: (references: Reference[]) => void;
  detach: () => void;
  attach: () => void;
  setSaveFailure: (fail: boolean) => void;
}[] = [];
const api = {
  editors,
  gridUrl,
  loadWfs,
  discoverWfs,
  describeWfsFeatureType,
  definitions,
  project,
  registerDatumGrids,
  engineFactory,
  fixture,
  View,
  toGeographicFeature,
};
declare global {
  interface Window {
    validation: typeof api;
  }
}
window.validation = api;
const singleEditor =
  new URLSearchParams(window.location.search).get("editors") === "1";
function Editor({ index }: { index: number }) {
  const failSave = useRef(false);
  const [bindingOptions, setBindingOptions] = useState<BindingOptions>({});
  const [visible, setVisible] = useState(true),
    target = useRef<HTMLDivElement>(null),
    [map, setMap] = useState<OLMap | null>(null);
  const adapter = useMemo(
    () => (map ? openLayers(map, bindingOptions) : null),
    [map, bindingOptions],
  );
  const [controller] = useState(
    () =>
      new GeoreferencerController({
        workingCrs: "EPSG:3857",
        engine: engineFactory(),
        digitizing: true,
        exports: harnessExports(() => editors[index]?.map, definitions),
        guard: singleEditor ? undefined : async () => "discard",
        onSave: async () => {
          if (failSave.current) throw Error("Test host rejected the save.");
        },
      }),
  );
  useEffect(() => {
    const feature = new Feature(new Point([1115, 1860]));
    feature.setId(`unrelated-host-${index}`);
    const host = new VectorLayer({
      source: new VectorSource({ features: [feature] }),
    });
    const current = new OLMap({
      target: target.current!,
      layers: [host],
      view: new View({
        projection: "EPSG:3857",
        center: [1115, 1860],
        resolution: 1,
      }),
    });
    editors[index] = {
      controller,
      map: current,
      host,
      setReferences: (references) => setBindingOptions({ references }),
      detach: () => setVisible(false),
      attach: () => setVisible(true),
      setSaveFailure: (fail) => {
        failSave.current = fail;
      },
    };
    setMap(current);
    return () => {
      current.setTarget(undefined);
      current.dispose();
    };
  }, [controller, index]);
  return (
    <section
      aria-label={`Editor ${index + 1}`}
      style={
        singleEditor
          ? {
              width: "100%",
              display: "grid",
              gridTemplateColumns: "minmax(600px, 1fr) minmax(400px, 1fr)",
              gap: 16,
              alignItems: "start",
            }
          : { width: "48vw", minWidth: 600 }
      }
    >
      <div
        ref={target}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: OpenLayers attaches keyboard map navigation to this focusable target.
        tabIndex={0}
        aria-label={`Map ${index + 1}`}
        style={
          singleEditor
            ? {
                height: 540,
                gridColumn: 2,
                gridRow: 1,
                position: "sticky",
                top: 8,
              }
            : { height: 320 }
        }
      />
      {map && visible && (
        <Georeferencer
          controller={controller}
          map={adapter!}
          definitions={bindingOptions.definitions}
        />
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ display: "flex", gap: 16 }}>
      <Editor index={0} />
      {!singleEditor && <Editor index={1} />}
    </main>
  </StrictMode>,
);
