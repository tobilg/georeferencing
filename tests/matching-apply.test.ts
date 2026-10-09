import { createNodeMatcher } from "@georeferencing/matching/node";
import { expect, it } from "vitest";
import { GeoreferencerController } from "../packages/core/src/core/controller.js";
import {
  applyCandidate,
  createApplicationToken,
} from "../packages/matching/src/apply.js";
import { createSnapshot } from "../packages/matching/src/reference.js";
import { cropPixels, syntheticPlan } from "./fixtures/matching.js";

function setup() {
  const image = syntheticPlan(),
    query = cropPixels(image, 130, 160, 250, 260),
    reference = createSnapshot({
      id: "apply",
      width: 640,
      height: 640,
      crs: "EPSG:3857",
      extent: [0, 0, 640, 640],
      source: { id: "synthetic", revision: "1", layers: ["plan"] },
      tiles: [{ ...image, x: 0, y: 0 }],
    });
  const m = createNodeMatcher(),
    controller = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      previewMode: "manual",
      engine: {
        dispose() {},
        async run() {
          return {
            elapsedMs: 0,
            imagePreview: new Blob(),
            metadata: {
              id: "query",
              name: "query.png",
              width: 250,
              height: 260,
              originalWidth: 250,
              originalHeight: 260,
              orientation: 1,
              format: "png",
              fingerprint: "a".repeat(64),
              sizeBytes: 1,
              pixelConvention: "normalized-top-left-corner-y-down",
              georeferenced: false,
            },
          };
        },
      },
    });
  return { m, controller, query, reference };
}

it("applies through controller as one undo step and refuses stale application", async () => {
  const { m, controller, query, reference } = setup();
  try {
    await controller.loadImage(new File(["x"], "query.png"));
    controller.addGcp([20, 20], [150, 460]);
    const before = controller.getSnapshot().document,
      token = createApplicationToken(controller, "config-1"),
      result = await m.match({ query, reference });
    applyCandidate(controller, result, result.candidates[0], reference, token, {
      configurationRevision: "config-1",
    });
    const after = controller.getSnapshot().document;
    expect(after.gcps).toHaveLength(17);
    expect(after.gcps[0]).toEqual(before.gcps[0]);
    expect(after.gcps[1].reference?.sourceId).toContain("matching:synthetic");
    expect(after.alignmentRevision).toBe(before.alignmentRevision + 1);
    expect(() =>
      applyCandidate(
        controller,
        result,
        result.candidates[0],
        reference,
        token,
        { configurationRevision: "config-1" },
      ),
    ).toThrow("changed");
    controller.undo();
    expect(controller.getSnapshot().document.gcps).toEqual(before.gcps);
    expect(controller.getSnapshot().document.model).toBe(before.model);
  } finally {
    m.dispose();
    controller.dispose();
  }
}, 30000);

it("keeps the user's fit model when merging unless the candidate model is requested", async () => {
  const { m, controller, query, reference } = setup();
  try {
    await controller.loadImage(new File(["x"], "query.png"));
    controller.addGcp([20, 20], [150, 460]);
    controller.setModel("polynomial2");
    const result = await m.match({ query, reference }),
      apply = (model?: "keep" | "candidate") =>
        applyCandidate(
          controller,
          result,
          result.candidates[0],
          reference,
          createApplicationToken(controller, "config-1"),
          { configurationRevision: "config-1", model },
        );
    apply();
    expect(controller.getSnapshot().document.model).toBe("polynomial2");
    controller.undo();
    apply("candidate");
    expect(controller.getSnapshot().document.model).toBe(
      result.candidates[0].model,
    );
  } finally {
    m.dispose();
    controller.dispose();
  }
}, 30000);
