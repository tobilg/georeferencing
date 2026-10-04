import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function executable(name) {
  const path = require.resolve(`${name}/package.json`);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  return resolve(dirname(path), pkg.bin[name]);
}

const children = new Set();
let stopping = false;
function start(cli, args, restartOnConfigChange = false) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: packageRoot,
    stdio: "inherit",
    env: { ...process.env, TYPEDOC_FORCE_WATCH: "1" },
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping && restartOnConfigChange && code === 7) {
      start(cli, args, true);
    } else {
      stop(code ?? 1);
    }
  });
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
// TypeDoc's bin wrapper forks an unmanaged grandchild. Invoke the pinned CLI
// directly so shutdown reaches the watcher; preserve its exit-7 restart protocol.
start(
  resolve(dirname(require.resolve("typedoc")), "cli.js"),
  ["--watch"],
  true,
);
start(executable("vite"), [
  "dist",
  "--host",
  "127.0.0.1",
  "--port",
  "4174",
  "--strictPort",
  "--clearScreen",
  "false",
  "--logLevel",
  "warn",
]);
console.log(
  "Documentation: http://127.0.0.1:4174/ (watching source and guides)",
);
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
