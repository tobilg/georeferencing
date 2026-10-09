/**
 * Optional browser-only OpenLayers reference acquisition for image matching.
 * This entry captures selected source pixels; candidate styling, overlays and all
 * review controls belong to the host application. It is never loaded by the root API.
 * @module @georeferencing/matching/openlayers
 * @group @georeferencing/matching
 */
import type Feature from "ol/Feature.js";
import type BaseLayer from "ol/layer/Base.js";
import VectorLayer from "ol/layer/Vector.js";
import OLMap from "ol/Map.js";
import { unByKey } from "ol/Observable.js";
import ImageWMS from "ol/source/ImageWMS.js";
import type Source from "ol/source/Source.js";
import TileWMS from "ol/source/TileWMS.js";
import VectorSource from "ol/source/Vector.js";
import View from "ol/View.js";
import { decodeReferenceImage } from "./browser.js";
import { validateSearchExtent } from "./geometry.js";
import { createSnapshot, createWmsProvider } from "./reference.js";
import type {
  ReferenceProvider,
  ReferenceSelection,
  ReferenceSource,
} from "./types.js";
import { MatchingError } from "./types.js";
/** Host-owned source layer eligible for reference acquisition. */
export interface OpenLayersReference {
  /** Opaque layer identity selected through `ReferenceSelection.layers`. */
  id: string;
  /** Borrowed ImageWMS/TileWMS layer or loaded vector layer; never disposed by the provider. */
  layer: BaseLayer;
  /** Content/style revision; change it when data, filters, time or styling changes. */
  revision: string;
}
/**
 * Create a provider for one WMS source or selected, already-loaded vector layers.
 *
 * WMS uses the configured server layers/styles/parameters and exact-extent
 * requests. Vectors/WFS clone current features/styles into an isolated north-up
 * map with pixel ratio 1; feature loaders are not run. Wait for host loading before
 * acquisition, and use deterministic style callbacks independent of mutable state.
 * Editor overlays and unrelated layers are excluded. Temporary maps, canvases and
 * cloned layers are cleaned up after acquisition; host layers remain borrowed.
 *
 * @param references - Configured eligible layers with opaque IDs and revisions.
 * @param request - Optional authenticated WMS request callback; defaults to fetch.
 * @returns Browser-only pixel provider; matching itself can also run in Node.
 * @throws Acquisition rejects with `SOURCE` for unsupported/mixed renderers,
 * unready vectors, CORS/readback failures, unaligned vector bounds or rendering
 * timeout (15 seconds). Vector captures above 8 MP/8192 pixels per side reject
 * with `BUDGET`. Abort cancels capture. Other renderers require a host provider.
 */
export function createOpenLayersProvider(
  references: OpenLayersReference[],
  request?: (url: string, signal?: AbortSignal) => Promise<Blob>,
): ReferenceProvider {
  return {
    async acquire(selection, signal) {
      selection = structuredClone(selection);
      validateSearchExtent(selection.extent, selection.crs);
      const selected = selection.layers.map((id) =>
        references.find((r) => r.id === id),
      );
      if (selected.some((r) => !r) || !selected.length)
        throw new MatchingError(
          "SOURCE",
          "Select configured reference layers.",
        );
      const source = (
        selected[0]!.layer as BaseLayer & { getSource(): Source | null }
      ).getSource();
      if (source instanceof ImageWMS || source instanceof TileWMS) {
        if (selected.length !== 1)
          throw new MatchingError(
            "SOURCE",
            "Select one WMS source with its configured server layers, or supply a compositing host provider.",
          );
        const params = { ...source.getParams() },
          url =
            source instanceof ImageWMS
              ? source.getUrl()
              : source.getUrls()?.[0];
        if (!url)
          throw new MatchingError("SOURCE", "WMS has no configured URL.");
        const layers = String(params.LAYERS ?? "").split(","),
          styles = String(params.STYLES ?? "").split(",");
        const provenance: ReferenceSource = {
          id: selected[0]!.id,
          revision: selected[0]!.revision,
          layers,
          styles,
          parameters: Object.fromEntries(
            ["TIME", "ELEVATION", "CQL_FILTER", "FILTER", "SLD_BODY"]
              .filter((k) => params[k] !== undefined)
              .map((k) => [k, String(params[k])]),
          ),
        };
        return createWmsProvider({
          url,
          source: provenance,
          parameters: params,
          version: params.VERSION ?? "1.3.0",
          request,
          decode: decodeReferenceImage,
        }).acquire({ ...selection, layers }, signal);
      }
      const layers = selected.map((r) => {
        const layer = r!.layer;
        if (
          !(layer instanceof VectorLayer) ||
          !(layer.getSource() instanceof VectorSource) ||
          layer.getSource()!.getState() !== "ready" ||
          layer.getSource()!.loading
        )
          throw new MatchingError(
            "SOURCE",
            "Native matching supports ready WMS or loaded vector layers. Supply a host pixel provider for other renderers.",
          );
        return new VectorLayer({
          source: new VectorSource({
            features: layer
              .getSource()!
              .getFeatures()
              .map((f: Feature) => {
                const copy = f.clone();
                copy.setId(f.getId());
                return copy;
              }),
          }),
          style: layer.getStyle(),
          opacity: layer.getOpacity(),
        });
      });
      const [x0, y0, x1, y1] = selection.extent,
        width = Math.ceil((x1 - x0) / selection.resolution - 1e-7),
        height = Math.ceil((y1 - y0) / selection.resolution - 1e-7);
      if (
        !(width > 0 && height > 0) ||
        width * height > 8_000_000 ||
        width > 8192 ||
        height > 8192
      ) {
        layers.forEach((l) => {
          l.getSource()?.dispose();
          l.dispose();
        });
        throw new MatchingError(
          "BUDGET",
          "Rendered vector reference is limited to 8 MP / 8192 pixels per side; reduce extent or resolution.",
        );
      }
      if (
        Math.abs(width * selection.resolution - (x1 - x0)) >
          selection.resolution * 1e-6 ||
        Math.abs(height * selection.resolution - (y1 - y0)) >
          selection.resolution * 1e-6
      ) {
        layers.forEach((layer) => {
          layer.getSource()?.dispose();
          layer.dispose();
        });
        throw new MatchingError(
          "SOURCE",
          "For native vector capture, align the selected extent to the resolution pixel grid (Use current map area), or use a host pixel provider.",
        );
      }
      const target = document.createElement("div");
      Object.assign(target.style, {
        position: "fixed",
        left: "-20000px",
        top: "0",
        width: `${width}px`,
        height: `${height}px`,
      });
      document.body.append(target);
      const map = new OLMap({
        target,
        layers,
        controls: [],
        interactions: [],
        pixelRatio: 1,
        view: new View({
          projection: selection.crs,
          center: [(x0 + x1) / 2, (y0 + y1) / 2],
          resolution: Math.max((x1 - x0) / width, (y1 - y0) / height),
          rotation: 0,
        }),
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            unByKey(key);
            signal?.removeEventListener("abort", abort);
          };
          const abort = () => {
            cleanup();
            reject(new DOMException("Reference cancelled", "AbortError"));
          };
          const key = map.once("rendercomplete", () => {
            cleanup();
            resolve();
          });
          const timer = setTimeout(() => {
            cleanup();
            reject(
              new MatchingError(
                "SOURCE",
                "Reference layers did not finish rendering.",
              ),
            );
          }, 15000);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
          else map.renderSync();
        });
        const actualExtent = map.getView().calculateExtent([width, height]);
        if (
          actualExtent.some(
            (value, i) =>
              Math.abs(value - selection.extent[i]) >
              selection.resolution * 1e-6,
          )
        )
          throw new MatchingError(
            "SOURCE",
            "Map view constraints changed the selected search extent; use a supported extent/resolution or a host pixel provider.",
          );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        for (const sourceCanvas of target.querySelectorAll<HTMLCanvasElement>(
          ".ol-layer canvas",
        )) {
          ctx.save();
          ctx.globalAlpha = Number(
            sourceCanvas.parentElement?.style.opacity || 1,
          );
          const matrix = new DOMMatrix(sourceCanvas.style.transform);
          ctx.setTransform(matrix);
          ctx.drawImage(sourceCanvas, 0, 0);
          ctx.restore();
        }
        const data = ctx.getImageData(0, 0, width, height).data,
          p0 = map.getCoordinateFromPixel([0, 0])!,
          px = map.getCoordinateFromPixel([1, 0])!,
          py = map.getCoordinateFromPixel([0, 1])!;
        // Preserve the actual mapping (rounding dimensions may make it differ from requested BBOX).
        return createSnapshot({
          id: crypto.randomUUID(),
          width,
          height,
          crs: selection.crs,
          extent: actualExtent as [number, number, number, number],
          pixelToMap: [
            px[0] - p0[0],
            py[0] - p0[0],
            p0[0],
            px[1] - p0[1],
            py[1] - p0[1],
            p0[1],
            0,
            0,
            1,
          ],
          source: {
            id: selected.map((r) => r!.id).join(","),
            revision: selected.map((r) => r!.revision).join(","),
            layers: selection.layers,
          },
          tiles: [{ x: 0, y: 0, width, height, data }],
        });
      } catch (error) {
        signal?.throwIfAborted();
        throw new MatchingError(
          "SOURCE",
          `Cannot read selected reference pixels; check CORS and layer readiness. ${String(error)}`,
        );
      } finally {
        map.setTarget(undefined);
        map.dispose();
        target.remove();
        for (const layer of layers) {
          layer.getSource()?.dispose();
          layer.dispose();
        }
      }
    },
  };
}
/**
 * Read the current map view's bounds, CRS and resolution as a search selection.
 *
 * @param map - Host map with a visible, nonzero viewport and initialized view.
 * @param layers - Eligible provider IDs selected by the host, in rendering order.
 * @returns View extent in XY map coordinates and map units per reference pixel.
 * A rotated view yields its axis-aligned bounding box; no pixels are captured.
 * Hosts must show/confirm the actual selection and retain it for the matching job.
 */
export function openLayersSelection(
  map: OLMap,
  layers: string[],
): ReferenceSelection {
  const extent = map.getView().calculateExtent(map.getSize()) as [
    number,
    number,
    number,
    number,
  ];
  return {
    extent,
    crs: map.getView().getProjection().getCode(),
    resolution: map.getView().getResolution()!,
    layers,
  };
}
