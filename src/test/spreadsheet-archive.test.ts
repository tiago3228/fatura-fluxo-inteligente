import { describe, expect, it } from "vitest";
import { isPrivateLegacySpreadsheet, spreadsheetDownloadHref } from "@/lib/finance/archive";
import type { SpreadsheetArchive } from "@/lib/finance/types";

const legacyArchive: SpreadsheetArchive = {
  id: "sheet_outubro_2020",
  fileName: "OUTUBRODE2020.xlsx",
  month: "2020-10",
  uploadedAt: "2026-10-23T21:00:00.000Z",
  publicPath: "/planilhas/OUTUBRODE2020.xlsx",
};

describe("download de planilhas arquivadas", () => {
  it("não expõe o caminho público legado depois de tornar o original privado", () => {
    expect(isPrivateLegacySpreadsheet(legacyArchive)).toBe(true);
    expect(spreadsheetDownloadHref(legacyArchive)).toBeUndefined();
  });

  it("permite baixar a cópia reenviada e sincronizada pelo workspace", () => {
    const reuploaded = {
      ...legacyArchive,
      dataUrl: "data:application/octet-stream;base64,ZmFrZQ==",
    };

    expect(isPrivateLegacySpreadsheet(reuploaded)).toBe(false);
    expect(spreadsheetDownloadHref(reuploaded)).toBe(reuploaded.dataUrl);
  });

  it("mantém downloads de outros arquivos públicos registrados", () => {
    const otherArchive = {
      ...legacyArchive,
      id: "sheet_other",
      publicPath: "/archives/other.xlsx",
    };

    expect(spreadsheetDownloadHref(otherArchive)).toBe("/archives/other.xlsx");
  });
});
