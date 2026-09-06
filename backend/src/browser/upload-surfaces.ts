import type { Db } from "../db/connection";
import type { DiscoveredButton } from "./browser-runtime-discovery";

export interface DiscoveredUploadSurface {
  id: number;
  pageUrl: string;
  selector: string;
  label: string;
}

/**
 * Upload Surfaces Are Discovered, Never Executed (Section 12.18): every
 * `input[type=file]` element is classified UPLOAD_SURFACE and persisted
 * at the table's default DISCOVERED status. This function never supplies
 * a file or submits the surrounding form — it has no file-input-setting
 * or form-submission capability at all, only inserting a row from data
 * already read out of the DOM.
 */
export function discoverUploadSurfaces(
  db: Db,
  scanRunId: number,
  pageUrl: string,
  uploadSurfaces: readonly DiscoveredButton[],
): DiscoveredUploadSurface[] {
  return uploadSurfaces.map((surface) => {
    const result = db
      .prepare("INSERT INTO browser_actions (scan_run_id, page_url, label, classification) VALUES (?, ?, ?, 'UPLOAD_SURFACE')")
      .run(scanRunId, pageUrl, surface.label);
    return { id: Number(result.lastInsertRowid), pageUrl, selector: surface.selector, label: surface.label };
  });
}
