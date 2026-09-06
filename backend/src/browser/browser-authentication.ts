import type { BrowserContext, Cookie } from "playwright";
import type { Db } from "../db/connection";
import { storeBrowserSession, readBrowserSession } from "./session-manager";

export interface LoginSelectors {
  username: string;
  password: string;
  submit: string;
}

export interface EstablishSessionParams {
  db: Db;
  context: BrowserContext;
  authProfileId: number;
  loginUrl: string;
  selectors: LoginSelectors;
  username: string;
  password: string;
  /** A URL pattern (Playwright's `waitForURL` glob) confirming a successful login redirect. */
  successUrlPattern: string;
  ttlMs?: number;
}

export interface EstablishSessionResult {
  reused: boolean;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Browser Authentication (design.md, Section 8.1 selectors + Section
 * 12.12's encrypted Browser Sessions): reuses an existing, still-valid
 * encrypted session for the profile when one exists — never re-running
 * the login flow needlessly — or otherwise automates the login form using
 * the profile's configured selectors, filling only the username/password
 * fields and clicking submit. Neither value is ever logged or
 * screenshotted by this function; the only thing persisted afterward is
 * the resulting cookie jar, encrypted (Section 12.12), never the
 * password itself.
 */
export async function establishBrowserSession(params: EstablishSessionParams): Promise<EstablishSessionResult> {
  const existing = readBrowserSession(params.db, params.authProfileId);
  if (existing) {
    const cookies = JSON.parse(existing.sessionData) as Cookie[];
    await params.context.addCookies(cookies);
    return { reused: true };
  }

  const page = await params.context.newPage();
  await page.goto(params.loginUrl);
  await page.fill(params.selectors.username, params.username);
  await page.fill(params.selectors.password, params.password);
  await page.click(params.selectors.submit);
  await page.waitForURL(params.successUrlPattern);
  await page.close();

  const cookies = await params.context.cookies();
  storeBrowserSession(params.db, {
    authProfileId: params.authProfileId,
    sessionData: JSON.stringify(cookies),
    ttlMs: params.ttlMs ?? DEFAULT_TTL_MS,
  });

  return { reused: false };
}
