import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Serves the bundled web/dist build over http://127.0.0.1 instead of
// file://, which gives the renderer a real, stable origin -- needed for the
// CORS-aware fetches it makes to the configured remote Vocal server, and
// for relative-URL resolution to work the same way it does in a browser.
export function startStaticServer(rootDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
      let filePath = join(rootDir, safePath);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(rootDir, "index.html"); // SPA fallback
      }
      const type = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("failed to bind static server"));
    });
  });
}
