/**
 * Owned-layer integration with host maps, reference providers and WFS discovery.
 * Import from `@georeferencing/core/openlayers`.
 * @module @georeferencing/core/openlayers
 * @group @georeferencing/core
 */
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
import proj4 from "proj4";
import type { GeoreferencerController } from "../core/controller.js";
import type { DatumGrids, Definitions } from "../core/projection.js";
import {
  project,
  projectExtent,
  registerDatumGrids,
} from "../core/projection.js";
import { backward, forward } from "../core/transform.js";
import type { Extent, XY } from "../core/types.js";
import { fail, uid } from "../core/types.js";
import { ViewHistory } from "../core/view-history.js";
import { toGeographicFeature } from "./geometry.js";
import type { Reference, SnapOptions } from "./references.js";
import { loadWfs, queryBounds } from "./references.js";

export * from "./geometry.js";
export * from "./references.js";

/**
 * Attachment configuration for a host-owned OpenLayers map. Keep this object stable when
 * used as a React prop to avoid unnecessary reattachment.
 */
export interface BindingOptions {
  /** Distinct provider configurations; borrowed layers remain entirely host-owned. */
  references?: Reference[];
  /**
   * Projection definitions registered with proj4 and OpenLayers for map/reference
   * conversion.
   */
  definitions?: Definitions;
  /**
   * Host-supplied NTv2 buffers registered in this realm; also supply them to the worker
   * engine.
   */
  datumGrids?: DatumGrids;
  /**
   * Delay before refreshing network references after map navigation, in milliseconds.
   * @defaultValue `150`
   */
  debounceMs?: number;
  /**
   * Optional map framing applied on attachment. It does not georeference the image or
   * constrain queries, drawings or output.
   */
  initialView?: {
    /** Initial map framing bounds. */
    extent: Extent;
    /** CRS of the framing extent. */
    crs: string;
  };
  /**
   * Opt-in snapping for drawing/modify tools, independently of GCP reference snapping.
   */
  digitizingSnapping?: {
    /**
     * Snap drawings to providers with snapping configured.
     * @defaultValue `false`
     */
    references?: boolean;
    /**
     * Snap drawings to the editor's other draft features.
     * @defaultValue `false`
     */
    drafts?: boolean;
  };
  /**
   * Screen-pixel tolerance used when densifying map geometry into longitude/latitude.
   * @defaultValue `0.25`
   */
  geometryTolerancePx?: number;
  /**
   * Observe provider loading/error/completeness feedback; statuses also appear in the
   * controller snapshot.
   */
  onReferenceStatus?: (
    id: string,
    status: {
      /** Latest provider request state. */
      state: "loading" | "ready" | "error";
      /** Whether service behavior or budgets caused incomplete results. */
      partial?: boolean;
      /** Optional provider explanation. */
      message?: string;
    },
  ) => void;
}
/**
 * Register host definitions and optional NTv2 grids with proj4 and OpenLayers in the
 * current realm. Supply identical definitions/grids separately to the worker engine.
 */
export function registerProjections(
  definitions: Definitions,
  datumGrids?: DatumGrids,
): void {
  registerDatumGrids(datumGrids);
  for (const [code, definition] of Object.entries(definitions))
    proj4.defs(code, definition);
  register(proj4);
}
/**
 * Attach package-owned overlay, GCP, residual and draft layers/interactions to an existing OpenLayers map.
 *
 * Call only in a browser after map creation. Borrowed layers are read without taking ownership. Detach removes owned resources and aborts reference requests while preserving the host map, layers and view. Do not combine this with the ready-made Georeferencer on the same controller/map: that component attaches its own binding.
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
) {
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
  const previewLayer = new ImageLayer({ zIndex: 999 });
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
    ownedReferences: VectorLayer<VectorSource<Feature>>[] = [];
  const snapSources: {
    id: string;
    source: VectorSource<Feature>;
    options: SnapOptions;
  }[] = [];
  const refreshers: (() => void)[] = [],
    cancellations: (() => void)[] = [];
  let detached = false,
    projection = map.getView().getProjection().getCode();
  const ensureProjection = () => {
    const code = map.getView().getProjection().getCode();
    if (!getProjection(code)) fail("CRS", `Unknown map projection ${code}`);
    return code;
  };
  const referenceStatus = (
    provider: Reference,
    status: {
      state: "loading" | "ready" | "error";
      partial?: boolean;
      message?: string;
    },
  ) => {
    controller.setReferenceStatus(provider.id, {
      label: provider.label,
      ...status,
    });
    options.onReferenceStatus?.(provider.id, status);
  };
  for (const provider of options.references ?? []) {
    const source =
      provider.kind === "existing-vector"
        ? provider.layer.getSource()
        : new VectorSource<Feature>();
    if (!source) continue;
    if (provider.snapping)
      snapSources.push({ id: provider.id, source, options: provider.snapping });
    if (provider.kind === "existing-vector") {
      referenceStatus(provider, { state: "ready" });
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
    let abort: AbortController | undefined,
      generation = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal,
        current = ++generation;
      referenceStatus(provider, { state: "loading" });
      try {
        const mapCrs = ensureProjection(),
          view = map.getView();
        let result: { features: Feature[]; partial: boolean; message?: string };
        if (provider.kind === "geojson")
          result = {
            features: format.readFeatures(provider.data, {
              dataProjection: provider.crs,
              featureProjection: mapCrs,
            }),
            partial: false,
          };
        else {
          const extent = queryBounds(
            provider,
            view.calculateExtent(map.getSize()) as Extent,
            mapCrs,
            definitions,
          );
          if (!extent) result = { features: [], partial: false };
          else {
            const query = {
              extent,
              crs:
                provider.kind === "wfs"
                  ? provider.requestCrs
                  : provider.queryCrs,
              resolution: view.getResolution() ?? 1,
              signal,
            };
            if (provider.kind === "wfs")
              result = await loadWfs(provider, query, mapCrs);
            else {
              const custom = await provider.load(query);
              result = {
                features: format.readFeatures(custom.data, {
                  dataProjection: custom.crs,
                  featureProjection: mapCrs,
                }),
                partial: custom.partial,
                message: custom.message,
              };
            }
          }
        }
        if (detached || current !== generation || signal.aborted) return;
        source.clear();
        source.addFeatures(result.features);
        referenceStatus(provider, {
          state: "ready",
          partial: result.partial,
          message: result.message,
        });
      } catch (e) {
        if (!detached && current === generation && !signal.aborted) {
          source.clear();
          referenceStatus(provider, {
            state: "error",
            message: String(e),
          });
        }
      }
    };
    const schedule = () => {
      abort?.abort();
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void load(), options.debounceMs ?? 150);
    };
    refreshers.push(schedule);
    if (provider.kind !== "geojson" && provider.loading !== "fixed")
      keys.push(map.on("moveend", schedule));
    cancellations.push(() => {
      abort?.abort();
      generation++;
      clearTimeout(timer);
    });
    schedule();
  }
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
  // Reporting an error emits a snapshot, which would re-enter sync. Errors are therefore
  // reported after the update, without re-entry, and only when the failure changes.
  let reporting = false,
    reported: string | null = null;
  const sync = () => {
    if (detached || reporting) return;
    const errors: unknown[] = [];
    try {
      update(errors);
    } catch (e) {
      errors.push(e);
    }
    const message = errors.length ? String(errors[0]) : null;
    // Re-report a persisting failure only after a later edit has cleared the error.
    if (
      message === null ||
      (message === reported && controller.getSnapshot().error !== null)
    ) {
      reported = message;
      return;
    }
    reported = message;
    reporting = true;
    try {
      controller.reportError(errors[0]);
    } finally {
      reporting = false;
    }
  };
  const update = (errors: unknown[]) => {
    const s = controller.getSnapshot(),
      mapCrs = ensureProjection();
    if (
      s.fit &&
      s.linkedNavigation === "image-to-map" &&
      s.imageView &&
      (oldImageView !== s.imageView || oldLink !== s.linkedNavigation)
    ) {
      const [x, y, w, h] = s.imageView,
        points: XY[] = [];
      for (let i = 0; i <= 16; i++)
        for (const p of [
          [x + (w * i) / 16, y],
          [x + (w * i) / 16, y + h],
          [x, y + (h * i) / 16],
          [x + w, y + (h * i) / 16],
        ])
          points.push(
            project(
              forward(s.fit, p as XY),
              s.document.workingCrs,
              mapCrs,
              definitions,
            ),
          );
      if (points.flat().every(Number.isFinite))
        map
          .getView()
          .fit([
            Math.min(...points.map((p) => p[0])),
            Math.min(...points.map((p) => p[1])),
            Math.max(...points.map((p) => p[0])),
            Math.max(...points.map((p) => p[1])),
          ]);
    }
    oldImageView = s.imageView;
    oldLink = s.linkedNavigation;
    if (mapCrs !== projection) {
      projection = mapCrs;
      oldDoc = null;
      refreshers.forEach((fn) => {
        fn();
      });
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
            sync();
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
            sync();
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
  const unsubscribe = controller.subscribe(sync);
  sync();
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
  keys.push(map.on("change:view", sync));
  keys.push(
    map.on("moveend", () => {
      const s = controller.getSnapshot();
      if (!s.fit || s.linkedNavigation !== "map-to-image") return;
      try {
        const extent = projectExtent(
            map.getView().calculateExtent(map.getSize()) as Extent,
            ensureProjection(),
            s.document.workingCrs,
            definitions,
          ),
          points: XY[] = [];
        for (let i = 0; i <= 16; i++)
          for (const p of [
            [extent[0] + ((extent[2] - extent[0]) * i) / 16, extent[1]],
            [extent[0] + ((extent[2] - extent[0]) * i) / 16, extent[3]],
            [extent[0], extent[1] + ((extent[3] - extent[1]) * i) / 16],
            [extent[2], extent[1] + ((extent[3] - extent[1]) * i) / 16],
          ]) {
            const q = backward(s.fit, p as XY, true);
            if (q) points.push(q);
          }
        if (points.length && points.flat().every(Number.isFinite)) {
          const x = Math.min(...points.map((p) => p[0])),
            y = Math.min(...points.map((p) => p[1]));
          controller.setImageView([
            x,
            y,
            Math.max(...points.map((p) => p[0])) - x,
            Math.max(...points.map((p) => p[1])) - y,
          ]);
        }
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
    /**
     * Package-owned layers exposed for display integration; do not persist them or
     * dispose them independently.
     */
    layers: {
      /** Target control-point display layer. */
      gcps: gcpLayer,
      /** Geographic user-drawing display layer. */
      drafts: draftLayer,
      /** Transformed raster preview layer. */
      preview: previewLayer,
    },
    /**
     * Fit the host view to the current preview bounds with padding; no-op if no preview
     * exists.
     */
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
    /**
     * Navigate map view history: -1 for back, 1 for forward. History resets when the host
     * replaces the view.
     */
    navigateHistory(direction: -1 | 1) {
      const h = history.step(direction);
      if (!h) return;
      restoring = true;
      const v = map.getView();
      v.setCenter(h.center);
      v.setResolution(h.resolution);
      v.setRotation(h.rotation);
    },
    /** Abort the active sketch and any pending GCP pair, returning to navigation. */
    cancelDrawing() {
      draw?.abortDrawing();
      controller.cancelPending();
    },
    /** Complete the active OpenLayers drawing sketch if one exists. */
    finishDrawing() {
      draw?.finishDrawing();
    },
    /**
     * Idempotently remove only package-owned layers, sources, interactions, listeners and
     * reference jobs. Does not dispose the host map or controller.
     */
    detach() {
      if (detached) return;
      detached = true;
      unsubscribe();
      for (const provider of options.references ?? [])
        controller.setReferenceStatus(provider.id, null);
      targetElement?.removeEventListener("keydown", keydown);
      unByKey(keys);
      cancellations.forEach((fn) => {
        fn();
      });
      clearInteractions();
      releasePreview();
      for (const layer of [...owned, ...ownedReferences]) {
        map.removeLayer(layer);
        const source = layer.getSource();
        source?.dispose();
        layer.dispose();
      }
    },
  };
}
