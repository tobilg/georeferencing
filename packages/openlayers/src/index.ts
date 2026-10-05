/**
 * OpenLayers map adapter: overlay, control points, residuals, drawing, snapping,
 * reference layers (including WFS GML and borrowed host layers) and map capture.
 * Import from `@georeferencing/openlayers`.
 * @module @georeferencing/openlayers
 * @group @georeferencing/openlayers
 */
import type {
  DatumGrids,
  Definitions,
  Extent,
  GeoreferencerController,
  XY,
} from "@georeferencing/core";
import {
  fail,
  forward,
  project,
  projectExtent,
  registerDatumGrids,
  uid,
} from "@georeferencing/core";
import type {
  MapAdapter,
  MapAdapterOptions,
  MapBinding,
  MapCapture,
  SnapOptions,
} from "@georeferencing/core/map";
import {
  extentToImageView,
  imageViewToExtent,
  sharedProj4,
  subscribeBinding,
  ViewHistory,
  watchReferences,
} from "@georeferencing/core/map";
import type { EventsKey } from "ol/events.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import LineString from "ol/geom/LineString.js";
import Point from "ol/geom/Point.js";
import Draw from "ol/interaction/Draw.js";
import type Interaction from "ol/interaction/Interaction.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import Snap from "ol/interaction/Snap.js";
import ImageLayer from "ol/layer/Image.js";
import VectorLayer from "ol/layer/Vector.js";
import type OLMap from "ol/Map.js";
import { unByKey } from "ol/Observable.js";
import { register } from "ol/proj/proj4.js";
import { get as getProjection } from "ol/proj.js";
import ImageSource from "ol/source/Image.js";
import VectorSource from "ol/source/Vector.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import { toGeographicFeature } from "./geometry.js";
import type { Reference } from "./references.js";
import { loadWfs } from "./references.js";

export type {
  CustomReference,
  GeoJsonReference,
  Query,
  ReferenceSource,
  SnapOptions,
  WfsReference,
} from "@georeferencing/core/map";
export * from "./geometry.js";
export * from "./references.js";

/**
 * Options of the OpenLayers adapter. Keep this object stable: it is read when attaching.
 */
export interface BindingOptions extends MapAdapterOptions<Reference> {
  /**
   * Screen-pixel tolerance used when densifying map geometry into longitude/latitude.
   * @defaultValue `0.25`
   */
  geometryTolerancePx?: number;
}
/** Binding returned by {@link attachReferenceMap}, with access to its owned layers. */
export interface OpenLayersBinding
  extends Required<Omit<MapBinding, "resize">> {
  /** Recompute the map size after its container changed size. */
  resize(): void;
  /**
   * Package-owned layers exposed for display integration; do not persist them or
   * dispose them independently.
   */
  layers: {
    /** Target control-point display layer. */
    gcps: VectorLayer<VectorSource<Feature>>;
    /** Geographic user-drawing display layer. */
    drafts: VectorLayer<VectorSource<Feature>>;
    /** Transformed raster preview layer. */
    preview: ImageLayer<ImageSource>;
  };
}
/**
 * Register host definitions and optional NTv2 grids with proj4 and OpenLayers in the
 * current realm. Supply identical definitions/grids separately to the worker engine.
 */
export function registerProjections(
  definitions: Definitions,
  datumGrids?: DatumGrids,
): void {
  const proj4 = sharedProj4();
  registerDatumGrids(datumGrids);
  for (const [code, definition] of Object.entries(definitions))
    proj4.defs(code, definition);
  // OpenLayers types the instance with proj4's declarations; it is the same object.
  register(proj4 as unknown as Parameters<typeof register>[0]);
}
/**
 * Create a {@link "@georeferencing/core/map".MapAdapter} for an OpenLayers map, for
 * example for the React `Georeferencer`'s `map` prop. Create it once per map and options
 * object (for example with `useMemo`).
 * @param map - Host-owned initialized map.
 * @param options - References, projections, snapping and optional initial framing.
 */
export function openLayers(
  map: OLMap,
  options: BindingOptions = {},
): MapAdapter {
  return (controller) => attachReferenceMap(map, controller, options);
}
/**
 * Capture the currently rendered canvas layers of an OpenLayers map for PDF reports,
 * without changing the view. Does not await outstanding tiles or capture DOM overlays.
 * @param map - Visible initialized host map.
 * @param attribution - Attribution override; defaults to the map's attribution text.
 * @throws {@link "@georeferencing/core".GeoreferenceError} If the viewport is unavailable or a source taints canvas export.
 */
export async function captureOpenLayersMap(
  map: OLMap,
  attribution?: string,
): Promise<MapCapture> {
  map.renderSync();
  const size = map.getSize();
  if (!size || size[0] <= 0 || size[1] <= 0)
    fail("REPORT_MAP", "Map has no visible viewport.");
  const canvas = document.createElement("canvas");
  canvas.width = size![0];
  canvas.height = size![1];
  const context = canvas.getContext("2d")!;
  try {
    for (const layer of map
      .getViewport()
      .querySelectorAll<HTMLCanvasElement>(".ol-layer canvas")) {
      if (!layer.width || !layer.height) continue;
      context.save();
      context.globalAlpha = Number(
        layer.parentElement?.style.opacity || layer.style.opacity || 1,
      );
      const transform = layer.style.transform;
      if (transform && transform !== "none")
        context.setTransform(new DOMMatrix(transform));
      else
        context.scale(
          parseFloat(layer.style.width || String(layer.width)) / layer.width,
          parseFloat(layer.style.height || String(layer.height)) / layer.height,
        );
      context.drawImage(layer, 0, 0);
      context.restore();
    }
    const image = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(Error("Could not encode the map.")),
          "image/png",
        );
      } catch (error) {
        reject(error);
      }
    }).catch(() =>
      fail(
        "REPORT_CORS",
        "A map layer prevents canvas export. Configure CORS on its source, or generate the report without the map frame.",
      ),
    );
    const view = map.getView();
    return {
      image,
      crs: view.getProjection().getCode(),
      extent: view.calculateExtent(size) as Extent,
      rotation: view.getRotation(),
      attribution:
        attribution ??
        map.getViewport().querySelector(".ol-attribution")?.textContent ??
        undefined,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
/**
 * Attach package-owned overlay, GCP, residual and draft layers/interactions to an existing OpenLayers map.
 *
 * Call only in a browser after map creation. Borrowed layers are read without taking ownership. Detach removes owned resources and aborts reference requests while preserving the host map, layers and view. Prefer {@link openLayers} with the React `Georeferencer`, which attaches its own binding.
 *
 * Invalid projection definitions or datum grids throw before any resource is attached. Later failures, such as an unknown map projection or a control point that cannot be projected, are reported through the controller error state instead of throwing.
 * @param map - Host-owned initialized map.
 * @param controller - Authoritative editor store.
 * @param options - Providers, projections, snapping and optional initial framing.
 * @returns Binding controls and an idempotent detach method.
 */
export function attachReferenceMap(
  map: OLMap,
  controller: GeoreferencerController,
  options: BindingOptions = {},
): OpenLayersBinding {
  const definitions = options.definitions ?? {},
    format = new GeoJSON();
  registerProjections(definitions, options.datumGrids);
  const gcps = new VectorSource<Feature>(),
    drafts = new VectorSource<Feature>(),
    residuals = new VectorSource<Feature>();
  const pointStyle = (feature: Feature) =>
    new Style({
      image: new Circle({
        radius: 6,
        fill: new Fill({ color: "#faf9ed" }),
        stroke: new Stroke({
          color: feature.get("enabled") === false ? "#666" : "#c95722",
          width: 2,
        }),
      }),
      text: new Text({
        text: String(feature.get("label") ?? ""),
        offsetY: -16,
        fill: new Fill({ color: "#182d2a" }),
        stroke: new Stroke({ color: "#fff", width: 3 }),
      }),
    });
  const gcpLayer = new VectorLayer({
    source: gcps,
    style: (feature) => pointStyle(feature as Feature),
    zIndex: 1003,
  });
  const draftLayer = new VectorLayer({
    source: drafts,
    style: new Style({
      image: new Circle({
        radius: 6,
        fill: new Fill({ color: "#12695b" }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
      stroke: new Stroke({ color: "#12695b", width: 3 }),
      fill: new Fill({ color: "#12695b25" }),
    }),
    zIndex: 1002,
  });
  const residualLayer = new VectorLayer({
    source: residuals,
    style: new Style({
      stroke: new Stroke({ color: "#b93232", width: 2, lineDash: [3, 3] }),
    }),
    zIndex: 1001,
  });
  const previewLayer = new ImageLayer<ImageSource>({ zIndex: 999 });
  let previewCanvas: HTMLCanvasElement | null = null;
  const releasePreview = () => {
    previewLayer.getSource()?.dispose();
    previewLayer.setSource(null);
    if (previewCanvas) previewCanvas.width = previewCanvas.height = 0;
    previewCanvas = null;
  };
  const owned = [previewLayer, residualLayer, draftLayer, gcpLayer];
  owned.forEach((layer) => {
    map.addLayer(layer);
  });
  const keys: EventsKey[] = [],
    referenceSources = new Map<string, VectorSource<Feature>>(),
    ownedReferences: VectorLayer<VectorSource<Feature>>[] = [];
  const snapSources: {
    id: string;
    source: VectorSource<Feature>;
    options: SnapOptions;
  }[] = [];
  let detached = false,
    projection = map.getView().getProjection().getCode();
  const ensureProjection = () => {
    const code = map.getView().getProjection().getCode();
    if (!getProjection(code)) fail("CRS", `Unknown map projection ${code}`);
    return code;
  };
  const loaded: Exclude<Reference, { kind: "existing-vector" }>[] = [];
  for (const provider of options.references ?? []) {
    const source =
      provider.kind === "existing-vector"
        ? provider.layer.getSource()
        : new VectorSource<Feature>();
    if (!source) continue;
    if (provider.snapping)
      snapSources.push({ id: provider.id, source, options: provider.snapping });
    if (provider.kind === "existing-vector") {
      controller.setReferenceStatus(provider.id, {
        label: provider.label,
        state: "ready",
      });
      options.onReferenceStatus?.(provider.id, { state: "ready" });
      continue;
    }
    const layer = new VectorLayer({
      source,
      zIndex: 998,
      style: new Style({
        stroke: new Stroke({ color: "#758981", width: 1.5 }),
        fill: new Fill({ color: "#75898112" }),
        image: new Circle({ radius: 4, fill: new Fill({ color: "#758981" }) }),
      }),
    });
    map.addLayer(layer);
    ownedReferences.push(layer);
    referenceSources.set(provider.id, source);
    loaded.push(provider);
  }
  const references = watchReferences<(typeof loaded)[number], Feature[]>(
    loaded,
    {
      controller,
      definitions,
      debounceMs: options.debounceMs,
      onStatus: options.onReferenceStatus,
      view: () => {
        const view = map.getView();
        return {
          extent: view.calculateExtent(map.getSize()) as Extent,
          crs: ensureProjection(),
          resolution: view.getResolution() ?? 1,
        };
      },
      async load(provider, query) {
        const mapCrs = ensureProjection();
        if (provider.kind === "geojson")
          return {
            data: format.readFeatures(provider.data, {
              dataProjection: provider.crs,
              featureProjection: mapCrs,
            }),
            partial: false,
          };
        if (!query) return null;
        if (provider.kind === "wfs") {
          const result = await loadWfs(provider, query, mapCrs);
          return { ...result, data: result.features };
        }
        const custom = await provider.load(query);
        return {
          data: format.readFeatures(custom.data, {
            dataProjection: custom.crs,
            featureProjection: mapCrs,
          }),
          partial: custom.partial,
          message: custom.message,
        };
      },
      apply(provider, features) {
        const source = referenceSources.get(provider.id)!;
        source.clear();
        if (features) source.addFeatures(features);
      },
    },
  );
  keys.push(map.on("moveend", () => references.refreshViewport()));
  let active: Interaction[] = [],
    interactionKeys: EventsKey[] = [],
    previousTool = "",
    draw: Draw | undefined;
  const clearInteractions = () => {
    unByKey(interactionKeys);
    interactionKeys = [];
    draw?.abortDrawing();
    for (const i of active) {
      map.removeInteraction(i);
      i.dispose();
    }
    active = [];
    draw = undefined;
  };
  const addInteraction = (i: Interaction) => {
    active.push(i);
    map.addInteraction(i);
  };
  const snapPoint = (
    coordinate: XY,
  ): { point: XY; reference?: { sourceId: string; featureId?: string } } => {
    const pixel = map.getPixelFromCoordinate(coordinate);
    let nearest: XY = coordinate,
      reference: { sourceId: string; featureId?: string } | undefined,
      best = Infinity;
    for (const item of snapSources) {
      const tolerance = item.options.tolerancePx ?? 10,
        resolution = map.getView().getResolution() ?? 1,
        extent = [
          coordinate[0] - resolution * tolerance,
          coordinate[1] - resolution * tolerance,
          coordinate[0] + resolution * tolerance,
          coordinate[1] + resolution * tolerance,
        ];
      for (const f of item.source.getFeaturesInExtent(extent)) {
        const geometry = f.getGeometry();
        if (!geometry) continue;
        const candidates: XY[] = [];
        if (item.options.edges)
          candidates.push(geometry.getClosestPoint(coordinate) as XY);
        if (item.options.vertices !== false) {
          const json = format.writeGeometryObject(geometry);
          const collect = (p: unknown) => {
            if (Array.isArray(p)) {
              if (typeof p[0] === "number")
                candidates.push(p.slice(0, 2) as XY);
              else p.forEach(collect);
            }
          };
          if ("coordinates" in json) collect(json.coordinates);
        }
        for (const p of candidates) {
          const test = map.getPixelFromCoordinate(p),
            distance = Math.hypot(test[0] - pixel[0], test[1] - pixel[1]);
          if (distance <= tolerance && distance < best) {
            nearest = p;
            best = distance;
            reference = { sourceId: item.id, featureId: f.getId()?.toString() };
          }
        }
      }
    }
    return { point: [...nearest], reference };
  };
  keys.push(
    map.on("singleclick", (e) => {
      const s = controller.getSnapshot();
      if (s.tool !== "gcp" || !s.pendingImagePoint) return;
      try {
        const snapped = snapPoint(e.coordinate as XY);
        controller.addGcp(
          s.pendingImagePoint,
          project(
            snapped.point,
            ensureProjection(),
            s.document.workingCrs,
            definitions,
          ),
          s.document.workingCrs,
          snapped.reference,
        );
      } catch (e) {
        controller.reportError(e);
      }
    }),
  );
  let oldDoc: unknown,
    oldPreview: unknown,
    oldImageView: unknown,
    oldLink: unknown;
  const update = (errors: unknown[]) => {
    const s = controller.getSnapshot(),
      mapCrs = ensureProjection();
    if (
      s.fit &&
      s.linkedNavigation === "image-to-map" &&
      s.imageView &&
      (oldImageView !== s.imageView || oldLink !== s.linkedNavigation)
    ) {
      const extent = imageViewToExtent(
        s.fit,
        s.imageView,
        s.document.workingCrs,
        mapCrs,
        definitions,
      );
      if (extent) map.getView().fit(extent);
    }
    oldImageView = s.imageView;
    oldLink = s.linkedNavigation;
    if (mapCrs !== projection) {
      projection = mapCrs;
      oldDoc = null;
      references.refreshAll();
    }
    if (oldDoc !== s.document || oldPreview !== s.preview) {
      oldDoc = s.document;
      gcps.clear();
      residuals.clear();
      for (const gcp of s.document.gcps) {
        try {
          const point = project(gcp.target, gcp.crs, mapCrs, definitions),
            f = new Feature({
              geometry: new Point(point),
              label: gcp.label,
              enabled: gcp.enabled,
            });
          f.setId(gcp.id);
          gcps.addFeature(f);
          if (s.fit && gcp.enabled)
            residuals.addFeature(
              new Feature(
                new LineString([
                  point,
                  project(
                    forward(s.fit, gcp.image),
                    s.document.workingCrs,
                    mapCrs,
                    definitions,
                  ),
                ]),
              ),
            );
        } catch (e) {
          errors.push(e);
        }
      }
      drafts.clear();
      drafts.addFeatures(
        format.readFeatures(s.document.features, {
          dataProjection: "EPSG:4326",
          featureProjection: mapCrs,
        }),
      );
    }
    if (oldPreview !== s.preview) {
      oldPreview = s.preview;
      releasePreview();
      if (s.preview) {
        const r = s.preview,
          canvas = document.createElement("canvas");
        canvas.width = r.width;
        canvas.height = r.height;
        canvas
          .getContext("2d")!
          .putImageData(
            new ImageData(
              r.data as Uint8ClampedArray<ArrayBuffer>,
              r.width,
              r.height,
            ),
            0,
            0,
          );
        previewCanvas = canvas;
        const rx = (r.bounds[2] - r.bounds[0]) / r.width,
          ry = (r.bounds[3] - r.bounds[1]) / r.height;
        // A zero-argument loader is static: the canvas is used directly, without
        // encoding a PNG data URL on the main thread.
        previewLayer.setSource(
          new ImageSource({
            loader: () =>
              Promise.resolve({
                image: canvas,
                extent: r.bounds,
                resolution: rx === ry ? ry : [rx, ry],
                pixelRatio: 1,
              }),
            projection: r.crs,
            interpolate: true,
          }),
        );
      }
    }
    previewLayer.setOpacity(s.opacity);
    previewLayer.setVisible(s.visible);
    // Crosshair while map clicks place control points or vertices, like the image viewer.
    const crosshair =
      (s.tool === "gcp" && s.mode === "align") ||
      (s.mode === "draw" &&
        ["Point", "LineString", "Polygon"].includes(s.tool));
    viewport.style.cursor = crosshair ? "crosshair" : hostCursor;
    const toolKey = `${s.tool}/${s.mode}/${mapCrs}`;
    if (toolKey === previousTool) return;
    previousTool = toolKey;
    clearInteractions();
    if (s.tool === "gcp") {
      const modify = new Modify({ source: gcps });
      addInteraction(modify);
      interactionKeys.push(
        modify.on("modifyend", (e) => {
          try {
            for (const f of e.features.getArray()) {
              const workingCrs = controller.getSnapshot().document.workingCrs;
              controller.updateGcp(String(f.getId()), {
                target: project(
                  (f.getGeometry() as Point).getCoordinates() as XY,
                  mapCrs,
                  workingCrs,
                  definitions,
                ),
                crs: workingCrs,
              });
            }
          } catch (error) {
            // Restore the dragged marker to its committed position.
            oldDoc = null;
            binding.sync();
            controller.reportError(error);
          }
        }),
      );
    } else if (
      s.mode === "draw" &&
      ["Point", "LineString", "Polygon"].includes(s.tool)
    ) {
      draw = new Draw({
        type: s.tool as "Point" | "LineString" | "Polygon",
        stopClick: true,
      });
      addInteraction(draw);
      interactionKeys.push(
        draw.on("drawend", (e) => {
          try {
            const f = toGeographicFeature(
              e.feature,
              mapCrs,
              (map.getView().getResolution() ?? 1) *
                (options.geometryTolerancePx ?? 0.25),
              definitions,
            );
            f.id = uid();
            f.properties ??= {};
            controller.setFeatures({
              type: "FeatureCollection",
              features: [
                ...controller.getSnapshot().document.features.features,
                f,
              ],
            });
          } catch (e) {
            controller.reportError(e);
          }
        }),
      );
    } else if (s.mode === "draw" && s.tool === "modify") {
      const select = new Select({ layers: [draftLayer] }),
        modify = new Modify({ features: select.getFeatures() });
      addInteraction(select);
      addInteraction(modify);
      interactionKeys.push(
        modify.on("modifyend", () => {
          try {
            controller.setFeatures({
              type: "FeatureCollection",
              features: drafts
                .getFeatures()
                .map((f) =>
                  toGeographicFeature(
                    f,
                    mapCrs,
                    (map.getView().getResolution() ?? 1) *
                      (options.geometryTolerancePx ?? 0.25),
                    definitions,
                  ),
                ),
            });
          } catch (e) {
            oldDoc = null;
            binding.sync();
            controller.reportError(e);
          }
        }),
      );
    }
    if (s.tool === "gcp" || (s.mode === "draw" && s.tool !== "navigate")) {
      if (s.tool === "gcp" || options.digitizingSnapping?.references)
        for (const item of snapSources)
          addInteraction(
            new Snap({
              source: item.source,
              vertex: item.options.vertices !== false,
              edge: item.options.edges ?? false,
              pixelTolerance: item.options.tolerancePx ?? 10,
            }),
          );
      if (s.mode === "draw" && options.digitizingSnapping?.drafts)
        addInteraction(new Snap({ source: drafts }));
    }
  };
  const viewport = map.getViewport(),
    hostCursor = viewport.style.cursor;
  const binding = subscribeBinding(controller, update);
  const targetElement = map.getTargetElement();
  const keydown = (event: KeyboardEvent) => {
    const tool = controller.getSnapshot().tool;
    if (event.key === "Escape" && tool !== "navigate") {
      draw?.abortDrawing();
      controller.cancelPending();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === "Enter" && draw) {
      draw.finishDrawing();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  targetElement?.addEventListener("keydown", keydown);
  keys.push(map.on("change:view", () => binding.sync()));
  keys.push(
    map.on("moveend", () => {
      const s = controller.getSnapshot();
      if (!s.fit || s.linkedNavigation !== "map-to-image") return;
      try {
        const view = extentToImageView(
          s.fit,
          map.getView().calculateExtent(map.getSize()) as Extent,
          ensureProjection(),
          s.document.workingCrs,
          definitions,
        );
        if (view) controller.setImageView(view);
      } catch (e) {
        controller.reportError(e);
      }
    }),
  );
  if (options.initialView)
    try {
      map
        .getView()
        .fit(
          projectExtent(
            options.initialView.extent,
            options.initialView.crs,
            projection,
            definitions,
          ),
        );
    } catch (error) {
      // Attachment has already added owned resources; report instead of leaking them.
      controller.reportError(error);
    }
  const history = new ViewHistory<{
    center: number[];
    resolution: number;
    rotation: number;
  }>();
  let restoring = false;
  const remember = () => {
    if (restoring) {
      restoring = false;
      return;
    }
    const v = map.getView();
    if (!v.getCenter() || !v.getResolution()) return;
    history.record({
      center: [...v.getCenter()!],
      resolution: v.getResolution()!,
      rotation: v.getRotation(),
    });
  };
  remember();
  keys.push(map.on("moveend", remember));
  keys.push(
    map.on("change:view", () => {
      history.clear();
      restoring = false;
      remember();
    }),
  );
  return {
    layers: { gcps: gcpLayer, drafts: draftLayer, preview: previewLayer },
    fitOverlay() {
      const r = controller.getSnapshot().preview;
      if (r)
        map
          .getView()
          .fit(
            projectExtent(r.bounds, r.crs, ensureProjection(), definitions),
            { padding: [30, 30, 30, 30] },
          );
    },
    navigateHistory(direction: -1 | 1) {
      const h = history.step(direction);
      if (!h) return;
      restoring = true;
      const v = map.getView();
      v.setCenter(h.center);
      v.setResolution(h.resolution);
      v.setRotation(h.rotation);
    },
    cancelDrawing() {
      draw?.abortDrawing();
      controller.cancelPending();
    },
    finishDrawing() {
      draw?.finishDrawing();
    },
    resize() {
      map.updateSize();
    },
    capture: () => captureOpenLayersMap(map),
    detach() {
      if (detached) return;
      detached = true;
      binding.unsubscribe();
      references.dispose();
      for (const provider of options.references ?? [])
        controller.setReferenceStatus(provider.id, null);
      targetElement?.removeEventListener("keydown", keydown);
      unByKey(keys);
      clearInteractions();
      releasePreview();
      viewport.style.cursor = hostCursor;
      for (const layer of [...owned, ...ownedReferences]) {
        map.removeLayer(layer);
        const source = layer.getSource();
        source?.dispose();
        layer.dispose();
      }
    },
  };
}
