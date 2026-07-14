/* =========================================================================
 * DCS Assessment Command Center — hosting server
 *
 * Zero-dependency Node server for Docker (or bare `node server.js`):
 *   - serves the static app
 *   - persists the shared workspace to DATA_DIR/workspace.json (atomic
 *     writes), so the whole team works from one store that survives
 *     container restarts via the mounted volume
 *   - optimistic concurrency: PUTs carry the revision they were based on;
 *     a stale PUT gets 409 and the client re-syncs instead of clobbering
 *   - optional HTTP Basic Auth via BASIC_AUTH_USER / BASIC_AUTH_PASS
 *
 * No auth is enabled by default — run it on a trusted network or behind
 * your own reverse proxy, consistent with the tool's on-site use case.
 * ========================================================================= */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const APP_DIR = __dirname;
const STORE_FILE = path.join(DATA_DIR, "workspace.json");
const MAX_BODY = 64 * 1024 * 1024; // evidence attachments are base64 data URLs

const AUTH_USER = process.env.BASIC_AUTH_USER || "";
const AUTH_PASS = process.env.BASIC_AUTH_PASS || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

/* ------------------------------------------------------------ workspace */
let store = { revision: 0, state: null, savedAt: null };

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      if (typeof store.revision !== "number") store.revision = 0;
    }
  } catch (err) {
    console.error(`Could not read ${STORE_FILE} — starting empty:`, err.message);
    store = { revision: 0, state: null, savedAt: null };
  }
}

function persistStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE_FILE); // atomic on the same filesystem
}

/* -------------------------------------------------------------- helpers */
function send(res, code, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(data);
}

function checkAuth(req, res) {
  if (!AUTH_USER) return true;
  const header = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="DCS Assessment Command Center"' });
  res.end("Authentication required");
  return false;
}

function readBody(req, res, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(res, 413, { error: "Payload too large — remove large evidence attachments." });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch (err) { send(res, 400, { error: "Invalid JSON body." }); }
  });
}

/* ------------------------------------------------------------ static app */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/+/, "")) || "index.html";
  const file = path.normalize(path.join(APP_DIR, rel));
  if (!file.startsWith(APP_DIR + path.sep) && file !== path.join(APP_DIR, "index.html")) {
    return send(res, 403, { error: "Forbidden" });
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
}

/* ----------------------------------------------------------------- routes */
const server = http.createServer((req, res) => {
  if (!checkAuth(req, res)) return;
  const urlPath = new URL(req.url, "http://x").pathname;

  if (urlPath === "/api/health" && req.method === "GET") {
    return send(res, 200, { ok: true, app: "dcs-command-center", revision: store.revision });
  }

  if (urlPath === "/api/revision" && req.method === "GET") {
    return send(res, 200, { revision: store.revision });
  }

  if (urlPath === "/api/workspace" && req.method === "GET") {
    return send(res, 200, { revision: store.revision, state: store.state, savedAt: store.savedAt });
  }

  if (urlPath === "/api/workspace" && req.method === "PUT") {
    return readBody(req, res, (body) => {
      if (!body || typeof body.revision !== "number" || !body.state || !Array.isArray(body.state.events)) {
        return send(res, 400, { error: "Expected { revision, state } with state.events[]" });
      }
      if (body.revision !== store.revision) {
        // stale base — client must re-sync; never clobber a teammate's save
        return send(res, 409, { revision: store.revision });
      }
      store = { revision: store.revision + 1, state: body.state, savedAt: new Date().toISOString() };
      try { persistStore(); }
      catch (err) {
        console.error("Persist failed:", err.message);
        return send(res, 500, { error: "Could not write to the data volume: " + err.message });
      }
      return send(res, 200, { revision: store.revision, savedAt: store.savedAt });
    });
  }

  if (urlPath.startsWith("/api/")) return send(res, 404, { error: "Unknown API route" });
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  serveStatic(req, res, urlPath === "/" ? "/index.html" : urlPath);
});

loadStore();
server.listen(PORT, () => {
  console.log(`DCS Assessment Command Center listening on :${PORT}`);
  console.log(`Workspace store: ${STORE_FILE} (revision ${store.revision})`);
  console.log(AUTH_USER ? "Basic auth: enabled" : "Basic auth: DISABLED (set BASIC_AUTH_USER / BASIC_AUTH_PASS or run behind your own proxy)");
});
