/**
 * Leaflet map adapter: image overlay, control-point markers, residuals, drawing with
 * Terra Draw, snapping and reference layers. Import from `@georeferencing/leaflet`.
 * @module @georeferencing/leaflet
 * @group @georeferencing/leaflet
 */
import type { Extent, GeoreferencerController, XY } from "@georeferencing/core";
import {
  createConverter,
  forward,
  normalizeCrs,
  project,
  projectExtent,
  registerDatumGrids,
} from "@georeferencing/core";
import type {
  MapAdapter,
  MapAdapterOptions,
  MapBinding,
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
import type * as Leaflet from "leaflet";
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
 * Options of the Leaflet adapter. Keep this object stable: it is read when attaching.
 * WFS references must return GeoJSON (`responseFormat: "geojson"`).
 */
export interface LeafletOptions extends MapAdapterOptions<ReferenceSource> {
  /**
   * The Leaflet module, for example `import L from "leaflet"`. It is passed in rather
   * than imported, so this package stays importable during server-side rendering and
   * works with a Leaflet loaded as a global.
   */
  lib: typeof Leaflet;
}

const GEOGRAPHIC = "EPSG:4326";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Create a {@link "@georeferencing/core/map".MapAdapter} for a Leaflet map, for example
 * for the React `Georeferencer`'s `map` prop. Create it once per map and options object
 * (for example with `useMemo`).
 * @param map - Host-owned Leaflet map.
 * @param options - The Leaflet module plus references, projections, snapping and initial framing.
 */
export function leaflet(map: Leaflet.Map, options: LeafletOptions): MapAdapter {
  return (controller) => attachLeaflet(map, controller, options);
}

/**
 * Attach owned image, marker, residual, draft and reference layers and interactions to an
 * existing Leaflet map. Prefer {@link leaflet} with the React `Georeferencer`.
 *
 * Leaflet places image overlays as rectangles in the map CRS, so the controller renders
 * previews in that CRS (`map.options.crs.code`, Web Mercator by default) while the binding
 * is attached; fitting and exports keep using the working CRS. Maps with a custom
 * Proj4Leaflet CRS need its definition in `definitions`; `L.CRS.Simple` is not supported.
 * The binding has no `capture`: Leaflet renders tiles as DOM images, so PDF reports omit
 * the map page. Drawing uses the optional `terra-draw` and `terra-draw-leaflet-adapter`
 * peers, loaded on first use.
 * @param map - Host-owned Leaflet map.
 * @param controller - Authoritative editor store.
 * @param options - The Leaflet module plus references, projections, snapping and framing.
 * @returns The binding; `detach` removes everything it added.
 */
export function attachLeaflet(
  map: Leaflet.Map,
  controller: GeoreferencerController,
  options: LeafletOptions,
): MapBinding {
  const L = options.lib,
    definitions = options.definitions ?? {};
  registerDatumGrids(options.datumGrids);
  const mapCrs = normalizeCrs(map.options.crs?.code ?? "EPSG:3857");
  const toLonLat = createConverter(mapCrs, GEOGRAPHIC, definitions),
    fromLonLat = createConverter(GEOGRAPHIC, mapCrs, definitions);
  const latLng = ([lon, lat]: XY | number[]) => L.latLng(lat, lon);
  const bounds = ([w, s, e, n]: Extent) => L.latLngBounds([s, w], [n, e]);
  let detached = false;

  // Previews in the map CRS make the overlay rectangle exact.
  controller.setPreviewCrs(mapCrs);

  const providers = options.references ?? [];
  const referenceData = new Map<string, FeatureCollection>();
  const referenceLayers = providers.map(() =>
    L.geoJSON(undefined, {
      style: { color: "#758981", weight: 1.5, fillOpacity: 0.07 },
      pointToLayer: (_, at) =>
        L.circleMarker(at, {
          radius: 4,
          color: "#758981",
          fillColor: "#758981",
          fillOpacity: 1,
          weight: 1,
        }),
    }).addTo(map),
  );
  const residuals = L.layerGroup().addTo(map);
  const drafts = L.geoJSON(undefined, {
    style: { color: "#12695b", weight: 3, fillOpacity: 0.15 },
    pointToLayer: (_, at) =>
      L.circleMarker(at, {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: "#12695b",
        fillOpacity: 1,
      }),
  }).addTo(map);
  const preview = L.imageOverlay("", L.latLngBounds([0, 0], [0, 0]), {
    interactive: false,
  });
  let previewUrl: string | null = null;

  const view = () => {
    const b = map.getBounds(),
      west = Math.max(-180, b.getWest()),
      east = Math.min(180, b.getEast()),
      south = Math.max(-85.05, b.getSouth()),
      north = Math.min(85.05, b.getNorth());
    const [x0, y0] = fromLonLat([west, south]),
      [x1, y1] = fromLonLat([east, north]);
    return {
      extent: [x0, y0, x1, y1] as Extent,
      crs: mapCrs,
      resolution: (x1 - x0) / Math.max(1, map.getSize().x),
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
      const layer = referenceLayers[providers.indexOf(provider)];
      layer.clearLayers();
      if (data) layer.addData(data);
    },
  });

  const snapSources = (withDrafts: boolean, refs: boolean): SnapSource[] => [
    ...(refs
      ? providers
          .filter((p) => p.snapping)
          .map((p) => ({
            id: p.id,
            data: referenceData.get(p.id) ?? EMPTY,
            options: p.snapping!,
          }))
      : []),
    ...(withDrafts
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
      a = map.containerPointToLatLng([x - tolerance, y + tolerance]),
      b = map.containerPointToLatLng([x + tolerance, y - tolerance]);
    return snapToReferences(
      [x, y],
      sources,
      ([lon, lat]) => {
        const p = map.latLngToContainerPoint([lat, lon]);
        return [p.x, p.y];
      },
      [a.lng, a.lat, b.lng, b.lat],
    );
  };

  // Control-point markers, keyed by GCP ID.
  const markers = new Map<string, { marker: Leaflet.Marker; key: string }>();
  const icon = (label: number, enabled: boolean) =>
    L.divIcon({
      className: "georef-gcp-marker",
      iconSize: [12, 12],
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#faf9ed;border:2px solid ${enabled ? "#c95722" : "#666"};box-sizing:border-box;position:relative"><span style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font:600 12px system-ui,sans-serif;color:#182d2a;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap">${label}</span></div>`,
    });
  const syncMarkers = (errors: unknown[]) => {
    const s = controller.getSnapshot(),
      draggable = s.tool === "gcp" && s.mode === "align",
      seen = new Set<string>();
    for (const gcp of s.document.gcps) {
      seen.add(gcp.id);
      try {
        const at = latLng(
          project(gcp.target, gcp.crs, GEOGRAPHIC, definitions),
        );
        const key = `${gcp.label}/${gcp.enabled}`;
        let entry = markers.get(gcp.id);
        if (!entry) {
          const marker = L.marker(at, {
            icon: icon(gcp.label, gcp.enabled),
            title: `Control point ${gcp.label}`,
            draggable,
          }).addTo(map);
          const gcpId = gcp.id;
          marker.on("dragend", () => {
            const { lng, lat } = marker.getLatLng(),
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
          entry = { marker, key };
          markers.set(gcp.id, entry);
        }
        entry.marker.setLatLng(at);
        if (entry.key !== key) {
          entry.marker.setIcon(icon(gcp.label, gcp.enabled));
          entry.key = key;
        }
        if (draggable) entry.marker.dragging?.enable();
        else entry.marker.dragging?.disable();
      } catch (error) {
        errors.push(error);
        markers.get(gcp.id)?.marker.remove();
        markers.delete(gcp.id);
      }
    }
    for (const [key, entry] of markers)
      if (!seen.has(key)) {
        entry.marker.remove();
        markers.delete(key);
      }
  };

  let drawing: DrawingSession | null = null,
    drawingRequested = false;
  const ensureDrawing = () => {
    if (drawingRequested) return;
    drawingRequested = true;
    void loadTerraDraw(() => import("terra-draw-leaflet-adapter"))
      .then(({ terraDraw, adapter }) => {
        if (detached) return;
        const snapping = options.digitizingSnapping;
        drawing = createDrawingSession(
          controller,
          terraDraw,
          new adapter.TerraDrawLeafletAdapter({ lib: L, map }),
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
          (editing) => {
            if (editing) drafts.remove();
            else drafts.addTo(map);
          },
        );
        drawing.update();
      })
      .catch((error) => {
        drawingRequested = false;
        controller.reportError(error);
      });
  };

  /** Encode a preview raster as an object URL for Leaflet's image overlay. */
  const encodePreview = async (
    r: NonNullable<
      ReturnType<GeoreferencerController["getSnapshot"]>["preview"]
    >,
  ) => {
    const canvas = document.createElement("canvas");
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    canvas.width = canvas.height = 0;
    return blob;
  };
  let previewGeneration = 0;

  let oldDocument: unknown,
    oldPreview: unknown,
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
      if (extent) map.fitBounds(bounds(extent), { animate: false });
    }
    oldImageView = s.imageView;
    oldLink = s.linkedNavigation;
    syncMarkers(errors);
    if (drawing) drawing.update();
    else if (s.mode === "draw" && s.tool !== "navigate") ensureDrawing();
    // Crosshair while a map click places a control point, like the image viewer.
    const picking = s.tool === "gcp" && s.mode === "align";
    if (picking !== showingCrosshair) {
      showingCrosshair = picking;
      container.style.cursor = picking ? "crosshair" : hostCursor;
    }
    if (oldDocument !== s.document || oldPreview !== s.preview) {
      oldDocument = s.document;
      residuals.clearLayers();
      if (s.fit)
        for (const gcp of s.document.gcps.filter((p) => p.enabled))
          try {
            L.polyline(
              [
                latLng(project(gcp.target, gcp.crs, GEOGRAPHIC, definitions)),
                latLng(
                  project(
                    forward(s.fit, gcp.image),
                    s.document.workingCrs,
                    GEOGRAPHIC,
                    definitions,
                  ),
                ),
              ],
              {
                color: "#b93232",
                weight: 2,
                dashArray: "3 3",
                interactive: false,
              },
            ).addTo(residuals);
          } catch (error) {
            errors.push(error);
          }
      drafts.clearLayers();
      drafts.addData(s.document.features);
    }
    const r = s.preview,
      // A preview rendered in another CRS (before the switch applied) is not shown.
      shown = Boolean(r && normalizeCrs(r.crs) === mapCrs);
    if (oldPreview !== r) {
      oldPreview = r;
      const generation = ++previewGeneration;
      if (r && shown)
        void encodePreview(r).then((blob) => {
          if (!blob || detached || generation !== previewGeneration) return;
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = URL.createObjectURL(blob);
          const [x0, y0, x1, y1] = r.bounds;
          preview.setBounds(
            L.latLngBounds(
              latLng(toLonLat([x0, y0])),
              latLng(toLonLat([x1, y1])),
            ),
          );
          preview.setUrl(previewUrl);
          binding?.sync();
        });
    }
    const visible = shown && s.visible && previewUrl !== null;
    if (visible && !map.hasLayer(preview)) preview.addTo(map).bringToBack();
    if (!visible && map.hasLayer(preview)) preview.remove();
    preview.setOpacity(s.opacity);
  };

  const onClick = (event: Leaflet.LeafletMouseEvent) => {
    const s = controller.getSnapshot();
    if (s.tool !== "gcp" || !s.pendingImagePoint) return;
    try {
      const snapped = snapAt(
        event.containerPoint.x,
        event.containerPoint.y,
        snapSources(false, true),
      );
      const lonLat: XY = snapped
        ? snapped.coordinate
        : [event.latlng.lng, event.latlng.lat];
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
  const history = new ViewHistory<{ center: [number, number]; zoom: number }>();
  let restoring = false;
  const onMoveEnd = () => {
    references.refreshViewport();
    if (restoring) restoring = false;
    else {
      const c = map.getCenter();
      history.record({ center: [c.lat, c.lng], zoom: map.getZoom() });
    }
    const s = controller.getSnapshot();
    if (!s.fit || s.linkedNavigation !== "map-to-image") return;
    try {
      const b = map.getBounds();
      const imageView = extentToImageView(
        s.fit,
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        GEOGRAPHIC,
        s.document.workingCrs,
        definitions,
      );
      if (imageView) controller.setImageView(imageView);
    } catch (error) {
      controller.reportError(error);
    }
  };
  const container = map.getContainer(),
    hostCursor = container.style.cursor;
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
  map.on("click", onClick);
  map.on("moveend", onMoveEnd);
  container.addEventListener("keydown", onKeyDown);

  let binding: ReturnType<typeof subscribeBinding> | undefined;
  binding = subscribeBinding(controller, update);
  if (options.initialView)
    try {
      map.fitBounds(
        bounds(
          projectExtent(
            options.initialView.extent,
            options.initialView.crs,
            GEOGRAPHIC,
            definitions,
          ),
        ),
        { animate: false },
      );
    } catch (error) {
      controller.reportError(error);
    }
  onMoveEnd();

  return {
    fitOverlay() {
      const r = controller.getSnapshot().preview;
      if (r)
        map.fitBounds(
          bounds(projectExtent(r.bounds, r.crs, GEOGRAPHIC, definitions)),
          {
            padding: [30, 30],
          },
        );
    },
    navigateHistory(direction) {
      const h = history.step(direction);
      if (!h) return;
      restoring = true;
      map.setView(h.center, h.zoom, { animate: false });
    },
    cancelDrawing() {
      controller.cancelPending();
    },
    finishDrawing() {
      drawing?.finish();
    },
    resize() {
      map.invalidateSize();
    },
    detach() {
      if (detached) return;
      detached = true;
      binding?.unsubscribe();
      references.dispose();
      map.off("click", onClick);
      map.off("moveend", onMoveEnd);
      container.removeEventListener("keydown", onKeyDown);
      drawing?.stop();
      drawing = null;
      container.style.cursor = hostCursor;
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      for (const layer of [...referenceLayers, residuals, drafts, preview])
        layer.remove();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      controller.setPreviewCrs(null);
    },
  };
}
