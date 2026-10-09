// Local-only JSON for browser regression; never included in packages or public CI artifacts.
import { mkdirSync, writeFileSync } from "node:fs";
import factory from "../../packages/matching/vendor/opencv.js";
import { realFixtures } from "./fixtures.mjs";

const cv = await factory();
mkdirSync("artifacts/matching", { recursive: true });
writeFileSync(
  "artifacts/matching/real-fixtures.json",
  JSON.stringify(realFixtures(cv), (_, value) =>
    ArrayBuffer.isView(value) ? Array.from(value) : value,
  ),
);
