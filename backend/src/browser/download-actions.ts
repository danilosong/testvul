import type { Db } from "../db/connection";
import type { DiscoveredButton } from "./browser-runtime-discovery";

export interface DiscoveredDownloadAction {
  id: number;
  pageUrl: string;
  selector: string;
  label: string;
}

/**
 * Download Actions Are Discovered, Never Executed (Section 12.17): every
 * anchor carrying a `download` attribute is classified DOWNLOAD_ACTION
 * and persisted at the table's default DISCOVERED status. This function
 * has no click/navigation capability at all — it only ever inserts a row
 * from data already read out of the DOM — so there is no code path here
 * that could ever trigger the download.
 */
export function discoverDownloadActions(
  db: Db,
  scanRunId: number,
  pageUrl: string,
  downloadLinks: readonly DiscoveredButton[],
): DiscoveredDownloadAction[] {
  return downloadLinks.map((link) => {
    const result = db
      .prepare("INSERT INTO browser_actions (scan_run_id, page_url, label, classification) VALUES (?, ?, ?, 'DOWNLOAD_ACTION')")
      .run(scanRunId, pageUrl, link.label || link.selector);
    return { id: Number(result.lastInsertRowid), pageUrl, selector: link.selector, label: link.label };
  });
}
