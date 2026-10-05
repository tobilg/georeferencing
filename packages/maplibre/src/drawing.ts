// Terra Draw integration shared by the MapLibre and Leaflet adapters. Both packages
// carry an identical copy of this file (verified by tests/adapters.test.ts), so core
// stays free of drawing-library code.
import type {
  Features,
  GeoreferencerController,
  Tool,
} from "@georeferencing/core";
import { uid } from "@georeferencing/core";
import type { Position } from "geojson";
import type * as TerraDrawModule from "terra-draw";

type Feature = Features["features"][number];
type TerraDraw = InstanceType<typeof TerraDrawModule.TerraDraw>;
type DrawAdapter = ConstructorParameters<
  typeof TerraDrawModule.TerraDraw
>[0]["adapter"];

/** Terra Draw mode names for the editor's drawing tools. */
const MODES: Partial<Record<Tool, string>> = {
  Point: "point",
  LineString: "linestring",
  Polygon: "polygon",
  modify: "select",
};
const MODE_OF_GEOMETRY = {
  Point: "point",
  LineString: "linestring",
  Polygon: "polygon",
} as const;
const EDIT_ACTIONS = new Set([
  "edit",
  "dragCoordinate",
  "dragFeature",
  "insertMidpoint",
  "deleteCoordinate",
]);

/**
 * Load Terra Draw lazily, only when a drawing tool is first used.
 * @throws With installation instructions when the optional peers are missing.
 */
export async function loadTerraDraw<A>(
  loadAdapter: () => Promise<A>,
): Promise<{ terraDraw: typeof TerraDrawModule; adapter: A }> {
  try {
    const [terraDraw, adapter] = await Promise.all([
      import("terra-draw"),
      loadAdapter(),
    ]);
    return { terraDraw, adapter };
  } catch (error) {
    throw new Error(
      `Drawing requires the optional terra-draw peer dependencies; install terra-draw and its adapter for this map library. (${String(error)})`,
    );
  }
}

/** Synchronizes the controller's drawing tools and drafts with a Terra Draw instance. */
export interface DrawingSession {
  /** Apply the controller's current tool and mode. */
  update(): void;
  /** Complete the active line or polygon sketch. */
  finish(): void;
  /** Stop Terra Draw and remove its layers. */
  stop(): void;
}

/**
 * Create a drawing session. Finished sketches become controller features with fresh IDs;
 * in modify mode the current drafts are editable and every edit is committed.
 * @param controller - Editor store.
 * @param terraDraw - The loaded Terra Draw module.
 * @param adapter - Terra Draw adapter for the host map.
 * @param snap - Optional custom snapping, from screen position to longitude/latitude.
 * @param onEditing - Called when drafts move into or out of the Terra Draw store, so the
 *   map binding can hide its own draft layer meanwhile.
 */
export function createDrawingSession(
  controller: GeoreferencerController,
  terraDraw: typeof TerraDrawModule,
  adapter: DrawAdapter,
  snap: ((x: number, y: number) => Position | undefined) | undefined,
  onEditing: (editing: boolean) => void,
): DrawingSession {
  const snapping = snap
    ? {
        toCustom: (event: { containerX: number; containerY: number }) =>
          snap(event.containerX, event.containerY),
      }
    : undefined;
  const editable = {
    feature: {
      draggable: true,
      coordinates: { draggable: true, midpoints: true, deletable: true },
    },
  };
  const draw: TerraDraw = new terraDraw.TerraDraw({
    adapter,
    idStrategy: {
      isValidId: (id) => typeof id === "string" && id.length > 0,
      getId: () => uid(),
    },
    modes: [
      new terraDraw.TerraDrawPointMode({ snapping }),
      new terraDraw.TerraDrawLineStringMode({ snapping }),
      new terraDraw.TerraDrawPolygonMode({ snapping }),
      new terraDraw.TerraDrawSelectMode({
        flags: {
          point: { feature: { draggable: true } },
          linestring: editable,
          polygon: editable,
        },
      }),
    ],
  });
  draw.start();
  let mode = "static";
  const features = () => controller.getSnapshot().document.features;
  const loadDrafts = () => {
    draw.clear();
    draw.addFeatures(
      features().features.map((f) => ({
        type: "Feature",
        id: String(f.id),
        geometry: f.geometry,
        properties: { mode: MODE_OF_GEOMETRY[f.geometry.type] },
      })),
    );
  };
  draw.on("finish", (id, context) => {
    try {
      if (mode === "select") {
        if (!EDIT_ACTIONS.has(context.action)) return;
        const current = features();
        controller.setFeatures({
          ...current,
          features: current.features.map((f): Feature => {
            const edited = draw.getSnapshotFeature(String(f.id));
            return edited
              ? ({ ...f, geometry: edited.geometry } as Feature)
              : f;
          }),
        });
        return;
      }
      if (context.action !== "draw") return;
      const sketch = draw.getSnapshotFeature(id);
      draw.removeFeatures([id]);
      if (!sketch) return;
      const current = features();
      controller.setFeatures({
        ...current,
        features: [
          ...current.features,
          {
            type: "Feature",
            id: uid(),
            geometry: sketch.geometry,
            properties: {},
          } as Feature,
        ],
      });
    } catch (error) {
      // Rejected edits: show the committed drafts again.
      if (mode === "select") loadDrafts();
      controller.reportError(error);
    }
  });
  return {
    update() {
      const s = controller.getSnapshot();
      const next = (s.mode === "draw" && MODES[s.tool]) || "static";
      if (next === mode) return;
      mode = next;
      draw.setMode("static");
      if (next === "select") loadDrafts();
      else draw.clear();
      onEditing(next === "select");
      draw.setMode(next);
    },
    finish() {
      // Line and polygon modes finish on Enter; Terra Draw has no finish method.
      adapter
        .getMapEventElement()
        .dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
    },
    stop() {
      onEditing(false);
      draw.clear();
      draw.stop();
    },
  };
}
