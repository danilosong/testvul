/**
 * A detected technology is always informational — presence alone is never
 * a vulnerability, so this type deliberately carries no severity/finding
 * shape at all (contrast with `findings`' `Finding` type).
 */
export interface DetectedTechnology {
  name: string;
  source: "header" | "html" | "script-url";
}

export interface TechnologyDetectionInput {
  headers: Record<string, string | string[] | undefined>;
  html: string;
  scriptUrls?: string[];
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(" ") : (value ?? "");
}

function hasHeaderStartingWith(headers: Record<string, string | string[] | undefined>, prefix: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase().startsWith(prefix));
}

interface Signature {
  name: string;
  source: DetectedTechnology["source"];
  test: (input: TechnologyDetectionInput) => boolean;
}

const SIGNATURES: Signature[] = [
  { name: "nginx", source: "header", test: (i) => /nginx/i.test(headerValue(i.headers["server"])) },
  { name: "Apache", source: "header", test: (i) => /apache/i.test(headerValue(i.headers["server"])) },
  {
    name: "Cloudflare",
    source: "header",
    test: (i) => /cloudflare/i.test(headerValue(i.headers["server"])) || hasHeaderStartingWith(i.headers, "cf-ray"),
  },
  { name: "Express", source: "header", test: (i) => /express/i.test(headerValue(i.headers["x-powered-by"])) },
  {
    name: "NestJS",
    source: "header",
    test: (i) => /nestjs/i.test(headerValue(i.headers["x-powered-by"])) || /nestjs/i.test(i.html),
  },
  {
    name: "Vercel",
    source: "header",
    test: (i) => hasHeaderStartingWith(i.headers, "x-vercel-id") || /vercel/i.test(headerValue(i.headers["server"])),
  },
  { name: "AWS", source: "header", test: (i) => hasHeaderStartingWith(i.headers, "x-amz-") },
  {
    name: "Next.js",
    source: "html",
    test: (i) => /_next\/static/.test(i.html) || /__NEXT_DATA__/.test(i.html) || (i.scriptUrls ?? []).some((u) => u.includes("_next/static")),
  },
  {
    name: "React",
    source: "html",
    test: (i) => /data-reactroot/.test(i.html) || (i.scriptUrls ?? []).some((u) => /react/i.test(u)),
  },
  {
    name: "Vue",
    source: "html",
    test: (i) => /\sdata-v-[0-9a-f]+/.test(i.html) || (i.scriptUrls ?? []).some((u) => /vue/i.test(u)),
  },
  {
    name: "Angular",
    source: "html",
    test: (i) => /\sng-version\b/.test(i.html) || (i.scriptUrls ?? []).some((u) => /angular/i.test(u)),
  },
];

/**
 * Identifies frameworks/servers/infrastructure from response headers, HTML
 * content, and script URLs already collected by normal discovery requests
 * — no active probing. Every result is informational; this function has no
 * way to produce a finding.
 */
export function detectTechnologies(input: TechnologyDetectionInput): DetectedTechnology[] {
  return SIGNATURES.filter((signature) => signature.test(input)).map(({ name, source }) => ({ name, source }));
}
