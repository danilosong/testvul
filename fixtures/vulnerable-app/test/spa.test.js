"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");
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

function request({ port, path, method = "GET", headers = {}, body }) {
  const options = { hostname: "127.0.0.1", port, path, method, headers };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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

async function loginAs(port, username, password) {
  const res = await jsonRequest({ port, path: "/api/login", method: "POST", body: { username, password } });
  const setCookie = res.headers["set-cookie"][0];
  const session = setCookie.split(";")[0];
  return { status: res.status, cookie: session };
}

test("login succeeds for each of User A, User B, and Admin and fails for a wrong password", async () => {
  const a = await loginAs(ports.httpPort, "userA", "userA-pass");
  const b = await loginAs(ports.httpPort, "userB", "userB-pass");
  const admin = await loginAs(ports.httpPort, "admin", "admin-pass");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(admin.status, 200);

  const bad = await jsonRequest({
    port: ports.httpPort,
    path: "/api/login",
    method: "POST",
    body: { username: "userA", password: "wrong" },
  });
  assert.equal(bad.status, 401);
});

test("session cookie authenticates subsequent requests the same as a bearer token", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const res = await request({ port: ports.httpPort, path: "/api/me", headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).id, "userA");
});

test("every app page is reachable and returns its shell HTML", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const pages = [
    "/login",
    "/app/projects",
    "/app/projects/1",
    "/app/settings",
    "/app/admin",
    "/app/profile",
    "/app/sw-demo",
    "/app/ws-demo",
    "/app/reports",
  ];
  for (const page of pages) {
    const res = await request({ port: ports.httpPort, path: page, headers: { Cookie: cookie } });
    assert.equal(res.status, 200, `expected ${page} to return 200`);
    assert.match(res.body, /<html/i, `expected ${page} to return an HTML shell`);
  }
});

test("the admin page is not linked from the projects page nav but is reachable by direct URL", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const projectsPage = await request({ port: ports.httpPort, path: "/app/projects", headers: { Cookie: cookie } });
  assert.doesNotMatch(projectsPage.body, /\/app\/admin/);

  const adminPage = await request({ port: ports.httpPort, path: "/app/admin", headers: { Cookie: cookie } });
  assert.equal(adminPage.status, 200);
});

test("my-projects is an SPA-runtime API scoped to the caller's own projects", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const res = await request({ port: ports.httpPort, path: "/api/my-projects", headers: { Cookie: cookie } });
  const projects = JSON.parse(res.body);
  assert.ok(projects.every((p) => p.owner === "userA"));
});

test("admin summary is forbidden for a non-admin session and allowed for admin", async () => {
  const { cookie: userCookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const { cookie: adminCookie } = await loginAs(ports.httpPort, "admin", "admin-pass");
  const forbidden = await request({ port: ports.httpPort, path: "/api/admin/summary", headers: { Cookie: userCookie } });
  const allowed = await request({ port: ports.httpPort, path: "/api/admin/summary", headers: { Cookie: adminCookie } });
  assert.equal(forbidden.status, 403);
  assert.equal(allowed.status, 200);
});

test("profile endpoint stores bio verbatim (Stored-XSS-vulnerable, rendered only via client hydration)", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  await jsonRequest({
    port: ports.httpPort,
    path: "/api/profile",
    method: "PATCH",
    headers: { Cookie: cookie },
    body: { bio: "<img src=x onerror=alert(1)>" },
  });
  const res = await request({ port: ports.httpPort, path: "/api/profile", headers: { Cookie: cookie } });
  assert.equal(JSON.parse(res.body).bio, "<img src=x onerror=alert(1)>");

  const page = await request({ port: ports.httpPort, path: "/app/profile" });
  assert.doesNotMatch(page.body, /onerror=alert/); // absent from the initial (pre-hydration) HTML
});

test("client-limit-only settings has no server-side cap", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/settings",
    method: "PATCH",
    headers: { Cookie: cookie },
    body: { quantity: 999 },
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).quantity, 999);
});

test("server-enforced settings rejects a quantity above the limit", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const res = await jsonRequest({
    port: ports.httpPort,
    path: "/api/settings-enforced",
    method: "PATCH",
    headers: { Cookie: cookie },
    body: { quantity: 999 },
  });
  assert.equal(res.status, 400);
});

test("delete-account endpoint exists and responds only when actually invoked", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const res = await request({ port: ports.httpPort, path: "/api/account", method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
});

test("service worker script is served and independently forwards a duplicate mutation", async () => {
  const swRes = await request({ port: ports.httpPort, path: "/sw.js" });
  assert.equal(swRes.status, 200);
  assert.match(swRes.body, /addEventListener\("fetch"/);

  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const before = servers.state.swSaveCount;
  await request({ port: ports.httpPort, path: "/api/sw-save", method: "PATCH", headers: { Cookie: cookie } });
  assert.equal(servers.state.swSaveCount, before + 1);
});

test("download control and upload form are present and reachable", async () => {
  const { cookie } = await loginAs(ports.httpPort, "userA", "userA-pass");
  const page = await request({ port: ports.httpPort, path: "/app/reports", headers: { Cookie: cookie } });
  assert.match(page.body, /id="export-link"/);
  assert.match(page.body, /type="file"/);

  const exportRes = await request({ port: ports.httpPort, path: "/api/export-report", headers: { Cookie: cookie } });
  assert.equal(exportRes.status, 200);
  assert.match(exportRes.headers["content-disposition"], /attachment/);

  const uploadRes = await request({
    port: ports.httpPort,
    path: "/api/upload",
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "text/plain" },
    body: "file-bytes",
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(JSON.parse(uploadRes.body).bytes, Buffer.byteLength("file-bytes"));
});

test("WebSocket endpoint completes the handshake and exchanges one application-operation message", () => {
  return new Promise((resolve, reject) => {
    const socket = net.connect(ports.httpPort, "127.0.0.1", () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        "GET /ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });

    let handshakeDone = false;
    let buffered = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!handshakeDone) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffered.subarray(0, headerEnd).toString("utf8");
        assert.match(header, /101 Switching Protocols/);
        handshakeDone = true;
        buffered = buffered.subarray(headerEnd + 4);

        const payload = Buffer.from(JSON.stringify({ action: "placeBid" }), "utf8");
        const frame = Buffer.concat([
          Buffer.from([0x81, 0x80 | payload.length]),
          Buffer.from([0, 0, 0, 0]), // zero mask key: payload sent unmodified
          payload,
        ]);
        socket.write(frame);
        return;
      }

      // Decode one unmasked server->client text frame.
      const opcode = buffered[0] & 0x0f;
      const len = buffered[1] & 0x7f;
      const message = buffered.subarray(2, 2 + len).toString("utf8");
      assert.equal(opcode, 0x1);
      const parsed = JSON.parse(message);
      assert.equal(parsed.action, "placeBid");
      assert.equal(parsed.status, "ok");
      socket.destroy();
      resolve();
    });

    socket.on("error", reject);
  });
});
