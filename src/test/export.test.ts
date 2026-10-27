import { describe, expect, it } from "vitest";
import { serializeCSV } from "@/lib/finance/export";
import type { ExportTable } from "@/lib/finance/export";

describe("serializeCSV", () => {
  it("neutraliza fórmulas em texto sem alterar células numéricas", () => {
    const table: ExportTable = {
      title: "Relatório",
      headers: ["Descrição", "Valor"],
      rows: [
        ["=SUM(A1:A2)", -12.5],
        ["\t@cmd", 3.25],
        ['Compra, "casa"', 0],
      ],
    };

    expect(serializeCSV(table)).toBe(
      'Descrição;Valor\n\'=SUM(A1:A2);-12,50\n\t\'@cmd;3,25\n"Compra, ""casa""";0,00',
    );
  });

  it("protege prefixos após espaços e controles iniciais", () => {
    const table: ExportTable = {
      title: "Relatório",
      headers: ["texto"],
      rows: [["  +1+1"], ["\r=2+2"], ["-texto"], ["@link"]],
    };

    expect(serializeCSV(table)).toBe("texto\n  '+1+1\n\r'=2+2\n'-texto\n'@link");
  });
});
