import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fromArrayBuffer } from "geotiff";
import type {} from "./harness/engine.js";
import { openValidation } from "./helpers.js";

test("AC-25 supported TIFF and unsupported sample encoding are explicit", async ({
  page,
}) => {
  await page.goto("/engine.html");
  await page.locator("input").setInputFiles("tests/fixtures/grid-lzw.tif");
  await expect(page.locator("pre")).toContainText("dimensions");
  await page
    .locator("input")
    .setInputFiles("tests/fixtures/unsupported-16bit.tif");
  await expect(page.locator("pre")).toContainText("Supported TIFF");
});
for (const extension of ["jpg", "png"])
  test(`AC-25 all eight ${extension} orientations agree between preview and compressed export`, async ({
    page,
  }) => {
    await page.goto("/engine.html");
    await page.waitForFunction(() => Boolean(window.engine));
    const expected = [
      [0, 1, 2, 3],
      [1, 0, 3, 2],
      [3, 2, 1, 0],
      [2, 3, 0, 1],
      [0, 2, 1, 3],
      [2, 0, 3, 1],
      [3, 1, 2, 0],
      [1, 3, 0, 2],
    ];
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
    ];
    for (let orientation = 1; orientation <= 8; orientation++) {
      await page
        .locator("input")
        .setInputFiles(`tests/fixtures/exif-${orientation}.${extension}`);
      const result = await page.evaluate(async () => {
        const file = document.querySelector("input")!.files![0];
        const tag = {
          documentId: "orientation",
          imageId: "jpeg",
          alignmentRevision: 1,
        };
        const inspected = await window.engine.run(
            { kind: "inspect", file },
            tag,
          ),
          metadata = inspected.metadata!;
        const gcps = [
          [0, 0],
          [metadata.width, 0],
          [0, metadata.height],
        ].map(([x, y], i) => ({
          id: String(i),
          label: i,
          enabled: true,
          image: [x, y] as [number, number],
          target: [1000 + x, 2000 - y] as [number, number],
          crs: "EPSG:3857",
        }));
        const { fit } = await window.engine.run(
          {
            kind: "fit",
            gcps,
            model: "polynomial1",
            workingCrs: "EPSG:3857",
            metadata,
          },
          tag,
        );
        const warped = await window.engine.run(
          {
            kind: "render",
            file,
            metadata,
            fit: fit!,
            workingCrs: "EPSG:3857",
            output: {
              crs: "EPSG:3857",
              resolution: [1, 1],
              resampler: "nearest",
              compression: "deflate",
            },
            preview: false,
          },
          tag,
        );
        const rendered = await window.encodeRaster(
          warped.raster!,
          {
            crs: "EPSG:3857",
            resolution: [1, 1],
            resampler: "nearest",
            compression: "deflate",
          },
          tag,
        );
        const canvas = document.createElement("canvas"),
          bitmap = await createImageBitmap(inspected.imagePreview!);
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const samples = (data: Uint8ClampedArray) =>
          [
            [0.25, 0.25],
            [0.75, 0.25],
            [0.25, 0.75],
            [0.75, 0.75],
          ].map(([x, y]) => {
            const p =
              (Math.floor(y * metadata.height) * metadata.width +
                Math.floor(x * metadata.width)) *
              4;
            return [...data.slice(p, p + 4)];
          });
        return {
          dimensions: [metadata.width, metadata.height],
          orientation: metadata.orientation,
          preview: samples(
            ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          ),
          exported: samples(rendered.raster!.data),
          tiff: [...new Uint8Array(await rendered.blob!.arrayBuffer())],
        };
      });
      expect(result.dimensions).toEqual(orientation >= 5 ? [40, 80] : [80, 40]);
      expect(result.orientation).toBe(orientation);
      expect(result.exported).toEqual(result.preview);
      for (let q = 0; q < 4; q++)
        for (let c = 0; c < 4; c++)
          expect(
            Math.abs(
              result.exported[q][c] - colors[expected[orientation - 1][q]][c],
            ),
          ).toBeLessThan(15);
      const tif = await fromArrayBuffer(new Uint8Array(result.tiff).buffer),
        image = await tif.getImage();
      expect(image.getFileDirectory().getValue("Compression")).toBe(8);
      const samples = await image.readRasters({ interleave: true });
      for (const [q, [x, y]] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ].entries()) {
        const offset =
          (Math.floor(y * result.dimensions[1]) * result.dimensions[0] +
            Math.floor(x * result.dimensions[0])) *
          4;
        expect([...samples.slice(offset, offset + 4)]).toEqual(
          result.exported[q],
        );
      }
    }
  });

test("AC-22 oriented source world-file export includes normalized original-resolution pixels", async ({
  page,
}) => {
  await openValidation(page);
  await page
    .getByLabel("Choose image", { exact: true })
    .setInputFiles("tests/fixtures/exif-6.png");
  await page.waitForFunction(() =>
    Boolean(
      window.validation.editors[0].controller.getSnapshot().document
        .sourceImage,
    ),
  );
  await page.evaluate(() => {
    const c = window.validation.editors[0].controller,
      metadata = c.getSnapshot().document.sourceImage!;
    c.replaceGcps(
      [
        [0, 0],
        [metadata.width, metadata.height],
      ].map(([x, y], i) => ({
        id: `world-${i}`,
        label: i + 1,
        enabled: true,
        image: [x, y],
        target: [1000 + 2 * x, 2000 - 3 * y],
        crs: "EPSG:3857",
      })),
    );
    c.setModel("linear");
  });
  await page.waitForFunction(
    () =>
      window.validation.editors[0].controller.getSnapshot().fit?.model ===
      "linear",
  );
  const output = await page.evaluate(async () => {
    const c = window.validation.editors[0].controller,
      result = await c.exportWorldFile();
    if (!result) throw Error(c.getSnapshot().error!);
    const bitmap = await createImageBitmap(result.blob),
      canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      png: [...new Uint8Array(await result.blob.arrayBuffer())],
      width: canvas.width,
      height: canvas.height,
      first: [...ctx.getImageData(5, 5, 1, 1).data],
      world: result.worldFile,
      revision: result.document.documentRevision,
      current: c.getSnapshot().document.documentRevision,
    };
  });
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    `artifacts/world-file-${test.info().project.name}.png`,
    new Uint8Array(output.png),
  );
  writeFileSync(
    `artifacts/world-file-${test.info().project.name}.pgw`,
    output.world.text,
  );
  writeFileSync(
    `artifacts/world-file-${test.info().project.name}.crs.json`,
    JSON.stringify({ crs: output.world.crs, revision: output.revision }),
  );
  expect([output.width, output.height]).toEqual([40, 80]);
  expect(output.first).toEqual([0, 0, 255, 255]);
  expect(output.world.crs).toBe("EPSG:3857");
  expect(output.revision).toBe(output.current);
  output.world.text
    .trim()
    .split("\n")
    .map(Number)
    .forEach((n, i) => {
      expect(n).toBeCloseTo([2, 0, 0, -3, 1001, 1998.5][i], 9);
    });
});

test("IMG-05/AC-25 static WebP normalizes all EXIF orientations in the worker", async ({
  page,
}) => {
  await page.route("**/elbphilharmonie.webp", (route) =>
    route.fulfill({
      path: "packages/demo/public/elbphilharmonie.webp",
      contentType: "image/webp",
    }),
  );
  await page.route("**/webp-quadrants", (route) =>
    route.fulfill({
      contentType: "image/webp",
      body: readFileSync("tests/fixtures/quadrants.webp"),
    }),
  );
  await page.goto("/engine.html");
  await page.waitForFunction(() => Boolean(window.engine));
  const result = await page.evaluate(async () => {
    const blob = await (await fetch("/webp-quadrants")).blob();
    const original = await (await fetch("/elbphilharmonie.webp")).blob();
    const tag = {
      documentId: "webp-orientation",
      imageId: "webp",
      alignmentRevision: 1,
    };
    const inspected = await window.engine.run(
      { kind: "inspect", file: new File([original], "hamburg.webp") },
      tag,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      view = new DataView(bytes.buffer);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let p = 12; p < bytes.length; ) {
      const length = view.getUint32(p + 4, true),
        tag = view.getUint32(p);
      if (tag !== 0x56503858 && tag !== 0x45584946)
        chunks.push(bytes.slice(p, p + 8 + length + (length % 2)));
      p += 8 + length + (length % 2);
    }
    const orientations = [];
    for (let orientation = 1; orientation <= 8; orientation++) {
      const extended = new Uint8Array(18);
      extended.set(new TextEncoder().encode("VP8X"));
      new DataView(extended.buffer).setUint32(4, 10, true);
      extended[8] = 8;
      extended[12] = 39;
      extended[15] = 19;
      const exif = new Uint8Array(34),
        ev = new DataView(exif.buffer);
      exif.set(new TextEncoder().encode("EXIF"));
      ev.setUint32(4, 26, true);
      ev.setUint16(8, 0x4949);
      ev.setUint16(10, 42, true);
      ev.setUint32(12, 8, true);
      ev.setUint16(16, 1, true);
      ev.setUint16(18, 274, true);
      ev.setUint16(20, 3, true);
      ev.setUint32(22, 1, true);
      ev.setUint16(26, orientation, true);
      const header = bytes.slice(0, 12);
      new DataView(header.buffer).setUint32(
        4,
        4 +
          extended.length +
          chunks.reduce((n, v) => n + v.length, 0) +
          exif.length,
        true,
      );
      const file = new File(
        [header, extended, ...chunks, exif],
        `orientation-${orientation}.webp`,
      );
      const { metadata, imagePreview } = await window.engine.run(
        { kind: "inspect", file },
        tag,
      );
      const bitmap = await createImageBitmap(imagePreview!);
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = surface.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      orientations.push({
        orientation: metadata!.orientation,
        width: metadata!.width,
        height: metadata!.height,
        samples: [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ].map(([x, y]) => [
          ...context.getImageData(
            Math.floor(x * surface.width),
            Math.floor(y * surface.height),
            1,
            1,
          ).data,
        ]),
      });
      surface.width = 0;
    }
    return {
      width: inspected.metadata!.width,
      height: inspected.metadata!.height,
      orientations,
    };
  });
  expect([result.width, result.height]).toEqual([1240, 697]);
  const order = [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [3, 2, 1, 0],
    [2, 3, 0, 1],
    [0, 2, 1, 3],
    [2, 0, 3, 1],
    [3, 1, 2, 0],
    [1, 3, 0, 2],
  ];
  const colors = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ];
  for (const row of result.orientations) {
    expect([row.width, row.height]).toEqual(
      row.orientation >= 5 ? [20, 40] : [40, 20],
    );
    for (const [i, sample] of row.samples.entries()) {
      for (const [channel, value] of sample.entries()) {
        expect(
          Math.abs(value - colors[order[row.orientation - 1][i]][channel]),
        ).toBeLessThan(12);
      }
    }
  }
});
