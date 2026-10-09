import assert from "node:assert/strict";
import { createSnapshot } from "@georeferencing/matching";
import { createNodeMatcher } from "@georeferencing/matching/node";
import { cropPixels, syntheticPlan } from "./matching-fixture.js";

const image = syntheticPlan(),
  matcher = createNodeMatcher();
try {
  const result = await matcher.match({
    query: cropPixels(image, 130, 160, 250, 260),
    reference: createSnapshot({
      id: "packed-node",
      width: 640,
      height: 640,
      extent: [0, 0, 640, 640],
      crs: "EPSG:3857",
      source: { id: "plan", revision: "1", layers: ["plan"] },
      tiles: [{ ...image, x: 0, y: 0 }],
    }),
  });
  assert.equal(result.status, "matched");
  assert(result.candidates[0].independentInliers >= 12);
  console.log("Packed Node worker and WASM passed");
} finally {
  matcher.dispose();
}
