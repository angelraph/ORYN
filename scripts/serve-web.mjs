// Local server for web/ that behaves like Vercel with cleanUrls: /vault serves vault.html,
// /pay?v=… serves pay.html, unknown paths get the 404 page. Usage: node scripts/serve-web.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".webp": "image/webp" };

async function file(p) {
  try { return (await stat(p)).isFile() ? p : null; } catch { return null; }
}

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if (path.includes("..")) { res.writeHead(400); return res.end(); }
  if (path.endsWith(".html")) { res.writeHead(308, { Location: "/" + path.slice(0, -5).replace(/^index$/, "") }); return res.end(); }
  const hit = (await file(join(ROOT, path || "index.html"))) || (await file(join(ROOT, path + ".html"))) || (await file(join(ROOT, path, "index.html")));
  const target = hit || join(ROOT, "404.html");
  const body = await readFile(target).catch(() => Buffer.from("Not found"));
  res.writeHead(hit ? 200 : 404, { "Content-Type": TYPES[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(body);
}).listen(PORT, () => console.log(`ORYN web on http://localhost:${PORT}`));
