import { describe, expect, it } from "vitest";
import { shareAccountRowDetails } from "@/lib/finance/share-image";
import type { Transaction } from "@/lib/finance/types";

const transaction: Transaction = {
  id: "tx_share_image",
  invoiceId: "invoice_share_image",
  date: "2026-11-16",
  description: "ABC ATACADO -CT RE",
  category: "Alimentação",
  amount: 267.02,
  type: "parcela",
  allocations: [],
  note: "Compra do mercado da semana",
};

describe("shareAccountRowDetails", () => {
  it("prepara data da compra, descrição, categoria e observação para o JPEG", () => {
    expect(
      shareAccountRowDetails({
        transaction,
        amount: 267.02,
        displayDate: "2026-09-07",
        dateKind: "purchase",
      }),
    ).toEqual({
      date: "07/09/2026",
      dateKind: "purchase",
      description: "ABC ATACADO -CT RE",
      note: "Compra do mercado da semana",
      category: "Alimentação",
    });
  });

  it("usa um rótulo claro quando a compra não tem categoria ou observação", () => {
    const { category, note, date } = shareAccountRowDetails({
      transaction: { ...transaction, category: undefined, note: "  " },
      amount: 1,
      displayDate: null,
      dateKind: "unknown",
    });

    expect(category).toBe("Sem categoria");
    expect(note).toBe("");
    expect(date).toBe("Não identificada");
  });
});
