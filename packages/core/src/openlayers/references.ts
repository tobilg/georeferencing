import type { FeatureCollection } from "geojson";
import type Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import WFS from "ol/format/WFS.js";
import type VectorLayer from "ol/layer/Vector.js";
import { get as getProjection } from "ol/proj.js";
import type VectorSource from "ol/source/Vector.js";
import type { Definitions } from "../core/projection.js";
import {
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
/** WFS results converted to host map coordinates, with completeness feedback. */
export interface ReferenceResult {
  /** OpenLayers features in the requested map CRS with stable string IDs. */
  features: Feature[];
  /** True if paging, budgets or service counts indicate incomplete results. */
  partial: boolean;
  /** Explanation of incomplete or unavailable results. */
  message?: string;
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
 * Supported reference-source configurations. Reference features remain separate from
 * control points and user-created drawings.
 */
export type Reference =
  | BorrowedReference
  | GeoJsonReference
  | CustomReference
  | WfsReference;
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
 * Load bounded WFS pages, reject service exceptions and missing IDs, deduplicate features and transform coordinates to the map CRS.
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
  const features = new Map<string, Feature>(),
    pageSize = provider.pageSize ?? 500,
    maxFeatures = provider.maxFeatures ?? 5000,
    maxPages = provider.maxPages ?? 20;
  if (provider.maxResolution && query.resolution > provider.maxResolution)
    return {
      features: [],
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
    const text = await responseText(
      response,
      query.signal,
      provider.maxResponseBytes,
    );
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
        provider.responseCrs ??
          data.crs?.properties?.name ??
          provider.requestCrs,
      );
      if (!getProjection(dataProjection))
        fail(
          "CRS",
          `Register the WFS response projection '${dataProjection}'.`,
        );
      parsed = new GeoJSON().readFeatures(data, {
        dataProjection,
        featureProjection: mapCrs,
      });
    } else {
      const xml = xmlDocument(text);
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
    let added = 0;
    for (const f of parsed) {
      if (!f.getGeometry()?.getExtent().every(Number.isFinite))
        fail(
          "WFS_GEOMETRY",
          "Reference geometry is missing or cannot be projected with the registered CRS definitions.",
        );
      const id =
        f.getId() ?? (provider.idProperty && f.get(provider.idProperty));
      if (id === undefined || id === false || id === null || id === "")
        fail(
          "WFS_ID",
          "Reference features require stable IDs; configure idProperty if the service omits IDs.",
        );
      f.setId(String(id));
      if (!features.has(String(id))) {
        if (features.size >= maxFeatures)
          return {
            features: [...features.values()],
            partial: true,
            message: "Feature budget reached; zoom in.",
          };
        features.set(String(id), f);
        added++;
      }
    }
    start += parsed.length;
    if (
      parsed.length === 0 ||
      (matched !== undefined && start >= matched) ||
      (matched === undefined && parsed.length < pageSize)
    )
      return {
        features: [...features.values()],
        partial: matched !== undefined && features.size < matched,
        message:
          matched !== undefined && features.size < matched
            ? "Service count and unique result count differ."
            : undefined,
      };
    if (
      added === 0 ||
      (provider.version === "1.1.0" &&
        !(provider.supportsStartIndex ?? capabilities?.paging)) ||
      capabilities?.paging === false
    )
      return {
        features: [...features.values()],
        partial: true,
        message: "Paging unavailable or repeated page; results are incomplete.",
      };
  }
  return {
    features: [...features.values()],
    partial: true,
    message: "Page budget reached; results are incomplete.",
  };
}
