import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_PACKAGES } from "./packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const results = [];
for (const name of PUBLIC_PACKAGES) {
  const source = JSON.parse(
    readFileSync(join(root, "packages", name, "package.json"), "utf8"),
  );
  const archive = join(
    root,
    "artifacts",
    `georeferencing-${name}-${source.version}.tgz`,
  );
  const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => !file.endsWith("/"));
  const read = (file) =>
    execFileSync("tar", ["-xOzf", archive, file], { encoding: "utf8" });
  for (const file of files) {
    assert(
      !file
        .split("/")
        .some((part) =>
          [
            "..",
            ".git",
            "adr",
            "evidence",
            "plans",
            "docs",
            "node_modules",
          ].includes(part),
        ),
      `Private/unexpected path in ${name}: ${file}`,
    );
    assert(
      /^package\/(package\.json|README\.md|LICENSE)$/.test(file) ||
        /^package\/dist\/.+\.(js|d\.ts|css)$/.test(file) ||
        /^package\/dist\/(licenses\/[^/]+|.+\.js\.LEGAL\.txt)$/.test(file),
      `Unexpected file in ${name}: ${file}`,
    );
    assert(
      !/docs\/(adr|evidence|delivery-report\.md|parity\.md)/.test(read(file)),
      `Private document reference in ${name}: ${file}`,
    );
  }
  for (const file of [
    "README.md",
    "LICENSE",
    "dist/licenses/inventory.json",
    "dist/licenses/GDAL-NOTICE.txt",
  ])
    assert(files.includes(`package/${file}`), `Missing ${file} in ${name}`);
  const manifest = JSON.parse(read("package/package.json"));
  assert.equal(manifest.name, `@georeferencing/${name}`);
  assert.equal(manifest.version, source.version);
  assert.notEqual(manifest.private, true);
  for (const dependency of [
    ...Object.values(manifest.dependencies ?? {}),
    ...Object.values(manifest.peerDependencies ?? {}),
  ])
    assert(
      !/^(workspace:|file:|link:)/.test(dependency),
      `Local dependency in ${name}`,
    );
  const checkExport = (value) => {
    if (typeof value === "string") {
      assert(value.startsWith("./"), `Invalid export in ${name}: ${value}`);
      assert(
        files.includes(`package/${value.slice(2)}`),
        `Missing export in ${name}: ${value}`,
      );
    } else for (const target of Object.values(value)) checkExport(target);
  };
  checkExport(manifest.exports);
  results.push({
    package: manifest.name,
    version: manifest.version,
    files: files.length,
    bytes: statSync(archive).size,
  });
}
console.log(
  JSON.stringify({ packageContents: "passed", packages: results }, null, 2),
);
