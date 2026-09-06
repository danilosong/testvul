/** True for a URL/path that references a conventional API surface:
 * `/api/`, `/api/v1/` (or any versioned variant), or `/graphql`. */
export function isApiReference(url: string): boolean {
  return /\/api\/(v\d+\/)?/i.test(url) || /\/graphql(?:$|[/?#])/i.test(url);
}
