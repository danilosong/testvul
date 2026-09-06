"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { createState } = require("./lib/state");
const { createMainRouter, createCrossOriginRouter } = require("./lib/router");
const { handleUpgrade } = require("./lib/websocket");

const BIND_HOST = "127.0.0.1"; // never 0.0.0.0 — this app is deliberately vulnerable

function createServers() {
  const state = createState();
  const ctx = { httpsPort: null, crossOriginPort: null };
  const mainRouter = createMainRouter(state, ctx);
  const crossOriginRouter = createCrossOriginRouter();

  const httpServer = http.createServer((req, res) => {
    mainRouter(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INTERNAL", message: err.message }));
    });
  });

  const tlsOptions = {
    key: fs.readFileSync(path.join(__dirname, "tls", "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "tls", "cert.pem")),
  };
  const httpsServer = https.createServer(tlsOptions, (req, res) => {
    mainRouter(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INTERNAL", message: err.message }));
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://localhost").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    handleUpgrade(req, socket, head, (send, onMessage) => {
      onMessage((raw) => {
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          message = null;
        }
        send(JSON.stringify({ action: message && message.action, status: "ok" }));
      });
    });
  });

  const crossOriginServer = http.createServer((req, res) => {
    crossOriginRouter(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INTERNAL", message: err.message }));
    });
  });

  function listen(server, port) {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, BIND_HOST, () => resolve(server.address().port));
    });
  }

  async function start({ httpPort = 0, httpsPort = 0, crossOriginPort = 0 } = {}) {
    const [resolvedHttpPort, resolvedHttpsPort, resolvedCrossOriginPort] = await Promise.all([
      listen(httpServer, httpPort),
      listen(httpsServer, httpsPort),
      listen(crossOriginServer, crossOriginPort),
    ]);
    ctx.httpsPort = resolvedHttpsPort;
    ctx.crossOriginPort = resolvedCrossOriginPort;
    return { httpPort: resolvedHttpPort, httpsPort: resolvedHttpsPort, crossOriginPort: resolvedCrossOriginPort };
  }

  function stop() {
    // closeAllConnections() forces any lingering connection closed —
    // notably a raw socket left open after a WebSocket upgrade — so a test
    // that forgets to tear one down can't hang server.close() forever.
    return Promise.all(
      [httpServer, httpsServer, crossOriginServer].map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
          }),
      ),
    );
  }

  return { httpServer, httpsServer, crossOriginServer, state, start, stop };
}

if (require.main === module) {
  const servers = createServers();
  servers
    .start({ httpPort: 4100, httpsPort: 4143, crossOriginPort: 4200 })
    .then((ports) => {
      console.log(`Vulnerable fixture app listening (HTTP ${BIND_HOST}:${ports.httpPort}, HTTPS ${BIND_HOST}:${ports.httpsPort}, cross-origin ${BIND_HOST}:${ports.crossOriginPort})`);
    })
    .catch((err) => {
      console.error("Failed to start fixture app:", err);
      process.exit(1);
    });
}

module.exports = { createServers };
