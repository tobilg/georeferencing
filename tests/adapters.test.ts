import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("the MapLibre and Leaflet adapters share an identical Terra Draw integration", () => {
  const read = (name: string) =>
    readFileSync(
      new URL(`../packages/${name}/src/drawing.ts`, import.meta.url),
      "utf8",
    );
  expect(read("leaflet")).toBe(read("maplibre"));
});
