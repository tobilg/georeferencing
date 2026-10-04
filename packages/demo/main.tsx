import type { SaveEnvelope } from "@georeferencing/core";
import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import { Georeferencer, useGeoreferencer } from "@georeferencing/react";
import TileLayer from "ol/layer/Tile.js";
import OLMap from "ol/Map.js";
import OSM from "ol/source/OSM.js";
import View from "ol/View.js";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "ol/ol.css";
import "@georeferencing/react/styles.css";
import "./style.css";
import { demoExports } from "./exports.js";

// Initial map framing only; these bounds never georeference the source image.
const hamburgExtent = [
  1110857.1986260768, 7083289.917462825, 1112415.671497183, 7084488.848353962,
];

declare global {
  interface Window {
    demo: { controller: GeoreferencerController; map: OLMap };
  }
}

function App() {
  const mapRef = useRef<OLMap | null>(null);
  const basemapSource = useRef<OSM | null>(null);
  const [map, setMap] = useState<OLMap | null>(null);
  const [saved, setSaved] = useState<SaveEnvelope | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const rejectSave = useRef(false);
  const exampleAbort = useRef<AbortController | null>(null);
  const [controller] = useState(
    () =>
      new GeoreferencerController({
        workingCrs: "EPSG:3857",
        previewMode: "manual",
        digitizing: true,
        engine: createWorkerEngine({
          workerFactory: () => new GeoreferencingWorker(),
        }),
        exports: demoExports(() => mapRef.current ?? undefined),
        onSave: async (snapshot) => {
          if (rejectSave.current)
            throw Error("Demo save failed. Your draft has been retained.");
          localStorage.setItem(
            `georeferencer-demo:${snapshot.documentId}`,
            JSON.stringify(snapshot),
          );
          setSaved(snapshot);
        },
        onSaveDraft: async (snapshot) => {
          if (rejectSave.current)
            throw Error(
              "Demo draft save failed. Your draft has been retained.",
            );
          localStorage.setItem(
            `georeferencer-demo-draft:${snapshot.document.id}`,
            JSON.stringify(snapshot),
          );
        },
      }),
  );
  const state = useGeoreferencer(controller);
  useEffect(() => {
    // OSM supplies the standard tile URL, anonymous CORS and visible attribution.
    const source = new OSM();
    source.on("tileloaderror", () =>
      setMapError(
        "Some OpenStreetMap tiles could not load. Check your connection and retry. You can still enter map coordinates manually.",
      ),
    );
    basemapSource.current = source;
    const map = new OLMap({
      layers: [new TileLayer({ source })],
      view: new View({
        projection: "EPSG:3857",
        center: [1111636, 7083889],
        resolution: 2.1,
      }),
    });
    mapRef.current = map;
    setMap(map);
    Object.assign(window, { demo: { controller, map } });
    return () => {
      exampleAbort.current?.abort();
      map.setTarget(undefined);
      map.dispose();
      source.dispose();
      mapRef.current = null;
      basemapSource.current = null;
    };
  }, [controller]);
  // The ref attaches before child effects bind interactions, including map keyboard controls.
  const target = useCallback(
    (element: HTMLDivElement | null) => {
      map?.setTarget(element ?? undefined);
    },
    [map],
  );
  const loadExample = async () => {
    exampleAbort.current?.abort();
    const abort = new AbortController();
    exampleAbort.current = abort;
    setLoadingExample(true);
    try {
      const response = await fetch("./elbphilharmonie.webp", {
        signal: abort.signal,
      });
      if (!response.ok)
        throw Error(
          "The Hamburg example could not be loaded. Try again or choose a local image.",
        );
      const bytes = await response.blob();
      if (!abort.signal.aborted)
        await controller.loadImage(
          new File([bytes], "elbphilharmonie.webp", { type: "image/webp" }),
        );
    } catch (error) {
      if (!abort.signal.aborted) controller.reportError(error);
    } finally {
      if (!abort.signal.aborted) setLoadingExample(false);
    }
  };
  return (
    <main className="workshop">
      <header className="workshop-header">
        <div>
          <a href="https://github.com/tobilg/georeferencing">georeferencing</a>
          <h1>Match an image to the map</h1>
        </div>
        <button
          type="button"
          disabled={loadingExample || state.loading === "running"}
          onClick={() => void loadExample()}
        >
          {loadingExample
            ? "Loading Hamburg image…"
            : "Try the Hamburg example"}
        </button>
      </header>
      <p className="workshop-intro">
        Choose an image, match a few locations, then run alignment. Your image
        stays in this browser.
      </p>
      {map && (
        <Georeferencer
          controller={controller}
          referenceMap={map}
          referenceView={
            <section
              className="workshop-reference"
              aria-label="Reference workspace"
            >
              <div className="rg-panel-heading">
                <h2>Reference map</h2>
                <button
                  type="button"
                  onClick={() =>
                    map
                      .getView()
                      .fit(hamburgExtent, { padding: [12, 12, 12, 12] })
                  }
                >
                  Show Hamburg area
                </button>
              </div>
              <div className="rg-image-meta">
                OpenStreetMap · Hamburg harbour
              </div>
              <div
                ref={target}
                className="workshop-map"
                role="application"
                aria-label="Reference map"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: OpenLayers attaches keyboard navigation to this focusable map target.
                tabIndex={0}
              />
              <p className="rg-hint">
                Pan and zoom the map to find the matching location. Map tiles
                load from OpenStreetMap and require an internet connection.
              </p>
              {mapError && (
                <div>
                  <p role="alert" className="rg-error">
                    {mapError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMapError(null);
                      basemapSource.current?.refresh();
                    }}
                  >
                    Retry map tiles
                  </button>
                </div>
              )}
              <details>
                <summary>Tips for the Hamburg example</summary>
                <p>
                  Match quay corners and bridge ends visible in both views.
                  Spread at least three pairs across the image, then choose Run
                  alignment. Add more pairs to assess residuals.
                </p>
                <p>
                  Use the map's shoreline, bridge outlines and street names to
                  identify locations. Avoid boats, shadows, and the elevated
                  roof of the Elbphilharmonie when choosing ground points.
                </p>
                <p>
                  Source image:{" "}
                  <a href="https://www.hamburg.de/resource/image/244210/landscape_ratio16x9/1240/697/7318622fc10dd5f77769a58ccfc8be1e/93342C630206278A1DD5B335B97E3977/b-dop.webp">
                    Hamburg LGV / hamburg.de
                  </a>
                  . Map framing supplies no alignment for the source image.
                </p>
              </details>
            </section>
          }
          propertyEditor={(feature, update) => (
            <input
              aria-label={`Feature name ${feature.id}`}
              placeholder="Feature name"
              defaultValue={String(feature.properties.name ?? "")}
              onBlur={(e) =>
                update({ ...feature.properties, name: e.target.value })
              }
            />
          )}
        />
      )}
      <details className="workshop-developer">
        <summary>Developer tools & demo persistence</summary>
        <p>
          Feature and draft saves use this browser’s localStorage. No production
          persistence is configured.
        </p>
        <label>
          <input
            type="checkbox"
            onChange={(e) => {
              rejectSave.current = e.target.checked;
            }}
          />{" "}
          Simulate save failure
        </label>
        <p>
          {saved
            ? `Saved ${saved.features.features.length} features from revision ${saved.documentRevision}.`
            : "No accepted features saved yet."}
        </p>
      </details>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
