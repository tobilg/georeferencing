import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import type { MapAdapter } from "@georeferencing/core/map";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import { Georeferencer, useGeoreferencer } from "@georeferencing/react";
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@georeferencing/react/styles.css";
import "./style.css";
import { demoExports } from "./exports.js";
import type { CreateDemoMap, DemoMap, MapLibrary } from "./maps/types.js";

// Initial map framing for the example image; it never georeferences the source image.
const HAMBURG_HARBOUR: [number, number, number, number] = [
  9.979, 53.538, 9.993, 53.5444,
];

/** Map libraries; only the selected one is downloaded. */
const LIBRARIES: Record<
  MapLibrary,
  { label: string; load: () => Promise<{ createDemoMap: CreateDemoMap }> }
> = {
  openlayers: {
    label: "OpenLayers",
    load: () => import("./maps/openlayers.js"),
  },
  maplibre: { label: "MapLibre GL", load: () => import("./maps/maplibre.js") },
  leaflet: { label: "Leaflet", load: () => import("./maps/leaflet.js") },
};
const requested = new URLSearchParams(window.location.search).get("map");
const library: MapLibrary =
  requested && requested in LIBRARIES
    ? (requested as MapLibrary)
    : "openlayers";

declare global {
  interface Window {
    demo: {
      controller: GeoreferencerController;
      /** Native map of the selected library (an OpenLayers map by default). */
      map: unknown;
      library: MapLibrary;
    };
  }
}

function App({ createDemoMap }: { createDemoMap: CreateDemoMap }) {
  const demoMap = useRef<DemoMap | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
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
        exports: demoExports(() => demoMap.current?.capture?.()),
        // Demo persistence: accepted features stay in this browser's localStorage.
        onSave: async (snapshot) => {
          localStorage.setItem(
            `georeferencer-demo:${snapshot.documentId}`,
            JSON.stringify(snapshot),
          );
        },
      }),
  );
  // The map is created by the container's ref callback, which React runs before the
  // editor's effects attach the adapter. This stable adapter forwards to that map.
  const [adapter] = useState<MapAdapter>(
    () => (editor: GeoreferencerController) => {
      if (!demoMap.current) throw Error("The reference map is not ready.");
      return demoMap.current.adapter(editor);
    },
  );
  const state = useGeoreferencer(controller);
  const container = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const created = createDemoMap(element, () =>
        setMapError(
          "Some OpenStreetMap tiles could not load. Check your connection and retry.",
        ),
      );
      demoMap.current = created;
      Object.assign(window, {
        demo: { controller, map: created.map, library },
      });
      return () => {
        exampleAbort.current?.abort();
        if (demoMap.current === created) demoMap.current = null;
        created.dispose();
      };
    },
    [controller, createDemoMap],
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
        <div className="workshop-topline">
          <a href="https://github.com/tobilg/georeferencing">georeferencing</a>
          <nav className="workshop-libraries" aria-label="Map library">
            {(Object.keys(LIBRARIES) as MapLibrary[]).map((key) => (
              <a
                key={key}
                href={`?map=${key}`}
                aria-current={key === library ? "page" : undefined}
              >
                {LIBRARIES[key].label}
              </a>
            ))}
          </nav>
        </div>
        <h1>Match an image to the map</h1>
        <p className="workshop-intro">
          Place a photo, plan or scan on the map in four steps. Your image never
          leaves this browser.
        </p>
      </header>
      {
        <Georeferencer
          controller={controller}
          map={adapter}
          controls={{ transformation: true }}
          emptyImageActions={
            <button
              type="button"
              disabled={loadingExample || state.loading === "running"}
              onClick={() => void loadExample()}
            >
              {loadingExample
                ? "Loading Hamburg image…"
                : "Try the Hamburg example"}
            </button>
          }
          referenceView={
            <section
              className="workshop-reference"
              aria-label="Reference workspace"
            >
              <div className="rg-panel-heading">
                <h2>Reference map</h2>
                <button
                  type="button"
                  onClick={() => demoMap.current?.fitBounds(HAMBURG_HARBOUR)}
                >
                  Show Hamburg area
                </button>
              </div>
              <div className="rg-image-meta">
                {LIBRARIES[library].label} · OpenStreetMap · Hamburg harbour
              </div>
              <div
                ref={container}
                className="workshop-map"
                role="application"
                aria-label="Reference map"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Map libraries attach keyboard navigation to this focusable map target.
                tabIndex={0}
              />
              <p className="rg-hint">Drag to pan, scroll or use +/− to zoom.</p>
              {mapError && (
                <div>
                  <p role="alert" className="rg-error">
                    {mapError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMapError(null);
                      demoMap.current?.retryTiles();
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
                  Spread at least three points across the image, then choose Run
                  alignment. A fourth point lets you measure accuracy.
                </p>
                <p>
                  Use the map's shoreline, bridge outlines and street names to
                  identify locations. Avoid boats, shadows, and the elevated
                  roof of the Elbphilharmonie when choosing ground points.
                </p>
                <p>
                  Source image: ©{" "}
                  <a href="https://www.hamburg.de/politik-und-verwaltung/behoerden/behoerde-fuer-stadtentwicklung-und-wohnen/aemter-und-landesbetrieb/landesbetrieb-geoinformation-und-vermessung">
                    Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation
                    und Vermessung (LGV)
                  </a>
                  ,{" "}
                  <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>
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
      }
    </main>
  );
}
void LIBRARIES[library].load().then(({ createDemoMap }) =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App createDemoMap={createDemoMap} />
    </StrictMode>,
  ),
);
