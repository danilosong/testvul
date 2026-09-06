const GTM_FIELD_NAMES = new Set(["gtm", "gtmid", "googletagmanager", "googletagmanagerid", "containerid"]);

function lastPathSegment(fieldPath: string): string {
  return (fieldPath.split(".").pop() ?? fieldPath).toLowerCase();
}

/** Detects a GTM configuration field by name — `gtm`, `gtmId`, `googleTagManager`, `googleTagManagerId`, or `containerId` (case-insensitive), matched on the field's last path segment. */
export function isGtmField(fieldPath: string): boolean {
  return GTM_FIELD_NAMES.has(lastPathSegment(fieldPath));
}
