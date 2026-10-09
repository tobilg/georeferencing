import type { ReferenceSelection } from "@georeferencing/matching";
import { createWmsProvider } from "@georeferencing/matching";
import { decodeReferenceImage } from "@georeferencing/matching/browser";

// Browser example: the host owns authentication and the eligible WMS endpoint.
export async function acquirePlanReference(
  endpoint: string,
  selection: ReferenceSelection,
  sourceRevision: string,
  signal?: AbortSignal,
) {
  const provider = createWmsProvider({
    url: endpoint,
    source: {
      id: "engineering-plans", // Opaque identity; never a credential-bearing URL.
      revision: sourceRevision,
      layers: [...selection.layers],
    },
    version: "1.3.0",
    maxPixels: 8_000_000,
    maxTileSize: 1024,
    decode: decodeReferenceImage,
    request: async (url, requestSignal) => {
      const response = await fetch(url, {
        signal: requestSignal,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Reference HTTP ${response.status}`);
      return response.blob();
    },
  });
  return provider.acquire(selection, signal);
}
