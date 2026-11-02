import { describe, expect, it } from "vitest";
import { createDemoState, createEmptyFinanceState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { InvoiceImportBatch, Transaction } from "@/lib/finance/types";

const hasContent = (state: ReturnType<typeof createEmptyFinanceState>) =>
  state.people.length + state.cards.length + state.invoices.length + state.transactions.length;

describe("privacidade inicial e auditoria de importação PDF", () => {
  it("não semeia dados do fixture ao hidratar ou limpar uma conta nova", () => {
    const empty = createEmptyFinanceState();
    const hydrated = reducer(empty, { type: "hydrate", state: empty });
    const reset = reducer(createDemoState(), { type: "reset" });

    expect(hasContent(hydrated)).toBe(0);
    expect(hasContent(reset)).toBe(0);
    expect(hydrated.spreadsheets).toEqual([]);
  });

  it("preserva transações já importadas e registra a nova linha/responsável em importação parcial", () => {
    const original = createDemoState();
    const card = original.cards[0]!;
    const existingInvoice = original.invoices.find(
      (invoice) => invoice.cardId === card.id && invoice.month === "2026-10",
    )!;
    const previousTransactions = original.transactions.filter(
      (transaction) => transaction.invoiceId === existingInvoice.id,
    );
    const newTransaction: Transaction = {
      id: "tx_pdf_manual_override",
      invoiceId: "new_invoice_id",
      date: "2026-10-31",
      description: "COMPRA NOVA DE TESTE",
      amount: 25,
      type: "compra",
      allocations: [],
    };
    const batch: InvoiceImportBatch = {
      id: "batch_test",
      fileName: "fatura-teste.pdf",
      importedAt: "2026-11-01T00:00:00.000Z",
      statementTotal: 25,
      includedCount: 1,
      ignoredCount: 1,
      rows: [
        {
          sourceRowId: "row-included",
          date: newTransaction.date,
          description: newTransaction.description,
          amount: newTransaction.amount,
          cardLast4: card.last4,
          cardId: card.id,
          included: true,
          comparisonStatus: "new_purchase",
          transactionId: newTransaction.id,
          personIds: ["p_atena"],
        },
        {
          sourceRowId: "row-ignored",
          date: newTransaction.date,
          description: "LINHA IGNORADA",
          amount: 10,
          cardId: card.id,
          included: false,
          comparisonStatus: "possible_duplicate",
          reason: "Ignorada na revisão",
          personIds: [],
        },
      ],
    };

    const result = reducer(original, {
      type: "importInvoice",
      invoice: {
        ...existingInvoice,
        id: "new_invoice_id",
        officialTotal: 25,
        importHistory: [batch],
      },
      transactions: [newTransaction],
      personOverrides: {
        [newTransaction.id]: [{ personId: "p_atena", amount: 25 }],
      },
    });

    const invoice = result.invoices.find((item) => item.id === existingInvoice.id)!;
    const imported = result.transactions.find((item) => item.id === newTransaction.id)!;
    expect(result.transactions.filter((item) => item.invoiceId === existingInvoice.id)).toHaveLength(
      previousTransactions.length + 1,
    );
    expect(imported.allocations).toEqual([{ personId: "p_atena", amount: 25 }]);
    expect(invoice.importHistory?.at(-1)).toEqual(batch);
    expect(invoice.status).toBe(existingInvoice.status);
  });
});
