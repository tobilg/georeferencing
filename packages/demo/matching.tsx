import type { GeoreferencerController } from "@georeferencing/core";
import {
  createOpenLayersProvider,
  openLayersSelection,
} from "@georeferencing/matching/openlayers";
import { MatchingPanel } from "./MatchingPanel.js";
import { showOpenLayersCandidates } from "./matching-overlays.js";
import "./matching.css";
import Feature from "ol/Feature.js";
import LineString from "ol/geom/LineString.js";
import VectorLayer from "ol/layer/Vector.js";
import type OLMap from "ol/Map.js";
import VectorSource from "ol/source/Vector.js";
import { Stroke, Style } from "ol/style.js";
import { useEffect, useMemo, useState } from "react";

function exampleSelection(map: OLMap) {
  if (map.getSize()?.every((value) => value > 0))
    return openLayersSelection(map, ["plan"]);
  // The existing mobile Image tab hides the map. Use a bounded example area
  // around its current centre until the map has a visible viewport.
  const view = map.getView();
  return {
    extent: view.calculateExtent([640, 640]) as [
      number,
      number,
      number,
      number,
    ],
    crs: view.getProjection().getCode(),
    resolution: view.getResolution()!,
    layers: ["plan"],
  };
}
/** Local synthetic engineering marks, suitable for public demo/CI without redistributing user plans. */
export default function DemoMatching({
  map,
  controller,
}: {
  map: OLMap;
  controller: GeoreferencerController;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setup = useMemo(() => {
    const selection = exampleSelection(map),
      [x0, y0, x1, y1] = selection.extent;
    let seed = 42;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const features = Array.from({ length: 300 }, () => {
      const x = x0 + random() * (x1 - x0),
        y = y0 + random() * (y1 - y0),
        w = (x1 - x0) * (0.003 + random() * 0.02),
        h = (y1 - y0) * (0.003 + random() * 0.03);
      return new Feature(
        new LineString([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, y],
          [x + w * 0.4, y + h * 0.7],
        ]),
      );
    });
    const source = new VectorSource({ features }),
      layer = new VectorLayer({
        source,
        style: new Style({
          stroke: new Stroke({ color: "#364954", width: 1.5 }),
        }),
      });
    const provider = createOpenLayersProvider([
      { id: "plan", layer, revision: "synthetic-1" },
    ]);
    return { layer, source, provider, selection };
  }, [map]);
  useEffect(() => {
    map.addLayer(setup.layer);
    return () => {
      map.removeLayer(setup.layer);
      // Local feature-only resources are collected after final unmount. Strict Mode may reattach.
    };
  }, [map, setup]);
  const preview = useMemo(
    () =>
      (
        ...args: Parameters<typeof showOpenLayersCandidates> extends [
          unknown,
          ...infer T,
        ]
          ? T
          : never
      ) =>
        showOpenLayersCandidates(map, ...args),
    [map],
  );
  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const snapshot = await setup.provider.acquire(setup.selection),
        tile = snapshot.tiles[0],
        canvas = document.createElement("canvas");
      canvas.width = Math.floor(tile.width * 0.45);
      canvas.height = Math.floor(tile.height * 0.55);
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(tile.data),
          tile.width,
          tile.height,
        ),
        -Math.floor(tile.width * 0.25),
        -Math.floor(tile.height * 0.2),
      );
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      await controller.loadImage(
        new File([blob], "example-plan.png", { type: "image/png" }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <div className="rg-match-example">
        <div>
          <strong>Try with an example</strong>
          <p>Load a sample image that matches the example plan on the map.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading example…" : "Load example image"}
        </button>
        {error && (
          <p className="rg-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <MatchingPanel
        controller={controller}
        provider={setup.provider}
        layers={[{ id: "plan", label: "Example plan" }]}
        initialSelection={setup.selection}
        configurationRevision="synthetic-1"
        matchOptions={{ maxMemoryBytes: 1024 * 1024 * 1024 }}
        currentSelection={() => exampleSelection(map)}
        onPreview={preview}
      />
    </>
  );
}
