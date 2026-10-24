import { describe, expect, it } from "vitest";
import { personDebtTotal, personMonthPaid, personMonthRemaining, personPaymentStatus, personMonthTotal } from "@/lib/finance/calc";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";

describe("pagamentos e competências", () => {
  it("registra pagamento parcial e reduz a obrigação mensal uma única vez", () => {
    const state = createDemoState();
    const due = personMonthTotal(state, "p_tiago", "2026-10");
    const paid = reducer(state, { type: "recordPersonPayment", payment: { id: "pay_1", personId: "p_tiago", amount: 80, paidAt: "2026-10-20", month: "2026-10" } });
    expect(personMonthPaid(paid, "p_tiago", "2026-10")).toBe(80);
    expect(personMonthRemaining(paid, "p_tiago", "2026-10")).toBe(Math.max(0, due - 80));
    expect(personPaymentStatus(paid, "p_tiago", "2026-10")).toBe("parcial");
    expect(personDebtTotal(paid, "p_tiago")).toBeGreaterThanOrEqual(0);
  });

  it("prepara apenas parcelas conhecidas e não duplica a competência", () => {
    const state = createDemoState();
    const current = state.invoices[0];
    const prepared = reducer(state, { type: "prepareNextInvoice", invoiceId: current.id });
    expect(prepared.invoices.some((invoice) => invoice.cardId === current.cardId && invoice.month === "2026-11")).toBe(true);
    const again = reducer(prepared, { type: "prepareNextInvoice", invoiceId: current.id });
    expect(again.invoices.filter((invoice) => invoice.cardId === current.cardId && invoice.month === "2026-11")).toHaveLength(1);
  });
});
