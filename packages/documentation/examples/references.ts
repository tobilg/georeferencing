import type { Extent } from "@georeferencing/core/core";
import type { BindingOptions } from "@georeferencing/openlayers";
import type Feature from "ol/Feature.js";
import type VectorLayer from "ol/layer/Vector.js";
import type VectorSource from "ol/source/Vector.js";

export function referenceOptions(
  url: string,
  typeName: string,
  projectedCrs: string,
  bounds: Extent,
  hostLayer: VectorLayer<VectorSource<Feature>>,
): BindingOptions {
  return {
    references: [
      {
        kind: "wfs",
        id: "service",
        label: "Reference service",
        url,
        version: "2.0.0",
        typeNames: [typeName],
        requestCrs: projectedCrs,
        responseCrs: projectedCrs,
        axisOrder: "xy",
        responseAxisOrder: "xy",
        responseFormat: "geojson",
        queryBounds: { extent: bounds, crs: projectedCrs },
        loading: "viewport",
        pageSize: 500,
        maxFeatures: 5000,
        request: (address, init) =>
          fetch(address, { ...init, credentials: "include" }),
        snapping: { vertices: true, tolerancePx: 10 },
      },
      {
        kind: "existing-vector",
        id: "host-layer",
        label: "Existing host layer",
        layer: hostLayer,
        snapping: { vertices: true },
      },
    ],
    digitizingSnapping: { references: true, drafts: true },
  };
}
