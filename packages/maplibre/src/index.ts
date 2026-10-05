/**
 * MapLibre GL JS map adapter: image overlay, control-point markers, residuals, drawing
 * with Terra Draw, snapping, reference layers and map capture.
 * Import from `@georeferencing/maplibre`.
 * @module @georeferencing/maplibre
 * @group @georeferencing/maplibre
 */
import type { Extent, GeoreferencerController, XY } from "@georeferencing/core";
import {
  createConverter,
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
  ReferenceSource,
  SnapSource,
} from "@georeferencing/core/map";
import {
  extentToImageView,
  imageViewToExtent,
  loadReferenceData,
  snapToReferences,
  subscribeBinding,
  ViewHistory,
  watchReferences,
} from "@georeferencing/core/map";
import type { FeatureCollection } from "geojson";
import type {
  GeoJSONSource,
  ImageSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
} from "maplibre-gl";
import { Marker } from "maplibre-gl";
import type { DrawingSession } from "./drawing.js";
import { createDrawingSession, loadTerraDraw } from "./drawing.js";

export type {
  CustomReference,
  GeoJsonReference,
  ReferenceSource,
  SnapOptions,
  WfsReference,
} from "@georeferencing/core/map";

/**
 * Options of the MapLibre adapter. Keep this object stable: it is read when attaching.
 * WFS references must return GeoJSON (`responseFormat: "geojson"`).
 */
export interface MapLibreOptions extends MapAdapterOptions<ReferenceSource> {
  /**
   * Insert the adapter's layers below this existing style layer, for example below
   * labels. Omit to add them on top.
   */
  beforeId?: string;
}

const MERCATOR = "EPSG:3857",
  GEOGRAPHIC = "EPSG:4326";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const toLonLat = createConverter(MERCATOR, GEOGRAPHIC);
const fromLonLat = createConverter(GEOGRAPHIC, MERCATOR);

/**
 * Create a {@link "@georeferencing/core/map".MapAdapter} for a MapLibre GL JS map, for
 * example for the React `Georeferencer`'s `map` prop. Create it once per map and options
 * object (for example with `useMemo`).
 * @param map - Host-owned MapLibre map.
 * @param options - References, projections, snapping and optional initial framing.
 */
export function maplibre(
  map: MapLibreMap,
  options: MapLibreOptions = {},
): MapAdapter {
  return (controller) => attachMapLibre(map, controller, options);
}

/**
 * Capture the currently rendered MapLibre canvas for PDF reports, without changing the
 * view. The capture is taken during the next render, so it works without
 * `preserveDrawingBuffer`; tile sources must allow CORS.
 * @param map - Visible MapLibre map.
 * @param attribution - Attribution override; defaults to the map's attribution control text.
 */
export function captureMapLibreMap(
  map: MapLibreMap,
  attribution?: string,
): Promise<MapCapture> {
  return new Promise((resolve, reject) => {
    map.once("render", () => {
      try {
        const url = map.getCanvas().toDataURL("image/png");
        const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        const bounds = map.getBounds();
        resolve({
          image: new Blob([bytes], { type: "image/png" }),
          crs: GEOGRAPHIC,
          extent: [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ],
          rotation: (-map.getBearing() * Math.PI) / 180,
          attribution:
            attribution ??
            map.getContainer().querySelector(".maplibregl-ctrl-attrib-inner")
              ?.textContent ??
            undefined,
        });
      } catch {
        reject(
          new Error(
            "A map layer prevents canvas export. Configure CORS on its source, or generate the report without the map frame.",
          ),
        );
      }
    });
    map.triggerRepaint();
  });
}

/** Marker element showing a control point's label. */
function markerElement(): HTMLElement {
  // No inline position: MapLibre's .maplibregl-marker class positions the element
  // absolutely (which also anchors the label); overriding it moves markers into flow.
  const element = document.createElement("div");
  element.className = "georef-gcp-marker";
  element.style.cssText =
    "width:12px;height:12px;border-radius:50%;background:#faf9ed;border:2px solid #c95722;box-sizing:border-box;cursor:pointer";
  const label = document.createElement("span");
  label.style.cssText =
    "position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font:600 12px system-ui,sans-serif;color:#182d2a;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap;pointer-events:none";
  element.append(label);
  return element;
}

/**
 * Attach owned image, marker, residual, draft and reference layers and interactions to an
 * existing MapLibre map. Prefer {@link maplibre} with the React `Georeferencer`.
 *
 * MapLibre displays raster overlays in Web Mercator only, so the controller renders
 * previews in EPSG:3857 while the binding is attached; fitting and exports keep using
 * the working CRS. Layers are added once the style has loaded and re-added after the
 * host replaces the style. Drawing uses the optional `terra-draw` and `terra-draw-maplibre-gl-adapter`
 * peers, loaded on first use.
 * @param map - Host-owned MapLibre map.
 * @param controller - Authoritative editor store.
 * @param options - References, projections, snapping and optional initial framing.
 * @returns The binding; `detach` removes everything it added.
 */
export function attachMapLibre(
  map: MapLibreMap,
  controller: GeoreferencerController,
  options: MapLibreOptions = {},
): MapBinding {
  const definitions = options.definitions ?? {};
  registerDatumGrids(options.datumGrids);
  const id = `georef-${uid().slice(0, 8)}`,
    ids = {
      preview: `${id}-preview`,
      residuals: `${id}-residuals`,
      drafts: `${id}-drafts`,
    };
  const referenceData = new Map<string, FeatureCollection>();
  const providers = options.references ?? [];
  const referenceId = (index: number) => `${id}-reference-${index}`;
  const ownedLayers: string[] = [],
    ownedSources: string[] = [];
  let detached = false,
    ready = false,
    draftsVisible = true;

  const addLayer = (layer: LayerSpecification) => {
    map.addLayer(layer, options.beforeId);
    ownedLayers.push(layer.id);
  };
  const addGeoJson = (source: string) => {
    map.addSource(source, { type: "geojson", data: EMPTY });
    ownedSources.push(source);
  };
  /** Add every owned source and layer; called when the style is ready and after setStyle. */
  const setupStyle = () => {
    ownedLayers.length = 0;
    ownedSources.length = 0;
    providers.forEach((_, index) => {
      const source = referenceId(index);
      addGeoJson(source);
      addLayer({
        id: `${source}-fill`,
        type: "fill",
        source,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#758981", "fill-opacity": 0.07 },
      });
      addLayer({
        id: `${source}-line`,
        type: "line",
        source,
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": "#758981", "line-width": 1.5 },
      });
      addLayer({
        id: `${source}-point`,
        type: "circle",
        source,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": "#758981", "circle-radius": 4 },
      });
    });
    // The image source is created with the first preview (see showPreview).
    addGeoJson(ids.residuals);
    addLayer({
      id: ids.residuals,
      type: "line",
      source: ids.residuals,
      paint: {
        "line-color": "#b93232",
        "line-width": 2,
        "line-dasharray": [1.5, 1.5],
      },
    });
    addGeoJson(ids.drafts);
    addLayer({
      id: `${ids.drafts}-fill`,
      type: "fill",
      source: ids.drafts,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#12695b", "fill-opacity": 0.15 },
    });
    addLayer({
      id: `${ids.drafts}-line`,
      type: "line",
      source: ids.drafts,
      filter: ["!=", ["geometry-type"], "Point"],
      paint: { "line-color": "#12695b", "line-width": 3 },
    });
    addLayer({
      id: `${ids.drafts}-point`,
      type: "circle",
      source: ids.drafts,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "#12695b",
        "circle-radius": 6,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
    ready = true;
    for (const [index, provider] of providers.entries())
      setData(referenceId(index), referenceData.get(provider.id) ?? EMPTY);
    // Re-render everything into the new layers.
    oldDocument = oldPreview = null;
    oldDisplay = "";
    binding?.sync();
  };
  /** Display a Web Mercator raster, creating its source and layer on first use. */
  const showPreview = (
    r: NonNullable<
      ReturnType<GeoreferencerController["getSnapshot"]>["preview"]
    >,
  ) => {
    const [x0, y0, x1, y1] = r.bounds;
    const coordinates = [
      toLonLat([x0, y1]),
      toLonLat([x1, y1]),
      toLonLat([x1, y0]),
      toLonLat([x0, y0]),
    ];
    const image = new ImageData(
      r.data as Uint8ClampedArray<ArrayBuffer>,
      r.width,
      r.height,
    );
    const source = map.getSource(ids.preview) as ImageSource | undefined;
    if (source) {
      source.updateImage({ image, coordinates } as never);
      return;
    }
    map.addSource(ids.preview, { type: "image", coordinates } as never);
    ownedSources.push(ids.preview);
    (map.getSource(ids.preview) as ImageSource).updateImage({ image } as never);
    // Below residuals and drafts, above references.
    map.addLayer(
      {
        id: ids.preview,
        type: "raster",
        source: ids.preview,
        paint: { "raster-fade-duration": 0 },
      },
      ids.residuals,
    );
    ownedLayers.push(ids.preview);
  };
  const setData = (source: string, data: FeatureCollection) => {
    if (ready)
      (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
  };
  const setDraftVisibility = (visible: boolean) => {
    draftsVisible = visible;
    if (ready)
      for (const suffix of ["fill", "line", "point"])
        map.setLayoutProperty(
          `${ids.drafts}-${suffix}`,
          "visibility",
          visible ? "visible" : "none",
        );
  };

  // Previews must be in the display projection so the image corners are exact.
  controller.setPreviewCrs(MERCATOR);

  const view = () => {
    const bounds = map.getBounds(),
      west = Math.max(-180, bounds.getWest()),
      east = Math.min(180, bounds.getEast()),
      south = Math.max(-85.05, bounds.getSouth()),
      north = Math.min(85.05, bounds.getNorth());
    const [x0, y0] = fromLonLat([west, south]),
      [x1, y1] = fromLonLat([east, north]);
    return {
      extent: [x0, y0, x1, y1] as Extent,
      crs: MERCATOR,
      resolution: (x1 - x0) / Math.max(1, map.getCanvas().clientWidth),
    };
  };
  const references = watchReferences(providers, {
    controller,
    definitions,
    debounceMs: options.debounceMs,
    onStatus: options.onReferenceStatus,
    view,
    load: (provider, query) => loadReferenceData(provider, query, definitions),
    apply(provider, data) {
      referenceData.set(provider.id, data ?? EMPTY);
      setData(referenceId(providers.indexOf(provider)), data ?? EMPTY);
    },
  });

  const snapSources = (drafts: boolean, refs: boolean): SnapSource[] => [
    ...(refs
      ? providers
          .filter((p) => p.snapping)
          .map((p) => ({
            id: p.id,
            data: referenceData.get(p.id) ?? EMPTY,
            options: p.snapping!,
          }))
      : []),
    ...(drafts
      ? [
          {
            id: "drafts",
            data: controller.getSnapshot().document.features,
            options: { vertices: true, edges: false },
          },
        ]
      : []),
  ];
  const snapAt = (x: number, y: number, sources: SnapSource[]) => {
    if (!sources.length) return null;
    const tolerance = Math.max(
        ...sources.map((s) => s.options.tolerancePx ?? 10),
      ),
      a = map.unproject([x - tolerance, y + tolerance]),
      b = map.unproject([x + tolerance, y - tolerance]);
    return snapToReferences(
      [x, y],
      sources,
      (c) => {
        const p = map.project(c as [number, number]);
        return [p.x, p.y];
      },
      [a.lng, a.lat, b.lng, b.lat],
    );
  };

  // Control-point markers, keyed by GCP ID.
  const markers = new Map<string, Marker>();
  const syncMarkers = (errors: unknown[]) => {
    const s = controller.getSnapshot(),
      draggable = s.tool === "gcp" && s.mode === "align",
      seen = new Set<string>();
    for (const gcp of s.document.gcps) {
      seen.add(gcp.id);
      try {
        const lonLat = project(gcp.target, gcp.crs, GEOGRAPHIC, definitions);
        let marker = markers.get(gcp.id);
        if (!marker) {
          marker = new Marker({ element: markerElement(), draggable });
          const gcpId = gcp.id;
          marker.on("dragend", () => {
            const { lng, lat } = marker!.getLngLat(),
              workingCrs = controller.getSnapshot().document.workingCrs;
            try {
              controller.updateGcp(gcpId, {
                target: project(
                  [lng, lat],
                  GEOGRAPHIC,
                  workingCrs,
                  definitions,
                ),
                crs: workingCrs,
              });
            } catch (error) {
              oldDocument = null;
              binding?.sync();
              controller.reportError(error);
            }
          });
          markers.set(
            gcp.id,
            marker.setLngLat(lonLat as [number, number]).addTo(map),
          );
        }
        marker.setLngLat(lonLat as [number, number]).setDraggable(draggable);
        const element = marker.getElement();
        element.style.borderColor = gcp.enabled ? "#c95722" : "#666";
        element.firstElementChild!.textContent = String(gcp.label);
        element.title = `Control point ${gcp.label}`;
      } catch (error) {
        errors.push(error);
        markers.get(gcp.id)?.remove();
        markers.delete(gcp.id);
      }
    }
    for (const [key, marker] of markers)
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
  };

  let drawing: DrawingSession | null = null,
    drawingRequested = false;
  const ensureDrawing = () => {
    if (drawingRequested) return;
    drawingRequested = true;
    void loadTerraDraw(() => import("terra-draw-maplibre-gl-adapter"))
      .then(({ terraDraw, adapter }) => {
        if (detached) return;
        const snapping = options.digitizingSnapping;
        drawing = createDrawingSession(
          controller,
          terraDraw,
          new adapter.TerraDrawMapLibreGLAdapter({
            map,
            prefixId: `${id}-draw`,
          }),
          snapping?.references || snapping?.drafts
            ? (x, y) =>
                snapAt(
                  x,
                  y,
                  snapSources(
                    Boolean(snapping.drafts),
                    Boolean(snapping.references),
                  ),
                )?.coordinate
            : undefined,
          (editing) => setDraftVisibility(!editing),
        );
        drawing.update();
      })
      .catch((error) => {
        drawingRequested = false;
        controller.reportError(error);
      });
  };

  let oldDocument: unknown,
    oldPreview: unknown,
    oldDisplay = "",
    oldImageView: unknown,
    oldLink: unknown;
  const update = (errors: unknown[]) => {
    const s = controller.getSnapshot();
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
        GEOGRAPHIC,
        definitions,
      );
      if (extent)
        map.fitBounds(
          [
            [extent[0], extent[1]],
            [extent[2], extent[3]],
          ],
          { animate: false },
        );
    }
    oldImageView = s.imageView;
    oldLink = s.linkedNavigation;
    syncMarkers(errors);
    if (s.mode === "draw" || drawing) {
      if (drawing) drawing.update();
      else if (s.mode === "draw" && s.tool !== "navigate") ensureDrawing();
    }
    // Crosshair while a map click places a control point, like the image viewer.
    const picking = s.tool === "gcp" && s.mode === "align";
    if (picking !== showingCrosshair) {
      showingCrosshair = picking;
      canvasContainer.style.cursor = picking ? "crosshair" : hostCursor;
    }
    if (!ready) return;
    if (oldDocument !== s.document || oldPreview !== s.preview) {
      oldDocument = s.document;
      const lines: FeatureCollection["features"] = [];
      if (s.fit)
        for (const gcp of s.document.gcps.filter((p) => p.enabled))
          try {
            lines.push({
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [
                  project(gcp.target, gcp.crs, GEOGRAPHIC, definitions),
                  project(
                    forward(s.fit, gcp.image),
                    s.document.workingCrs,
                    GEOGRAPHIC,
                    definitions,
                  ),
                ],
              },
            });
          } catch (error) {
            errors.push(error);
          }
      setData(ids.residuals, { type: "FeatureCollection", features: lines });
      setData(ids.drafts, s.document.features);
    }
    const r = s.preview,
      // A preview rendered in another CRS (before the switch applied) is not shown.
      shown = Boolean(r && r.crs === MERCATOR);
    if (oldPreview !== r && shown) showPreview(r!);
    oldPreview = r;
    const display = `${shown && s.visible}/${s.opacity}/${draftsVisible}`;
    if (display !== oldDisplay && map.getLayer(ids.preview)) {
      oldDisplay = display;
      map.setLayoutProperty(
        ids.preview,
        "visibility",
        shown && s.visible ? "visible" : "none",
      );
      map.setPaintProperty(ids.preview, "raster-opacity", s.opacity);
    }
  };

  const onClick = (event: MapMouseEvent) => {
    const s = controller.getSnapshot();
    if (s.tool !== "gcp" || !s.pendingImagePoint) return;
    try {
      const snapped = snapAt(
        event.point.x,
        event.point.y,
        snapSources(false, true),
      );
      const lonLat: XY = snapped
        ? snapped.coordinate
        : [event.lngLat.lng, event.lngLat.lat];
      controller.addGcp(
        s.pendingImagePoint,
        project(lonLat, GEOGRAPHIC, s.document.workingCrs, definitions),
        s.document.workingCrs,
        snapped?.reference,
      );
    } catch (error) {
      controller.reportError(error);
    }
  };
  const history = new ViewHistory<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }>();
  let restoring = false;
  const onMoveEnd = () => {
    references.refreshViewport();
    if (restoring) restoring = false;
    else {
      const c = map.getCenter();
      history.record({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    }
    const s = controller.getSnapshot();
    if (!s.fit || s.linkedNavigation !== "map-to-image") return;
    try {
      const bounds = map.getBounds();
      const imageView = extentToImageView(
        s.fit,
        [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ],
        GEOGRAPHIC,
        s.document.workingCrs,
        definitions,
      );
      if (imageView) controller.setImageView(imageView);
    } catch (error) {
      controller.reportError(error);
    }
  };
  const container = map.getContainer();
  const canvasContainer = map.getCanvasContainer(),
    hostCursor = canvasContainer.style.cursor;
  let showingCrosshair = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      controller.getSnapshot().tool !== "navigate"
    ) {
      controller.cancelPending();
      event.preventDefault();
    }
  };
  /** Remove owned layers and sources that still exist. */
  const removeOwned = () => {
    try {
      for (const layer of [...ownedLayers].reverse())
        if (map.getLayer(layer)) map.removeLayer(layer);
      for (const source of ownedSources)
        if (map.getSource(source)) map.removeSource(source);
    } catch {
      // The map or its style was already removed.
    }
    ownedLayers.length = 0;
    ownedSources.length = 0;
  };
  /** Add owned layers when the style is ready and again after the host replaces it. */
  const onStyleData = () => {
    if (detached || map.getSource(ids.residuals)) return;
    ready = false;
    try {
      setupStyle();
    } catch (error) {
      removeOwned();
      // Still loading: the next styledata event retries. Anything else is a real error.
      if (!String(error).includes("Style is not done loading"))
        controller.reportError(error);
    }
  };
  map.on("click", onClick);
  map.on("moveend", onMoveEnd);
  map.on("styledata", onStyleData);
  container.addEventListener("keydown", onKeyDown);

  let binding: ReturnType<typeof subscribeBinding> | undefined;
  binding = subscribeBinding(controller, update);
  onStyleData();
  if (options.initialView)
    try {
      const [w, s, e, n] = projectExtent(
        options.initialView.extent,
        options.initialView.crs,
        GEOGRAPHIC,
        definitions,
      );
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { animate: false },
      );
    } catch (error) {
      controller.reportError(error);
    }
  onMoveEnd();

  return {
    fitOverlay() {
      const r = controller.getSnapshot().preview;
      if (!r) return;
      const [w, s, e, n] = projectExtent(
        r.bounds,
        r.crs,
        GEOGRAPHIC,
        definitions,
      );
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 30 },
      );
    },
    navigateHistory(direction) {
      const h = history.step(direction);
      if (!h) return;
      restoring = true;
      map.jumpTo(h);
    },
    cancelDrawing() {
      controller.cancelPending();
    },
    finishDrawing() {
      drawing?.finish();
    },
    resize() {
      map.resize();
    },
    capture: () => captureMapLibreMap(map),
    detach() {
      if (detached) return;
      detached = true;
      binding?.unsubscribe();
      references.dispose();
      map.off("click", onClick);
      map.off("moveend", onMoveEnd);
      map.off("styledata", onStyleData);
      container.removeEventListener("keydown", onKeyDown);
      drawing?.stop();
      drawing = null;
      canvasContainer.style.cursor = hostCursor;
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      removeOwned();
      controller.setPreviewCrs(null);
    },
  };
}
