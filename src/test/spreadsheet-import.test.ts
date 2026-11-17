import { describe, expect, it } from "vitest";
import type { CreditCard, Person } from "@/lib/finance/types";
import {
  detectSpreadsheetInvoiceMonth,
  guessSpreadsheetColumns,
  matchSpreadsheetPeople,
  resolveSpreadsheetCard,
  splitAmountAcrossPeople,
} from "@/lib/finance/spreadsheet-import";

const person = (id: string, name: string) => ({ id, name }) as Person;
const card = (id: string, last4: string) => ({ id, last4 }) as CreditCard;

describe("importação de planilha", () => {
  it("mapeia Data da compra como data e não confunde com a descrição", () => {
    expect(
      guessSpreadsheetColumns([
        "Cartão (final)",
        "Data da compra",
        "Estabelecimento / descrição",
        "Valor (R$)",
        "Pessoa sugerida",
        "Tipo",
        "Conferência",
      ]),
    ).toMatchObject({ date: 1, description: 2, amount: 3, person: 4, card: 0, category: null });
  });

  it("reconhece o cartão de cada linha e usa o cartão padrão quando o final está vazio", () => {
    const cards = [card("card-0548", "0548"), card("card-7432", "7432")];
    expect(resolveSpreadsheetCard("0548", cards, "card-7432").card?.id).toBe("card-0548");
    expect(resolveSpreadsheetCard("", cards, "card-7432").card?.id).toBe("card-7432");
    expect(resolveSpreadsheetCard("9999", cards, "card-7432").error).toContain("9999");
  });

  it("associa dois nomes separados por vírgula e divide o valor até o centavo", () => {
    const people = [person("arlete", "Arlete"), person("joao", "João Cardoso")];
    const result = matchSpreadsheetPeople("Arlete, João Cardoso", people);
    expect(result.matched.map((item) => item.id)).toEqual(["arlete", "joao"]);
    expect(result.unmatched).toEqual([]);
    expect(splitAmountAcrossPeople(103.27, result.matched.length)).toEqual([51.64, 51.63]);
    expect(splitAmountAcrossPeople(-0.01, 2)).toEqual([-0.01, 0]);
  });

  it("detecta a competência da fatura em outra aba da planilha", () => {
    expect(
      detectSpreadsheetInvoiceMonth([
        [["Cartão (final)", "Data da compra", "Valor (R$)"]],
        [["Fatura Itaú — novembro/2026"], ["Vencimento", "23/11/2026"]],
        [["Competência: novembro/2026. Vencimento: 23/11/2026."]],
      ]),
    ).toBe("2026-11");
  });

  it("não confunde datas das compras com a competência da fatura", () => {
    expect(
      detectSpreadsheetInvoiceMonth([
        [
          ["Data da compra", "Estabelecimento"],
          ["10/09/2026", "Loja"],
          ["16/11/2026", "Outra loja"],
        ],
      ]),
    ).toBeNull();
  });
});
