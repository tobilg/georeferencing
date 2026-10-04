import assert from "node:assert/strict";

await Promise.all(
  [
    "@georeferencing/core",
    "@georeferencing/core/core",
    "@georeferencing/plugins",
    "@georeferencing/plugins/geotiff",
    "@georeferencing/plugins/jpeg",
    "@georeferencing/plugins/pdf",
    "@georeferencing/react",
    "@georeferencing/core/engine",
    "@georeferencing/core/openlayers",
    "@georeferencing/core/encoder-worker",
    "@georeferencing/plugins/data",
    "@georeferencing/plugins/tiff",
    "@georeferencing/plugins/report",
    "@georeferencing/plugins/serializers",
  ].map((name) => import(name)),
);
const core = await import("@georeferencing/core");
const serializers = await import("@georeferencing/plugins/serializers");
for (const name of ["exportPoints", "worldFile", "accuracyReport"]) {
  assert.equal(core[name], undefined, `${name} must belong to plugins`);
  assert.equal(typeof serializers[name], "function");
}
console.log("SSR imports and serializer ownership passed");
