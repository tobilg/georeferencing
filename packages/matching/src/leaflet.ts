/**
 * Optional browser-only Leaflet reference acquisition for image matching.
 * Supports `L.tileLayer.wms` layers: the provider requests fresh images of exactly
 * the selected area from the layer's WMS server. Other layers need a host provider.
 * Leaflet itself is not imported at runtime, and the root API never loads this entry.
 * @module @georeferencing/matching/leaflet
 * @group @georeferencing/matching
 */
import type { Map as LeafletMap, TileLayer } from "leaflet";
import type { ReferenceProvider, ReferenceSelection } from "./types.js";
import { MatchingError } from "./types.js";
import { acquireWmsLayer, selectedReference } from "./wms-layer.js";
/** Host-owned WMS layer eligible for reference acquisition. */
export interface LeafletReference {
  /** Opaque layer identity selected through `ReferenceSelection.layers`. */
  id: string;
  /** Borrowed `L.tileLayer.wms` layer; it need not be on a map and is never changed. */
  layer: TileLayer.WMS;
  /** Content/style revision; change it when data, filters, time or styling changes. */
  revision: string;
}
/**
 * Create a provider for one `L.tileLayer.wms` layer.
 *
 * Requests use the layer's endpoint and WMS parameters (layers, styles, version,
 * time, filters and vendor parameters) with the selected extent, CRS and
 * resolution, so the reference never depends on the visible tiles. A `{s}`
 * subdomain placeholder resolves to the layer's first subdomain.
 *
 * @param references - Configured eligible layers with opaque IDs and revisions.
 * @param request - Optional authenticated WMS request callback; defaults to fetch.
 * @returns Browser-only pixel provider; matching itself can also run in Node.
 * @throws Acquisition rejects with `SOURCE` when the selection names unknown,
 * several or non-WMS layers, or for transport/decoding failures, and with
 * `BUDGET` when the selection exceeds the WMS provider's pixel limits.
 * @example
 * ```ts
 * const wms = L.tileLayer.wms("https://example.org/wms", { layers: "ortho" });
 * const provider = createLeafletProvider([
 *   { id: "ortho", layer: wms, revision: "2026" },
 * ]);
 * const reference = await provider.acquire(leafletSelection(map, ["ortho"]));
 * ```
 */
export function createLeafletProvider(
  references: LeafletReference[],
  request?: (url: string, signal?: AbortSignal) => Promise<Blob>,
): ReferenceProvider {
  return {
    async acquire(selection, signal) {
      const reference = selectedReference(references, selection),
        // Leaflet keeps the endpoint template in a private field.
        layer = reference.layer as TileLayer.WMS & { _url?: unknown },
        subdomains = layer.options?.subdomains,
        url =
          typeof layer._url === "string"
            ? layer._url.replaceAll(
                "{s}",
                (typeof subdomains === "string"
                  ? subdomains[0]
                  : subdomains?.[0]) ?? "",
              )
            : undefined;
      if (!layer.wmsParams || !url)
        throw new MatchingError(
          "SOURCE",
          "Native Leaflet matching supports L.tileLayer.wms layers. Supply a host pixel provider for other layers.",
        );
      if (/\{[^}]*\}/.test(url))
        throw new MatchingError(
          "SOURCE",
          "The WMS URL contains placeholders other than {s}; supply a host pixel provider.",
        );
      return acquireWmsLayer(
        {
          id: reference.id,
          revision: reference.revision,
          url,
          parameters: { ...layer.wmsParams },
          request,
        },
        selection,
        signal,
      );
    },
  };
}
/**
 * Read the current map view's bounds, CRS and resolution as a search selection.
 *
 * @param map - Host map with a visible, nonzero size and a CRS that has a code.
 * @param layers - Eligible provider IDs selected by the host.
 * @returns View extent in the map CRS's projected XY units and units per CSS
 * pixel; no pixels are captured. Hosts must show/confirm the actual selection.
 * @throws `INPUT` for a CRS without a code, such as `L.CRS.Simple`.
 */
export function leafletSelection(
  map: LeafletMap,
  layers: string[],
): ReferenceSelection {
  const crs = map.options.crs;
  if (!crs?.code)
    throw new MatchingError(
      "INPUT",
      "The map CRS has no code (for example L.CRS.Simple); build the selection explicitly.",
    );
  const bounds = map.getBounds(),
    sw = crs.project(bounds.getSouthWest()),
    ne = crs.project(bounds.getNorthEast());
  return {
    extent: [sw.x, sw.y, ne.x, ne.y],
    crs: crs.code,
    resolution: (ne.x - sw.x) / map.getSize().x,
    layers,
  };
}
