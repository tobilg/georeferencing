import { fail, normalizeCrs } from "@georeferencing/core";
import type {
  Query,
  ReferenceBase,
  ReferenceSource,
  WfsReference,
} from "@georeferencing/core/map";
import { loadWfsPages } from "@georeferencing/core/map";
import type Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import WFS from "ol/format/WFS.js";
import type VectorLayer from "ol/layer/Vector.js";
import { get as getProjection } from "ol/proj.js";
import type VectorSource from "ol/source/Vector.js";

/**
 * Use a vector layer already owned by the host. The package neither adds/removes this
 * layer nor loads, clears or disposes its source.
 */
export interface BorrowedReference extends ReferenceBase {
  /** Discriminator for a borrowed host vector layer. */
  kind: "existing-vector";
  /**
   * Host-owned layer whose existing features are read for snapping without duplicating
   * network requests.
   */
  layer: VectorLayer<VectorSource<Feature>>;
}
/**
 * Reference sources accepted by the OpenLayers adapter: the map-independent sources of
 * `@georeferencing/core/map` plus layers already owned by the host map.
 */
export type Reference = ReferenceSource | BorrowedReference;
/** WFS results converted to host map coordinates, with completeness feedback. */
export interface ReferenceResult {
  /** OpenLayers features in the requested map CRS with stable string IDs. */
  features: Feature[];
  /** True if paging, budgets or service counts indicate incomplete results. */
  partial: boolean;
  /** Explanation of incomplete or unavailable results. */
  message?: string;
}

function parseXml(text: string): XMLDocument {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length)
    fail("WFS_FORMAT", "Malformed WFS XML.");
  return xml;
}
/** Parse one WFS response page into OpenLayers features in the map CRS. */
function parsePage(provider: WfsReference, text: string, mapCrs: string) {
  let parsed: Feature[], matched: number | undefined;
  if (provider.responseFormat === "geojson") {
    const data = JSON.parse(text);
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
      fail("WFS_FORMAT", "Expected a WFS GeoJSON FeatureCollection.");
    matched =
      typeof data.numberMatched === "number"
        ? data.numberMatched
        : typeof data.totalFeatures === "number"
          ? data.totalFeatures
          : undefined;
    if (provider.responseAxisOrder === "yx") {
      const swap = (v: unknown): unknown =>
        Array.isArray(v)
          ? typeof v[0] === "number"
            ? [v[1], v[0], ...v.slice(2)]
            : v.map(swap)
          : v;
      for (const f of data.features) {
        if (!f.geometry?.coordinates)
          fail("WFS_FORMAT", "Axis override requires coordinate geometries.");
        f.geometry.coordinates = swap(f.geometry.coordinates);
      }
    }
    const dataProjection = normalizeCrs(
      provider.responseCrs ?? data.crs?.properties?.name ?? provider.requestCrs,
    );
    if (!getProjection(dataProjection))
      fail("CRS", `Register the WFS response projection '${dataProjection}'.`);
    parsed = new GeoJSON().readFeatures(data, {
      dataProjection,
      featureProjection: mapCrs,
    });
  } else {
    const xml = parseXml(text);
    const count = xml.documentElement.getAttribute("numberMatched");
    if (count && count !== "unknown") matched = Number(count);
    const geometryCrs = Array.from(xml.getElementsByTagName("*"))
      .find((n) => n.hasAttribute("srsName"))
      ?.getAttribute("srsName");
    const declaredCrs =
      provider.responseCrs ?? geometryCrs ?? provider.requestCrs;
    const responseCrs = normalizeCrs(declaredCrs);
    const requestedAxis =
      provider.responseAxisOrder ??
      (/CRS:?84$/i.test(declaredCrs) ? "xy" : undefined);
    if (!getProjection(responseCrs))
      fail("CRS", `Register the WFS response projection '${responseCrs}'.`);
    // Normalize EPSG URI aliases so registered local projected CRSs are found.
    for (const n of Array.from(xml.getElementsByTagName("*")))
      if (n.hasAttribute("srsName"))
        n.setAttribute(
          "srsName",
          provider.responseCrs
            ? responseCrs
            : normalizeCrs(n.getAttribute("srsName")!),
        );
    parsed = new WFS({ version: provider.version }).readFeatures(xml, {
      dataProjection: responseCrs,
      featureProjection: responseCrs,
    });
    const nativeAxis = getProjection(responseCrs)!
      .getAxisOrientation()
      .startsWith("ne")
      ? "yx"
      : "xy";
    for (const f of parsed) {
      const geometry = f.getGeometry();
      if (requestedAxis && requestedAxis !== nativeAxis)
        geometry?.applyTransform((input, output, stride = 2) => {
          output ??= input;
          for (let i = 0; i < input.length; i += stride) {
            const x = input[i];
            output[i] = input[i + 1];
            output[i + 1] = x;
            for (let j = 2; j < stride; j++) output[i + j] = input[i + j];
          }
          return output;
        });
      geometry?.transform(responseCrs, mapCrs);
    }
  }
  for (const f of parsed)
    if (!f.getGeometry()?.getExtent().every(Number.isFinite))
      fail(
        "WFS_GEOMETRY",
        "Reference geometry is missing or cannot be projected with the registered CRS definitions.",
      );
  return { items: parsed, matched };
}
/**
 * Load bounded WFS pages as OpenLayers features in the map CRS, reading GeoJSON or GML
 * (WFS 1.1/2.0) responses. Paging, budgets and deduplication follow
 * `loadWfsPages` from `@georeferencing/core/map`.
 *
 * Register all response/map projections first with registerProjections. The binding calls this after queryBounds; direct callers must provide an extent in provider.requestCrs. A partial result is explicit, never silently treated as complete.
 * @param provider - Service and request configuration.
 * @param query - Bounds, map resolution and cancellation signal.
 * @param mapCrs - CRS of returned OpenLayers features.
 */
export async function loadWfs(
  provider: WfsReference,
  query: Query,
  mapCrs: string,
): Promise<ReferenceResult> {
  const { items, partial, message } = await loadWfsPages<Feature>(
    provider,
    query,
    (text) => parsePage(provider, text, mapCrs),
    (f) => f.getId() ?? (provider.idProperty && f.get(provider.idProperty)),
    (f, id) => f.setId(id),
  );
  return { features: items, partial, message };
}
