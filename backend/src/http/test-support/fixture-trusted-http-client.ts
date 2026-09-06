import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, buildConnector, type Dispatcher } from "undici";
import { SecurityHttpClient } from "../security-http-client";

const FIXTURE_CA_CERT = readFileSync(
  join(__dirname, "..", "..", "..", "..", "fixtures", "vulnerable-app", "tls", "cert.pem"),
);

/**
 * TEST-ONLY. Trusts the local self-signed fixture certificate so
 * integration tests can exercise the HTTPS path without ever disabling
 * TLS validation in `SecurityHttpClient` itself. This class lives only
 * under `test-support/` (excluded from the production build — see
 * tsconfig.json) and is never imported by production code: the trust
 * decision is baked in at build/import time via subclassing, not toggled
 * by a runtime flag the base class would otherwise have to expose.
 */
export class FixtureTrustedSecurityHttpClient extends SecurityHttpClient {
  protected override createDispatcher(pinnedAddress: { address: string; family: number }): Dispatcher {
    const connector = buildConnector({
      ca: FIXTURE_CA_CERT,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
        else callback(null, pinnedAddress.address, pinnedAddress.family);
      },
    });
    return new Agent({ connect: connector });
  }
}
