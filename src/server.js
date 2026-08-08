import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isLoopbackAddress } from "./config.js";
import { SpaController } from "./spa/controller.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const controller = new SpaController();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(response, statusCode, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(data);
}

function hasValidAccessToken(request) {
  if (!config.accessToken) return true;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const expectedBytes = Buffer.from(config.accessToken);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32 * 1024) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { statusCode: 400 });
  }
}

function credentialLoginAllowed(request) {
  return config.allowLanCredentialLogin || isLoopbackAddress(request.socket.remoteAddress);
}

async function handleApi(request, response, pathname) {
  if (!hasValidAccessToken(request)) {
    sendJson(response, 401, { error: "access token required", code: "unauthorized" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    sendJson(response, 200, await controller.status());
    return;
  }
  if (request.method === "GET" && pathname === "/api/info") {
    sendJson(response, 200, {
      service: "CleverSpa recovery bridge",
      host: config.hostname,
      loopbackOnly: config.loopbackOnly,
      accessTokenRequired: Boolean(config.accessToken),
    });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  const body = await readJson(request);
  if (pathname === "/api/discover") {
    sendJson(response, 200, await controller.discover());
    return;
  }
  if (pathname === "/api/cloud/login") {
    if (!credentialLoginAllowed(request)) {
      sendJson(response, 403, {
        error: "cloud credentials may only be entered from this PC unless LAN credential login is explicitly enabled",
        code: "loopback_required",
      });
      return;
    }
    await controller.connectCloud(body.username, body.password);
    sendJson(response, 200, await controller.status());
    return;
  }
  if (pathname === "/api/cloud/token") {
    if (!credentialLoginAllowed(request)) {
      sendJson(response, 403, { error: "token import is restricted to this PC", code: "loopback_required" });
      return;
    }
    await controller.connectCloudToken(body.token);
    sendJson(response, 200, await controller.status());
    return;
  }
  if (pathname === "/api/control/heater") {
    sendJson(response, 200, await controller.controlHeater(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/filter") {
    sendJson(response, 200, await controller.controlFilter(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/bubbles") {
    sendJson(response, 200, await controller.controlBubbles(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/target-temperature") {
    sendJson(response, 200, await controller.setTargetTemperature(Number(body.temperature)));
    return;
  }
  sendJson(response, 404, { error: "API route not found" });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const candidate = path.resolve(publicRoot, `.${decodeURIComponent(requested)}`);
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${path.sep}`)) {
    sendJson(response, 400, { error: "invalid path" });
    return;
  }
  try {
    const stat = await fs.stat(candidate);
    const file = stat.isDirectory() ? path.join(candidate, "index.html") : candidate;
    const data = await fs.readFile(file);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": data.length,
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(response, 404, { error: "not found" });
    else throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url.pathname);
    else if (request.method === "GET" || request.method === "HEAD") await serveStatic(response, url.pathname);
    else sendJson(response, 405, { error: "method not allowed" });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "internal server error",
      code: error.code || "server_error",
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`CleverSpa recovery bridge: http://${config.host}:${config.port}`);
  if (config.loopbackOnly) console.log("Loopback-only mode is active (safe default).");
});

if (config.spaIp) {
  controller.connectLan(config.spaIp, config.spaPasscode).catch((error) => {
    console.error(`Initial LAN connection failed: ${error.message}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
