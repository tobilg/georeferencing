import { createNodeMatcher } from "@georeferencing/matching/node";
import { describe, expect, it } from "vitest";
import { corners, transform } from "../packages/matching/src/geometry.js";
import { createSnapshot } from "../packages/matching/src/reference.js";
import type { Detector } from "../packages/matching/src/types.js";
import { cropPixels, syntheticPlan } from "./fixtures/matching.js";

export const image = syntheticPlan(),
  query = cropPixels(image, 130, 160, 250, 260);
export function snapshot(tiles = [{ ...image, x: 0, y: 0 }]) {
  return createSnapshot({
    id: "synthetic-1",
    width: image.width,
    height: image.height,
    extent: [0, 0, 640, 640],
    crs: "EPSG:3857",
    source: { id: "plan", revision: "1", layers: ["plan"] },
    tiles,
  });
}
// Node source executor resolves built node-worker.js: exactly the same artifact used by consumers.
// SIFT runs without options so the suite also covers the default detector.
function matcher(detector: Detector = "sift") {
  const m = createNodeMatcher();
  if (detector === "sift") return m;
  const match = m.match.bind(m);
  m.match = (request, execution) =>
    match({ ...request, options: { detector, ...request.options } }, execution);
  return m;
}
/**
 * End-to-end cases through the shipped Node worker, registered once per detector.
 * Each detector has its own test file so Vitest runs them in parallel; validation
 * gates are shared.
 */
export function endToEnd(detector: Detector) {
  describe(`shipped Node matching with ${detector}`, () => {
    it("locates a crop and distinguishes missing data from geometric coverage", async () => {
      const m = matcher(detector);
      try {
        const extracting: { completed: number; total: number }[] = [];
        const result = await m.match(
          { query, reference: snapshot() },
          {
            onProgress: (p) => {
              if (p.stage === "extracting") extracting.push(p);
            },
          },
        );
        expect(extracting.length).toBeGreaterThan(0);
        expect(extracting.at(-1)).toEqual({
          stage: "extracting",
          completed: extracting[0].total,
          total: extracting[0].total,
        });
        expect(result.status).toBe("matched");
        expect(result.diagnostics.detector).toBe(detector);
        const c = result.candidates[0];
        expect(c.extentStatus).toBe("complete");
        expect(c.model).toBe("helmert");
        expect(c.independentInliers).toBeGreaterThanOrEqual(12);
        expect(transform(c.transform, [0, 0])[0]).toBeCloseTo(130, 0);
        expect(transform(c.transform, [0, 0])[1]).toBeCloseTo(160, 0);
      } finally {
        m.dispose();
      }
    }, 30000);
    it("recovers across acquisition tile seams", async () => {
      const m = matcher(detector);
      try {
        const tiles = [
            { ...cropPixels(image, 0, 0, 250, 640), x: 0, y: 0 },
            { ...cropPixels(image, 250, 0, 390, 640), x: 250, y: 0 },
          ],
          result = await m.match({ query, reference: snapshot(tiles) });
        expect(result.status).toBe("matched");
        expect(result.candidates[0].extentStatus).toBe("complete");
        expect(result.candidates[0].overlapFraction).toBeCloseTo(1, 3);
        const untiled = await m.match({ query, reference: snapshot() });
        for (const point of corners({
          x: 0,
          y: 0,
          width: query.width,
          height: query.height,
        })) {
          const a = transform(result.candidates[0].transform, point),
            b = transform(untiled.candidates[0].transform, point);
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.1);
        }
      } finally {
        m.dispose();
      }
    }, 30000);
    it("finds a small plan in a 25 MP reference with few correct pairs", async () => {
      // Same feature density as the 640 px plan; only ~2% of tentative pairs are correct.
      const size = 5000,
        large = syntheticPlan(
          size,
          size,
          42,
          Math.round((700 * size ** 2) / 640 ** 2),
        ),
        origin = [2375, 2370] as const,
        reference = createSnapshot({
          id: "large",
          width: size,
          height: size,
          crs: "EPSG:3857",
          extent: [0, 0, size, size],
          source: { id: "large", revision: "1", layers: ["plan"] },
          tiles: [{ ...large, x: 0, y: 0 }],
        });
      const m = matcher(detector);
      try {
        const result = await m.match({
          query: cropPixels(large, origin[0], origin[1], 250, 260),
          reference,
        });
        expect(result.status).toBe("matched");
        for (const p of corners({ x: 0, y: 0, width: 250, height: 260 })) {
          const [x, y] = transform(result.candidates[0].transform, p);
          expect(
            Math.hypot(x - p[0] - origin[0], y - p[1] - origin[1]),
          ).toBeLessThan(1);
        }
      } finally {
        m.dispose();
      }
    }, 120000);
    it("reports two copies as ambiguous", async () => {
      const data = new Uint8Array(1280 * 640 * 4);
      for (let y = 0; y < 640; y++) {
        const row = image.data.subarray(y * 640 * 4, (y + 1) * 640 * 4);
        data.set(row, y * 1280 * 4);
        data.set(row, (y * 1280 + 640) * 4);
      }
      const reference = createSnapshot({
        id: "copies",
        width: 1280,
        height: 640,
        crs: "EPSG:3857",
        extent: [0, 0, 1280, 640],
        source: { id: "copies", revision: "1", layers: ["copies"] },
        tiles: [{ x: 0, y: 0, width: 1280, height: 640, data }],
      });
      const m = matcher(detector);
      try {
        const result = await m.match({ query, reference });
        expect(result.status).toBe("ambiguous");
        expect(result.candidates).toHaveLength(2);
        const repeated = await m.match({ query, reference });
        expect(repeated.candidates.map((c) => c.footprint)).toEqual(
          result.candidates.map((c) => c.footprint),
        );
      } finally {
        m.dispose();
      }
    }, 30000);
    it("rejects blank and unrelated images", async () => {
      const m = matcher(detector);
      try {
        const blank = {
          width: 100,
          height: 100,
          data: new Uint8Array(40000).fill(255),
        };
        expect(
          (await m.match({ query: blank, reference: snapshot() })).status,
        ).toBe("not-found");
        for (let y = 40; y < 50; y++)
          for (let x = 40; x < 50; x++)
            for (let c = 0; c < 3; c++) blank.data[(y * 100 + x) * 4 + c] = 0;
        expect(
          (await m.match({ query: blank, reference: snapshot() })).status,
        ).toBe("not-found");
        expect(
          (
            await m.match({
              query: syntheticPlan(250, 260, 3456),
              reference: snapshot(),
            })
          ).status,
        ).toBe("not-found");
      } finally {
        m.dispose();
      }
    }, 30000);
    it("cancels synchronous work, releases worker and restarts safely", async () => {
      const m = matcher(detector);
      for (const stage of ["initializing", "extracting", "initializing"]) {
        const abort = new AbortController();
        const job = m.match(
          { query, reference: snapshot() },
          {
            signal: abort.signal,
            onProgress: (p) => {
              if (p.stage === stage) abort.abort();
            },
          },
        );
        await expect(job).rejects.toMatchObject({ name: "AbortError" });
        expect((await m.match({ query, reference: snapshot() })).status).toBe(
          "matched",
        );
      }
      const heaps: number[] = [];
      for (let i = 0; i < 4; i++)
        heaps.push(
          (await m.match({ query, reference: snapshot() })).diagnostics
            .wasmHeapBytes,
        );
      expect(new Set(heaps).size).toBe(1);
      m.dispose();
      m.dispose();
      await expect(
        m.match({ query, reference: snapshot() }),
      ).rejects.toMatchObject({ code: "DISPOSED" });
    }, 30000);

    it("keeps data availability separate from geometric overlap", async () => {
      const partlyMissing = { ...image, data: image.data.slice() };
      for (let y = 160; y < 240; y++)
        for (let x = 130; x < 380; x++)
          partlyMissing.data[(y * 640 + x) * 4 + 3] = 0;
      const m = matcher(detector);
      try {
        const result = await m.match({
          query,
          reference: snapshot([{ ...partlyMissing, x: 0, y: 0 }]),
        });
        const c = result.candidates[0];
        expect(c.extentStatus).toBe("complete");
        expect(c.overlapFraction).toBeCloseTo(1, 2);
        expect(c.referenceDataCoverage).toBeLessThan(0.8);
        expect(c.warnings.join(" ")).toContain("incomplete");
      } finally {
        m.dispose();
      }
    }, 30000);

    it("preserves full-image crop coordinates", async () => {
      const m = matcher(detector);
      try {
        const result = await m.match({
          query: image,
          queryRegion: { x: 130, y: 160, width: 250, height: 260 },
          reference: snapshot(),
        });
        expect(result.status).toBe("matched");
        const origin = transform(result.candidates[0].transform, [130, 160]);
        expect(origin[0]).toBeCloseTo(130, 0);
        expect(origin[1]).toBeCloseTo(160, 0);
      } finally {
        m.dispose();
      }
    }, 30000);

    it("rejects parallel-line and repeated-glyph evidence", async () => {
      const lines = {
        width: 300,
        height: 300,
        data: new Uint8Array(300 * 300 * 4).fill(255),
      };
      for (let y = 10; y < 300; y += 15)
        for (let x = 0; x < 300; x++)
          for (let c = 0; c < 3; c++) lines.data[(y * 300 + x) * 4 + c] = 0;
      const glyph = {
        ...lines,
        data: new Uint8Array(lines.data.length).fill(255),
      };
      for (let y = 10; y < 280; y += 30)
        for (let x = 10; x < 280; x += 30)
          for (let j = 0; j < 14; j++)
            for (let i = 0; i < 10; i++)
              if (i < 2 || j < 2 || j > 11)
                for (let c = 0; c < 3; c++)
                  glyph.data[((y + j) * 300 + x + i) * 4 + c] = 0;
      const m = matcher(detector);
      try {
        for (const q of [lines, glyph]) {
          const r = createSnapshot({
            id: "repetitive",
            width: 300,
            height: 300,
            extent: [0, 0, 300, 300],
            crs: "EPSG:3857",
            source: { id: "repetition", revision: "1", layers: ["marks"] },
            tiles: [{ ...q, x: 0, y: 0 }],
          });
          const result = await m.match({ query: q, reference: r });
          expect(result.status).toBe("not-found");
          expect(result.candidates).toHaveLength(0);
        }
      } finally {
        m.dispose();
      }
    }, 30000);

    it("ranks a stronger partial placement above a weaker complete placement", async () => {
      const width = 800,
        height = 500,
        data = new Uint8Array(width * height * 4).fill(255);
      for (const offset of [-100, 400])
        for (let y = 0; y < query.height; y++)
          for (let x = 0; x < query.width; x++) {
            if (x + offset < 0 || (offset === 400 && x > 100)) continue;
            data.set(
              query.data.subarray(
                (y * query.width + x) * 4,
                (y * query.width + x + 1) * 4,
              ),
              ((y + 100) * width + x + offset) * 4,
            );
          }
      const reference = createSnapshot({
        id: "rank",
        width,
        height,
        crs: "EPSG:3857",
        extent: [0, 0, width, height],
        source: { id: "rank", revision: "1", layers: ["plan"] },
        tiles: [{ x: 0, y: 0, width, height, data }],
      });
      const m = matcher(detector);
      try {
        const result = await m.match({ query, reference });
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0].extentStatus).toBe("partial");
        expect(result.candidates[1].extentStatus).toBe("complete");
        expect(result.candidates[0].score).toBeGreaterThan(
          result.candidates[1].score,
        );
      } finally {
        m.dispose();
      }
    }, 30000);
  });
}
