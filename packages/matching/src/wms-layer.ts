import { decodeReferenceImage } from "./browser.js";
import { createWmsProvider } from "./reference.js";
import type {
  ReferenceProvider,
  ReferenceSelection,
  ReferenceSource,
} from "./types.js";
import { MatchingError } from "./types.js";

// GetMap parameters that each request derives from the selection.
const DERIVED = new Set([
  "SERVICE",
  "REQUEST",
  "VERSION",
  "LAYERS",
  "STYLES",
  "FORMAT",
  "TRANSPARENT",
  "WIDTH",
  "HEIGHT",
  "BBOX",
  "CRS",
  "SRS",
]);
// Content-relevant parameters recorded as snapshot provenance; never credentials.
const PROVENANCE = ["TIME", "ELEVATION", "CQL_FILTER", "FILTER", "SLD_BODY"];

/** A map library's configured WMS layer, read by an adapter-specific provider. */
export interface WmsLayerConfig {
  id: string;
  revision: string;
  /** Endpoint; vendor query parameters such as `map=` stay on it unchanged. */
  url: string;
  /** Configured WMS parameters in any key case. */
  parameters: Record<string, unknown>;
  request?: (url: string, signal?: AbortSignal) => Promise<Blob>;
}

/** The single configured reference a WMS-only provider acquires from. */
export function selectedReference<T extends { id: string }>(
  references: T[],
  selection: ReferenceSelection,
): T {
  const selected = selection.layers.map((id) =>
    references.find((r) => r.id === id),
  );
  if (!selected.length || selected.some((r) => !r))
    throw new MatchingError("SOURCE", "Select configured reference layers.");
  if (selected.length !== 1)
    throw new MatchingError(
      "SOURCE",
      "Select one WMS source with its configured server layers, or supply a compositing host provider.",
    );
  return selected[0]!;
}

/**
 * Acquire through {@link createWmsProvider} with a layer's own configuration.
 * WMS parameters found in the URL (as in MapLibre tile templates) move into the
 * request parameters, so each request carries every parameter exactly once.
 */
export function acquireWmsLayer(
  config: WmsLayerConfig,
  selection: ReferenceSelection,
  signal?: AbortSignal,
): ReturnType<ReferenceProvider["acquire"]> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.parameters))
    if (value !== undefined && value !== null)
      params[key.toUpperCase()] = String(value);
  const url = new URL(config.url, globalThis.location?.href);
  for (const [key, value] of [...url.searchParams]) {
    const name = key.toUpperCase();
    if (DERIVED.has(name) || PROVENANCE.includes(name)) {
      url.searchParams.delete(key);
      params[name] ??= value;
    }
  }
  const layers = (params.LAYERS ?? "").split(",").filter(Boolean);
  if (!layers.length)
    throw new MatchingError("SOURCE", "The WMS layer has no LAYERS parameter.");
  const source: ReferenceSource = {
    id: config.id,
    revision: config.revision,
    layers,
    styles: (params.STYLES ?? "").split(","),
    parameters: Object.fromEntries(
      PROVENANCE.filter((k) => params[k] !== undefined).map((k) => [
        k,
        params[k],
      ]),
    ),
  };
  return createWmsProvider({
    url: url.href,
    source,
    parameters: Object.fromEntries(
      Object.entries(params).filter(([k]) => !DERIVED.has(k)),
    ),
    version: (params.VERSION ?? "1.3.0") as "1.1.1" | "1.3.0",
    request: config.request,
    decode: decodeReferenceImage,
  }).acquire({ ...selection, layers }, signal);
}
