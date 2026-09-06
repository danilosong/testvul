"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { createServers } = require("../server");

let servers;
let ports;

test.before(async () => {
  servers = createServers();
  ports = await servers.start();
});

test.after(async () => {
  await servers.stop();
});

function request({ port, path, method = "GET", headers = {}, body, tls = false }) {
  const lib = tls ? https : http;
  const options = {
    hostname: "127.0.0.1",
    port,
    path,
    method,
    headers,
    rejectUnauthorized: false,
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function jsonRequest(opts) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  return request(Object.assign({}, opts, { headers, body: opts.body ? JSON.stringify(opts.body) : undefined }));
}

const AUTH_A = { Authorization: "Bearer userA-token" };
const AUTH_B = { Authorization: "Bearer userB-token" };

test("serves an HTML page with links/forms/scripts", async () => {
  const res = await request({ port: ports.httpPort, path: "/" });
  assert.equal(res.status, 200);
  assert.match(res.body, /<a href="\/projects">/);
  assert.match(res.body, /<form action="\/api\/projects\/1" method="post">/);
  assert.match(res.body, /<script src="\/app.js">/);
});

test("serves app.js with literal axios.patch and fetch PATCH call sites", async () => {
  const res = await request({ port: ports.httpPort, path: "/app.js" });
  assert.equal(res.status, 200);
  assert.match(res.body, /axios\.patch\(/);
  assert.match(res.body, /method:\s*"PATCH"/);
});

test("serves an OpenAPI document describing a GET+PATCH pair", async () => {
  const res = await request({ port: ports.httpPort, path: "/openapi.json" });
  assert.equal(res.status, 200);
  const doc = JSON.parse(res.body);
  assert.ok(doc.paths["/api/projects/{id}"].get);
  assert.ok(doc.paths["/api/projects/{id}"].patch);
});

test("GraphQL endpoint is identifiable without introspection", async () => {
  const res = await request({ port: ports.httpPort, path: "/graphql" });
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.errors[0].message, "Must provide query string.");
});

test("Stored XSS: notes field stores raw HTML unsanitized", async () => {
  await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { notes: '<script>alert(1)</script>' },
  });
  const res = await request({ port: ports.httpPort, path: "/api/projects/1", headers: AUTH_A });
  const project = JSON.parse(res.body);
  assert.equal(project.notes, "<script>alert(1)</script>");
});

test("Escaped field: description is HTML-escaped on write", async () => {
  await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { description: "<b>hi</b>" },
  });
  const res = await request({ port: ports.httpPort, path: "/api/projects/1", headers: AUTH_A });
  const project = JSON.parse(res.body);
  assert.equal(project.description, "&lt;b&gt;hi&lt;/b&gt;");
});

test("Allowlist field: summaryHtml keeps allowed tags and strips disallowed ones", async () => {
  await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { summaryHtml: '<script>bad()</script><b>ok</b><a href="javascript:evil()">x</a>' },
  });
  const res = await request({ port: ports.httpPort, path: "/api/projects/1", headers: AUTH_A });
  const project = JSON.parse(res.body);
  assert.doesNotMatch(project.summaryHtml, /<script>/);
  assert.match(project.summaryHtml, /<b>ok<\/b>/);
  assert.doesNotMatch(project.summaryHtml, /javascript:/);
});

test("Sanitizer-probe field: commentHtml strips disallowed attributes but keeps tags", async () => {
  await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { commentHtml: '<div onclick="evil()">hi</div>' },
  });
  const res = await request({ port: ports.httpPort, path: "/api/projects/1", headers: AUTH_A });
  const project = JSON.parse(res.body);
  assert.doesNotMatch(project.commentHtml, /onclick/);
  assert.match(project.commentHtml, /<div>hi<\/div>/);
});

test("GTM vulnerable field: any authenticated user (not just the owner) can change analyticsGtm", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_B,
    body: { analyticsGtm: "GTM-HACKED99" },
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).analyticsGtm, "GTM-HACKED99");
});

test("GTM protected field: non-owner is rejected with 403", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_B,
    body: { protectedGtm: "GTM-HACKED99" },
  });
  assert.equal(res.status, 403);
});

test("GTM protected field: owner can change it", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { protectedGtm: "GTM-OWNER01" },
  });
  assert.equal(res.status, 200);
});

test("GTM strict-format field: a canary failing the format is VALIDATION_REJECTED, not an authorization outcome", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { strictFormatGtm: "GTM-SECURITYTEST" },
  });
  assert.equal(res.status, 422);
  assert.equal(JSON.parse(res.body).error, "VALIDATION_REJECTED");
});

test("GTM strict-format field: a correctly-formatted value is accepted", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { strictFormatGtm: "GTM-TEST1234" },
  });
  assert.equal(res.status, 200);
});

test("price field: the owner-supplied value is stored verbatim instead of being recalculated server-side", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_A,
    body: { price: 1 },
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).price, 1);
});

test("price field: a non-owner is rejected with 403", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/projects/1",
    method: "PATCH",
    headers: AUTH_B,
    body: { price: 1 },
  });
  assert.equal(res.status, 403);
});

test("IDOR-vulnerable endpoint returns another user's project", async () => {
  const res = await request({ port: ports.httpPort, path: "/api/projects/2", headers: AUTH_A });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).owner, "userB");
});

test("IDOR-protected endpoint rejects a non-owner with 403", async () => {
  const res = await request({ port: ports.httpPort, path: "/api/protected-projects/2", headers: AUTH_A });
  assert.equal(res.status, 403);
});

test("IDOR-protected endpoint returns 404 for a nonexistent resource", async () => {
  const res = await request({ port: ports.httpPort, path: "/api/protected-projects/999", headers: AUTH_A });
  assert.equal(res.status, 404);
});

test("in-scope redirect points at a same-host path", async () => {
  const res = await request({ port: ports.httpPort, path: "/redirect/in-scope" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/projects");
});

test("out-of-scope redirect points at an external host", async () => {
  const res = await request({ port: ports.httpPort, path: "/redirect/out-of-scope" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "http://out-of-scope.example.test/");
});

test("same-origin redirect points at an auth-protected same-host path", async () => {
  const res = await request({ port: ports.httpPort, path: "/redirect/same-origin-auth" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/api/projects/1");
});

test("cross-origin redirect target echoes whatever headers it actually receives", async () => {
  const redirectRes = await request({ port: ports.httpPort, path: "/redirect/cross-origin-auth" });
  assert.equal(redirectRes.status, 302);
  assert.equal(redirectRes.headers.location, `http://127.0.0.1:${ports.crossOriginPort}/echo-headers`);

  const echoRes = await request({
    port: ports.crossOriginPort,
    path: "/echo-headers",
    headers: { Authorization: "Bearer userA-token" },
  });
  assert.equal(JSON.parse(echoRes.body).headers.authorization, "Bearer userA-token");
});

test("repeated 429 responses carry Retry-After", async () => {
  const first = await request({ port: ports.httpPort, path: "/errors/429" });
  const second = await request({ port: ports.httpPort, path: "/errors/429" });
  assert.equal(first.status, 429);
  assert.equal(second.status, 429);
  assert.equal(first.headers["retry-after"], "1");
});

test("500/502/503 endpoints return their respective status codes", async () => {
  const r500 = await request({ port: ports.httpPort, path: "/errors/500" });
  const r502 = await request({ port: ports.httpPort, path: "/errors/502" });
  const r503 = await request({ port: ports.httpPort, path: "/errors/503" });
  assert.equal(r500.status, 500);
  assert.equal(r502.status, 502);
  assert.equal(r503.status, 503);
});

test("oversized response exceeds the default 5MB limit", async () => {
  const res = await request({ port: ports.httpPort, path: "/oversized" });
  assert.equal(res.status, 200);
  assert.ok(Buffer.byteLength(res.body) > 5 * 1024 * 1024);
});

test("paginated listing never terminates on its own", async () => {
  const page1 = JSON.parse((await request({ port: ports.httpPort, path: "/paginate?page=1" })).body);
  const page9999 = JSON.parse((await request({ port: ports.httpPort, path: "/paginate?page=9999" })).body);
  assert.equal(page1.nextPage, 2);
  assert.equal(page9999.nextPage, 10000);
});

test("HTTPS listener serves the self-signed fixture certificate", async () => {
  const res = await request({ port: ports.httpsPort, path: "/", tls: true });
  assert.equal(res.status, 200);
});

test("HTTP endpoint redirects to the HTTPS listener", async () => {
  const res = await request({ port: ports.httpPort, path: "/go-https" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, `https://127.0.0.1:${ports.httpsPort}/`);
});

test("ETag precondition: a stale If-Match is rejected with 412", async () => {
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/resources/etag/etag-1",
    method: "PATCH",
    headers: { "If-Match": '"stale-etag"' },
    body: { value: "new-value" },
  });
  assert.equal(res.status, 412);
});

test("ETag precondition: a matching If-Match succeeds and rotates the ETag", async () => {
  const before = await request({ port: ports.httpPort, path: "/api/resources/etag/etag-1" });
  const currentEtag = before.headers.etag;
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/resources/etag/etag-1",
    method: "PATCH",
    headers: { "If-Match": currentEtag },
    body: { value: "updated-value" },
  });
  assert.equal(res.status, 200);
  assert.notEqual(res.headers.etag, currentEtag);
});

test("plain resource carries no concurrency signal and always accepts the write", async () => {
  const res = await request({ port: ports.httpPort, path: "/api/resources/plain/plain-1" });
  assert.equal(res.headers.etag, undefined);
  const patch = await jsonRequest({
    port: ports.httpPort,
    path: "/api/resources/plain/plain-1",
    method: "PATCH",
    body: { value: "overwritten-with-no-precondition" },
  });
  assert.equal(patch.status, 200);
});

test("vulnerable reward claim: replaying the call credits the balance again", async () => {
  const first = await jsonRequest({ port: ports.httpPort, path: "/api/rewards/claim", method: "POST", headers: AUTH_A });
  const replay = await jsonRequest({ port: ports.httpPort, path: "/api/rewards/claim", method: "POST", headers: AUTH_A });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(JSON.parse(replay.body).balance, JSON.parse(first.body).balance + 100);
});

test("protected reward claim: replaying the same Idempotency-Key returns the original result without crediting again", async () => {
  const headers = Object.assign({ "Idempotency-Key": "claim-key-1" }, AUTH_B);
  const first = await jsonRequest({ port: ports.httpPort, path: "/api/rewards/claim-protected", method: "POST", headers });
  const replay = await jsonRequest({ port: ports.httpPort, path: "/api/rewards/claim-protected", method: "POST", headers });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.deepEqual(JSON.parse(replay.body), JSON.parse(first.body));
});

test("protected reward claim: a different Idempotency-Key is treated as a genuinely new operation", async () => {
  const first = await jsonRequest({
    port: ports.httpPort,
    path: "/api/rewards/claim-protected",
    method: "POST",
    headers: Object.assign({ "Idempotency-Key": "claim-key-2" }, AUTH_B),
  });
  const second = await jsonRequest({
    port: ports.httpPort,
    path: "/api/rewards/claim-protected",
    method: "POST",
    headers: Object.assign({ "Idempotency-Key": "claim-key-3" }, AUTH_B),
  });
  assert.equal(JSON.parse(second.body).balance, JSON.parse(first.body).balance + 100);
});

test("protected reward claim: rejects a request with no Idempotency-Key at all", async () => {
  const res = await jsonRequest({ port: ports.httpPort, path: "/api/rewards/claim-protected", method: "POST", headers: AUTH_A });
  assert.equal(res.status, 400);
});
