import type { SpreadsheetArchive } from "./types";

const PRIVATE_LEGACY_SPREADSHEET_ID = "sheet_outubro_2020";

export const isPrivateLegacySpreadsheet = (item: SpreadsheetArchive) =>
  item.id === PRIVATE_LEGACY_SPREADSHEET_ID && !item.dataUrl;

export const spreadsheetDownloadHref = (item: SpreadsheetArchive) =>
  item.dataUrl ?? (isPrivateLegacySpreadsheet(item) ? undefined : item.publicPath);
