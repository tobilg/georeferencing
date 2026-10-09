import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { gzipSync } from "node:zlib";
import {
  corners,
  distance,
  transform,
} from "../../packages/matching/dist/geometry.js";
import { createNodeMatcher } from "../../packages/matching/dist/node.js";
import factory from "../../packages/matching/vendor/opencv.js";
import { realFixtures } from "./fixtures.mjs";

for (const [file, hash] of [
  [
    "target.png",
    "e3e47f5a7c196d844b8e0efa883a6b999b78e8ff3a8b07890170e64f64b251d4",
  ],
  [
    "to_match.png",
    "211c1a8372953c568473e36b0d06965367489c883f5704f149685f8335b188f5",
  ],
])
  if (
    createHash("sha256")
      .update(readFileSync(new URL(`../../plans/${file}`, import.meta.url)))
      .digest("hex") !== hash
  )
    throw Error(`Fixture hash mismatch: ${file}`);
const cv = await factory(),
  cases = realFixtures(cv),
  results = [];
cases.push(
  { ...cases[0], name: "original-repeat" },
  { ...cases[0], name: "original-warm" },
);
for (const detector of ["sift", "akaze"]) {
  const matcher = createNodeMatcher();
  try {
    for (const test of cases) {
      const before = process.memoryUsage(),
        result = await matcher.match({
          query: test.query,
          reference: test.reference,
          options: { detector },
        }),
        best = result.candidates[0],
        boundary = corners({
          x: 0,
          y: 0,
          width: test.query.width,
          height: test.query.height,
        }),
        cornerError =
          best && test.expected
            ? boundary.reduce(
                (s, p) =>
                  s +
                  distance(
                    transform(best.transform, p),
                    transform(test.expected, p),
                  ),
                0,
              ) / 4
            : null;
      const row = {
        detector,
        case: test.name,
        query: [test.query.width, test.query.height],
        reference: [test.reference.width, test.reference.height],
        acquisitionMs: 0,
        status: result.status,
        candidates: result.candidates.length,
        extentStatus: best?.extentStatus,
        cornerError,
        overlap: best?.overlapFraction,
        expectedOverlap: test.overlap,
        mayMiss: test.mayMiss ?? [],
        independentInliers: best?.independentInliers,
        medianError: best?.medianError,
        score: best?.score,
        diagnostics: result.diagnostics,
        rssBefore: before.rss,
        rssAfter: process.memoryUsage().rss,
      };
      results.push(row);
      console.log(JSON.stringify(row));
      if (!test.expected) {
        assert.equal(result.status, "not-found", test.name);
        assert.equal(result.candidates.length, 0, test.name);
      } else if (
        !(test.mayMiss?.includes(detector) && result.status === "not-found")
      ) {
        assert.equal(result.status, "matched", `${detector} ${test.name}`);
        assert(
          cornerError !== null &&
            cornerError <= (test.name.startsWith("original") ? 1 : 2),
          `${detector} ${test.name}: corner error ${cornerError}`,
        );
        assert.equal(
          best.extentStatus,
          test.overlap ? "partial" : "complete",
          test.name,
        );
        if (test.overlap)
          assert(
            Math.abs(best.overlapFraction - test.overlap) <= 0.02,
            test.name,
          );
      }
    }
  } finally {
    matcher.dispose();
  }
}
mkdirSync("artifacts/reports", { recursive: true });
writeFileSync(
  "artifacts/reports/matching-node.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0].model,
      totalMemory: os.totalmem(),
      assets: Object.fromEntries(
        ["opencv.js", "opencv.wasm"].map((n) => [
          n,
          {
            bytes: statSync(`packages/matching/vendor/${n}`).size,
            gzip: gzipSync(readFileSync(`packages/matching/vendor/${n}`))
              .length,
          },
        ]),
      ),
      results,
    },
    null,
    2,
  ),
);
