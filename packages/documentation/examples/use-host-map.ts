import type { GeoreferencerController } from "@georeferencing/core";
import type { MapAdapter, MapBinding } from "@georeferencing/core/map";
import { type RefCallback, useCallback, useRef, useState } from "react";

/** A host map created for a container element, with its adapter. */
export interface HostMap<M> {
  /** The native map of your map library. */
  map: M;
  /** Adapter connecting the editor to `map`. */
  adapter: MapAdapter;
  /** Destroy the map; called after the editor has detached from it. */
  dispose(): void;
}

/**
 * Create a host map in a container rendered by React, for example inside the guided
 * editor's `referenceView`, and connect the editor to it.
 *
 * React attaches refs before it runs effects, so the map exists when the editor attaches
 * its adapter. The returned adapter is stable and forwards to the current map; the map
 * is disposed only after the editor has detached from it.
 * @param create - Creates the map; keep it stable, for example a module-level function.
 */
export function useHostMap<M>(
  create: (container: HTMLDivElement) => HostMap<M>,
): {
  ref: RefCallback<HTMLDivElement>;
  adapter: MapAdapter;
  current: () => M | null;
} {
  const current = useRef<HostMap<M> | null>(null);
  const [adapter] = useState<MapAdapter>(
    () => (controller: GeoreferencerController) => {
      if (!current.current)
        throw new Error("The map container is not mounted.");
      return current.current.adapter(controller);
    },
  );
  const ref = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container) return;
      const created = create(container);
      let attached = 0,
        removed = false;
      const entry: HostMap<M> = {
        ...created,
        adapter(controller) {
          const binding = created.adapter(controller);
          let detached = false;
          attached++;
          return {
            ...binding,
            detach() {
              if (detached) return;
              detached = true;
              binding.detach();
              if (--attached === 0 && removed) created.dispose();
            },
          } satisfies MapBinding;
        },
      };
      current.current = entry;
      return () => {
        if (current.current === entry) current.current = null;
        removed = true;
        // React removes refs before effect cleanups: wait for the editor to detach.
        if (attached === 0) created.dispose();
      };
    },
    [create],
  );
  return { ref, adapter, current: () => current.current?.map ?? null };
}
