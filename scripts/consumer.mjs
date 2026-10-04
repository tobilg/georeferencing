import "./report-output.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { build as bundle } from "esbuild";

const root = process.cwd();
mkdirSync("artifacts", { recursive: true });
execFileSync("pnpm", ["run", "pack:packages"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-package-contents.mjs"], {
  stdio: "inherit",
});
const corePkg = JSON.parse(readFileSync("packages/core/package.json", "utf8"));
const packs = Object.fromEntries(
  ["core", "plugins", "react"].map((name) => {
    const filename = `georeferencing-${name}-${corePkg.version}.tgz`;
    const bytes = readFileSync(resolve("artifacts", filename));
    return [
      name,
      {
        filename,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        size: bytes.length,
      },
    ];
  }),
);
const pack = packs.core;
const packageFiles = Object.fromEntries(
  Object.entries(packs).map(([name, artifact]) => [
    `@georeferencing/${name}`,
    `file:${resolve("artifacts", artifact.filename)}`,
  ]),
);
const directory = mkdtempSync(join(tmpdir(), "georeferencer-consumer-"));
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: directory, stdio: "inherit" });
cpSync("tests/consumers/react", directory, { recursive: true });
const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
writeFileSync(
  join(directory, "package.json"),
  JSON.stringify(
    {
      ...pkg,
      dependencies: { ...pkg.dependencies, ...packageFiles },
    },
    null,
    2,
  ),
);
// pnpm 12 settings live in pnpm-workspace.yaml, including unpublished-tarball overrides.
writeFileSync(
  join(directory, "pnpm-workspace.yaml"),
  JSON.stringify(
    {
      overrides: {
        "@georeferencing/core": packageFiles["@georeferencing/core"],
      },
    },
    null,
    2,
  ),
);
// These temporary projects generate and change manifests/overrides during the test,
// so their lockfiles must remain writable even under pnpm's CI defaults.
const installArgs = ["install", "--ignore-scripts", "--no-frozen-lockfile"];
run("pnpm", installArgs);
const installedCore = join(directory, "node_modules/@georeferencing/core");
const installedManifest = JSON.parse(
  readFileSync(join(installedCore, "package.json"), "utf8"),
);
assert.equal(installedManifest.name, "@georeferencing/core");
assert.equal(installedManifest.dependencies.typedoc, undefined);
for (const [file, documentedContract] of [
  ["core/controller.d.ts", "Authoritative editor store"],
  ["core/types.d.ts", "Versioned, JSON-serializable editor document"],
  ["core/transform.d.ts", "Training RMSE"],
  ["engine/index.d.ts", "Create an SSR-safe engine"],
  [
    "openlayers/references.d.ts",
    "Explicit read-only WFS provider configuration",
  ],
]) {
  const declaration = readFileSync(join(installedCore, "dist", file), "utf8");
  assert(
    declaration.includes(documentedContract),
    `Missing published TypeDoc in ${file}`,
  );
}
const installedReact = join(directory, "node_modules/@georeferencing/react");
const installedPlugins = join(
  directory,
  "node_modules/@georeferencing/plugins",
);
assert(
  readFileSync(
    join(installedReact, "dist/Georeferencer.d.ts"),
    "utf8",
  ).includes("Ready-made React editor"),
);
assert(
  readFileSync(join(installedPlugins, "dist/geotiff.d.ts"), "utf8").includes(
    "Register lazy GeoTIFF export",
  ),
);
assert(!existsSync(join(installedCore, "dist/react")));
assert(!existsSync(join(installedCore, "dist/engine/tiff.js")));
assert.equal(installedManifest.dependencies["pdf-lib"], undefined);
assert.equal(installedManifest.dependencies.geotiff, undefined);
assert.equal(installedManifest.dependencies["jpeg-js"], undefined);
assert.equal(installedManifest.peerDependencies.react, undefined);
const reactManifest = JSON.parse(
  readFileSync(join(installedReact, "package.json"), "utf8"),
);
assert.equal(reactManifest.dependencies["@georeferencing/plugins"], undefined);
for (const installed of [installedReact, installedPlugins]) {
  const manifest = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  assert.equal(
    manifest.dependencies["@georeferencing/core"],
    `^${corePkg.version}`,
  );
  assert.equal(manifest.dependencies.typedoc, undefined);
}
// A second installation proves core works without installing UI or export packages.
const headlessDirectory = mkdtempSync(
  join(tmpdir(), "georeferencing-headless-"),
);
cpSync("tests/consumers/headless", headlessDirectory, { recursive: true });
writeFileSync(
  join(headlessDirectory, "package.json"),
  JSON.stringify({
    name: "headless-consumer",
    private: true,
    type: "module",
    dependencies: {
      "@georeferencing/core": packageFiles["@georeferencing/core"],
    },
  }),
);
execFileSync("pnpm", installArgs, {
  cwd: headlessDirectory,
  stdio: "inherit",
});
const dependencyTree = execFileSync(
  "pnpm",
  ["list", "--prod", "--depth", "Infinity", "--json"],
  { cwd: headlessDirectory, encoding: "utf8" },
);
for (const name of [
  "react",
  "react-dom",
  "pdf-lib",
  "@georeferencing/plugins",
  "@georeferencing/react",
  "ol",
])
  assert(
    !dependencyTree.includes(`"${name}":`),
    `Unexpected headless dependency: ${name}`,
  );
execFileSync(process.execPath, ["ssr.mjs"], {
  cwd: headlessDirectory,
  stdio: "inherit",
});
const headlessEntry = join(headlessDirectory, "main.js");
const headlessBundle = await bundle({
  entryPoints: [headlessEntry],
  bundle: true,
  write: false,
  format: "esm",
  minify: true,
  metafile: true,
});
const bundleEvidence = {
  coreBytes: headlessBundle.outputFiles[0].contents.length,
};
// Typecheck all factory exports in a headless installation with no map/UI peers.
writeFileSync(
  join(headlessDirectory, "package.json"),
  JSON.stringify({
    name: "headless-plugin-consumer",
    private: true,
    type: "module",
    dependencies: {
      "@georeferencing/core": packageFiles["@georeferencing/core"],
      "@georeferencing/plugins": packageFiles["@georeferencing/plugins"],
    },
    devDependencies: { typescript: pkg.devDependencies.typescript },
  }),
);
writeFileSync(
  join(headlessDirectory, "pnpm-workspace.yaml"),
  JSON.stringify(
    {
      overrides: {
        "@georeferencing/core": packageFiles["@georeferencing/core"],
      },
    },
    null,
    2,
  ),
);
execFileSync("pnpm", installArgs, {
  cwd: headlessDirectory,
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "api.ts",
  ],
  { cwd: headlessDirectory, stdio: "inherit" },
);
const pluginTree = execFileSync(
  "pnpm",
  ["list", "--prod", "--depth", "Infinity", "--json"],
  { cwd: headlessDirectory, encoding: "utf8" },
);
for (const name of ["react", "react-dom", "ol"])
  assert(!pluginTree.includes(`"${name}":`), `Unexpected plugin peer: ${name}`);
for (const format of ["geotiff", "jpeg", "pdf"]) {
  const entry = join(directory, `${format}-only.js`);
  const factory = format === "geotiff" ? "geoTiff" : format;
  writeFileSync(
    entry,
    `import {${factory}} from '@georeferencing/plugins/${format}'; export const format=${factory}();`,
  );
  const result = await bundle({
    entryPoints: [entry],
    outdir: join(directory, "isolated-bundles", format),
    bundle: true,
    splitting: true,
    write: false,
    format: "esm",
    minify: true,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert(!inputs.some((p) => p.includes("/react/") || p.includes("react-dom")));
  if (format !== "pdf")
    assert(
      !inputs.some((p) => p.includes("pdf-lib") || p.endsWith("/report.js")),
      `${format} must not import PDF code`,
    );
  if (format === "jpeg")
    assert(
      !inputs.some((p) => p.endsWith("/tiff.js")),
      "JPEG must not import TIFF encoder",
    );
  bundleEvidence[format] = {
    javascriptBytes: result.outputFiles.reduce(
      (sum, file) => sum + file.contents.length,
      0,
    ),
    pdfLibrary: inputs.some((p) => p.includes("pdf-lib")),
  };
}
cpSync("packages/documentation/examples", join(directory, "guide-examples"), {
  recursive: true,
});
run("pnpm", ["exec", "tsc", "--noEmit"]);
run(process.execPath, ["ssr.mjs"]);
run("pnpm", ["exec", "vite", "build"]);
mkdirSync(join(directory, "dist", "fixtures"), { recursive: true });
cpSync(
  "tests/fixtures/grid.png",
  join(directory, "dist", "fixtures", "grid.png"),
);
const { startServer } = await import(
  pathToFileURL(join(directory, "server.mjs")).href
);
const { server, url } = await startServer(directory);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    errors.push(`${r.url()}: ${r.failure()?.errorText}`),
  );
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.consumer?.map));
  const result = await page.evaluate(async () => {
    const c = window.consumer.controller;
    const blob = await (await fetch("./fixtures/grid.png")).blob();
    await c.loadImage(new File([blob], "grid.png", { type: "image/png" }));
    c.replaceGcps(
      [
        [0, 0],
        [100, 0],
        [0, 100],
      ].map(([x, y], i) => ({
        id: String(i),
        label: i + 1,
        enabled: true,
        image: [x, y],
        target: [1000 + 2 * x, 2000 - 3 * y],
        crs: "EPSG:3857",
      })),
    );
    return { layers: window.consumer.map.getLayers().getLength() };
  });
  await page.waitForFunction(() =>
    Boolean(window.consumer.controller.getSnapshot().fit),
  );
  await page
    .getByText("Raster output & session files", { exact: true })
    .click();
  assert(
    !requests.some((url) => /report-|pdf-lib|geotiff-|jpeg-/.test(url)),
    "Export assets loaded before requesting a format",
  );
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF map & report" }).click();
  await (await pdfDownload).saveAs(
    resolve(root, "artifacts", "consumer-report.pdf"),
  );
  const raster = await page.evaluate(async () => {
    const c = window.consumer.controller;
    c.setOutput({ ...c.getSnapshot().document.output, compression: "deflate" });
    const result = await c.exportRaster();
    const jpeg = await c.export("jpeg");
    if (!jpeg) throw Error(c.getSnapshot().error ?? "JPEG export failed");
    const decoded = await createImageBitmap(jpeg.blob);
    const jpegDimensions = [decoded.width, decoded.height];
    decoded.close();
    c.confirm();
    c.setFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "consumer-feature",
          properties: { name: "test" },
          geometry: { type: "Point", coordinates: [0.01, 0.02] },
        },
      ],
    });
    await c.save();
    return {
      jpeg: {
        bytes: jpeg.blob.size,
        files: jpeg.files.map((f) => f.name),
        dimensions: jpegDimensions,
      },
      bytes: result.blob.size,
      crs: result.raster.crs,
      receipt: window.receipt,
      workerUrls: performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .filter((s) => s.includes("worker")),
    };
  });
  await page.evaluate(() => window.consumer.setVisible(false));
  await page.waitForFunction(
    () => window.consumer.map.getLayers().getLength() === 1,
  );
  if (
    errors.length ||
    result.layers !== 5 ||
    raster.bytes < 100 ||
    raster.receipt.features.features.length !== 1
  )
    throw Error(JSON.stringify({ errors, result, raster }));
  execFileSync("pdfinfo", [resolve(root, "artifacts", "consumer-report.pdf")], {
    stdio: "pipe",
  });
  for (const format of ["geotiff", "jpeg"]) {
    assert(
      requests.some((url) =>
        new RegExp(`/assets/${format}-[^/]+\\.js$`).test(url),
      ),
      `Missing ${format} codec request`,
    );
  }
  const evidence = {
    packageName: corePkg.name,
    packages: packs,
    headlessDirectory,
    isolatedBundles: bundleEvidence,
    packageManager: execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
    }).trim(),
    tarball: pack.filename,
    integrity: pack.integrity,
    size: pack.size,
    consumerDirectory: directory,
    base: "/consumer/",
    serverUrl: url,
    browser: browser.version(),
    ssr: true,
    typecheck: true,
    productionBuild: true,
    strictCsp: true,
    workerRequests: requests.filter((r) =>
      /\/(worker|geotiff|jpeg)-[^/]+\.js$/.test(r),
    ),
    rasterBytes: raster.bytes,
    compression: "deflate",
    crs: raster.crs,
    pdf: true,
    jpeg: raster.jpeg,
    save: true,
    hostLayersAfterUnmount: 1,
    errors,
  };
  writeFileSync(
    resolve(root, "artifacts/reports/consumer.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(evidence);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}
