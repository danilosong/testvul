"use strict";

function createState() {
  return {
    tokens: {
      "userA-token": { id: "userA", role: "user" },
      "userB-token": { id: "userB", role: "user" },
      "admin-token": { id: "admin", role: "admin" },
    },
    projects: {
      1: {
        id: "1",
        owner: "userA",
        name: "Project Alpha",
        notes: "Welcome to Alpha",
        description: "A safe project",
        summaryHtml: "<p>Allowed <b>bold</b> text</p>",
        commentHtml: "<p>Nice</p>",
        analyticsGtm: "GTM-REAL0001",
        protectedGtm: "GTM-REAL0002",
        strictFormatGtm: "GTM-REAL0003",
        price: 4999,
      },
      2: {
        id: "2",
        owner: "userB",
        name: "Project Beta",
        notes: "Beta notes",
        description: "Another project",
        summaryHtml: "<p>Beta summary</p>",
        commentHtml: "<p>Beta comment</p>",
        analyticsGtm: "GTM-REAL0004",
        protectedGtm: "GTM-REAL0005",
        strictFormatGtm: "GTM-REAL0006",
        price: 2999,
      },
    },
    etagResource: { id: "etag-1", value: "original-value" },
    plainResource: { id: "plain-1", value: "original-value" },
    credentials: {
      userA: { password: "userA-pass", token: "userA-token" },
      userB: { password: "userB-pass", token: "userB-token" },
      admin: { password: "admin-pass", token: "admin-token" },
    },
    profiles: {
      userA: { bio: "Hi, I'm User A" },
      userB: { bio: "Hi, I'm User B" },
      admin: { bio: "Administrator account" },
    },
    settings: {
      // Client-limit-only variant: the UI disables its own "increase" button
      // past QUANTITY_CLIENT_LIMIT, but nothing here enforces that limit.
      userA: { quantity: 1 },
      userB: { quantity: 1 },
      admin: { quantity: 1 },
    },
    settingsEnforced: {
      // Protected variant: PATCH validates the same limit server-side too.
      userA: { quantity: 1 },
      userB: { quantity: 1 },
      admin: { quantity: 1 },
    },
    swSaveCount: 0,
    contest: {
      campaigns: {
        1: { id: "1", name: "Fixture Contest", closed: false, winningNumber: null, nextTicketNumber: 1 },
        2: { id: "2", name: "Vulnerable Contest", closed: false, winningNumber: null, nextTicketNumber: 1 },
      },
      reservations: {},
      tickets: {},
      purchases: {},
      nextReservationId: 1,
      nextTicketId: 1,
      nextPurchaseId: 1,
      webhookSecret: "fixture-webhook-secret",
    },
    rewards: {
      // Section 13.13 (Replay and Idempotency Analysis) fixture: each
      // user's reward balance, plus the set of Idempotency-Keys the
      // protected claim endpoint has already completed.
      userA: { balance: 0, completedIdempotencyKeys: {} },
      userB: { balance: 0, completedIdempotencyKeys: {} },
      admin: { balance: 0, completedIdempotencyKeys: {} },
    },
  };
}

module.exports = { createState };
