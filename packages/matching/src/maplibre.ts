/**
 * Optional browser-only MapLibre reference acquisition for image matching.
 * Supports raster layers whose source tiles are WMS GetMap URLs with a
 * `{bbox-epsg-3857}` placeholder: the provider requests fresh images of exactly
 * the selected area from that server. Other layers need a host provider.
 * MapLibre itself is not imported at runtime, and the root API never loads this entry.
 * @module @georeferencing/matching/maplibre
 * @group @georeferencing/matching
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ReferenceProvider, ReferenceSelection } from "./types.js";
import { MatchingError } from "./types.js";
import { acquireWmsLayer, selectedReference } from "./wms-layer.js";
/** Host-owned WMS raster layer eligible for reference acquisition. */
export interface MapLibreReference {
  /** Opaque layer identity selected through `ReferenceSelection.layers`. */
  id: string;
  /** Borrowed map whose loaded style contains the layer; never changed. */
  map: MapLibreMap;
  /** Style layer ID of a raster layer backed by a WMS tile source. */
  layer: string;
  /** Content/style revision; change it when data, filters, time or styling changes. */
  revision: string;
}
/**
 * Create a provider for one WMS-backed MapLibre raster layer.
 *
 * Requests use the endpoint and WMS parameters of the source's tile URL
 * (layers, styles, version, time, filters and vendor parameters) with the
 * selected extent, CRS and resolution, so the reference never depends on the
 * rendered tiles. The layer may be hidden; its style must be loaded.
 *
 * @param references - Configured eligible layers with opaque IDs and revisions.
 * @param request - Optional authenticated WMS request callback; defaults to fetch.
 * @returns Browser-only pixel provider; matching itself can also run in Node.
 * @throws Acquisition rejects with `SOURCE` when the selection names unknown,
 * several or non-WMS layers, or for transport/decoding failures, and with
 * `BUDGET` when the selection exceeds the WMS provider's pixel limits.
 * @example
 * ```ts
 * map.addSource("ortho", {
 *   type: "raster",
 *   tileSize: 256,
 *   tiles: [
 *     "https://example.org/wms?service=WMS&request=GetMap&version=1.3.0" +
 *       "&layers=ortho&styles=&format=image/png&crs=EPSG:3857" +
 *       "&width=256&height=256&bbox={bbox-epsg-3857}",
 *   ],
 * });
 * map.addLayer({ id: "ortho", type: "raster", source: "ortho" });
 * const provider = createMapLibreProvider([
 *   { id: "ortho", map, layer: "ortho", revision: "2026" },
 * ]);
 * const reference = await provider.acquire(mapLibreSelection(map, ["ortho"]));
 * ```
 */
export function createMapLibreProvider(
  references: MapLibreReference[],
  request?: (url: string, signal?: AbortSignal) => Promise<Blob>,
): ReferenceProvider {
  return {
    async acquire(selection, signal) {
      const reference = selectedReference(references, selection),
        sourceId = reference.map.getLayer(reference.layer)?.source,
        source = sourceId
          ? reference.map.getStyle()?.sources[sourceId]
          : undefined,
        template =
          source?.type === "raster"
            ? source.tiles?.find((t) => t.includes("{bbox-epsg-3857}"))
            : undefined;
      if (!template)
        throw new MatchingError(
          "SOURCE",
          "Native MapLibre matching supports loaded raster layers whose source tiles are WMS URLs with {bbox-epsg-3857}. Supply a host pixel provider for other layers.",
        );
      const url = template.replace("{bbox-epsg-3857}", "");
      if (/\{[^}]*\}/.test(url))
        throw new MatchingError(
          "SOURCE",
          "The WMS tile URL contains placeholders other than {bbox-epsg-3857}; supply a host pixel provider.",
        );
      return acquireWmsLayer(
        {
          id: reference.id,
          revision: reference.revision,
          url,
          parameters: {},
          request,
        },
        selection,
        signal,
      );
    },
  };
}
const EARTH_RADIUS = 6378137;
/**
 * Read the current map view as an EPSG:3857 search selection.
 *
 * @param map - Host map with a visible, nonzero size and zero pitch.
 * @param layers - Eligible provider IDs selected by the host.
 * @returns View extent in Web Mercator metres and metres per CSS pixel. A rotated
 * view yields its axis-aligned bounding box; no pixels are captured. Hosts must
 * show/confirm the actual selection and retain it for the matching job.
 * @throws `INPUT` when the map is pitched, since a tilted view has no single
 * resolution.
 */
export function mapLibreSelection(
  map: MapLibreMap,
  layers: string[],
): ReferenceSelection {
  if (map.getPitch() !== 0)
    throw new MatchingError(
      "INPUT",
      "Reset the map pitch to 0 before selecting a search area.",
    );
  const bounds = map.getBounds(),
    x = (lng: number) => (EARTH_RADIUS * lng * Math.PI) / 180,
    y = (lat: number) =>
      EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return {
    extent: [
      x(bounds.getWest()),
      y(bounds.getSouth()),
      x(bounds.getEast()),
      y(bounds.getNorth()),
    ],
    crs: "EPSG:3857",
    // MapLibre's world is 512 CSS pixels wide at zoom 0.
    resolution: (2 * Math.PI * EARTH_RADIUS) / (512 * 2 ** map.getZoom()),
    layers,
  };
}
