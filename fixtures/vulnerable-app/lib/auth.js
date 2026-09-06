"use strict";

function parseCookies(req) {
  const header = req.headers["cookie"];
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const idx = pair.indexOf("=");
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    }),
  );
}

function authenticate(req, state) {
  const header = req.headers["authorization"];
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (state.tokens[token]) return state.tokens[token];
  }
  const cookies = parseCookies(req);
  if (cookies.session && state.tokens[cookies.session]) return state.tokens[cookies.session];
  return null;
}

module.exports = { authenticate, parseCookies };
