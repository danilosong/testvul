export interface ParsedCurlRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  cookies?: string;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/**
 * Parses a `curl` command line as plain text — tokenizing and reading
 * flags only. This function never shells out, execs, spawns, or evals
 * anything; a shell metacharacter in a header/body/URL value is just a
 * character in a string here, never interpreted.
 */
export function parseCurlCommand(command: string): ParsedCurlRequest {
  const tokens = tokenize(command);
  let method = "GET";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let cookies: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token === "curl") continue;

    if (token === "-X" || token === "--request") {
      method = (tokens[++i] ?? method).toUpperCase();
      continue;
    }
    if (token === "-H" || token === "--header") {
      const headerLine = tokens[++i] ?? "";
      const separatorIndex = headerLine.indexOf(":");
      if (separatorIndex > -1) {
        headers[headerLine.slice(0, separatorIndex).trim()] = headerLine.slice(separatorIndex + 1).trim();
      }
      continue;
    }
    if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
      body = tokens[++i] ?? "";
      if (method === "GET") method = "POST"; // matches curl's own default-method behavior when -d is present
      continue;
    }
    if (token === "-b" || token === "--cookie") {
      const cookieValue = tokens[++i] ?? "";
      cookies = cookies ? `${cookies}; ${cookieValue}` : cookieValue;
      headers["Cookie"] = cookies;
      continue;
    }
    if (token === "-u" || token === "--user") {
      const credential = tokens[++i] ?? "";
      headers["Authorization"] = `Basic ${Buffer.from(credential, "utf8").toString("base64")}`;
      continue;
    }
    if (token.startsWith("-")) continue; // an unrecognized flag — ignored, never executed

    if (!url && /^https?:\/\//i.test(token)) url = token;
  }

  const result: ParsedCurlRequest = { method, url, headers };
  if (body !== undefined) result.body = body;
  if (cookies !== undefined) result.cookies = cookies;
  return result;
}
