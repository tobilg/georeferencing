import type { Map as LeafletMap, TileLayer as LeafletTileLayer } from "leaflet";
import type { Map as MapLibreMap } from "maplibre-gl";
import TileLayer from "ol/layer/Tile.js";
import TileWMS from "ol/source/TileWMS.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLeafletProvider,
  leafletSelection,
} from "../packages/matching/src/leaflet.js";
import {
  createMapLibreProvider,
  mapLibreSelection,
} from "../packages/matching/src/maplibre.js";
import { createOpenLayersProvider } from "../packages/matching/src/openlayers.js";
import type { ReferenceSelection } from "../packages/matching/src/types.js";

const selection: ReferenceSelection = {
  extent: [1000, 2000, 1300, 2100],
  crs: "EPSG:3857",
  resolution: 1,
  layers: ["ortho"],
};
// Each response encodes its requested size; the stubbed browser decoder reads it.
let requests: URL[] = [];
const request = async (url: string) => {
  const u = new URL(url);
  requests.push(u);
  return new Blob([
    `${u.searchParams.get("WIDTH")}x${u.searchParams.get("HEIGHT")}`,
  ]);
};
beforeEach(() => {
  requests = [];
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const [width, height] = (await blob.text()).split("x").map(Number);
    return { width, height, close() {} };
  });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4).fill(255),
          }),
        };
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Upper-cased query keys must be unique: a server may read either duplicate. */
function expectUniqueKeys(url: URL) {
  const keys = [...url.searchParams.keys()].map((k) => k.toUpperCase());
  expect(new Set(keys).size).toBe(keys.length);
}

describe("Leaflet WMS provider", () => {
  // As L.tileLayer.wms stores it after being added to an EPSG:3857 map.
  const layer = {
    _url: "https://{s}.example.org/wms?map=/srv/plan.map&token=secret",
    options: { subdomains: "abc" },
    wmsParams: {
      service: "WMS",
      request: "GetMap",
      layers: "ortho,roads",
      styles: ",",
      format: "image/jpeg",
      transparent: false,
      version: "1.1.1",
      width: 256,
      height: 256,
      srs: "EPSG:3857",
      time: "2026-10-09",
      cql_filter: "status=1",
    },
  } as unknown as LeafletTileLayer.WMS;

  it("requests the selected area with the layer's parameters", async () => {
    const reference = await createLeafletProvider(
      [{ id: "ortho", layer, revision: "r1" }],
      request,
    ).acquire(selection);
    expect(requests).toHaveLength(1);
    const url = requests[0];
    expectUniqueKeys(url);
    expect(url.origin + url.pathname).toBe("https://a.example.org/wms");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      map: "/srv/plan.map",
      token: "secret",
      SERVICE: "WMS",
      REQUEST: "GetMap",
      VERSION: "1.1.1",
      LAYERS: "ortho,roads",
      STYLES: ",",
      FORMAT: "image/png",
      TRANSPARENT: "TRUE",
      WIDTH: "300",
      HEIGHT: "100",
      BBOX: "1000,2000,1300,2100",
      SRS: "EPSG:3857",
      TIME: "2026-10-09",
      CQL_FILTER: "status=1",
    });
    expect(reference.width).toBe(300);
    expect(reference.height).toBe(100);
    expect(reference.extent).toEqual(selection.extent);
    // Credentials stay on the request URL and out of the snapshot; the provider records the version.
    expect(reference.source).toEqual({
      id: "ortho",
      revision: "r1",
      layers: ["ortho", "roads"],
      styles: ["", ""],
      parameters: {
        TIME: "2026-10-09",
        CQL_FILTER: "status=1",
        VERSION: "1.1.1",
      },
    });
  });

  it("rejects unknown, several and non-WMS layers", async () => {
    const tiles = {
      _url: "https://tile.example.org/{z}/{x}/{y}.png",
      options: {},
    } as unknown as LeafletTileLayer.WMS;
    const provider = createLeafletProvider(
      [
        { id: "ortho", layer, revision: "r1" },
        { id: "tiles", layer: tiles, revision: "r1" },
      ],
      request,
    );
    for (const layers of [["missing"], ["ortho", "tiles"], ["tiles"]])
      await expect(
        provider.acquire({ ...selection, layers }),
      ).rejects.toMatchObject({ code: "SOURCE" });
    expect(requests).toHaveLength(0);
  });

  it("reads the view in the map's projected CRS", () => {
    const R = 6378137,
      project = ({ lat, lng }: { lat: number; lng: number }) => ({
        x: (R * lng * Math.PI) / 180,
        y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
      }),
      map = (code?: string) =>
        ({
          options: { crs: { code, project } },
          getBounds: () => ({
            getSouthWest: () => ({ lat: 53.5, lng: 9.9 }),
            getNorthEast: () => ({ lat: 53.6, lng: 10.1 }),
          }),
          getSize: () => ({ x: 800, y: 600 }),
        }) as unknown as LeafletMap;
    const s = leafletSelection(map("EPSG:3857"), ["ortho"]),
      sw = project({ lat: 53.5, lng: 9.9 }),
      ne = project({ lat: 53.6, lng: 10.1 });
    expect(s).toEqual({
      extent: [sw.x, sw.y, ne.x, ne.y],
      crs: "EPSG:3857",
      resolution: (ne.x - sw.x) / 800,
      layers: ["ortho"],
    });
    expect(() => leafletSelection(map(), ["ortho"])).toThrow(
      expect.objectContaining({ code: "INPUT" }),
    );
  });
});

describe("MapLibre WMS provider", () => {
  const template =
    "https://example.org/wms?service=WMS&request=GetMap&version=1.3.0&layers=ortho&styles=&format=image/jpeg&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&time=2026-10-09&api_key=secret";
  const map = (source: object) =>
    ({
      getLayer: (id: string) =>
        id === "ortho-layer" ? { source: "ortho" } : undefined,
      getStyle: () => ({ sources: { ortho: source } }),
    }) as unknown as MapLibreMap;

  it("turns the source's tile template into exact-area requests", async () => {
    const reference = await createMapLibreProvider(
      [
        {
          id: "ortho",
          map: map({ type: "raster", tiles: [template] }),
          layer: "ortho-layer",
          revision: "r1",
        },
      ],
      request,
    ).acquire(selection);
    const url = requests[0];
    expectUniqueKeys(url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: "secret",
      SERVICE: "WMS",
      REQUEST: "GetMap",
      VERSION: "1.3.0",
      LAYERS: "ortho",
      STYLES: "",
      FORMAT: "image/png",
      TRANSPARENT: "TRUE",
      WIDTH: "300",
      HEIGHT: "100",
      BBOX: "1000,2000,1300,2100",
      CRS: "EPSG:3857",
      TIME: "2026-10-09",
    });
    expect(reference.source.parameters).toEqual({
      TIME: "2026-10-09",
      VERSION: "1.3.0",
    });
  });

  it("rejects layers without a WMS tile template", async () => {
    for (const source of [
      { type: "raster", url: "https://example.org/tiles.json" },
      { type: "raster", tiles: ["https://example.org/{z}/{x}/{y}.png"] },
      { type: "vector", tiles: [template] },
    ])
      await expect(
        createMapLibreProvider(
          [
            {
              id: "ortho",
              map: map(source),
              layer: "ortho-layer",
              revision: "r1",
            },
          ],
          request,
        ).acquire(selection),
      ).rejects.toMatchObject({ code: "SOURCE" });
    expect(requests).toHaveLength(0);
  });

  it("reads an unpitched view as Web Mercator metres", () => {
    const view = (pitch: number) =>
      ({
        getPitch: () => pitch,
        getZoom: () => 10,
        getBounds: () => ({
          getWest: () => 0,
          getSouth: () => 0,
          getEast: () => 1,
          getNorth: () => 1,
        }),
      }) as unknown as MapLibreMap;
    const s = mapLibreSelection(view(0), ["ortho"]);
    expect(s.crs).toBe("EPSG:3857");
    expect(s.extent[0]).toBe(0);
    expect(s.extent[2]).toBeCloseTo(111319.49, 2);
    expect(s.extent[3]).toBeCloseTo(111325.14, 2);
    // 512 CSS pixels span the world at zoom 0.
    expect(s.resolution).toBeCloseTo(76.437, 3);
    expect(() => mapLibreSelection(view(30), ["ortho"])).toThrow(
      expect.objectContaining({ code: "INPUT" }),
    );
  });
});

it("keeps OpenLayers WMS requests unchanged through the shared WMS path", async () => {
  const layer = new TileLayer({
    source: new TileWMS({
      url: "https://example.org/wms",
      params: { LAYERS: "ortho", STYLES: "plan", TIME: "2026-10-09" },
    }),
  });
  const reference = await createOpenLayersProvider(
    [{ id: "ortho", layer, revision: "r1" }],
    request,
  ).acquire(selection);
  expectUniqueKeys(requests[0]);
  expect(requests[0].searchParams.get("LAYERS")).toBe("ortho");
  expect(requests[0].searchParams.get("STYLES")).toBe("plan");
  expect(requests[0].searchParams.get("CRS")).toBe("EPSG:3857");
  expect(reference.source).toEqual({
    id: "ortho",
    revision: "r1",
    layers: ["ortho"],
    styles: ["plan"],
    parameters: { TIME: "2026-10-09", VERSION: "1.3.0" },
  });
});
