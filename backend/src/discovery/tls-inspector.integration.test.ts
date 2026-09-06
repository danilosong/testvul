import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { inspectTlsCertificate } from "./tls-inspector";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
});

describe("inspectTlsCertificate against the fixture app's self-signed HTTPS listener", () => {
  it("extracts hostname, issuer, expiration, and SANs without rejecting the untrusted certificate", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const dnsLookup = async () => ({ address: "127.0.0.1", family: 4 });

    const cert = await inspectTlsCertificate(scopeValidator, true, dnsLookup, "127.0.0.1", ports.httpsPort);

    expect(cert.hostname).toBe("localhost");
    expect(cert.issuer).toBe("localhost"); // self-signed: issuer === subject
    expect(cert.validFrom).toBeTruthy();
    expect(cert.validTo).toBeTruthy();
    expect(cert.subjectAltNames).toContain("localhost");
    expect(cert.subjectAltNames.some((san) => san.includes("127.0.0.1"))).toBe(true);
  });

  it("still enforces the mandatory scope gate for this connection", async () => {
    const scopeValidator = new ScopeValidator(["only-this-host.example"]);
    const dnsLookup = async () => ({ address: "127.0.0.1", family: 4 });

    await expect(inspectTlsCertificate(scopeValidator, true, dnsLookup, "127.0.0.1", ports.httpsPort)).rejects.toThrow();
  });

  it("still enforces the private-IP block when allowPrivateNetworks is off", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const dnsLookup = async () => ({ address: "127.0.0.1", family: 4 });

    await expect(inspectTlsCertificate(scopeValidator, false, dnsLookup, "127.0.0.1", ports.httpsPort)).rejects.toThrow();
  });
});
