import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";

describe("observações de compras", () => {
  it("salva e remove observações sem alterar os dados financeiros da transação", () => {
    const state = createDemoState();
    const original = state.transactions[0];
    expect(original).toBeDefined();
    if (!original) return;

    const withNote = reducer(state, {
      type: "setTransactionNote",
      txId: original.id,
      note: "  compra para manutenção do carro  ",
    });
    const saved = withNote.transactions.find((transaction) => transaction.id === original.id);

    expect(saved?.note).toBe("compra para manutenção do carro");
    expect(saved?.description).toBe(original.description);
    expect(saved?.amount).toBe(original.amount);
    expect(saved?.allocations).toEqual(original.allocations);

    const cleared = reducer(withNote, {
      type: "setTransactionNote",
      txId: original.id,
      note: "   ",
    });
    expect(
      cleared.transactions.find((transaction) => transaction.id === original.id)?.note,
    ).toBeUndefined();
  });

  it("preserva a observação quando a compra é reconhecida em uma nova importação", () => {
    const state = createDemoState();
    const transaction = state.transactions[0];
    if (!transaction) return;
    const invoice = state.invoices.find((item) => item.id === transaction.invoiceId);
    expect(invoice).toBeDefined();
    if (!invoice) return;

    const noted = reducer(state, {
      type: "setTransactionNote",
      txId: transaction.id,
      note: "compra para identificar",
    });
    const reimported = reducer(noted, {
      type: "importInvoice",
      invoice,
      transactions: [{ ...transaction, id: "reimported_transaction" }],
    });

    expect(reimported.transactions.find((item) => item.id === "reimported_transaction")?.note).toBe(
      "compra para identificar",
    );
  });
});
