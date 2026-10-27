import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { invoiceHasFinancialData } from "@/lib/finance/calc";

describe("visibilidade de faturas", () => {
  it("classifica como vazia a fatura sem total, lançamentos ou pagamentos", () => {
    const state = createDemoState();
    const invoice = state.invoices[0];
    const transaction = state.transactions[0];
    expect(invoice).toBeDefined();
    expect(transaction).toBeDefined();
    if (!invoice || !transaction) return;

    const emptyInvoice = {
      ...invoice,
      id: "invoice_empty_test",
      officialTotal: 0,
      payments: undefined,
    };
    const emptyState = { ...state, invoices: [...state.invoices, emptyInvoice] };

    expect(invoiceHasFinancialData(emptyState, emptyInvoice)).toBe(false);
    expect(
      invoiceHasFinancialData(
        {
          ...emptyState,
          transactions: [
            ...state.transactions,
            { ...transaction, id: "tx_for_empty_test", invoiceId: emptyInvoice.id },
          ],
        },
        emptyInvoice,
      ),
    ).toBe(true);
    expect(
      invoiceHasFinancialData(
        {
          ...emptyState,
          invoices: [...emptyState.invoices.slice(0, -1), { ...emptyInvoice, officialTotal: 1 }],
        },
        { ...emptyInvoice, officialTotal: 1 },
      ),
    ).toBe(true);
    expect(
      invoiceHasFinancialData(
        {
          ...emptyState,
          invoices: [
            ...emptyState.invoices.slice(0, -1),
            {
              ...emptyInvoice,
              payments: [{ personId: "p_test", amount: 1, paidAt: "2026-10-01" }],
            },
          ],
        },
        { ...emptyInvoice, payments: [{ personId: "p_test", amount: 1, paidAt: "2026-10-01" }] },
      ),
    ).toBe(true);
  });
});
