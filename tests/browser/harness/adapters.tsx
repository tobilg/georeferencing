// Mounts the React editor with a non-OpenLayers map adapter: ?lib=maplibre or ?lib=leaflet.
import type { XY } from "@georeferencing/core";
import { project } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import type { MapAdapter, ReferenceSource } from "@georeferencing/core/map";
import GeoreferencingWorker from "@georeferencing/core/worker?worker";
import { leaflet } from "@georeferencing/leaflet";
import { maplibre } from "@georeferencing/maplibre";
import { Georeferencer, GeoreferencerController } from "@georeferencing/react";
import L from "leaflet";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import gridUrl from "../../fixtures/grid.png?url";
import { fixture } from "../../fixtures/models.js";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "@georeferencing/react/styles.css";

// As documented for Vite hosts: point MapLibre at its bundled worker file.
setWorkerUrl(maplibreWorker);
const lib =
  new URLSearchParams(window.location.search).get("lib") ?? "maplibre";
// The fixture targets are Web Mercator metres near longitude 0.01°, latitude 0.017°.
const CENTER: XY = [0.0103, 0.0167];
/** Static reference: a snappable point and a square near the fixture targets. */
const reference: ReferenceSource = {
  id: "landmarks",
  label: "Landmarks",
  kind: "geojson",
  crs: "EPSG:4326",
  snapping: { vertices: true, edges: true, tolerancePx: 12 },
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "tower",
        properties: {},
        geometry: { type: "Point", coordinates: [0.0098, 0.0172] },
      },
      {
        type: "Feature",
        id: "block",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0.0106, 0.0161],
              [0.0109, 0.0161],
              [0.0109, 0.0164],
              [0.0106, 0.0164],
              [0.0106, 0.0161],
            ],
          ],
        },
      },
    ],
  },
};
interface AdapterHarness {
  lib: string;
  controller: GeoreferencerController;
  fixture: typeof fixture;
  map?: unknown;
  /** Page coordinates of a longitude/latitude, for mouse input. */
  toPage(lonLat: XY): Promise<{ x: number; y: number }>;
  /** Counts of resources the adapter added to the host map. */
  owned(): { layers: number; markers: number };
  /** Screen distance in pixels between each control-point marker and its coordinate. */
  markerErrors(): Promise<number[]>;
  /** Whether the raster preview overlay is displayed. */
  previewShown(): boolean;
  /** Visible draft features (not counting Terra Draw's own layers). */
  draftsShown(): boolean;
  /** Replace the host style (MapLibre) to test layer restoration. */
  replaceStyle(): Promise<void>;
  loadGrid(): Promise<boolean>;
  setMounted(mounted: boolean): void;
}
declare global {
  interface Window {
    adapters: AdapterHarness;
  }
}
const controller = new GeoreferencerController({
  workingCrs: "EPSG:3857",
  digitizing: true,
  engine: createWorkerEngine({
    workerFactory: () => new GeoreferencingWorker(),
  }),
  onSave: async () => {},
  guard: async () => "discard",
});
const background = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: { "background-color": "#f4f1e8" },
    },
  ],
};
const api: AdapterHarness = {
  lib,
  controller,
  fixture,
  async toPage() {
    throw Error("Map not ready");
  },
  owned: () => ({ layers: 0, markers: 0 }),
  async markerErrors() {
    const errors: number[] = [];
    for (const gcp of controller.getSnapshot().document.gcps) {
      const marker = document.querySelector(
        `.georef-gcp-marker[title="Control point ${gcp.label}"]`,
      );
      if (!marker) {
        errors.push(Number.POSITIVE_INFINITY);
        continue;
      }
      const box = marker.getBoundingClientRect();
      const at = await api.toPage(project(gcp.target, gcp.crs, "EPSG:4326"));
      errors.push(
        Math.hypot(
          box.left + box.width / 2 - at.x,
          box.top + box.height / 2 - at.y,
        ),
      );
    }
    return errors;
  },
  previewShown: () => false,
  draftsShown: () => false,
  async replaceStyle() {},
  async loadGrid() {
    const bytes = await (await fetch(gridUrl)).blob();
    return controller.loadImage(
      new File([bytes], "grid.png", { type: "image/png" }),
    );
  },
  setMounted: () => {},
};
window.adapters = api;

function useMapLibre(target: HTMLDivElement | null) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  useEffect(() => {
    if (!target) return;
    const instance = new MapLibreMap({
      container: target,
      style: background,
      center: CENTER,
      zoom: 17,
      attributionControl: false,
    });
    const rect = () => target.getBoundingClientRect();
    Object.assign(api, {
      map: instance,
      async toPage([lon, lat]: XY) {
        const p = instance.project([lon, lat]);
        return { x: rect().left + p.x, y: rect().top + p.y };
      },
      owned: () => ({
        layers: (instance.getStyle()?.layers ?? []).filter((l) =>
          l.id.startsWith("georef-"),
        ).length,
        markers: target.querySelectorAll(".georef-gcp-marker").length,
      }),
      previewShown: () => {
        const layer = instance
          .getStyle()
          ?.layers.find((l) => l.id.endsWith("-preview"));
        return Boolean(
          layer &&
            instance.getLayoutProperty(layer.id, "visibility") !== "none",
        );
      },
      draftsShown: () => {
        const layer = instance
          .getStyle()
          ?.layers.find((l) => l.id.endsWith("-drafts-point"));
        return Boolean(
          layer &&
            instance.getLayoutProperty(layer.id, "visibility") !== "none",
        );
      },
      replaceStyle: () =>
        new Promise<void>((resolve) => {
          instance.once("idle", () => resolve());
          instance.setStyle(
            { ...background, layers: [...background.layers] },
            {
              diff: false,
            },
          );
        }),
    });
    instance.once("load", () => setMap(instance));
    return () => instance.remove();
  }, [target]);
  const adapter = useMemo<MapAdapter | null>(
    () =>
      map
        ? maplibre(map, {
            references: [reference],
            digitizingSnapping: { references: true, drafts: true },
          })
        : null,
    [map],
  );
  return adapter;
}

function useLeaflet(target: HTMLDivElement | null) {
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    if (!target) return;
    const instance = L.map(target, {
      center: [CENTER[1], CENTER[0]],
      zoom: 17,
      attributionControl: false,
    });
    const rect = () => target.getBoundingClientRect();
    Object.assign(api, {
      map: instance,
      async toPage([lon, lat]: XY) {
        const p = instance.latLngToContainerPoint([lat, lon]);
        return { x: rect().left + p.x, y: rect().top + p.y };
      },
      owned: () => {
        let layers = 0;
        // Leaflet's shared default vector renderer belongs to the map, not the adapter.
        instance.eachLayer((layer) => {
          if (!(layer instanceof L.Renderer)) layers++;
        });
        return {
          layers,
          markers: target.querySelectorAll(".georef-gcp-marker").length,
        };
      },
      previewShown: () =>
        Boolean(target.querySelector("img.leaflet-image-layer[src^='blob:']")),
      draftsShown: () =>
        target.querySelectorAll('path[fill="#12695b"]').length > 0,
    });
    setMap(instance);
    return () => {
      instance.remove();
    };
  }, [target]);
  return useMemo<MapAdapter | null>(
    () =>
      map
        ? leaflet(map, {
            lib: L,
            references: [reference],
            digitizingSnapping: { references: true, drafts: true },
          })
        : null,
    [map],
  );
}

function App() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(true);
  const maplibreAdapter = useMapLibre(lib === "maplibre" ? target : null);
  const leafletAdapter = useLeaflet(lib === "leaflet" ? target : null);
  const adapter = lib === "leaflet" ? leafletAdapter : maplibreAdapter;
  const ready = useRef(false);
  useEffect(() => {
    api.setMounted = setMounted;
    ready.current = true;
  }, []);
  return (
    <main>
      <div
        ref={setTarget}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: maps take keyboard focus for Escape/Enter.
        tabIndex={0}
        style={{ width: 800, height: 500 }}
      />
      {adapter && mounted && (
        <Georeferencer controller={controller} map={adapter} />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
