// Set one release version on all public packages, the documentation workspace and
// the engine identifier. Usage: node scripts/set-version.mjs 0.1.0-alpha.3
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? ""))
  throw Error("Expected a semver version, e.g. 0.1.0-alpha.3 or 1.0.0");

const root = new URL("..", import.meta.url);
for (const name of ["core", "plugins", "react", "documentation"]) {
  const file = new URL(`packages/${name}/package.json`, root);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.version = version;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
const types = new URL("packages/core/src/core/types.ts", root);
const source = readFileSync(types, "utf8");
const updated = source.replace(
  /ENGINE_VERSION = "js-warp\/[^"]+"/,
  `ENGINE_VERSION = "js-warp/${version}"`,
);
if (updated === source && !source.includes(`js-warp/${version}`))
  throw Error("ENGINE_VERSION declaration not found");
writeFileSync(types, updated);
console.log(`Set version ${version}. Commit, then tag v${version}.`);
