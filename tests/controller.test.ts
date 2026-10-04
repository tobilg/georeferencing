import { worldFile } from "@georeferencing/plugins/data";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { describe, expect, it, vi } from "vitest";
import type {
  ControllerOptions,
  SaveEnvelope,
} from "../packages/core/src/core/controller.js";
import { GeoreferencerController } from "../packages/core/src/core/controller.js";
import { fitTransform } from "../packages/core/src/core/transform.js";
import type { ImageMetadata } from "../packages/core/src/core/types.js";
import type {
  Engine,
  EngineResult,
} from "../packages/core/src/engine/index.js";
import { fixture } from "./fixtures/models.js";

const metadata: ImageMetadata = {
  id: "image-A",
  name: "grid.png",
  width: 100,
  height: 100,
  originalWidth: 100,
  originalHeight: 100,
  orientation: 1,
  format: "png",
  fingerprint: "a".repeat(64),
  sizeBytes: 100,
  pixelConvention: "normalized-top-left-corner-y-down",
  georeferenced: false,
};
const file = new File(["fixture"], "grid.png");
const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function engine(): Engine {
  return {
    dispose: vi.fn(),
    run: async (request) => {
      if (request.kind === "inspect")
        return {
          metadata: { ...metadata, id: request.file.name },
          imagePreview: new Blob(["preview"]),
          elapsedMs: 1,
        };
      if (request.kind === "fit")
        return { fit: fitTransform(request.gcps, request.model), elapsedMs: 1 };
      return {
        raster: {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray(4),
          bounds: [1000, 1700, 1230, 2020],
          crs: "EPSG:3857",
          estimatedBytes: 100,
        },
        blob: new Blob(["TIFF"]),
        elapsedMs: 1,
      };
    },
  };
}
async function ready(options: Partial<ControllerOptions> = {}) {
  const c = new GeoreferencerController({
    workingCrs: "EPSG:3857",
    engine: engine(),
    digitizing: true,
    exports: [geoTiff(), worldFile()],
    ...options,
  });
  await c.loadImage(file);
  c.replaceGcps(fixture("polynomial1"));
  await vi.waitFor(() => expect(c.getSnapshot().fit).not.toBeNull());
  c.confirm();
  return c;
}
function addPoint(c: GeoreferencerController, id: string) {
  const fs = c.getSnapshot().document.features;
  c.setFeatures({
    type: "FeatureCollection",
    features: [
      ...fs.features,
      {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [0.01, 0.02] },
        properties: { name: id },
      },
    ],
  });
}
describe("revision and lifecycle contract", () => {
  it("AC-17 late export failure cannot overwrite a restarted export", async () => {
    const implementation = engine(),
      base = implementation.run;
    const old = deferred<EngineResult>(),
      fresh = deferred<EngineResult>();
    let exports = 0;
    implementation.run = (request, tag, options) =>
      request.kind === "render" && !request.preview
        ? ++exports === 1
          ? old.promise
          : fresh.promise
        : base(request, tag, options);
    const c = await ready({ engine: implementation });
    const first = c.exportRaster();
    await vi.waitFor(() => expect(exports).toBe(1));
    c.cancelExport();
    const next = c.exportRaster();
    await vi.waitFor(() => expect(exports).toBe(2));
    old.reject(Error("obsolete export failure"));
    expect(await first).toBeNull();
    expect(c.getSnapshot().exporting).toBe("running");
    expect(c.getSnapshot().error).toBeNull();
    fresh.resolve({
      blob: new Blob(["fresh TIFF"]),
      raster: {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(4),
        bounds: [0, 0, 1, 1],
        crs: "EPSG:3857",
        estimatedBytes: 4,
      },
      elapsedMs: 1,
    });
    expect((await next)?.blob.size).toBe(4);
    expect(c.getSnapshot().exporting).toBe("succeeded");
    c.dispose();
  });
  it("OUT-07/DIG-12 invalid topology remains restorable as a draft but cannot be accepted", async () => {
    let snapshot = "";
    const c = await ready({
      guard: async () => "discard",
      onSaveDraft: async ({ document }) => {
        snapshot = JSON.stringify(document);
      },
    });
    c.setFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "bowtie",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [3, 3],
                [3, 0],
                [0, 3],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    expect(c.canSaveFeatures()).toBe(false);
    await c.save("draft");
    expect(await c.restoreSession(snapshot, file)).toBe(true);
    await vi.waitFor(() => expect(c.getSnapshot().fit).not.toBeNull());
    c.confirm();
    expect(c.getSnapshot().document.features.features[0].id).toBe("bowtie");
    expect(c.canSaveFeatures()).toBe(false);
    c.deleteFeature("bowtie");
    expect(c.canSaveFeatures()).toBe(true);
    c.dispose();
  });
  it("OUT-02 snapshots diagnostics before synchronous realignment after save", async () => {
    const save = vi.fn(async (_snapshot: SaveEnvelope) => {});
    const c = await ready({ onSave: save });
    const oldRevision = c.getSnapshot().document.documentRevision;
    const pending = c.save();
    c.returnToAlignment();
    c.updateGcp(c.getSnapshot().document.gcps[0].id, { target: [1001, 2000] });
    await pending;
    expect(save.mock.calls[0][0].documentRevision).toBe(oldRevision);
    expect(c.getSnapshot().dirty).toBe(true);
    c.dispose();
  });
  it("DIG-07 arbitrary string feature IDs do not inherit object properties", async () => {
    const c = await ready();
    const id = "__proto__";
    addPoint(c, id);
    expect(
      c.getSnapshot().document.provenanceByFeatureId[id].sourceImageId,
    ).toBe("grid.png");
    expect(Object.isFrozen(Object.prototype)).toBe(false);
    c.dispose();
  });
  it("AC-14 immutable older save acknowledgement cannot mark later edits saved", async () => {
    const wait = deferred<void>();
    let snapshot: SaveEnvelope | undefined;
    const c = await ready({
      onSave: async (s) => {
        snapshot = s;
        await wait.promise;
      },
    });
    addPoint(c, "one");
    const save = c.save();
    await Promise.resolve();
    addPoint(c, "two");
    expect(Object.isFrozen(snapshot!.document)).toBe(true);
    expect(snapshot!.features.features).toHaveLength(1);
    wait.resolve();
    await save;
    expect(c.getSnapshot().dirty).toBe(true);
    expect(c.getSnapshot().savedRevision).toBe(snapshot!.documentRevision);
    expect(c.getSnapshot().document.features.features).toHaveLength(2);
    c.dispose();
  });
  it("AC-13 retry uses same idempotency key and preserves complete draft, including synchronous failure", async () => {
    const ids: string[] = [];
    let reject = true;
    const c = await ready({
      onSave: (s) => {
        ids.push(s.requestId);
        if (reject) throw Error("offline");
        return Promise.resolve();
      },
    });
    addPoint(c, "one");
    await expect(c.save()).rejects.toThrow("offline");
    expect(c.getSnapshot().dirty).toBe(true);
    reject = false;
    await c.save();
    expect(ids[0]).toBe(ids[1]);
    expect(c.getSnapshot().dirty).toBe(false);
    c.dispose();
  });
  it("AC-15 realignment preserves geography, invalidates review; undo cannot revive stale confirmation", async () => {
    const c = await ready({ onSave: async () => {} });
    addPoint(c, "one");
    const geometry = c.getSnapshot().document.features;
    c.returnToAlignment();
    c.updateGcp(c.getSnapshot().document.gcps[0].id, { target: [1001, 2000] });
    expect(c.getSnapshot().document.features).toEqual(geometry);
    expect(c.getSnapshot().document.confirmedAlignmentRevision).toBeNull();
    c.undo();
    await vi.waitFor(() => expect(c.getSnapshot().fit).not.toBeNull());
    expect(c.getSnapshot().document.confirmedAlignmentRevision).toBeNull();
    c.confirm();
    expect(c.canSaveFeatures()).toBe(false);
    c.reviewFeatures();
    expect(c.canSaveFeatures()).toBe(true);
    c.dispose();
  });
  it("AC-16 failed guard save and cancel retain image; unfinished draft uses draft callback", async () => {
    let choice: "save" | "discard" | "cancel" = "save";
    const save = vi.fn(async () => {
        throw Error("offline");
      }),
      accepted = vi.fn(async () => {});
    const c = await ready({
      onSaveDraft: save,
      onSave: accepted,
      guard: async () => choice,
    });
    c.returnToAlignment();
    c.setModel("polynomial2");
    const old = c.getSnapshot().document.id;
    expect(await c.removeImage()).toBe(false);
    expect(c.getSnapshot().document.id).toBe(old);
    expect(accepted).not.toHaveBeenCalled();
    choice = "cancel";
    expect(await c.removeImage()).toBe(false);
    choice = "discard";
    expect(await c.removeImage()).toBe(true);
    expect(c.getSnapshot().document.sourceImage).toBeNull();
    c.dispose();
  });
  it("AC-16 rechecks guard if user edits during draft save", async () => {
    const wait = deferred<void>();
    let calls = 0;
    const c = await ready({
      onSaveDraft: async () => wait.promise,
      guard: async () => (++calls === 1 ? "save" : "cancel"),
    });
    const removal = c.removeImage();
    await vi.waitFor(() => expect(c.getSnapshot().saving).toBe("running"));
    addPoint(c, "late");
    wait.resolve();
    expect(await removal).toBe(false);
    expect(calls).toBe(2);
    expect(c.getSnapshot().document.features.features).toHaveLength(1);
    c.dispose();
  });
  it("AC-17 late fit and export responses never populate replacement image", async () => {
    const implementation = engine(),
      oldRun = implementation.run,
      fitWait = deferred<EngineResult>(),
      exportWait = deferred<EngineResult>();
    let hold = false;
    implementation.run = (request, tag, options) =>
      hold && request.kind === "fit"
        ? fitWait.promise
        : hold && request.kind === "render" && !request.preview
          ? exportWait.promise
          : oldRun(request, tag, options);
    const c = await ready({
      engine: implementation,
      guard: async () => "discard",
    });
    hold = true;
    const exporting = c.exportRaster();
    c.returnToAlignment();
    c.updateGcp(c.getSnapshot().document.gcps[0].id, { target: [1001, 2000] });
    hold = false;
    await c.loadImage(new File(["next"], "B.png"));
    fitWait.resolve({
      fit: fitTransform(fixture("polynomial1"), "polynomial1"),
      elapsedMs: 0,
    });
    exportWait.resolve({ blob: new Blob(["old"]), elapsedMs: 0 });
    expect(await exporting).toBeNull();
    await Promise.resolve();
    expect(c.getSnapshot().document.sourceImage!.id).toBe("B.png");
    expect(c.getSnapshot().fit).toBeNull();
    c.dispose();
  });
  it("OUT-07 restore verifies matching image bytes, schema, identities and permits resumed drawings", async () => {
    const c = await ready({ guard: async () => "discard" });
    addPoint(c, "stable");
    const session = JSON.stringify(c.getSnapshot().document);
    const parsed = JSON.parse(session);
    parsed.sourceImage.fingerprint = "b".repeat(64);
    expect(await c.restoreSession(JSON.stringify(parsed), file)).toBe(false);
    expect(c.getSnapshot().document.features.features[0].id).toBe("stable");
    expect(await c.restoreSession(session, file)).toBe(true);
    await vi.waitFor(() => expect(c.getSnapshot().fit).not.toBeNull());
    c.confirm();
    expect(c.canSaveFeatures()).toBe(true);
    c.dispose();
  });
  it("AC-32 isolated controllers and document-scoped feature deletions", async () => {
    const save = vi.fn(async (_snapshot: SaveEnvelope) => {}),
      a = await ready({ onSave: save }),
      b = await ready();
    addPoint(a, "one");
    addPoint(b, "two");
    a.deleteFeature("one");
    await a.save();
    expect(b.getSnapshot().document.features.features[0].id).toBe("two");
    expect(save.mock.calls[0][0]).toMatchObject({
      semantics: "replace-document-features",
      features: { features: [] },
      documentId: a.getSnapshot().document.id,
    });
    a.dispose();
    b.dispose();
  });
});

describe("optional export plugins", () => {
  it("PKG-01 no format or lazy exporter is activated implicitly", async () => {
    const c = await ready({ exports: [] });
    expect(c.getSnapshot().exportFormats).toEqual([]);
    await expect(c.exportRaster()).rejects.toMatchObject({
      code: "EXPORT_DISABLED",
    });
    expect(c.getSnapshot().document.confirmedAlignmentRevision).not.toBeNull();
    addPoint(c, "without-export");
    expect(c.getSnapshot().document.features.features).toHaveLength(1);
    c.dispose();
  });
  it("PKG-01 validates format IDs and loads only the selected implementation", async () => {
    const load = vi.fn();
    const c = await ready({
      exports: [{ id: "unused", label: "Unused", load }],
    });
    expect(load).not.toHaveBeenCalled();
    expect(() =>
      c.setExportFormats([
        { id: "same", label: "A", load },
        { id: "same", label: "B", load },
      ]),
    ).toThrow();
    expect(c.getSnapshot().exportFormats.map((x) => x.id)).toEqual(["unused"]);
    c.dispose();
  });
  it("AC-17 cancelled lazy loading cannot start work or report late errors", async () => {
    const loading = deferred<import("@georeferencing/core").Exporter>();
    const c = await ready({
      exports: [{ id: "slow", label: "Slow", load: () => loading.promise }],
    });
    const result = c.export("slow");
    c.cancelExport();
    expect(await result).toBeNull();
    loading.reject(Error("late module failure"));
    await Promise.resolve();
    expect(c.getSnapshot().exporting).toBe("cancelled");
    expect(c.getSnapshot().error).toBeNull();
    c.dispose();
  });
  it("AC-17 removing a running format ignores its result and aborts its context", async () => {
    const work = deferred<import("@georeferencing/core").ExportContent>();
    let signal: AbortSignal | undefined;
    const c = await ready({
      exports: [
        {
          id: "custom",
          label: "Custom",
          load: async () => ({
            run: (ctx) => {
              signal = ctx.signal;
              return work.promise;
            },
          }),
        },
      ],
    });
    const result = c.export("custom");
    await vi.waitFor(() => expect(signal).toBeDefined());
    c.setExportFormats([]);
    expect(signal!.aborted).toBe(true);
    expect(await result).toBeNull();
    const blob = new Blob(["obsolete"]);
    work.resolve({ blob, files: [{ name: "old.txt", blob }] });
    await Promise.resolve();
    expect(c.getSnapshot().exporting).toBe("cancelled");
    c.dispose();
  });
  it("OUT-01 preview-affecting output changes abort a running export", async () => {
    const work = deferred<import("@georeferencing/core").ExportContent>();
    let signal: AbortSignal | undefined;
    const c = await ready({
      exports: [
        {
          id: "custom",
          label: "Custom",
          load: async () => ({
            run: (ctx) => {
              signal = ctx.signal;
              return work.promise;
            },
          }),
        },
      ],
    });
    const result = c.export("custom");
    await vi.waitFor(() => expect(signal).toBeDefined());
    c.setOutput({ ...c.getSnapshot().document.output, resampler: "cubic" });
    expect(signal!.aborted).toBe(true);
    expect(c.getSnapshot().exporting).toBe("cancelled");
    expect(await result).toBeNull();
    const blob = new Blob(["stale"]);
    work.resolve({ blob, files: [{ name: "stale.txt", blob }] });
    await Promise.resolve();
    expect(c.getSnapshot().exporting).toBe("cancelled");
    c.dispose();
  });
  it("OUT-01 lazy-load failure remains retryable", async () => {
    const blob = new Blob(["retry"]);
    const load = vi
      .fn()
      .mockRejectedValueOnce(Error("offline module"))
      .mockResolvedValue({
        run: async () => ({ blob, files: [{ name: "retry.txt", blob }] }),
      });
    const c = await ready({ exports: [{ id: "retry", label: "Retry", load }] });
    expect(await c.export("retry")).toBeNull();
    expect(c.getSnapshot().exporting).toBe("failed");
    expect((await c.export("retry"))?.blob).toBe(blob);
    expect(c.getSnapshot().error).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    c.dispose();
  });
  it("OUT-07 export captures immutable provenance while newer drawings remain dirty", async () => {
    const work = deferred<import("@georeferencing/core").ExportContent>();
    let captured: import("@georeferencing/core").Document | undefined;
    const c = await ready({
      exports: [
        {
          id: "snapshot",
          label: "Snapshot",
          load: async () => ({
            run: (ctx) => {
              captured = ctx.document;
              return work.promise;
            },
          }),
        },
      ],
    });
    const result = c.export("snapshot");
    await vi.waitFor(() => expect(captured).toBeDefined());
    addPoint(c, "newer");
    expect(captured!.features.features).toHaveLength(0);
    expect(Object.isFrozen(captured)).toBe(true);
    const blob = new Blob(["snapshot"]);
    work.resolve({ blob, files: [{ name: "snapshot.json", blob }] });
    expect((await result)?.document).toBe(captured);
    expect(c.getSnapshot().document.documentRevision).toBeGreaterThan(
      captured!.documentRevision,
    );
    expect(c.getSnapshot().dirty).toBe(true);
    c.dispose();
  });
});

describe("FIT-02 explicit preview policy", () => {
  it("manual mode waits through edits/history/restore/remount and invalidates stale acceptance", async () => {
    const implementation = engine();
    const run = vi.spyOn(implementation, "run");
    const c = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      engine: implementation,
      previewMode: "manual",
      digitizing: true,
      guard: async () => "discard",
    });
    await c.loadImage(file);
    c.replaceGcps(fixture("polynomial1"));
    expect(c.getSnapshot().error).toBeNull();
    expect(run.mock.calls.map(([request]) => request.kind)).toEqual([
      "inspect",
    ]);
    await c.refit();
    expect(c.getSnapshot().fitRevision).toBe(
      c.getSnapshot().document.alignmentRevision,
    );
    c.confirm();
    expect(c.canSaveFeatures()).toBe(true);
    c.returnToAlignment();
    run.mockClear();
    c.updateGcp("gcp-0", { target: [1001, 2000] });
    c.undo();
    c.redo();
    expect(c.getSnapshot().fit).toBeNull();
    expect(c.getSnapshot().document.confirmedAlignmentRevision).toBeNull();
    expect(c.canSaveFeatures()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    c.suspend();
    c.start();
    expect(run).not.toHaveBeenCalled();
    const session = JSON.stringify(c.getSnapshot().document);
    await c.restoreSession(session, file);
    expect(run.mock.calls.map(([request]) => request.kind)).toEqual([
      "inspect",
    ]);
    expect(c.getSnapshot().previewMode).toBe("manual");
    await c.refit();
    expect(c.getSnapshot().preview).not.toBeNull();
    c.setOutput({ ...c.getSnapshot().document.output, resampler: "cubic" });
    expect(c.getSnapshot().fit).toBeNull();
    expect(c.getSnapshot().preview).toBeNull();
    c.dispose();
  });
  it("automatic mode waits for the selected model's minimum, then fits complete pairs", async () => {
    const implementation = engine(),
      run = vi.spyOn(implementation, "run");
    const c = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      engine: implementation,
    });
    await c.loadImage(file);
    const points = fixture("polynomial1");
    c.replaceGcps(points.slice(0, 2));
    expect(c.getSnapshot().fitting).toBe("idle");
    expect(c.getSnapshot().error).toBeNull();
    expect(run.mock.calls.map(([request]) => request.kind)).toEqual([
      "inspect",
    ]);
    c.addGcp(points[2].image, points[2].target);
    await vi.waitFor(() => expect(c.getSnapshot().fit).not.toBeNull());
    const revision = c.getSnapshot().document.documentRevision;
    c.setPreviewMode("manual");
    expect(c.getSnapshot().document.documentRevision).toBe(revision);
    expect(c.getSnapshot().fit).not.toBeNull();
    c.setModel("polynomial2");
    c.setPreviewMode("automatic");
    expect(c.getSnapshot().fit).toBeNull();
    expect(c.getSnapshot().error).toBeNull();
    c.dispose();
  });
  it("switching to manual cancels and rejects a late automatic fit", async () => {
    const implementation = engine(),
      base = implementation.run;
    const pending = deferred<EngineResult>();
    implementation.run = vi.fn((request, tag, options) =>
      request.kind === "fit" ? pending.promise : base(request, tag, options),
    );
    const c = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      engine: implementation,
    });
    await c.loadImage(file);
    c.replaceGcps(fixture("polynomial1"));
    expect(c.getSnapshot().fitting).toBe("running");
    c.setPreviewMode("manual");
    pending.resolve({
      fit: fitTransform(fixture("polynomial1"), "polynomial1"),
      elapsedMs: 1,
    });
    await Promise.resolve();
    expect(c.getSnapshot().fitting).toBe("cancelled");
    expect(c.getSnapshot().preview).toBeNull();
    expect(c.getSnapshot().fit).toBeNull();
    expect(
      vi.mocked(implementation.run).mock.calls.map(([request]) => request.kind),
    ).toEqual(["inspect", "fit"]);
    implementation.run = base;
    c.setPreviewMode("automatic");
    await vi.waitFor(() => expect(c.getSnapshot().fitting).toBe("succeeded"));
    c.dispose();
  });
  it("manual runs reject pending pairs and degenerate geometry without confirming", async () => {
    const c = new GeoreferencerController({
      workingCrs: "EPSG:3857",
      engine: engine(),
      previewMode: "manual",
    });
    await c.loadImage(file);
    c.replaceGcps(fixture("polynomial1").slice(0, 3));
    c.setPendingPoint([20, 20]);
    await c.refit();
    expect(c.getSnapshot().errorDetail?.code).toBe("PENDING_PAIR");
    expect(c.getSnapshot().fit).toBeNull();
    c.setPendingPoint(null);
    c.replaceGcps(
      fixture("polynomial1")
        .slice(0, 3)
        .map((p, i) => ({ ...p, image: [i * 10, i * 10] })),
    );
    await c.refit();
    expect(c.getSnapshot().fitting).toBe("failed");
    expect(() => c.confirm()).toThrow(/valid fit/);
    expect(c.getSnapshot().preview).toBeNull();
    c.dispose();
  });
});
