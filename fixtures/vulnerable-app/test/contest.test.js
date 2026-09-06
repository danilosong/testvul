"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServers } = require("../server");
const { signatureFor } = require("../lib/contest-router");

let servers;
let ports;

test.before(async () => {
  servers = createServers();
  ports = await servers.start();
});

test.after(async () => {
  await servers.stop();
});

function request({ path, method = "GET", headers = {}, body }) {
  const options = { hostname: "127.0.0.1", port: ports.httpPort, path, method, headers };
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

const AUTH_A = { Authorization: "Bearer userA-token" };
const AUTH_B = { Authorization: "Bearer userB-token" };
const AUTH_ADMIN = { Authorization: "Bearer admin-token" };

async function reserveAndPurchase(auth, campaignId = "1", ttlMs) {
  const reserveRes = await jsonRequest({
    path: `/api/contest/campaigns/${campaignId}/reservations`,
    method: "POST",
    headers: auth,
    body: ttlMs ? { ttlMs } : {},
  });
  const reservation = JSON.parse(reserveRes.body);
  const purchaseRes = await request({
    path: `/api/contest/reservations/${reservation.id}/purchase`,
    method: "POST",
    headers: auth,
  });
  return { reservation, purchase: JSON.parse(purchaseRes.body), purchaseStatus: purchaseRes.status };
}

test("winning-determinative state is hidden before campaign close and revealed after", async () => {
  const before = await request({ path: "/api/contest/campaigns/1" });
  assert.equal(JSON.parse(before.body).winningNumber, undefined);

  await request({ path: "/api/contest/campaigns/1/close", method: "POST", headers: AUTH_ADMIN });

  const after = await request({ path: "/api/contest/campaigns/1" });
  assert.ok("winningNumber" in JSON.parse(after.body));
});

test("only the campaign admin can close it", async () => {
  const res = await request({ path: "/api/contest/campaigns/1/close", method: "POST", headers: AUTH_A });
  assert.equal(res.status, 403);
});

test("ticket numbers are server-assigned, sequential, and never client-controlled", async () => {
  const first = await reserveAndPurchase(AUTH_A);
  const second = await reserveAndPurchase(AUTH_A);
  assert.equal(typeof first.purchase.ticket.number, "number");
  assert.ok(second.purchase.ticket.number > first.purchase.ticket.number);
});

test("a ticket number is immutable once the ticket is PAID", async () => {
  const { purchase } = await reserveAndPurchase(AUTH_A);
  const signature = signatureFor("fixture-webhook-secret", Buffer.from(JSON.stringify({ purchaseId: purchase.purchase.id })));
  await request({
    path: "/api/contest/payments/webhook",
    method: "POST",
    headers: { "X-Webhook-Signature": signature, "Content-Type": "application/json" },
    body: JSON.stringify({ purchaseId: purchase.purchase.id }),
  });

  const res = await jsonRequest({
    path: `/api/contest/tickets/${purchase.ticket.id}`,
    method: "PATCH",
    headers: AUTH_ADMIN,
    body: { number: 99999 },
  });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(res.body).error, "IMMUTABLE_AFTER_PAYMENT");
});

test("only PAID tickets are eligible", async () => {
  const { purchase } = await reserveAndPurchase(AUTH_B);
  const before = await request({ path: "/api/contest/campaigns/1/eligible-numbers" });
  assert.ok(!JSON.parse(before.body).numbers.includes(purchase.ticket.number));

  const signature = signatureFor("fixture-webhook-secret", Buffer.from(JSON.stringify({ purchaseId: purchase.purchase.id })));
  await request({
    path: "/api/contest/payments/webhook",
    method: "POST",
    headers: { "X-Webhook-Signature": signature, "Content-Type": "application/json" },
    body: JSON.stringify({ purchaseId: purchase.purchase.id }),
  });

  const after = await request({ path: "/api/contest/campaigns/1/eligible-numbers" });
  assert.ok(JSON.parse(after.body).numbers.includes(purchase.ticket.number));
});

test("User A cannot access User B's ticket", async () => {
  const { purchase } = await reserveAndPurchase(AUTH_B);
  const res = await request({ path: `/api/contest/tickets/${purchase.ticket.id}`, headers: AUTH_A });
  assert.equal(res.status, 403);
});

test("reservations expire and can no longer be purchased", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/contest/campaigns/1/reservations",
    method: "POST",
    headers: AUTH_A,
    body: { ttlMs: 1 },
  });
  const reservation = JSON.parse(reserveRes.body);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const res = await request({ path: `/api/contest/reservations/${reservation.id}/purchase`, method: "POST", headers: AUTH_A });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(res.body).error, "RESERVATION_EXPIRED");
});

test("the correct ranking endpoint is admin-only", async () => {
  const forbidden = await request({ path: "/api/contest/campaigns/1/ranking", headers: AUTH_A });
  const allowed = await request({ path: "/api/contest/campaigns/1/ranking", headers: AUTH_ADMIN });
  assert.equal(forbidden.status, 403);
  assert.equal(allowed.status, 200);
});

test("the protected webhook rejects a request with no or an invalid signature", async () => {
  const { purchase } = await reserveAndPurchase(AUTH_A, "1");
  const noSig = await jsonRequest({
    path: "/api/contest/payments/webhook",
    method: "POST",
    body: { purchaseId: purchase.purchase.id },
  });
  assert.equal(noSig.status, 401);

  const badSig = await request({
    path: "/api/contest/payments/webhook",
    method: "POST",
    headers: { "X-Webhook-Signature": "0".repeat(64), "Content-Type": "application/json" },
    body: JSON.stringify({ purchaseId: purchase.purchase.id }),
  });
  assert.equal(badSig.status, 401);
});

// ── vulnerable "lowest eligible number wins" variant ────────────────────

test("vulnerable: current-lowest-eligible-number is reachable unauthenticated", async () => {
  const res = await request({ path: "/api/vuln-contest/campaigns/2/current-lowest-eligible-number" });
  assert.equal(res.status, 200);
  assert.ok("currentLowestEligibleNumber" in JSON.parse(res.body));
});

test("vulnerable: the reservation endpoint honors a client-supplied ticketNumber", async () => {
  const res = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_A,
    body: { ticketNumber: 1 },
  });
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(res.body).number, 1);
});

test("vulnerable: a merely RESERVED (unpaid) ticket counts as eligible", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_B,
    body: { ticketNumber: 2 },
  });
  assert.equal(JSON.parse(reserveRes.body).status, "RESERVED");
  const res = await request({ path: "/api/vuln-contest/campaigns/2/current-lowest-eligible-number" });
  assert.ok(JSON.parse(res.body).currentLowestEligibleNumber <= 2);
});

test("vulnerable: cancelling a ticket does not remove its eligibility", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_A,
    body: { ticketNumber: 1 },
  });
  const ticket = JSON.parse(reserveRes.body);
  const cancelRes = await request({
    path: `/api/vuln-contest/tickets/${ticket.id}/cancel`,
    method: "POST",
    headers: AUTH_A,
  });
  assert.equal(JSON.parse(cancelRes.body).status, "CANCELLED");
  const res = await request({ path: "/api/vuln-contest/campaigns/2/current-lowest-eligible-number" });
  assert.equal(JSON.parse(res.body).currentLowestEligibleNumber, 1); // still counted despite cancellation
});

test("vulnerable: two simultaneous reservations can receive the same ticket number", async () => {
  const [a, b] = await Promise.all([
    jsonRequest({
      path: "/api/vuln-contest/campaigns/2/reservations",
      method: "POST",
      headers: AUTH_A,
      body: { ticketNumber: 42 },
    }),
    jsonRequest({
      path: "/api/vuln-contest/campaigns/2/reservations",
      method: "POST",
      headers: AUTH_B,
      body: { ticketNumber: 42 },
    }),
  ]);
  assert.equal(JSON.parse(a.body).number, 42);
  assert.equal(JSON.parse(b.body).number, 42);
});

test("vulnerable: the ranking endpoint is reachable by a normal-privilege user", async () => {
  const res = await request({ path: "/api/vuln-contest/campaigns/2/ranking", headers: AUTH_A });
  assert.equal(res.status, 200);
});

test("vulnerable: the payment webhook accepts an unauthenticated, unsigned callback", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_A,
    body: { ticketNumber: 7 },
  });
  const ticket = JSON.parse(reserveRes.body);
  const res = await jsonRequest({
    path: "/api/vuln-contest/payments/webhook",
    method: "POST",
    body: { ticketId: ticket.id },
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).status, "PAID");
});

test("vulnerable: a ticket can be read by id with no ownership check at all", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_B,
    body: { ticketNumber: 99 },
  });
  const ticket = JSON.parse(reserveRes.body);
  assert.equal(ticket.ownerId, "userB");

  const res = await request({ path: `/api/vuln-contest/tickets/${ticket.id}`, headers: AUTH_A });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ownerId, "userB");
});

test("vulnerable: a ticket's number can still be changed after it is already PAID", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_A,
    body: { ticketNumber: 500 },
  });
  const ticket = JSON.parse(reserveRes.body);

  const payRes = await jsonRequest({
    path: "/api/vuln-contest/payments/webhook",
    method: "POST",
    body: { ticketId: ticket.id },
  });
  assert.equal(JSON.parse(payRes.body).status, "PAID");

  const patchRes = await jsonRequest({
    path: `/api/vuln-contest/tickets/${ticket.id}`,
    method: "PATCH",
    headers: AUTH_A,
    body: { number: 99999 },
  });
  assert.equal(patchRes.status, 200);
  assert.equal(JSON.parse(patchRes.body).number, 99999);
});

test("vulnerable: reading a ticket by id still requires authentication", async () => {
  const reserveRes = await jsonRequest({
    path: "/api/vuln-contest/campaigns/2/reservations",
    method: "POST",
    headers: AUTH_B,
    body: { ticketNumber: 100 },
  });
  const ticket = JSON.parse(reserveRes.body);
  const res = await request({ path: `/api/vuln-contest/tickets/${ticket.id}` });
  assert.equal(res.status, 401);
});
