import { createWorkerEngine } from "@georeferencing/core/engine";
import { captureMapLibreMap, maplibre } from "@georeferencing/maplibre";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { pdf } from "@georeferencing/plugins/pdf";
import {
  type ControllerOptions,
  Georeferencer,
  GeoreferencerController,
} from "@georeferencing/react";
import { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { type HostMap, useHostMap } from "./use-host-map.js";

function createMap(container: HTMLDivElement): HostMap<MapLibreMap> {
  const map = new MapLibreMap({ container, style: "/map-style.json" });
  return { map, adapter: maplibre(map), dispose: () => map.remove() };
}

/** One editor session: a controller and the engine it uses. */
interface EditorSession {
  controller: GeoreferencerController;
  dispose(): void;
}

function createSession(
  persist: NonNullable<ControllerOptions["onSave"]>,
  currentMap: () => MapLibreMap | null,
): EditorSession {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs: "EPSG:3857",
    engine,
    digitizing: true,
    onSave: persist,
    exports: [
      geoTiff(),
      // Read the map when the report is made; without a map the page is omitted.
      pdf({
        capture: () => {
          const map = currentMap();
          return map ? captureMapLibreMap(map) : undefined;
        },
      }),
    ],
  });
  return {
    controller,
    dispose() {
      controller.dispose();
      engine.dispose();
    },
  };
}

export function EditorPage({
  persist,
}: {
  persist: NonNullable<ControllerOptions["onSave"]>;
}) {
  const hostMap = useHostMap(createMap);
  const [session, setSession] = useState<EditorSession | null>(null);
  const closed = useRef<EditorSession | null>(null);
  // Runs after the editor has unmounted and detached: now the session can be disposed.
  useEffect(() => {
    if (session) return;
    closed.current?.dispose();
    closed.current = null;
  }, [session]);

  if (!session)
    return (
      <button
        type="button"
        onClick={() => setSession(createSession(persist, hostMap.current))}
      >
        Georeference an image
      </button>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          closed.current = session;
          setSession(null);
        }}
      >
        Close editor
      </button>
      <Georeferencer
        controller={session.controller}
        map={hostMap.adapter}
        referenceView={<div ref={hostMap.ref} style={{ height: 480 }} />}
      />
    </>
  );
}
