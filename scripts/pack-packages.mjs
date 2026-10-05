// Pack every public package into artifacts/ (run after building them).
import { execFileSync } from "node:child_process";
import { PUBLIC_PACKAGES } from "./packages.mjs";

for (const name of PUBLIC_PACKAGES)
  execFileSync(
    "pnpm",
    [
      "--filter",
      `@georeferencing/${name}`,
      "pack",
      "--pack-destination",
      "artifacts",
    ],
    { stdio: "inherit" },
  );
