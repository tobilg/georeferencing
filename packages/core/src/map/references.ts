import type { FeatureCollection, Geometry, Position } from "geojson";
import type { GeoreferencerController } from "../core/controller.js";
import type { Definitions } from "../core/projection.js";
import {
  createConverter,
  intersection,
  normalizeCrs,
  projectExtent,
} from "../core/projection.js";
import type { Extent } from "../core/types.js";
import { fail } from "../core/types.js";

/**
 * Reference snapping rules. Supplying this object opts the provider into GCP snapping.
 */
export interface SnapOptions {
  /**
   * Snap to reference vertices.
   * @defaultValue `true`
   */
  vertices?: boolean;
  /**
   * Also snap to reference segment edges.
   * @defaultValue `false`
   */
  edges?: boolean;
  /**
   * Pointer tolerance in screen pixels.
   * @defaultValue `10`
   */
  tolerancePx?: number;
}
/** Shared reference-provider identity and opt-in snapping configuration. */
export interface ReferenceBase {
  /** Unique stable provider ID within an editor binding. */
  id: string;
  /** Human-readable provider name for loading/error feedback. */
  label: string;
  /** Opt into reference snapping and configure its tolerance. */
  snapping?: SnapOptions;
}
/** Static reference collection loaded into a package-owned layer. */
export interface GeoJsonReference extends ReferenceBase {
  /** Discriminator for static reference GeoJSON. */
  kind: "geojson";
  /** Reference features, distinct from user drawings and GCPs. */
  data: FeatureCollection;
  /**
   * Explicit coordinate CRS of the supplied collection; converted to the host map
   * projection.
   */
  crs: string;
}
/**
 * Reference query with explicit bounds/CRS and a cancellation signal tied to
 * viewport/provider lifetime.
 */
export interface Query {
  /**
   * Positive-area query bounds in `crs`, already intersected with configured provider
   * bounds.
   */
  extent: Extent;
  /** CRS of the query extent. */
  crs: string;
  /**
   * Current host map resolution in map-projection units per pixel, even when the query
   * uses a different CRS.
   */
  resolution: number;
  /**
   * Abort signal for navigation, provider replacement or detach; loaders should pass it
   * through to network calls.
   */
  signal: AbortSignal;
}
/**
 * Host-defined cancellable reference loader; useful for services with custom paging,
 * authentication or split geographic queries.
 */
export interface CustomReference extends ReferenceBase {
  /** Discriminator for a custom reference loader. */
  kind: "custom";
  /** CRS in which the loader receives query bounds. */
  queryCrs: string;
  /** Optional loading constraint in queryCrs. Required for fixed loading. */
  queryBounds?: Extent;
  /**
   * Viewport queries follow navigation; fixed queries use configured bounds.
   * @defaultValue `"viewport"`
   */
  loading?: "viewport" | "fixed";
  /**
   * Load a query and declare the returned coordinate CRS. The binding discards late
   * results after a newer query or detach.
   */
  load: (query: Query) => Promise<{
    /**
     * Returned reference features; stable IDs are recommended for snapping provenance.
     */
    data: FeatureCollection;
    /** Coordinate CRS of the returned feature collection. */
    crs: string;
    /** Whether the result is incomplete. */
    partial: boolean;
    /** Optional explanation displayed alongside provider status. */
    message?: string;
  }>;
}
/**
 * Explicit read-only WFS provider configuration. Request and response axis order are
 * independent; bounds constrain queries without georeferencing the image.
 */
export interface WfsReference extends ReferenceBase {
  /** Discriminator for a WFS reference provider. */
  kind: "wfs";
  /**
   * GetCapabilities/GetFeature service URL. Use request injection for credentials rather
   * than hardcoding secrets.
   */
  url: string;
  /** WFS protocol version; supported values are 1.1.0 and 2.0.0. */
  version: "2.0.0" | "1.1.0";
  /** Qualified feature-type names to request. */
  typeNames: string[];
  /** CRS of request bounds and the requested output coordinates. */
  requestCrs: string;
  /**
   * Override incorrect/missing service CRS metadata. Otherwise the response declaration
   * is preferred, then requestCrs.
   */
  responseCrs?: string;
  /** Explicit BBOX wire order; xy uses minX,minY,maxX,maxY and yx swaps each pair. */
  axisOrder: "xy" | "yx";
  /**
   * Optional response axis override. GeoJSON defaults to xy; GML uses declared CRS/native
   * OpenLayers axis conventions.
   */
  responseAxisOrder?: "xy" | "yx";
  /** Response parser family; must agree with the service outputFormat. */
  responseFormat: "geojson" | "gml";
  /**
   * Exact service-advertised format string. Defaults to application/json or
   * version-appropriate GML.
   */
  outputFormat?: string;
  /**
   * Optional spatial query constraint, transformed to requestCrs before viewport
   * intersection.
   */
  queryBounds?: {
    /** Provider query boundary in its declared CRS. */
    extent: Extent;
    /** CRS of the provider query boundary. */
    crs: string;
  };
  /**
   * Follow viewport navigation or repeatedly query the configured fixed bounds.
   * @defaultValue `"viewport"`
   */
  loading?: "viewport" | "fixed";
  /**
   * Requested features per page.
   * @defaultValue `500`
   */
  pageSize?: number;
  /**
   * Maximum retained unique features per query; exhaustion is reported as partial.
   * @defaultValue `5000`
   */
  maxFeatures?: number;
  /**
   * Page-request budget per query; exhaustion is reported as partial.
   * @defaultValue `20`
   */
  maxPages?: number;
  /**
   * Explicit paging support for WFS 1.1 services; otherwise capabilities.paging is used.
   * WFS 2 requests include startIndex.
   */
  supportsStartIndex?: boolean;
  /**
   * Skip loading when host map resolution exceeds this value, in map units per pixel;
   * returns zoom-in feedback.
   */
  maxResolution?: number;
  /**
   * Feature property used when the service omits a feature ID. Missing IDs are errors;
   * duplicate IDs are deduplicated.
   */
  idProperty?: string;
  /**
   * Additional query parameters, such as a read filter. Computed type names, BBOX and
   * page counts take precedence.
   */
  parameters?: Record<string, string>;
  /**
   * Host fetch adapter for authentication/headers/credentials. Preserve init.signal to support cancellation.
   * @defaultValue Native fetch
   */
  request?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * Optional pre-fetched discovery metadata used to validate version, feature types,
   * formats and paging.
   */
  capabilities?: WfsCapabilities;
  /**
   * Maximum bytes streamed for each service response before parsing.
   * @defaultValue `20971520` (20 MiB)
   */
  maxResponseBytes?: number;
}
/** Subset of WFS GetCapabilities used for provider validation and discovery UI. */
export interface WfsCapabilities {
  /** Advertised supported WFS version. */
  version: "2.0.0" | "1.1.0";
  /** Whether ImplementsResultPaging is explicitly advertised as true. */
  paging: boolean;
  /** Advertised output-format strings. */
  outputFormats: string[];
  /** Advertised feature-type names, labels and CRSs. */
  featureTypes: {
    /** Qualified service type name. */
    name: string;
    /** Human-readable advertised title. */
    title: string;
    /** Normalized default CRS identifier. */
    defaultCrs: string;
    /** Normalized additional advertised CRS identifiers. */
    otherCrs: string[];
  }[];
}
/** Property description extracted from a WFS DescribeFeatureType schema. */
export interface WfsProperty {
  /** Schema element name. */
  name: string;
  /** XML schema type name as advertised by the service. */
  type: string;
  /** Whether minOccurs is zero. */
  optional: boolean;
  /** Whether the schema permits an explicit nil value. */
  nillable: boolean;
  /** Whether maxOccurs exceeds one or is unbounded. */
  multiple: boolean;
}
/**
 * Service endpoint, protocol, request adapter and byte budget for optional WFS discovery.
 */
export type WfsDiscoveryOptions = Pick<
  WfsReference,
  "url" | "version" | "request" | "maxResponseBytes"
> & {
  /** Abort signal applied to both network fetching and response reading. */
  signal: AbortSignal;
};
/**
 * Stream and bound reference response bytes before parsing, detecting OGC exception
 * payloads even on HTTP success.
 */
async function responseText(
  response: Response,
  signal: AbortSignal,
  maxBytes = 20 * 1024 * 1024,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    fail(
      "REFERENCE_BUDGET",
      "Reference byte budget must be a positive integer.",
    );
  if (!response.ok) fail("WFS_HTTP", `WFS HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes)
    fail("REFERENCE_BUDGET", "Reference response exceeds its byte budget.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        fail(
          "REFERENCE_BUDGET",
          "Reference response exceeds its byte budget; reduce page size.",
        );
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    signal.throwIfAborted();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  // Only XML bodies can be OGC exception reports; GeoJSON property values may contain
  // the same words. Services may still answer a JSON request with an XML exception.
  if (
    text.trimStart().startsWith("<") &&
    /<(?:\w+:)?(?:ExceptionReport|ServiceExceptionReport|Exception|ServiceException)\b/i.test(
      text,
    )
  )
    fail(
      "WFS_EXCEPTION",
      text
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 350),
    );
  return text;
}
function xmlDocument(text: string): XMLDocument {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length)
    fail("WFS_FORMAT", "Malformed WFS XML.");
  return xml;
}
const elements = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagNameNS("*", name));
const textOf = (node: Document | Element, name: string) =>
  elements(node, name)[0]?.textContent?.trim() ?? "";
async function discovery(
  options: WfsDiscoveryOptions,
  operation: string,
  extra: Record<string, string> = {},
): Promise<XMLDocument> {
  const url = new URL(
    options.url,
    typeof location === "undefined" ? "http://localhost" : location.href,
  );
  for (const [k, v] of Object.entries({
    service: "WFS",
    version: options.version,
    request: operation,
    ...extra,
  }))
    url.searchParams.set(k, v);
  return xmlDocument(
    await responseText(
      await (options.request ?? fetch)(url.href, { signal: options.signal }),
      options.signal,
      options.maxResponseBytes,
    ),
  );
}
/**
 * Read optional WFS capabilities using the host request adapter and bounded response
 * reader. Requires DOMParser when called; importing the module is SSR-safe.
 */
export async function discoverWfs(
  options: WfsDiscoveryOptions,
): Promise<WfsCapabilities> {
  const xml = await discovery(options, "GetCapabilities");
  const version = xml.documentElement.getAttribute("version");
  if (version !== "1.1.0" && version !== "2.0.0")
    fail("WFS_VERSION", "Expected WFS 1.1.0 or 2.0.0 capabilities.");
  const formats = elements(xml, "Parameter")
    .filter((n) => n.getAttribute("name")?.toLowerCase() === "outputformat")
    .flatMap((n) => elements(n, "Value").map((v) => v.textContent!.trim()));
  for (const n of elements(xml, "OutputFormats"))
    for (const f of elements(n, "Format")) formats.push(f.textContent!.trim());
  return {
    version: version as WfsCapabilities["version"],
    paging: elements(xml, "Constraint").some(
      (n) =>
        n.getAttribute("name") === "ImplementsResultPaging" &&
        textOf(n, "DefaultValue").toLowerCase() === "true",
    ),
    outputFormats: [...new Set(formats)],
    featureTypes: elements(xml, "FeatureType").map((n) => ({
      name: textOf(n, "Name"),
      title: textOf(n, "Title"),
      defaultCrs: normalizeCrs(
        textOf(n, "DefaultCRS") || textOf(n, "DefaultSRS"),
      ),
      otherCrs: [...elements(n, "OtherCRS"), ...elements(n, "OtherSRS")].map(
        (v) => normalizeCrs(v.textContent!.trim()),
      ),
    })),
  };
}
/**
 * Read schema property metadata for the requested feature types. Uses the same
 * cancellation, authentication and byte budgets as capabilities discovery.
 */
export async function describeWfsFeatureType(
  options: WfsDiscoveryOptions,
  typeNames: string[],
): Promise<WfsProperty[]> {
  const xml = await discovery(options, "DescribeFeatureType", {
    [options.version === "2.0.0" ? "typeNames" : "typeName"]:
      typeNames.join(","),
  });
  return elements(xml, "sequence")
    .flatMap((n) => elements(n, "element"))
    .map((n) => ({
      name: n.getAttribute("name") ?? "",
      type: n.getAttribute("type") ?? "",
      optional: n.getAttribute("minOccurs") === "0",
      nillable: n.getAttribute("nillable") === "true",
      multiple:
        n.getAttribute("maxOccurs") === "unbounded" ||
        Number(n.getAttribute("maxOccurs") ?? 1) > 1,
    }));
}
/**
 * Map-library-independent reference sources. Reference features remain separate from
 * control points and user-created drawings. Map adapters may accept additional kinds,
 * such as layers already owned by the host map.
 */
export type ReferenceSource = GeoJsonReference | CustomReference | WfsReference;
/**
 * Project the map viewport into the provider query CRS and intersect optional bounds. Fixed loading uses configured bounds directly.
 * @returns Query extent or null when the viewport intersection is empty.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For invalid/wrapped bounds, missing CRS definitions or fixed loading without bounds.
 */
export function queryBounds(
  provider: WfsReference | CustomReference,
  view: Extent,
  mapCrs: string,
  definitions: Definitions = {},
): Extent | null {
  const crs = provider.kind === "wfs" ? provider.requestCrs : provider.queryCrs;
  const configured =
    provider.kind === "wfs"
      ? provider.queryBounds &&
        projectExtent(
          provider.queryBounds.extent,
          provider.queryBounds.crs,
          crs,
          definitions,
        )
      : provider.queryBounds;
  if (provider.loading === "fixed") {
    if (!configured)
      return fail(
        "REFERENCE",
        "Fixed-area loading requires explicit query bounds.",
      );
    return configured;
  }
  const extent = projectExtent(view, mapCrs, crs, definitions);
  return configured ? intersection(extent, configured) : extent;
}
/**
 * Construct a version-specific read-only GetFeature URL with explicit BBOX axis order and paging parameters.
 * @param provider - Service configuration.
 * @param extent - Bounds already in provider.requestCrs.
 * @param start - Zero-based result offset, used when paging is supported.
 */
export function buildWfsUrl(
  provider: WfsReference,
  extent: Extent,
  start = 0,
): string {
  const url = new URL(
    provider.url,
    typeof location === "undefined" ? "http://localhost" : location.href,
  );
  const parameters = new URLSearchParams({
    service: "WFS",
    request: "GetFeature",
    version: provider.version,
    srsName: provider.requestCrs,
    outputFormat:
      provider.outputFormat ??
      (provider.responseFormat === "geojson"
        ? "application/json"
        : provider.version === "2.0.0"
          ? "application/gml+xml; version=3.2"
          : "text/xml; subtype=gml/3.1.1"),
    ...provider.parameters,
  });
  parameters.set(
    provider.version === "2.0.0" ? "typeNames" : "typeName",
    provider.typeNames.join(","),
  );
  const b =
    provider.axisOrder === "yx"
      ? [extent[1], extent[0], extent[3], extent[2]]
      : extent;
  parameters.set("bbox", [...b, provider.requestCrs].join(","));
  parameters.set(
    provider.version === "2.0.0" ? "count" : "maxFeatures",
    String(provider.pageSize ?? 500),
  );
  if (
    provider.version === "2.0.0" ||
    (provider.supportsStartIndex ?? provider.capabilities?.paging)
  )
    parameters.set("startIndex", String(start));
  for (const [key, value] of parameters) url.searchParams.set(key, value);
  return url.href;
}
/**
 * Reference features in an explicit CRS with completeness feedback. Generic adapters
 * convert them to longitude/latitude with {@link toGeographic}.
 */
export interface ReferenceData {
  /** Features with stable string IDs where the source provides them. */
  data: FeatureCollection;
  /** CRS of the feature coordinates. */
  crs: string;
  /** True if paging, budgets or service counts indicate incomplete results. */
  partial: boolean;
  /** Explanation of incomplete or unavailable results. */
  message?: string;
}
/** One parsed WFS response page for {@link loadWfsPages}. */
export interface WfsPage<T> {
  /** Parsed features of this page, already validated by the parser. */
  items: T[];
  /** Total number of matching features reported by the service, when known. */
  matched?: number;
}
/**
 * Load bounded WFS GetFeature pages with a format-specific parser. Handles the
 * resolution guard, page/feature budgets, capability validation, deduplication by
 * feature ID and explicit partial-result reporting; map adapters supply the parser.
 * @param provider - Service and request configuration.
 * @param query - Bounds in `provider.requestCrs`, map resolution and cancellation signal.
 * @param parse - Parse one response body. Throw for malformed responses.
 * @param id - Read a feature's service ID, or its `idProperty` value.
 * @param setId - Store the normalized string ID on the feature.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For invalid budgets, capability mismatches, missing IDs or service errors.
 */
export async function loadWfsPages<T>(
  provider: WfsReference,
  query: Query,
  parse: (text: string) => WfsPage<T>,
  id: (item: T) => unknown,
  setId: (item: T, id: string) => void,
): Promise<{
  /** Unique features in service order. */
  items: T[];
  /** True if the result is known or suspected to be incomplete. */
  partial: boolean;
  /** Explanation of incomplete results. */
  message?: string;
}> {
  const items = new Map<string, T>(),
    pageSize = provider.pageSize ?? 500,
    maxFeatures = provider.maxFeatures ?? 5000,
    maxPages = provider.maxPages ?? 20;
  const result = (partial: boolean, message?: string) => ({
    items: [...items.values()],
    partial,
    message,
  });
  if (provider.maxResolution && query.resolution > provider.maxResolution)
    return {
      items: [],
      partial: true,
      message: "Zoom in to load this reference.",
    };
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    maxFeatures < 1 ||
    maxPages < 1
  )
    fail("REFERENCE", "Reference page/feature budgets must be positive.");
  const capabilities = provider.capabilities;
  if (capabilities) {
    if (capabilities.version !== provider.version)
      fail(
        "WFS_VERSION",
        "Provider version disagrees with supplied capabilities.",
      );
    for (const name of provider.typeNames)
      if (!capabilities.featureTypes.some((f) => f.name === name))
        fail("WFS_TYPE", `Feature type '${name}' is absent from capabilities.`);
    if (
      provider.outputFormat &&
      capabilities.outputFormats.length &&
      !capabilities.outputFormats.includes(provider.outputFormat)
    )
      fail("WFS_FORMAT", "Output format is not advertised by this service.");
  }
  let start = 0;
  for (let page = 0; page < maxPages; page++) {
    query.signal.throwIfAborted();
    const response = await (provider.request ?? fetch)(
      buildWfsUrl(provider, query.extent, start),
      { signal: query.signal },
    );
    const { items: parsed, matched } = parse(
      await responseText(response, query.signal, provider.maxResponseBytes),
    );
    let added = 0;
    for (const item of parsed) {
      const raw = id(item);
      if (raw === undefined || raw === false || raw === null || raw === "")
        fail(
          "WFS_ID",
          "Reference features require stable IDs; configure idProperty if the service omits IDs.",
        );
      const key = String(raw);
      setId(item, key);
      if (!items.has(key)) {
        if (items.size >= maxFeatures)
          return result(true, "Feature budget reached; zoom in.");
        items.set(key, item);
        added++;
      }
    }
    start += parsed.length;
    if (
      parsed.length === 0 ||
      (matched !== undefined && start >= matched) ||
      (matched === undefined && parsed.length < pageSize)
    ) {
      const incomplete = matched !== undefined && items.size < matched;
      return result(
        incomplete,
        incomplete
          ? "Service count and unique result count differ."
          : undefined,
      );
    }
    if (
      added === 0 ||
      (provider.version === "1.1.0" &&
        !(provider.supportsStartIndex ?? capabilities?.paging)) ||
      capabilities?.paging === false
    )
      return result(
        true,
        "Paging unavailable or repeated page; results are incomplete.",
      );
  }
  return result(true, "Page budget reached; results are incomplete.");
}
/**
 * Load a WFS provider that returns GeoJSON (`responseFormat: "geojson"`), without any
 * map library. GML responses require the OpenLayers adapter's parser.
 * @param provider - Service and request configuration.
 * @param query - Bounds in `provider.requestCrs`, map resolution and cancellation signal.
 * @returns Features in the declared response CRS.
 */
export async function loadWfsGeoJson(
  provider: WfsReference,
  query: Query,
): Promise<ReferenceData> {
  if (provider.responseFormat !== "geojson")
    fail(
      "WFS_FORMAT",
      "This map adapter reads WFS GeoJSON only; request GeoJSON output or use the OpenLayers adapter for GML.",
    );
  let crs = normalizeCrs(provider.responseCrs ?? provider.requestCrs);
  type Item = FeatureCollection["features"][number];
  const swap = (v: unknown): unknown =>
    Array.isArray(v)
      ? typeof v[0] === "number"
        ? [v[1], v[0], ...v.slice(2)]
        : v.map(swap)
      : v;
  const loaded = await loadWfsPages<Item>(
    provider,
    query,
    (text) => {
      const data = JSON.parse(text);
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
        fail("WFS_FORMAT", "Expected a WFS GeoJSON FeatureCollection.");
      if (!provider.responseCrs && data.crs?.properties?.name)
        crs = normalizeCrs(data.crs.properties.name);
      for (const f of data.features) {
        if (!f?.geometry)
          fail("WFS_GEOMETRY", "Reference geometry is missing.");
        if (provider.responseAxisOrder === "yx") {
          if (!f.geometry.coordinates)
            fail("WFS_FORMAT", "Axis override requires coordinate geometries.");
          f.geometry.coordinates = swap(f.geometry.coordinates);
        }
      }
      return {
        items: data.features,
        matched:
          typeof data.numberMatched === "number"
            ? data.numberMatched
            : typeof data.totalFeatures === "number"
              ? data.totalFeatures
              : undefined,
      };
    },
    (f) =>
      f.id ??
      (provider.idProperty ? f.properties?.[provider.idProperty] : undefined),
    (f, id) => {
      f.id = id;
    },
  );
  return {
    data: { type: "FeatureCollection", features: loaded.items },
    crs,
    partial: loaded.partial,
    message: loaded.message,
  };
}
/**
 * Convert a feature collection to longitude/latitude (EPSG:4326) coordinates. Supports
 * every GeoJSON geometry type; IDs and properties are kept. Vertices are converted
 * individually, without densifying long projected segments.
 * @param data - Features in `crs`; not mutated.
 * @param crs - CRS of the input coordinates.
 * @param definitions - Host projection definitions.
 * @throws {@link "@georeferencing/core".GeoreferenceError} For unknown CRSs or coordinates outside the projection domain.
 */
export function toGeographic(
  data: FeatureCollection,
  crs: string,
  definitions: Definitions = {},
): FeatureCollection {
  const convert = createConverter(crs, "EPSG:4326", definitions);
  const position = (p: Position): Position => {
    const q = convert([p[0], p[1]]);
    if (!q.every(Number.isFinite))
      fail("CRS", `Reference coordinates cannot be converted from ${crs}.`);
    return [q[0], q[1], ...p.slice(2)];
  };
  const geometry = (g: Geometry | null): Geometry | null => {
    if (!g) return g;
    switch (g.type) {
      case "Point":
        return { ...g, coordinates: position(g.coordinates) };
      case "MultiPoint":
      case "LineString":
        return { ...g, coordinates: g.coordinates.map(position) };
      case "MultiLineString":
      case "Polygon":
        return { ...g, coordinates: g.coordinates.map((r) => r.map(position)) };
      case "MultiPolygon":
        return {
          ...g,
          coordinates: g.coordinates.map((p) => p.map((r) => r.map(position))),
        };
      case "GeometryCollection":
        return {
          ...g,
          geometries: g.geometries.map((child) => geometry(child) as Geometry),
        };
    }
  };
  return {
    ...data,
    features: data.features.map((f) => ({
      ...f,
      geometry: geometry(f.geometry) as Geometry,
    })),
  };
}
/**
 * Load any {@link ReferenceSource} as longitude/latitude GeoJSON, for map libraries that
 * display geographic coordinates (MapLibre, Leaflet). WFS sources must return GeoJSON.
 * @param provider - Reference configuration.
 * @param query - Viewport query; null for static GeoJSON sources.
 * @param definitions - Host projection definitions.
 */
export async function loadReferenceData(
  provider: ReferenceSource,
  query: Query | null,
  definitions: Definitions = {},
): Promise<ReferenceData> {
  let loaded: ReferenceData;
  if (provider.kind === "geojson")
    loaded = { data: provider.data, crs: provider.crs, partial: false };
  else if (!query) fail("REFERENCE", "This reference requires a query.");
  else if (provider.kind === "wfs")
    loaded = await loadWfsGeoJson(provider, query!);
  else loaded = await provider.load(query!);
  return {
    ...loaded!,
    data: toGeographic(loaded!.data, loaded!.crs, definitions),
    crs: "EPSG:4326",
  };
}
/** Provider status reported by {@link watchReferences}. */
export interface ReferenceLoadStatus {
  /** Latest provider request state. */
  state: "loading" | "ready" | "error";
  /** Whether service behavior or budgets caused incomplete results. */
  partial?: boolean;
  /** Optional provider explanation. */
  message?: string;
}
/** Hooks connecting {@link watchReferences} to a map binding. */
export interface ReferenceWatchOptions<P extends ReferenceBase, T> {
  /** Controller receiving provider statuses for its snapshot. */
  controller: GeoreferencerController;
  /**
   * Current host view: visible extent and resolution in `crs`. Throw if the view or its
   * projection is unavailable; the provider then reports an error.
   */
  view(): {
    /** Visible extent in `crs`. */
    extent: Extent;
    /** Map CRS of the extent. */
    crs: string;
    /** Map units per pixel. */
    resolution: number;
  };
  /**
   * Load one provider. `query` is null for static sources that ignore the viewport.
   * Return null to leave the provider empty without an error.
   */
  load(
    provider: P,
    query: Query | null,
  ): Promise<{
    /** Loaded data in the binding's own representation. */
    data: T;
    /** Whether the result is incomplete. */
    partial: boolean;
    /** Explanation of incomplete results. */
    message?: string;
  } | null>;
  /** Display loaded data, or clear the provider's display when `data` is null. */
  apply(provider: P, data: T | null): void;
  /** Whether a provider follows viewport navigation. Defaults to WFS/custom sources without fixed loading. */
  followsView?(provider: P): boolean;
  /** Host projection definitions for query bounds. */
  definitions?: Definitions;
  /**
   * Delay before refreshing after navigation, in milliseconds.
   * @defaultValue `150`
   */
  debounceMs?: number;
  /** Observe provider status changes in addition to the controller snapshot. */
  onStatus?(id: string, status: ReferenceLoadStatus): void;
}
/**
 * Load reference providers for a map binding: debounced viewport refreshes, abort of
 * superseded requests, discarding of late results and status reporting through the
 * controller. Loading starts immediately.
 * @param providers - Provider configurations with unique IDs.
 * @param options - Binding hooks for view access, loading and display.
 * @returns Controls to refresh after navigation or projection changes and to dispose.
 */
export function watchReferences<P extends ReferenceBase, T>(
  providers: readonly P[],
  options: ReferenceWatchOptions<P, T>,
): {
  /** Reload providers that follow the viewport; call after navigation ends. */
  refreshViewport(): void;
  /** Reload every provider, for example after the map projection changed. */
  refreshAll(): void;
  /** Abort requests, cancel timers and clear provider statuses. */
  dispose(): void;
} {
  const follows =
    options.followsView ??
    ((provider: P) => {
      const p = provider as unknown as ReferenceSource;
      return p.kind !== "geojson" && p.loading !== "fixed";
    });
  let disposed = false;
  const watchers = providers.map((provider) => {
    let abort: AbortController | undefined,
      generation = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const status = (value: ReferenceLoadStatus) => {
      options.controller.setReferenceStatus(provider.id, {
        label: provider.label,
        ...value,
      });
      options.onStatus?.(provider.id, value);
    };
    const load = async () => {
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal,
        current = ++generation;
      status({ state: "loading" });
      try {
        const source = provider as unknown as ReferenceSource;
        let query: Query | null = null;
        if (source.kind === "wfs" || source.kind === "custom") {
          const view = options.view();
          const extent = queryBounds(
            source,
            view.extent,
            view.crs,
            options.definitions,
          );
          if (extent)
            query = {
              extent,
              crs: source.kind === "wfs" ? source.requestCrs : source.queryCrs,
              resolution: view.resolution,
              signal,
            };
        }
        const result =
          query || !(source.kind === "wfs" || source.kind === "custom")
            ? await options.load(provider, query)
            : null;
        if (disposed || current !== generation || signal.aborted) return;
        options.apply(provider, result ? result.data : null);
        status({
          state: "ready",
          partial: result?.partial ?? false,
          message: result?.message,
        });
      } catch (error) {
        if (!disposed && current === generation && !signal.aborted) {
          options.apply(provider, null);
          status({ state: "error", message: String(error) });
        }
      }
    };
    const schedule = () => {
      abort?.abort();
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void load(), options.debounceMs ?? 150);
    };
    const cancel = () => {
      abort?.abort();
      generation++;
      clearTimeout(timer);
    };
    schedule();
    return { provider, schedule, cancel };
  });
  return {
    refreshViewport() {
      for (const w of watchers) if (follows(w.provider)) w.schedule();
    },
    refreshAll() {
      for (const w of watchers) w.schedule();
    },
    dispose() {
      disposed = true;
      for (const w of watchers) {
        w.cancel();
        options.controller.setReferenceStatus(w.provider.id, null);
      }
    },
  };
}
