import { describe, expect, it } from "vitest";
import type { WfsReference } from "../packages/core/src/openlayers/references.js";
import {
  buildWfsUrl,
  loadWfs,
  queryBounds,
} from "../packages/core/src/openlayers/references.js";

const base: WfsReference = {
  id: "wfs",
  label: "WFS fixture",
  kind: "wfs",
  url: "https://example.invalid/wfs",
  version: "2.0.0",
  typeNames: ["test:landmarks"],
  requestCrs: "EPSG:3857",
  responseCrs: "EPSG:3857",
  axisOrder: "xy",
  responseFormat: "geojson",
  pageSize: 2,
};
const feature = (id: string) => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [111319.49079327357, 0] },
  properties: {},
});
const query = () => ({
  extent: [0, 0, 200000, 10] as [number, number, number, number],
  crs: "EPSG:3857",
  resolution: 1,
  signal: new AbortController().signal,
});
describe("AC-07/08/26 references", () => {
  it("intersection is in query CRS; empty requests do not occur; fixed bounds are distinct", () => {
    const provider = {
      ...base,
      queryBounds: {
        extent: [0, 0, 100, 100] as [number, number, number, number],
        crs: "EPSG:3857",
      },
    };
    expect(queryBounds(provider, [50, 50, 200, 200], "EPSG:3857")).toEqual([
      50, 50, 100, 100,
    ]);
    expect(queryBounds(provider, [200, 200, 300, 300], "EPSG:3857")).toBeNull();
    expect(
      queryBounds(
        { ...provider, loading: "fixed" },
        [200, 200, 300, 300],
        "EPSG:3857",
      ),
    ).toEqual([0, 0, 100, 100]);
  });
  it("WFS 1.1 y/x and 2.0 x/y parameters encode names and bboxes", () => {
    const url = new URL(
      buildWfsUrl(
        { ...base, version: "1.1.0", requestCrs: "EPSG:4326", axisOrder: "yx" },
        [10, 40, 11, 41],
      ),
    );
    expect(url.searchParams.get("bbox")).toBe("40,10,41,11,EPSG:4326");
    expect(url.searchParams.get("typeName")).toBe("test:landmarks");
    expect(url.searchParams.has("startIndex")).toBe(false);
    expect(
      new URL(buildWfsUrl(base, query().extent, 2)).searchParams.get(
        "startIndex",
      ),
    ).toBe("2");
  });
  it("pages and deduplicates; authentication request receives signal, projected features convert to degrees", async () => {
    const calls: string[] = [];
    const result = await loadWfs(
      {
        ...base,
        request: async (url, init) => {
          expect(init.signal).toBeDefined();
          calls.push(url);
          const page = calls.length === 1 ? ["a", "b"] : ["b", "c"];
          return new Response(
            JSON.stringify({
              type: "FeatureCollection",
              numberMatched: 4,
              features: page.map(feature),
            }),
          );
        },
      },
      query(),
      "EPSG:4326",
    );
    expect(calls).toHaveLength(2);
    expect(result.features).toHaveLength(3);
    expect(result.partial).toBe(true);
    expect(result.features[0].getGeometry()!.getExtent()[0]).toBeCloseTo(1, 10);
  });
  it("reports HTTP and HTTP-200 service exceptions; missing IDs fail explicitly", async () => {
    for (const response of [
      new Response("no", { status: 403 }),
      new Response("<ows:ExceptionReport>bad filter</ows:ExceptionReport>"),
    ])
      await expect(
        loadWfs(
          { ...base, request: async () => response },
          query(),
          "EPSG:3857",
        ),
      ).rejects.toThrow();
    await expect(
      loadWfs(
        {
          ...base,
          request: async () =>
            new Response(
              JSON.stringify({
                type: "FeatureCollection",
                features: [{ ...feature("x"), id: undefined }],
              }),
            ),
        },
        query(),
        "EPSG:3857",
      ),
    ).rejects.toThrow(/stable IDs/);
  });
  it("GeoJSON text resembling an exception is data; unregistered response CRSs fail", async () => {
    const collection = (extra: object = {}) =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            { ...feature("x"), properties: { note: "<Exception> sign" } },
          ],
          ...extra,
        }),
      );
    const result = await loadWfs(
      { ...base, request: async () => collection() },
      query(),
      "EPSG:3857",
    );
    expect(result.features[0].get("note")).toBe("<Exception> sign");
    await expect(
      loadWfs(
        {
          ...base,
          responseCrs: undefined,
          request: async () =>
            collection({
              crs: { type: "name", properties: { name: "EPSG:31468" } },
            }),
        },
        query(),
        "EPSG:3857",
      ),
    ).rejects.toThrow(/Register the WFS response projection 'EPSG:31468'/);
  });
  it("checks cancellation after a loader ignores abort; repeated pages and WFS1.1 signal partial", async () => {
    const abort = new AbortController();
    await expect(
      loadWfs(
        {
          ...base,
          request: async () => {
            abort.abort();
            return new Response(
              JSON.stringify({ type: "FeatureCollection", features: [] }),
            );
          },
        },
        { ...query(), signal: abort.signal },
        "EPSG:3857",
      ),
    ).rejects.toThrow();
    const request = async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: ["a", "b"].map(feature),
        }),
      );
    expect(
      (await loadWfs({ ...base, request }, query(), "EPSG:3857")).partial,
    ).toBe(true);
    expect(
      (
        await loadWfs(
          { ...base, request, version: "1.1.0" },
          query(),
          "EPSG:3857",
        )
      ).partial,
    ).toBe(true);
  });
});
