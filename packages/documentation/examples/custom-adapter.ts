import type { GeoreferencerController, XY } from "@georeferencing/core";
import { project } from "@georeferencing/core";
import type { MapAdapter, MapBinding } from "@georeferencing/core/map";
import { subscribeBinding } from "@georeferencing/core/map";

/** The few operations this example needs from a hypothetical host map library. */
export interface HostMap {
  /** Register a click handler receiving longitude/latitude; returns an unsubscribe function. */
  onClick(handler: (lonLat: XY) => void): () => void;
  /** Show markers at longitude/latitude positions. */
  setMarkers(markers: { id: string; label: string; at: XY }[]): void;
  /** Frame longitude/latitude bounds. */
  fit(bounds: [number, number, number, number]): void;
}

/** A minimal adapter: picks control points and shows their markers. */
export function hostMapAdapter(map: HostMap): MapAdapter {
  return (controller: GeoreferencerController): MapBinding => {
    // Render each snapshot; errors pushed here are reported once by subscribeBinding.
    const binding = subscribeBinding(controller, (errors) => {
      const markers = [];
      for (const gcp of controller.getSnapshot().document.gcps)
        try {
          markers.push({
            id: gcp.id,
            label: String(gcp.label),
            at: project(gcp.target, gcp.crs, "EPSG:4326"),
          });
        } catch (error) {
          errors.push(error);
        }
      map.setMarkers(markers);
    });
    const stopClicks = map.onClick((lonLat) => {
      const s = controller.getSnapshot();
      if (s.tool !== "gcp" || !s.pendingImagePoint) return;
      try {
        controller.addGcp(
          s.pendingImagePoint,
          project(lonLat, "EPSG:4326", s.document.workingCrs),
          s.document.workingCrs,
        );
      } catch (error) {
        controller.reportError(error);
      }
    });
    return {
      fitOverlay() {
        const preview = controller.getSnapshot().preview;
        if (!preview) return;
        const [x0, y0, x1, y1] = preview.bounds;
        const [w, s] = project([x0, y0], preview.crs, "EPSG:4326");
        const [e, n] = project([x1, y1], preview.crs, "EPSG:4326");
        map.fit([w, s, e, n]);
      },
      cancelDrawing: () => controller.cancelPending(),
      detach() {
        stopClicks();
        binding.unsubscribe();
        map.setMarkers([]);
      },
    };
  };
}
