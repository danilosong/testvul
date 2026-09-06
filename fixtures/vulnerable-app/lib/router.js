"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { authenticate } = require("./auth");
const { escapeHtml, allowlistSanitize, stripDisallowedAttributes } = require("./sanitize");
const { createContestRouter } = require("./contest-router");

const STATIC_DIR = path.join(__dirname, "..", "static");
const APP_DIR = path.join(STATIC_DIR, "app");
const OPENAPI_PATH = path.join(__dirname, "..", "openapi.json");

const QUANTITY_SERVER_LIMIT = 10;

function sendHtmlFile(res, fileName) {
  return sendText(res, 200, fs.readFileSync(path.join(APP_DIR, fileName)), "text/html");
}

const STRICT_GTM_FORMAT = /^GTM-[A-Z]{4}\d{4}$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Server: "nginx" }, headers));
  res.end(body);
}

function sendText(res, status, body, contentType, headers) {
  const buf = Buffer.from(body);
  res.writeHead(status, Object.assign({ "Content-Type": contentType || "text/plain", "Content-Length": buf.length, Server: "nginx" }, headers));
  res.end(buf);
}

function etagOf(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isOwnerOrAdmin(user, project) {
  return !!user && (user.id === project.owner || user.role === "admin");
}

/**
 * Shared route table for the plaintext HTTP listener and the HTTPS listener
 * (both fixture surfaces expose the same application). `ctx` carries the
 * ports of the sibling listeners so redirect endpoints can reference them —
 * it is filled in after all three servers are actually listening, since
 * dynamic (port 0) test runs don't know their ports at router-construction
 * time.
 */
function createMainRouter(state, ctx) {
  const contestRouter = createContestRouter(state);

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const method = req.method;

    if (pathname === "/echo-headers") {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "authorization, content-type");
      if (method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      return sendJson(res, 200, { headers: req.headers });
    }

    if (pathname.startsWith("/api/contest/") || pathname.startsWith("/api/vuln-contest/")) {
      const handled = await contestRouter(req, res, url, method);
      if (handled) return;
    }

    if (method === "GET" && pathname === "/") {
      return sendText(res, 200, fs.readFileSync(path.join(STATIC_DIR, "index.html")), "text/html");
    }
    if (method === "GET" && pathname === "/app.js") {
      return sendText(res, 200, fs.readFileSync(path.join(STATIC_DIR, "app.js")), "application/javascript");
    }
    if (method === "GET" && pathname === "/openapi.json") {
      return sendText(res, 200, fs.readFileSync(OPENAPI_PATH), "application/json");
    }
    if (method === "GET" && pathname === "/projects") {
      return sendText(res, 200, "<html><body>Projects landing page</body></html>", "text/html");
    }
    if (method === "GET" && pathname === "/host-discovery-fixture") {
      // Section 14.4 fixture: a page linking to both an in-scope subdomain
      // and an out-of-scope host, both fake/never-connected-to — scope
      // routing is decided from the hostname string alone, before any
      // connection is attempted. Kept off the shared "/" page so it never
      // interferes with an ordinary crawl starting there.
      return sendText(
        res,
        200,
        '<html><body><a href="http://sub.in-scope.example.test/">In-scope subdomain</a><a href="http://out-of-scope.example.test/">Out-of-scope host</a></body></html>',
        "text/html",
      );
    }

    // ── Browser-driven SPA fixture (Section 1.5) ────────────────────────

    if (method === "GET" && pathname === "/login") return sendHtmlFile(res, "login.html");
    if (method === "GET" && pathname === "/app/projects") return sendHtmlFile(res, "projects.html");
    if (method === "GET" && /^\/app\/projects\/[^/]+$/.test(pathname)) return sendHtmlFile(res, "project-detail.html");
    if (method === "GET" && pathname === "/app/settings") return sendHtmlFile(res, "settings.html");
    // Not linked from any nav in the fixture's HTML — reachable only by direct URL.
    if (method === "GET" && pathname === "/app/admin") return sendHtmlFile(res, "admin.html");
    if (method === "GET" && pathname === "/app/profile") return sendHtmlFile(res, "profile.html");
    if (method === "GET" && pathname === "/app/sw-demo") return sendHtmlFile(res, "sw-demo.html");
    if (method === "GET" && pathname === "/app/ws-demo") return sendHtmlFile(res, "ws-demo.html");
    if (method === "GET" && pathname === "/app/reports") return sendHtmlFile(res, "reports.html");

    if (method === "GET" && pathname === "/sw.js") {
      return sendText(res, 200, fs.readFileSync(path.join(STATIC_DIR, "sw.js")), "application/javascript");
    }
    const assetMatch = pathname.match(/^\/app-assets\/([a-z0-9-]+\.js)$/);
    if (method === "GET" && assetMatch) {
      const filePath = path.join(APP_DIR, path.basename(assetMatch[1]));
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: "NOT_FOUND" });
      return sendText(res, 200, fs.readFileSync(filePath), "application/javascript");
    }

    if (method === "POST" && pathname === "/api/login") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const cred = state.credentials[body.username];
      if (!cred || cred.password !== body.password) {
        return sendJson(res, 401, { error: "INVALID_CREDENTIALS" });
      }
      return sendJson(
        res,
        200,
        { ok: true, id: body.username },
        { "Set-Cookie": `session=${cred.token}; HttpOnly; Path=/` },
      );
    }
    if (method === "GET" && pathname === "/api/logout") {
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": "session=; Max-Age=0; Path=/" });
    }
    if (method === "GET" && pathname === "/api/me") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return sendJson(res, 200, user);
    }
    if (method === "GET" && pathname === "/api/my-projects") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const owned = Object.values(state.projects).filter((p) => p.owner === user.id);
      return sendJson(res, 200, owned);
    }

    if (pathname === "/api/profile" && (method === "GET" || method === "PATCH")) {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      if (method === "GET") return sendJson(res, 200, state.profiles[user.id]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      state.profiles[user.id].bio = String(body.bio); // stored verbatim, deliberately vulnerable
      return sendJson(res, 200, state.profiles[user.id]);
    }

    if (pathname === "/api/settings" && (method === "GET" || method === "PATCH")) {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      if (method === "GET") return sendJson(res, 200, state.settings[user.id]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      state.settings[user.id].quantity = Number(body.quantity); // no server-side cap: client-limit-only
      return sendJson(res, 200, state.settings[user.id]);
    }

    // ── Section 13.13 (Replay and Idempotency Analysis) fixture ─────────

    if (method === "POST" && pathname === "/api/rewards/claim") {
      // Vulnerable variant: no Idempotency-Key (or any other) replay
      // protection at all — every call credits the balance again.
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const reward = state.rewards[user.id];
      reward.balance += 100;
      return sendJson(res, 200, { balance: reward.balance });
    }

    if (method === "POST" && pathname === "/api/rewards/claim-protected") {
      // Protected variant: an Idempotency-Key header is required; replaying
      // the same key returns the original stored result without crediting
      // the balance again.
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey) return sendJson(res, 400, { error: "IDEMPOTENCY_KEY_REQUIRED" });
      const reward = state.rewards[user.id];
      const existing = reward.completedIdempotencyKeys[idempotencyKey];
      if (existing) return sendJson(res, 200, existing);
      reward.balance += 100;
      const result = { balance: reward.balance };
      reward.completedIdempotencyKeys[idempotencyKey] = result;
      return sendJson(res, 200, result);
    }
    if (pathname === "/api/settings-enforced" && (method === "GET" || method === "PATCH")) {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      if (method === "GET") return sendJson(res, 200, state.settingsEnforced[user.id]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const quantity = Number(body.quantity);
      if (quantity > QUANTITY_SERVER_LIMIT) {
        return sendJson(res, 400, { error: "LIMIT_EXCEEDED", limit: QUANTITY_SERVER_LIMIT });
      }
      state.settingsEnforced[user.id].quantity = quantity;
      return sendJson(res, 200, state.settingsEnforced[user.id]);
    }

    if (method === "DELETE" && pathname === "/api/account") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return sendJson(res, 200, { deleted: true });
    }

    if (method === "GET" && pathname === "/api/admin/summary") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      if (user.role !== "admin") return sendJson(res, 403, { error: "FORBIDDEN" });
      return sendJson(res, 200, { rankings: Object.values(state.projects).map((p) => p.name) });
    }

    if (method === "PATCH" && pathname === "/api/sw-save") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      state.swSaveCount += 1;
      return sendJson(res, 200, { swSaveCount: state.swSaveCount });
    }

    if (method === "GET" && pathname === "/api/export-report") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return sendText(res, 200, "id,name\n1,Project Alpha\n", "text/csv", {
        "Content-Disposition": 'attachment; filename="report.csv"',
      });
    }
    if (method === "POST" && pathname === "/api/upload") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const body = await readBody(req); // never parsed/executed — byte length only
      return sendJson(res, 200, { received: true, bytes: body.length });
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && (method === "GET" || method === "PATCH")) {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const project = state.projects[projectMatch[1]];
      if (!project) return sendJson(res, 404, { error: "NOT_FOUND" });

      if (method === "GET") {
        // Intentionally vulnerable: no ownership check (IDOR).
        return sendJson(res, 200, project);
      }

      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");

      if (Object.prototype.hasOwnProperty.call(body, "notes")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.notes = String(body.notes); // stored verbatim: Stored-XSS-vulnerable field
      }
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.description = escapeHtml(body.description);
      }
      if (Object.prototype.hasOwnProperty.call(body, "summaryHtml")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.summaryHtml = allowlistSanitize(body.summaryHtml);
      }
      if (Object.prototype.hasOwnProperty.call(body, "commentHtml")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.commentHtml = stripDisallowedAttributes(body.commentHtml);
      }
      if (Object.prototype.hasOwnProperty.call(body, "analyticsGtm")) {
        // Intentionally vulnerable: any authenticated user, not just the owner, can change it.
        project.analyticsGtm = String(body.analyticsGtm);
      }
      if (Object.prototype.hasOwnProperty.call(body, "protectedGtm")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.protectedGtm = String(body.protectedGtm);
      }
      if (Object.prototype.hasOwnProperty.call(body, "strictFormatGtm")) {
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        if (!STRICT_GTM_FORMAT.test(String(body.strictFormatGtm))) {
          return sendJson(res, 422, { error: "VALIDATION_REJECTED", reason: "strictFormatGtm must match GTM-XXXX0000" });
        }
        project.strictFormatGtm = String(body.strictFormatGtm);
      }
      if (Object.prototype.hasOwnProperty.call(body, "price")) {
        // Section 13.15 (Price/Amount Integrity) fixture field: stored
        // verbatim from the client instead of being recalculated
        // server-side — deliberately vulnerable to price tampering.
        if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
        project.price = Number(body.price);
      }

      return sendJson(res, 200, project);
    }

    const protectedMatch = pathname.match(/^\/api\/protected-projects\/([^/]+)$/);
    if (protectedMatch && method === "GET") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" });
      const project = state.projects[protectedMatch[1]];
      if (!project) return sendJson(res, 404, { error: "NOT_FOUND" });
      if (!isOwnerOrAdmin(user, project)) return sendJson(res, 403, { error: "FORBIDDEN" });
      return sendJson(res, 200, project);
    }

    if (method === "GET" && pathname === "/redirect/in-scope") {
      res.writeHead(302, { Location: "/projects" });
      return res.end();
    }
    if (method === "GET" && pathname === "/redirect/out-of-scope") {
      res.writeHead(302, { Location: "http://out-of-scope.example.test/" });
      return res.end();
    }
    if (method === "GET" && pathname === "/redirect/cross-origin-auth") {
      res.writeHead(302, { Location: `http://127.0.0.1:${ctx.crossOriginPort}/echo-headers` });
      return res.end();
    }
    if (method === "GET" && pathname === "/redirect/same-origin-auth") {
      // Same host and port as this listener — lands on an endpoint that
      // requires Authorization, so a caller can prove whether credentials
      // survived a same-origin redirect (they must).
      res.writeHead(302, { Location: "/api/projects/1" });
      return res.end();
    }
    if (method === "GET" && pathname === "/go-https") {
      res.writeHead(301, { Location: `https://127.0.0.1:${ctx.httpsPort}/` });
      return res.end();
    }

    if (method === "GET" && pathname === "/errors/429") {
      return sendJson(res, 429, { error: "RATE_LIMITED" }, { "Retry-After": "1" });
    }
    if (method === "GET" && pathname === "/errors/500") return sendJson(res, 500, { error: "INTERNAL" });
    if (method === "GET" && pathname === "/errors/502") return sendJson(res, 502, { error: "BAD_GATEWAY" });
    if (method === "GET" && pathname === "/errors/503") return sendJson(res, 503, { error: "UNAVAILABLE" });

    if (method === "GET" && pathname === "/oversized") {
      const bytes = Number(url.searchParams.get("bytes")) || 6 * 1024 * 1024;
      return sendText(res, 200, "A".repeat(bytes), "text/plain");
    }

    if (method === "GET" && pathname === "/paginate") {
      const page = Number(url.searchParams.get("page")) || 1;
      return sendJson(res, 200, { page, items: [`item-${page}-a`, `item-${page}-b`], nextPage: page + 1 });
    }

    if (pathname === "/graphql" && (method === "GET" || method === "POST")) {
      let query = method === "GET" ? url.searchParams.get("query") : null;
      if (method === "POST") {
        try {
          const parsed = JSON.parse((await readBody(req)).toString("utf8") || "{}");
          query = parsed.query;
        } catch {
          query = null;
        }
      }
      if (!query) {
        return sendJson(res, 400, { errors: [{ message: "Must provide query string." }] });
      }
      return sendJson(res, 200, { data: { __typename: "Query" } });
    }

    if (method === "GET" && pathname === "/api/resources/etag/etag-1") {
      const etag = etagOf(state.etagResource);
      return sendJson(res, 200, state.etagResource, { ETag: `"${etag}"` });
    }
    if (method === "PATCH" && pathname === "/api/resources/etag/etag-1") {
      const currentEtag = etagOf(state.etagResource);
      const ifMatch = (req.headers["if-match"] || "").replace(/^"|"$/g, "");
      if (!ifMatch || ifMatch !== currentEtag) {
        return sendJson(res, 412, { error: "PRECONDITION_FAILED" });
      }
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      state.etagResource.value = body.value;
      const newEtag = etagOf(state.etagResource);
      return sendJson(res, 200, state.etagResource, { ETag: `"${newEtag}"` });
    }

    if (method === "GET" && pathname === "/api/resources/plain/plain-1") {
      return sendJson(res, 200, state.plainResource);
    }
    if (method === "PATCH" && pathname === "/api/resources/plain/plain-1") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      state.plainResource.value = body.value; // no concurrency signal at all, by design
      return sendJson(res, 200, state.plainResource);
    }

    return sendJson(res, 404, { error: "NOT_FOUND" });
  };
}

function createCrossOriginRouter() {
  return async function handle(req, res) {
    // CORS is enabled purely so a real browser (Section 12's Browser
    // Network Policy tests) can actually complete and read a cross-origin
    // fetch to this echo endpoint — reflecting the request's own
    // Authorization/custom headers back is what "echo" needs, not a
    // security control this fixture is trying to demonstrate.
    const requestedHeaders = req.headers["access-control-request-headers"];
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", requestedHeaders || "authorization, content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/echo-headers") {
      return sendJson(res, 200, { headers: req.headers });
    }
    return sendJson(res, 404, { error: "NOT_FOUND" });
  };
}

module.exports = { createMainRouter, createCrossOriginRouter };
