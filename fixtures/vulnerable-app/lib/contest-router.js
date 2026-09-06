"use strict";

const crypto = require("crypto");
const { authenticate } = require("./auth");

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
  res.writeHead(status, Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, headers));
  res.end(body);
}

function isOwnerOrAdmin(user, ownerId) {
  return !!user && (user.id === ownerId || user.role === "admin");
}

function isExpired(reservation) {
  return Date.now() > new Date(reservation.expiresAt).getTime();
}

function signatureFor(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function validSignature(expectedHex, providedHex) {
  if (!providedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Handles the Contest/Ticketing business-logic fixture routes (Section
 * 1.6). Returns `true` if the request was handled, `false` otherwise so the
 * caller can fall through to its own routes/404.
 */
function createContestRouter(state) {
  const contest = state.contest;

  return async function tryHandle(req, res, url, method) {
    const pathname = url.pathname;

    // ── correct / protected behavior ──────────────────────────────────

    let m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)$/);
    if (m && method === "GET") {
      const campaign = contest.campaigns[m[1]];
      if (!campaign) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      const { winningNumber, ...rest } = campaign;
      // Winning-determinative state is never exposed before campaign close.
      return sendJson(res, 200, campaign.closed ? campaign : rest), true;
    }

    m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)\/close$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      if (user.role !== "admin") return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      const campaign = contest.campaigns[m[1]];
      if (!campaign) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      const paidNumbers = Object.values(contest.tickets)
        .filter((t) => t.campaignId === campaign.id && t.status === "PAID")
        .map((t) => t.number);
      campaign.closed = true;
      campaign.winningNumber = paidNumbers.length ? Math.min(...paidNumbers) : null;
      return sendJson(res, 200, campaign), true;
    }

    m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)\/prize$/);
    if (m && method === "GET") {
      const campaign = contest.campaigns[m[1]];
      if (!campaign) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (!campaign.closed) return sendJson(res, 403, { error: "CAMPAIGN_NOT_CLOSED" }), true;
      const winningTicket = Object.values(contest.tickets).find(
        (t) => t.campaignId === campaign.id && t.status === "PAID" && t.number === campaign.winningNumber,
      );
      return sendJson(res, 200, { winningNumber: campaign.winningNumber, winningTicketId: winningTicket ? winningTicket.id : null }), true;
    }

    m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)\/eligible-numbers$/);
    if (m && method === "GET") {
      const numbers = Object.values(contest.tickets)
        .filter((t) => t.campaignId === m[1] && t.status === "PAID") // only PAID tickets are eligible
        .map((t) => t.number)
        .sort((a, b) => a - b);
      return sendJson(res, 200, { numbers }), true;
    }

    m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)\/ranking$/);
    if (m && method === "GET") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      if (user.role !== "admin") return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      const ranking = Object.values(contest.tickets)
        .filter((t) => t.campaignId === m[1])
        .sort((a, b) => a.number - b.number);
      return sendJson(res, 200, { ranking }), true;
    }

    m = pathname.match(/^\/api\/contest\/campaigns\/([^/]+)\/reservations$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const campaign = contest.campaigns[m[1]];
      if (!campaign) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const ttlMs = Number.isFinite(body.ttlMs) ? body.ttlMs : 60000;
      const id = String(contest.nextReservationId++);
      const reservation = {
        id,
        campaignId: campaign.id,
        ownerId: user.id,
        status: "RESERVED",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      };
      contest.reservations[id] = reservation;
      return sendJson(res, 201, reservation), true;
    }

    m = pathname.match(/^\/api\/contest\/reservations\/([^/]+)$/);
    if (m && method === "GET") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const reservation = contest.reservations[m[1]];
      if (!reservation) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (!isOwnerOrAdmin(user, reservation.ownerId)) return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      if (reservation.status === "RESERVED" && isExpired(reservation)) reservation.status = "EXPIRED";
      return sendJson(res, 200, reservation), true;
    }

    m = pathname.match(/^\/api\/contest\/reservations\/([^/]+)\/purchase$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const reservation = contest.reservations[m[1]];
      if (!reservation) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (!isOwnerOrAdmin(user, reservation.ownerId)) return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      if (reservation.status !== "RESERVED") return sendJson(res, 409, { error: "RESERVATION_NOT_ACTIVE" }), true;
      if (isExpired(reservation)) {
        reservation.status = "EXPIRED";
        return sendJson(res, 409, { error: "RESERVATION_EXPIRED" }), true;
      }
      const campaign = contest.campaigns[reservation.campaignId];
      const ticketId = String(contest.nextTicketId++);
      const ticket = {
        id: ticketId,
        campaignId: campaign.id,
        ownerId: user.id,
        number: campaign.nextTicketNumber++, // server-assigned, never client-supplied
        status: "PENDING_PAYMENT",
      };
      contest.tickets[ticketId] = ticket;
      const purchaseId = String(contest.nextPurchaseId++);
      const purchase = { id: purchaseId, ticketId, ownerId: user.id, status: "PENDING" };
      contest.purchases[purchaseId] = purchase;
      reservation.status = "CONVERTED";
      return sendJson(res, 201, { ticket, purchase }), true;
    }

    m = pathname.match(/^\/api\/contest\/tickets\/([^/]+)$/);
    if (m && (method === "GET" || method === "PATCH")) {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const ticket = contest.tickets[m[1]];
      if (!ticket) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (method === "GET") {
        if (!isOwnerOrAdmin(user, ticket.ownerId)) return sendJson(res, 403, { error: "FORBIDDEN" }), true;
        return sendJson(res, 200, ticket), true;
      }
      if (user.role !== "admin") return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      if (ticket.status === "PAID") return sendJson(res, 409, { error: "IMMUTABLE_AFTER_PAYMENT" }), true;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (Object.prototype.hasOwnProperty.call(body, "number")) ticket.number = Number(body.number);
      return sendJson(res, 200, ticket), true;
    }

    m = pathname.match(/^\/api\/contest\/tickets\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const ticket = contest.tickets[m[1]];
      if (!ticket) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (!isOwnerOrAdmin(user, ticket.ownerId)) return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      ticket.status = "CANCELLED"; // correctly excluded from eligible-numbers, which only counts PAID
      return sendJson(res, 200, ticket), true;
    }

    if (pathname === "/api/contest/payments/webhook" && method === "POST") {
      const rawBody = await readBody(req);
      const providedSignature = req.headers["x-webhook-signature"];
      const expected = signatureFor(contest.webhookSecret, rawBody);
      if (!validSignature(expected, providedSignature)) {
        return sendJson(res, 401, { error: "INVALID_SIGNATURE" }), true;
      }
      const body = JSON.parse(rawBody.toString("utf8") || "{}");
      const purchase = contest.purchases[body.purchaseId];
      if (!purchase) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      const ticket = contest.tickets[purchase.ticketId];
      if (ticket.status === "PENDING_PAYMENT") ticket.status = "PAID";
      purchase.status = "COMPLETED";
      return sendJson(res, 200, { ticket, purchase }), true;
    }

    // ── deliberately-vulnerable "lowest eligible number wins" variant ──

    m = pathname.match(/^\/api\/vuln-contest\/campaigns\/([^/]+)\/current-lowest-eligible-number$/);
    if (m && method === "GET") {
      // Reachable unauthenticated, and — the actual bug — counts every
      // ticket ever created (RESERVED/PENDING_PAYMENT/PAID/CANCELLED alike)
      // as eligible instead of only PAID ones, so a RESERVED-but-unpaid or
      // even a CANCELLED ticket can still win.
      const numbers = Object.values(contest.tickets)
        .filter((t) => t.campaignId === m[1])
        .map((t) => t.number);
      const currentLowestEligibleNumber = numbers.length ? Math.min(...numbers) : null;
      return sendJson(res, 200, { currentLowestEligibleNumber }), true;
    }

    m = pathname.match(/^\/api\/vuln-contest\/campaigns\/([^/]+)\/reservations$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const ticketId = String(contest.nextTicketId++);
      const ticket = {
        id: ticketId,
        campaignId: m[1],
        ownerId: user.id,
        number: Number(body.ticketNumber), // client-supplied and honored verbatim: the bug
        status: "RESERVED",
      };
      contest.tickets[ticketId] = ticket; // no uniqueness check: concurrent callers can collide
      return sendJson(res, 201, ticket), true;
    }

    m = pathname.match(/^\/api\/vuln-contest\/tickets\/([^/]+)\/cancel$/);
    if (m && method === "POST") {
      const user = authenticate(req, state);
      if (!user) return sendJson(res, 401, { error: "UNAUTHENTICATED" }), true;
      const ticket = contest.tickets[m[1]];
      if (!ticket) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      if (!isOwnerOrAdmin(user, ticket.ownerId)) return sendJson(res, 403, { error: "FORBIDDEN" }), true;
      ticket.status = "CANCELLED"; // still counted by current-lowest-eligible-number above: the bug
      return sendJson(res, 200, ticket), true;
    }

    m = pathname.match(/^\/api\/vuln-contest\/campaigns\/([^/]+)\/ranking$/);
    if (m && method === "GET") {
      // No privilege check at all — a normal-privilege user can reach an
      // administrative report.
      const ranking = Object.values(contest.tickets)
        .filter((t) => t.campaignId === m[1])
        .sort((a, b) => a.number - b.number);
      return sendJson(res, 200, { ranking }), true;
    }

    if (pathname === "/api/vuln-contest/payments/webhook" && method === "POST") {
      // No signature/authentication check at all.
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const ticket = contest.tickets[body.ticketId];
      if (!ticket) return sendJson(res, 404, { error: "NOT_FOUND" }), true;
      ticket.status = "PAID";
      return sendJson(res, 200, ticket), true;
    }

    return false;
  };
}

module.exports = { createContestRouter, signatureFor };
