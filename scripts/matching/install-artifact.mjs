import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const source = new URL("../../artifacts/matching/build/", import.meta.url),
  vendor = new URL("../../packages/matching/vendor/", import.meta.url);
mkdirSync(vendor, { recursive: true });
const js = readFileSync(
  new URL("wasm/bin/opencv_js.js", source),
  "utf8",
).replaceAll("opencv_js.wasm", "opencv.wasm");
writeFileSync(new URL("opencv.js", vendor), js);
copyFileSync(
  new URL("wasm/bin/opencv_js.wasm", source),
  new URL("opencv.wasm", vendor),
);
copyFileSync(
  new URL("opencv-4.12.0/LICENSE", source),
  new URL("LICENSE", vendor),
);
const emscripten =
  process.env.EMSCRIPTEN ??
  execFileSync("em-config", ["EMSCRIPTEN_ROOT"], { encoding: "utf8" })
    .trim()
    .replaceAll("'", "");
const notices = [
  "OpenCV 4.12.0. Trimmed bindings and ESM packaging by georeferencing contributors. Apache-2.0. Source and build flags: opencv-provenance.json.",
  readFileSync(new URL("opencv-4.12.0/doc/LICENSE_BSD.txt", source), "utf8"),
  readFileSync(
    new URL(
      "opencv-4.12.0/modules/flann/include/opencv2/flann/defines.h",
      source,
    ),
    "utf8",
  ).split("#ifndef")[0],
  readFileSync(
    new URL(
      "opencv-4.12.0/modules/core/3rdparty/SoftFloat/COPYING.txt",
      source,
    ),
    "utf8",
  ),
  readFileSync(
    new URL("opencv-4.12.0/modules/core/src/softfloat.cpp", source),
    "utf8",
  ).split("#include")[0],
  readFileSync(new URL("opencv-4.12.0/3rdparty/zlib/LICENSE", source), "utf8"),
  ...[
    "LICENSE",
    "system/lib/libcxx/LICENSE.TXT",
    "system/lib/libcxxabi/LICENSE.TXT",
    "system/lib/compiler-rt/LICENSE.TXT",
  ].map((file) =>
    readFileSync(
      file === "LICENSE" && !existsSync(join(emscripten, file))
        ? join(emscripten, "..", file)
        : join(emscripten, file),
      "utf8",
    ),
  ),
];
writeFileSync(new URL("NOTICE", vendor), notices.join("\n\n---\n\n"));
const hashes = Object.fromEntries(
  ["opencv.js", "opencv.wasm", "LICENSE"].map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(new URL(name, vendor)))
      .digest("hex"),
  ]),
);
writeFileSync(
  new URL("provenance.json", vendor),
  `${JSON.stringify(
    {
      opencv: "4.12.0",
      source: "https://github.com/opencv/opencv/releases/tag/4.12.0",
      sourceSha256:
        "44c106d5bb47efec04e531fd93008b3fcd1d27138985c5baf4eafac0e1ec9e9d",
      emscripten: "6.0.8 (Homebrew 6.0.8; reports 6.0.8-git)",
      build: "scripts/matching/build-opencv.sh",
      modules: ["core", "imgproc", "features2d", "flann", "calib3d", "js"],
      flags: [
        "C++17",
        "EXPORT_ES6=1",
        "DYNAMIC_EXECUTION=0",
        "MODULARIZE=1",
        "USE_PTHREADS=0",
        "SIMD=off",
        "DISABLE_EXCEPTION_CATCHING=0",
        "INITIAL_MEMORY=32MB",
        "MAXIMUM_MEMORY=512MB",
        "ALLOW_MEMORY_GROWTH=1",
      ],
      hashes,
    },
    null,
    2,
  )}\n`,
);
console.log(hashes);
