import type OLMap from "ol/Map.js";
import { describe, expect, it, vi } from "vitest";
import { GeoreferencerController } from "../packages/core/src/core/controller.js";
import type { Document } from "../packages/core/src/core/types.js";
import { createDocument } from "../packages/core/src/core/types.js";
import type { Engine } from "../packages/core/src/engine/index.js";
import { attachReferenceMap } from "../packages/core/src/openlayers/index.js";

/** Minimal OpenLayers map double: owned layers, interactions and view events. */
function fakeMap(code = "EPSG:3857") {
  const layers = new Set<unknown>(),
    interactions = new Set<unknown>(),
    listeners = new Map<string, Set<() => void>>();
  const view = {
    center: [0, 0],
    resolution: 10,
    getProjection: () => ({ getCode: () => code }),
    getCenter: () => view.center,
    getResolution: () => view.resolution,
    getRotation: () => 0,
    setCenter: (c: number[]) => {
      view.center = c;
    },
    setResolution: (r: number) => {
      view.resolution = r;
    },
    setRotation: () => {},
    calculateExtent: () => [-1000, -1000, 1000, 1000],
    fit: vi.fn(),
  };
  const map = {
    layers,
    interactions,
    view,
    emit: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    addLayer: (l: unknown) => layers.add(l),
    removeLayer: (l: unknown) => layers.delete(l),
    addInteraction: (i: unknown) => interactions.add(i),
    removeInteraction: (i: unknown) => interactions.delete(i),
    getView: () => view,
    getSize: () => [100, 100],
    getTargetElement: () => null,
    getPixelFromCoordinate: (c: number[]) => c,
    on: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      return {
        type,
        listener,
        target: {
          removeEventListener: () => listeners.get(type)!.delete(listener),
        },
      };
    },
    listenerCount: () =>
      [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
  return map;
}
const engine: Engine = {
  run: async () => {
    throw Error("unused");
  },
  dispose() {},
};
function documentWith(crs: string): Document {
  const d = createDocument("EPSG:3857");
  d.sourceImage = {
    id: "image",
    name: "a.png",
    sizeBytes: 10,
    width: 10,
    height: 10,
    fingerprint: "a".repeat(64),
    format: "png",
    orientation: 1,
    originalWidth: 10,
    originalHeight: 10,
    pixelConvention: "normalized-top-left-corner-y-down",
    georeferenced: false,
  };
  d.gcps = [
    {
      id: "g1",
      label: 1,
      enabled: true,
      image: [1, 1],
      target: [500000, 5000000],
      crs,
    },
  ];
  return d;
}
const controllerFor = (d: Document) =>
  new GeoreferencerController({
    workingCrs: "EPSG:3857",
    initialDocument: d,
    engine,
  });
const gcpLayerSize = (binding: ReturnType<typeof attachReferenceMap>) =>
  binding.layers.gcps.getSource()!.getFeatures().length;

describe("OpenLayers binding", () => {
  it("reports an unprojectable control point once instead of recursing", () => {
    const controller = controllerFor(documentWith("EPSG:25832")),
      errors = vi.fn();
    controller.subscribe(() => {
      if (controller.getSnapshot().error) errors();
    });
    const map = fakeMap();
    const binding = attachReferenceMap(map as unknown as OLMap, controller);
    expect(controller.getSnapshot().errorDetail?.code).toBe("CRS");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(gcpLayerSize(binding)).toBe(0);
    // An unrelated edit clears the error; the persisting failure is shown again.
    controller.setOutput({
      ...controller.getSnapshot().document.output,
      resampler: "nearest",
    });
    expect(controller.getSnapshot().errorDetail?.code).toBe("CRS");
    binding.detach();
  });
  it("reports an unknown map projection without throwing", () => {
    const controller = controllerFor(documentWith("EPSG:3857"));
    const map = fakeMap("EPSG:99999");
    const binding = attachReferenceMap(map as unknown as OLMap, controller);
    expect(controller.getSnapshot().errorDetail?.code).toBe("CRS");
    binding.detach();
    expect(map.layers.size).toBe(0);
  });
  it("draws markers and releases every owned resource on detach", () => {
    const controller = controllerFor(documentWith("EPSG:3857"));
    const map = fakeMap();
    const listenersBefore = map.listenerCount();
    const binding = attachReferenceMap(map as unknown as OLMap, controller);
    expect(controller.getSnapshot().error).toBeNull();
    expect(gcpLayerSize(binding)).toBe(1);
    expect(map.layers.size).toBe(4);
    binding.detach();
    binding.detach();
    expect(map.layers.size).toBe(0);
    expect(map.interactions.size).toBe(0);
    expect(map.listenerCount()).toBe(listenersBefore);
  });
  it("navigates recorded map views and skips duplicate entries", () => {
    const controller = controllerFor(documentWith("EPSG:3857"));
    const map = fakeMap();
    const binding = attachReferenceMap(map as unknown as OLMap, controller);
    map.view.center = [10, 10];
    map.emit("moveend");
    map.emit("moveend");
    map.view.center = [20, 20];
    map.emit("moveend");
    binding.navigateHistory(-1);
    expect(map.view.center).toEqual([10, 10]);
    map.emit("moveend");
    binding.navigateHistory(-1);
    expect(map.view.center).toEqual([0, 0]);
    binding.navigateHistory(1);
    expect(map.view.center).toEqual([10, 10]);
    binding.detach();
  });
});
