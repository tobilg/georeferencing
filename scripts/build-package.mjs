import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PUBLIC_PACKAGES } from "./packages.mjs";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const name = process.argv[2];
if (!PUBLIC_PACKAGES.includes(name))
  throw Error(`Expected package name: ${PUBLIC_PACKAGES.join(", ")}`);
const packageRoot = join(workspaceRoot, "packages", name);
const require = createRequire(join(packageRoot, "package.json"));
const watching = process.argv.includes("--watch");
process.chdir(packageRoot);
if (!watching) rmSync("dist", { recursive: true, force: true });

async function compile() {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc")], {
    stdio: "inherit",
  });
  const workers =
    name === "core"
      ? ["src/engine/worker.ts"]
      : name === "plugins"
        ? ["src/workers/geotiff.ts", "src/workers/jpeg.ts"]
        : name === "matching"
          ? ["src/worker.ts"]
          : [];
  const result = workers.length
    ? await build({
        entryPoints: workers,
        outdir:
          name === "core"
            ? "dist/engine"
            : name === "matching"
              ? "dist"
              : "dist/workers",
        external: name === "matching" ? ["./vendor/opencv.js"] : [],
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        sourcemap: watching,
        minify: true,
        legalComments: "linked",
        metafile: true,
      })
    : undefined;
  if (name === "matching") {
    mkdirSync("dist/vendor", { recursive: true });
    const provenance = JSON.parse(
      readFileSync("vendor/provenance.json", "utf8"),
    );
    for (const file of ["opencv.js", "opencv.wasm"]) {
      if (
        createHash("sha256")
          .update(readFileSync(join("vendor", file)))
          .digest("hex") !== provenance.hashes[file]
      )
        throw Error(`OpenCV artifact hash mismatch: ${file}`);
      copyFileSync(join("vendor", file), join("dist/vendor", file));
    }
  }
  if (existsSync("src/styles.css"))
    copyFileSync("src/styles.css", "dist/styles.css");
  mkdirSync("dist/licenses", { recursive: true });
  const inventory = new Map();
  if (name === "matching")
    inventory.set("opencv", {
      version: "4.12.0",
      license: "Apache-2.0; see opencv-NOTICE",
    });
  for (const input of Object.keys(result?.metafile.inputs ?? {}).filter((p) =>
    p.includes("node_modules/"),
  )) {
    let directory = dirname(resolve(input));
    while (!existsSync(join(directory, "package.json"))) {
      const parent = dirname(directory);
      if (parent === directory)
        throw Error(`Missing dependency manifest: ${input}`);
      directory = parent;
    }
    const pkg = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    if (inventory.has(pkg.name)) continue;
    inventory.set(pkg.name, { version: pkg.version, license: pkg.license });
    for (const file of readdirSync(directory).filter((n) =>
      /^(license|copying|notice)/i.test(n),
    ))
      copyFileSync(
        join(directory, file),
        `dist/licenses/${pkg.name.replaceAll("/", "-")}-${file}`,
      );
  }
  copyFileSync(
    join(workspaceRoot, "licenses/APACHE-2.0.txt"),
    "dist/licenses/APACHE-2.0.txt",
  );
  copyFileSync(
    join(workspaceRoot, "licenses/GDAL-NOTICE.txt"),
    "dist/licenses/GDAL-NOTICE.txt",
  );
  writeFileSync(
    "dist/licenses/inventory.json",
    `${JSON.stringify(Object.fromEntries(inventory), null, 2)}\n`,
  );
  if (name === "matching") {
    for (const file of ["LICENSE", "NOTICE", "provenance.json"])
      copyFileSync(
        join("vendor", file),
        join("dist/licenses", `opencv-${file}`),
      );
  }
  copyFileSync(join(workspaceRoot, "LICENSE"), "LICENSE");
  // Remove the legacy generated copy. Internal project records never ship.
  if (name === "core") rmSync("docs", { recursive: true, force: true });
}

await compile();
if (watching) {
  let running = false;
  let pending = false;
  let timer;
  const rebuild = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      try {
        await compile();
        console.log(`@georeferencing/${name} rebuilt`);
      } catch (error) {
        console.error(error);
      }
    } while (pending);
    running = false;
  };
  const watcher = watch("src", { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
  const close = () => {
    clearTimeout(timer);
    watcher.close();
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  console.log(`Watching @georeferencing/${name} source and styles`);
}
