/**
 * Non-Proxy Browser Network Surface Reduction (design.md Decision 45).
 *
 * The Controlled Egress Proxy (Section 12.1) mediates ordinary HTTP/HTTPS
 * traffic because every browser context is launched with no other egress
 * (`browser-worker-proxy-config.ts`'s empty `bypass`). But a few Chromium
 * networking features either run over a transport a plain HTTP-CONNECT
 * proxy cannot mediate at all, or generate noise/telemetry connections
 * unrelated to the scan itself. Each is disabled individually, with the
 * reason it matters:
 *
 * - QUIC / HTTP3 (`--disable-quic`): QUIC runs over UDP. A CONNECT-based
 *   HTTP proxy has no way to relay it, so if Chromium ever attempted a
 *   direct QUIC connection it would bypass the proxy's validation
 *   entirely — this is a real proxy-bypass vector, not just noise.
 * - WebRTC / STUN (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`):
 *   WebRTC's ICE candidate gathering uses UDP/STUN and, by default, does
 *   not respect the browser's configured HTTP proxy at all — a page could
 *   use it to reach an arbitrary host/port directly. This policy value is
 *   Chromium's own documented way to force ICE gathering to either use
 *   the proxy or produce no non-proxied UDP candidates at all.
 * - Background/telemetry networking (`--disable-background-networking`,
 *   `--disable-sync`, `--disable-client-side-phishing-detection`,
 *   `--disable-component-update`, `--disable-domain-reliability`,
 *   `--metrics-recording-only`, `--disable-breakpad`): Chromium makes
 *   several outbound connections on its own (update checks, safe-browsing
 *   list fetches, sync, crash/metrics reporting) unrelated to any page the
 *   engine navigates to — each is its own potential validated-or-not
 *   connection attempt through the proxy that has nothing to do with the
 *   scan.
 * - DNS prefetching (`--dns-prefetch-disable`): a page can hint at
 *   hostnames to resolve ahead of navigation; disabled so no such hint
 *   ever produces a proxy request for a host the scan never actually
 *   decided to visit.
 * - Speculative connections/preconnect (`--disable-features=` including
 *   `PreconnectToSearch`, `NetworkPrediction`, `NetworkPredictionOnBar`):
 *   the same concern as DNS prefetching, one step further — Chromium can
 *   open a full connection speculatively based on `<link rel=preconnect>`
 *   or navigation heuristics, again for hosts the scan never chose to visit.
 * - No browser extensions (`--disable-extensions`): the automated context
 *   never loads any extension, so there is no extension background
 *   script/service worker with its own independent network access at all.
 */
export function buildHardenedLaunchArgs(): string[] {
  return [
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--metrics-recording-only",
    "--disable-breakpad",
    "--dns-prefetch-disable",
    "--disable-features=PreconnectToSearch,NetworkPrediction,NetworkPredictionOnBar",
    "--disable-extensions",
    "--no-pings", // disables <a ping> click-tracking requests
  ];
}

export const QUIC_DISABLE_FLAG = "--disable-quic";
export const WEBRTC_POLICY_FLAG = "--force-webrtc-ip-handling-policy=disable_non_proxied_udp";
export const BACKGROUND_NETWORKING_FLAGS = [
  "--disable-background-networking",
  "--disable-sync",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--metrics-recording-only",
  "--disable-breakpad",
];
export const DNS_PREFETCH_DISABLE_FLAG = "--dns-prefetch-disable";
export const SPECULATIVE_CONNECTIONS_DISABLE_FLAG = "--disable-features=PreconnectToSearch,NetworkPrediction,NetworkPredictionOnBar";
export const NO_EXTENSIONS_FLAG = "--disable-extensions";

/**
 * Service Workers disabled by default for every Browser Security Testing
 * Engine context (design.md, Section 12.5). A page's own Service Worker
 * can independently intercept and re-issue a mutating request outside the
 * page's own request lifecycle — a channel Playwright's page-level
 * request interception does not reliably see at all, and one this
 * engine's own mutation-safety guarantees (backup/restore, evidence,
 * resource locking) never authorized. Blocking Service Worker
 * registration entirely, rather than trying to observe/intercept what it
 * does, is what actually prevents that independent channel from ever
 * reaching the backend.
 */
export function buildHardenedContextOptions(): { serviceWorkers: "block" } {
  return { serviceWorkers: "block" };
}
