import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import type {
  Detector,
  MatchRequest,
  MatchResult,
  ReferenceProvider,
  ReferenceSelection,
} from "@georeferencing/matching";
import { createSnapshot, createWmsProvider } from "@georeferencing/matching";
import {
  createBrowserMatcher,
  decodeReferenceImage,
} from "@georeferencing/matching/browser";
import {
  createLeafletProvider,
  leafletSelection,
} from "@georeferencing/matching/leaflet";
import {
  createMapLibreProvider,
  mapLibreSelection,
} from "@georeferencing/matching/maplibre";
import L from "leaflet";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { cropPixels, syntheticPlan } from "../../fixtures/matching.js";

const matcher = createBrowserMatcher(),
  image = syntheticPlan();
const request: MatchRequest = {
  query: cropPixels(image, 130, 160, 250, 260),
  reference: createSnapshot({
    id: "browser-synthetic",
    width: 640,
    height: 640,
    extent: [0, 0, 640, 640],
    crs: "EPSG:3857",
    source: { id: "plan", revision: "1", layers: ["plan"] },
    tiles: [{ ...image, x: 0, y: 0 }],
  }),
};
async function synthetic(detector?: Detector) {
  const stages: string[] = [];
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    const result = await matcher.match(
      detector ? { ...request, options: { detector } } : request,
      { onProgress: (p) => stages.push(p.stage) },
    );
    return { result, stages, ticks };
  } finally {
    clearInterval(timer);
  }
}
async function oriented() {
  const canvas = document.createElement("canvas");
  canvas.width = request.query.width;
  canvas.height = request.query.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(request.query.data),
        canvas.width,
        canvas.height,
      ),
      0,
      0,
    );
  const jpeg = new Uint8Array(
    await (
      await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.98),
      )
    ).arrayBuffer(),
  );
  // JPEG APP1: little-endian TIFF with one orientation tag, clockwise quarter-turn.
  const exif = new Uint8Array(36),
    view = new DataView(exif.buffer);
  exif.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0]);
  view.setUint16(10, 0x4949);
  view.setUint16(12, 42, true);
  view.setUint32(14, 8, true);
  view.setUint16(18, 1, true);
  view.setUint16(20, 274, true);
  view.setUint16(22, 3, true);
  view.setUint32(24, 1, true);
  view.setUint16(28, 6, true);
  // WebKit's encoder already emits EXIF; replace it instead of creating conflicting APP1 records.
  const parts = [jpeg.slice(0, 2), exif];
  let offset = 2;
  while (jpeg[offset] === 255 && jpeg[offset + 1] !== 218) {
    const end = offset + 2 + (jpeg[offset + 2] << 8) + jpeg[offset + 3];
    if (jpeg[offset + 1] !== 225) parts.push(jpeg.slice(offset, end));
    offset = end;
  }
  parts.push(jpeg.slice(offset));
  const controller = new GeoreferencerController({
    workingCrs: "EPSG:3857",
    previewMode: "manual",
    engine: createWorkerEngine(),
  });
  try {
    await controller.loadImage(
      new File(parts, "oriented-plan.jpg", {
        type: "image/jpeg",
      }),
    );
    const query = await decodeReferenceImage(
      await controller.getNormalizedImage(),
    );
    return {
      dimensions: [query.width, query.height],
      result: await matcher.match({ ...request, query }),
    };
  } finally {
    controller.dispose();
  }
}
async function cancellation(
  stage: "initializing" | "extracting" = "extracting",
) {
  const abort = new AbortController();
  try {
    await matcher.match(request, {
      signal: abort.signal,
      onProgress: (p) => {
        if (p.stage === stage) abort.abort();
      },
    });
    return false;
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError";
  }
}
async function real(url: string) {
  const tests = (await (await fetch(url)).json()) as {
    name: string;
    query: { width: number; height: number; data: number[] };
    reference: MatchRequest["reference"] & { tiles: { data: number[] }[] };
    expected: number[] | null;
    overlap?: number;
    mayMiss?: Detector[];
  }[];
  const rows = [];
  for (const detector of ["sift", "akaze"] as const)
    for (const test of tests) {
      const result = await matcher.match({
        query: { ...test.query, data: new Uint8Array(test.query.data) },
        reference: {
          ...test.reference,
          tiles: test.reference.tiles.map((t) => ({
            ...t,
            data: new Uint8Array(t.data),
          })),
        },
        options: { detector },
      });
      rows.push({
        name: test.name,
        detector,
        expected: test.expected,
        expectedOverlap: test.overlap,
        mayMiss: test.mayMiss ?? [],
        query: [test.query.width, test.query.height],
        result,
      });
    }
  return rows;
}
function referencePng() {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      ),
      0,
      0,
    );
  return canvas.toDataURL("image/png").split(",")[1];
}
async function wms() {
  const provider = createWmsProvider({
    url: new URL("/matching-wms", location.href).href,
    source: {
      id: "wms",
      revision: "v1",
      layers: ["ivl"],
      styles: ["engineering"],
    },
    parameters: { TIME: "2026-10-08", CQL_FILTER: "status=1" },
    decode: decodeReferenceImage,
  });
  const start = performance.now(),
    reference = await provider.acquire({
      extent: [0, 0, 640, 640],
      resolution: 1,
      crs: "EPSG:3857",
      layers: ["ivl"],
    }),
    acquisitionMs = performance.now() - start;
  return {
    reference: {
      extent: reference.extent,
      source: reference.source,
      pixelToMap: reference.pixelToMap,
    },
    acquisitionMs,
    result: await matcher.match({ ...request, reference }),
  };
}
/**
 * Acquire through a real Leaflet WMS layer or MapLibre WMS raster source on a live
 * map, so the providers are exercised against each library's actual layer state.
 */
async function adapterWms(adapter: "leaflet" | "maplibre") {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "640px", height: "480px" });
  document.body.append(container);
  const endpoint = new URL("/matching-wms", location.href).href,
    selection = {
      extent: [0, 0, 640, 640] as [number, number, number, number],
      resolution: 1,
      crs: "EPSG:3857",
      layers: ["ivl"],
    };
  let remove = () => {};
  try {
    let provider: ReferenceProvider, view: ReferenceSelection;
    if (adapter === "leaflet") {
      const map = L.map(container).setView([53.55, 10], 12),
        layer = L.tileLayer
          .wms(`${endpoint}?map=plan`, {
            layers: "ivl",
            styles: "engineering",
            time: "2026-10-08",
            cql_filter: "status=1",
            // Leaflet forwards extra options as WMS parameters; its types omit them.
          } as L.WMSOptions)
          .addTo(map);
      remove = () => map.remove();
      provider = createLeafletProvider([{ id: "ivl", layer, revision: "v1" }]);
      view = leafletSelection(map, ["ivl"]);
    } else {
      setWorkerUrl(maplibreWorker);
      const map = new MapLibreMap({
        container,
        center: [10, 53.55],
        zoom: 12,
        style: {
          version: 8,
          sources: {
            ivl: {
              type: "raster",
              tileSize: 256,
              tiles: [
                `${endpoint}?service=WMS&request=GetMap&version=1.3.0&layers=ivl&styles=engineering&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&time=2026-10-08`,
              ],
            },
          },
          layers: [{ id: "ivl-layer", type: "raster", source: "ivl" }],
        },
      });
      remove = () => map.remove();
      // The provider reads only the style; "load" would also wait for tiles and WebGL.
      if (!map.isStyleLoaded())
        await new Promise((resolve) => map.once("style.load", resolve));
      provider = createMapLibreProvider([
        { id: "ivl", map, layer: "ivl-layer", revision: "v1" },
      ]);
      view = mapLibreSelection(map, ["ivl"]);
    }
    const reference = await provider.acquire(selection);
    return {
      view,
      reference: { extent: reference.extent, source: reference.source },
      result: await matcher.match({ ...request, reference }),
    };
  } finally {
    remove();
    container.remove();
  }
}
declare global {
  interface Window {
    matching: {
      oriented: typeof oriented;
      referencePng: typeof referencePng;
      wms: typeof wms;
      adapterWms: typeof adapterWms;
      synthetic: typeof synthetic;
      cancellation: typeof cancellation;
      real: typeof real;
      dispose: () => void;
      result?: MatchResult;
    };
  }
}
window.matching = {
  oriented,
  referencePng,
  wms,
  adapterWms,
  synthetic,
  cancellation,
  real,
  dispose: () => matcher.dispose(),
};
