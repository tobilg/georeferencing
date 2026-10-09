// Pack every public package into artifacts/ (run after building them). Lifecycle
// scripts are skipped: each package's prepack would otherwise rebuild it.
import { execFileSync } from "node:child_process";
import { PUBLIC_PACKAGES } from "./packages.mjs";

for (const name of PUBLIC_PACKAGES)
  execFileSync(
    "pnpm",
    [
      "--filter",
      `@georeferencing/${name}`,
      "pack",
      "--ignore-scripts",
      "--pack-destination",
      "artifacts",
    ],
    { stdio: "inherit" },
  );
