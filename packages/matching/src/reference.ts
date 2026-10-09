import { validateSearchExtent } from "./geometry.js";
import { contentDigest } from "./pixels.js";
import type {
  Extent,
  Matrix3,
  PixelImage,
  ReferenceProvider,
  ReferenceSelection,
  ReferenceSnapshot,
  ReferenceSource,
  ReferenceTile,
} from "./types.js";
import { MatchingError } from "./types.js";
/**
 * Copy reference pixels and freeze their coordinate/source metadata for one job.
 *
 * With no `pixelToMap`, a north-up raster maps `(0, 0)` to `(minX, maxY)` and
 * `(width, height)` to `(maxX, minY)` in the explicit CRS. Supply the exact matrix
 * when the raster has another orientation. Tiles must partition this common
 * raster without gaps or overlap; alpha-zero pixels/`valid: false` mark missing
 * source data without changing the geographic search bounds.
 *
 * @param input - Raster dimensions, selected extent/CRS, provenance and RGBA tiles.
 * @returns A fresh snapshot with copied byte views and frozen metadata. Typed-array
 * bytes cannot be frozen: treat returned buffers as immutable. Full raster/matrix
 * and resource-budget validation occurs when submitting a matching request.
 * @throws {@link MatchingError} for unsupported geographic extents or URL-like
 * source IDs. Known credential parameter names are stripped, but callers remain
 * responsible for keeping all provenance free of secrets.
 */
export function createSnapshot(
  input: Omit<ReferenceSnapshot, "pixelToMap" | "digest"> & {
    pixelToMap?: Matrix3;
  },
): ReferenceSnapshot {
  return freezeSnapshot(input, true);
}
/** Snapshot construction; `copy` is false only for buffers a provider just decoded and owns. */
function freezeSnapshot(
  input: Omit<ReferenceSnapshot, "pixelToMap" | "digest"> & {
    pixelToMap?: Matrix3;
  },
  copy: boolean,
): ReferenceSnapshot {
  validateSearchExtent(input.extent, input.crs);
  const [xmin, ymin, xmax, ymax] = input.extent;
  if (/[:][/]\/|[?&]/.test(input.source.id))
    throw new MatchingError(
      "INPUT",
      "Use an opaque source ID, never a credential-bearing URL.",
    );
  const safeParameters = Object.fromEntries(
    Object.entries(input.source.parameters ?? {}).filter(
      ([key]) =>
        !/token|auth|passw|secret|credential|cookie|session|signature|api.?key|access.?key|^(key|sig|sas|jwt)$/i.test(
          key,
        ),
    ),
  );

  const snapshot: ReferenceSnapshot = {
    ...input,
    extent: [...input.extent],
    pixelToMap: input.pixelToMap
      ? [...input.pixelToMap]
      : [
          (xmax - xmin) / input.width,
          0,
          xmin,
          0,
          -(ymax - ymin) / input.height,
          ymax,
          0,
          0,
          1,
        ],
    source: structuredClone({ ...input.source, parameters: safeParameters }),
    tiles: input.tiles.map((t) => ({
      ...t,
      data: copy ? t.data.slice() : t.data,
    })),
  };
  snapshot.digest = contentDigest(snapshot.tiles);
  Object.freeze(snapshot.source.layers);
  if (snapshot.source.styles) Object.freeze(snapshot.source.styles);
  if (snapshot.source.parameters) Object.freeze(snapshot.source.parameters);
  Object.freeze(snapshot.source);
  Object.freeze(snapshot.extent);
  Object.freeze(snapshot.pixelToMap);
  snapshot.tiles.forEach(Object.freeze);
  Object.freeze(snapshot.tiles);
  return Object.freeze(snapshot);
}
/** Host-owned WMS transport, decoding and bounded reference acquisition policy. */
export interface WmsProviderOptions {
  /** Endpoint remains host-private; no URL or credentials enter snapshot provenance. */
  url: string;
  /** Opaque source identity, content revision and configured layer/style ordering. */
  source: ReferenceSource;
  /** WMS protocol version; defaults to `1.3.0`. */
  version?: "1.1.1" | "1.3.0";
  /** Source filters/time/vendor parameters. GetMap geometry and selected layers override conflicts. */
  parameters?: Record<string, string>;
  /** BBOX wire order; defaults to `yx` for WMS 1.3.0 EPSG:4326, otherwise `xy`. */
  axisOrder?: "xy" | "yx";
  /** Maximum tile edge in pixels, integer 1–4096; defaults to 1024. */
  maxTileSize?: number;
  /** Maximum acquired raster area before requests start; defaults to 32 million pixels. */
  maxPixels?: number;
  /** Fetch a tile with host authentication/cancellation; defaults to fetch with the supplied signal. */
  request?: (url: string, signal?: AbortSignal) => Promise<Blob>;
  /** Decode a tile into RGBA with the requested dimensions; supply your own decoder in Node. */
  decode: (blob: Blob) => Promise<PixelImage>;
}
/**
 * Construct a single WMS PNG GetMap URL without sending a request.
 *
 * @param options - Endpoint, protocol, configured layers/styles and extra parameters.
 * @param selection - CRS and selected layer IDs in rendering order.
 * @param extent - Tile bounds in public XY order; serialized according to WMS axes.
 * @param width - Requested integer tile width in pixels.
 * @param height - Requested integer tile height in pixels.
 * @returns Absolute request URL, potentially containing transport credentials;
 * do not log it or store it as snapshot provenance. Direct callers must validate
 * dimensions/extent themselves; {@link createWmsProvider} does so before requests.
 */
export function wmsRequestUrl(
  options: WmsProviderOptions,
  selection: ReferenceSelection,
  extent: Extent,
  width: number,
  height: number,
): string {
  const version = options.version ?? "1.3.0",
    params = new URLSearchParams();
  const yx =
    options.axisOrder === "yx" ||
    (!options.axisOrder &&
      version === "1.3.0" &&
      selection.crs === "EPSG:4326");
  for (const [key, value] of Object.entries(options.parameters ?? {}))
    params.set(key.toUpperCase(), value);
  const styles = options.source.styles ?? params.get("STYLES")?.split(",");
  for (const [key, value] of Object.entries({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: version,
    LAYERS: selection.layers.join(","),
    STYLES: selection.layers
      .map((layer) => styles?.[options.source.layers.indexOf(layer)] ?? "")
      .join(","),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    WIDTH: String(width),
    HEIGHT: String(height),
    BBOX: (yx ? [extent[1], extent[0], extent[3], extent[2]] : extent).join(
      ",",
    ),
  }))
    params.set(key, value);
  params.delete(version === "1.3.0" ? "SRS" : "CRS");
  params.set(version === "1.3.0" ? "CRS" : "SRS", selection.crs);
  const url = new URL(options.url);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return url.href;
}
/**
 * Acquire a frozen reference snapshot through sequential, cancellable WMS tiles.
 *
 * Dimensions round the selected extent/resolution ratio upwards; the snapshot
 * records the exact mapping of the resulting raster to the selected bounds.
 * Requests never expand the search area. Configuration is copied at creation;
 * recreate the provider when source parameters/styles/content revisions change.
 * Hosts handle CORS, authentication and source readiness in their request closure.
 *
 * @param options - WMS source, decoder and optional transport/resource overrides.
 * @returns A provider whose `acquire` respects abort and bounds pixel allocations.
 * @throws Acquisition rejects with {@link MatchingError}: `INPUT` for invalid
 * selection, `BUDGET` before requests exceeding configured or hard limits (32,768
 * pixels per side, 4096 tiles), `SOURCE` for transport/decoding failures. Failed
 * requests are not silently converted to missing-data or geometric partial matches.
 */
export function createWmsProvider(
  options: WmsProviderOptions,
): ReferenceProvider {
  options = {
    ...options,
    source: structuredClone(options.source),
    parameters: { ...options.parameters },
  };
  return {
    async acquire(selection, signal) {
      const { extent, crs, resolution, layers } = structuredClone(selection);
      validateSearchExtent(extent, crs);
      if (
        extent.length !== 4 ||
        !extent.every(Number.isFinite) ||
        extent[0] >= extent[2] ||
        extent[1] >= extent[3] ||
        !crs ||
        !layers.length ||
        !(resolution > 0 && Number.isFinite(resolution))
      )
        throw new MatchingError(
          "INPUT",
          "Select an unwrapped extent, CRS, resolution and reference layers.",
        );
      const width = Math.ceil((extent[2] - extent[0]) / resolution),
        height = Math.ceil((extent[3] - extent[1]) / resolution),
        size = options.maxTileSize ?? 1024;
      if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 4096 ||
        width > 32768 ||
        height > 32768 ||
        Math.ceil(width / size) * Math.ceil(height / size) > 4096 ||
        width * height > (options.maxPixels ?? 32_000_000)
      )
        throw new MatchingError(
          "BUDGET",
          "Reference acquisition exceeds the configured pixel or tile budget.",
        );
      const tiles: ReferenceTile[] = [];
      for (let y = 0; y < height; y += size)
        for (let x = 0; x < width; x += size) {
          signal?.throwIfAborted();
          const w = Math.min(size, width - x),
            h = Math.min(size, height - y),
            dx = (extent[2] - extent[0]) / width,
            dy = (extent[3] - extent[1]) / height;
          const box: Extent = [
            extent[0] + x * dx,
            extent[3] - (y + h) * dy,
            extent[0] + (x + w) * dx,
            extent[3] - y * dy,
          ];
          try {
            const url = wmsRequestUrl(
                options,
                { extent, crs, resolution, layers },
                box,
                w,
                h,
              ),
              blob = await (options.request
                ? options.request(url, signal)
                : fetch(url, { signal }).then(async (response) => {
                    if (!response.ok)
                      throw Error(`WMS HTTP ${response.status}`);
                    return response.blob();
                  }));
            signal?.throwIfAborted();
            const pixels = await options.decode(blob);
            signal?.throwIfAborted();
            if (pixels.width !== w || pixels.height !== h)
              throw Error(
                "WMS returned unexpected dimensions or a service exception.",
              );
            // Copy per tile: the host decoder may reuse its buffer, and the decoded
            // original can be released before the next request.
            tiles.push({ ...pixels, data: pixels.data.slice(), x, y });
          } catch (error) {
            signal?.throwIfAborted();
            throw new MatchingError(
              "SOURCE",
              `Reference acquisition failed. Check WMS access, CORS, layer readiness and parameters. ${String(error)}`,
            );
          }
        }
      // Snapshot metadata is explicit allowlisted provenance, never transport headers/URL.
      // Tiles were copied on arrival, so they are frozen without a second full copy.
      return freezeSnapshot(
        {
          id: crypto.randomUUID(),
          width,
          height,
          crs,
          extent,
          source: {
            ...options.source,
            layers,
            parameters: {
              ...options.source.parameters,
              ...options.parameters,
              VERSION: options.version ?? "1.3.0",
            },
          },
          tiles,
        },
        false,
      );
    },
  };
}
