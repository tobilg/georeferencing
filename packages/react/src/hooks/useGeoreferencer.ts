import type { GeoreferencerController } from "@georeferencing/core";
import { useSyncExternalStore } from "react";

/**
 * Subscribe to a controller with React useSyncExternalStore and read its stable
 * EditorSnapshot. The hook does not attach maps or own controller lifecycle.
 */
export function useGeoreferencer(controller: GeoreferencerController) {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}
