import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

/** Serve a copied consumer build with its deployment prefix and strict worker CSP. */
export async function startServer(directory) {
  const root = resolve(directory, "dist");
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (!pathname.startsWith("/consumer/")) throw Error("Unknown prefix");
      const file = resolve(
        root,
        pathname.slice("/consumer/".length) || "index.html",
      );
      if (!file.startsWith(root + sep)) throw Error("Outside build directory");
      const body = await readFile(file);
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".png": "image/png",
        }[extname(file)] || "application/octet-stream",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; worker-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'",
      );
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}/consumer/` };
}
