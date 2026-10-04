// Generated reports are local-only. A fresh public checkout has no report directory.
import { mkdirSync } from "node:fs";

mkdirSync(new URL("../artifacts/reports/", import.meta.url), {
  recursive: true,
});
