import assert from "node:assert/strict";

const core = await import("@georeferencing/core");

assert.equal(typeof core.GeoreferencerController, "function");
for (const name of ["exportPoints", "worldFile", "accuracyReport"])
  assert.equal(core[name], undefined);
console.log("Headless core imports without export plugins");
