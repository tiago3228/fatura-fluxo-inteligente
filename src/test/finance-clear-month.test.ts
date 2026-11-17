import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { FinanceState, Invoice, PersonPayment, Transaction } from "@/lib/finance/types";

describe("limpeza de lançamentos por competência", () => {
  it("remove as faturas completas do mês e projeções derivadas, mas mantém pagamentos pessoais e lançamentos reais posteriores", () => {
    const base = createDemoState();
    const card = base.cards.find((item) => item.id === "c_7432");
    const otherCard = base.cards.find((item) => item.id !== card?.id);
    const october = base.invoices.find(
      (item) => item.cardId === card?.id && item.month === "2026-10",
    );
    const otherOctober = base.invoices.find(
      (item) => item.cardId === otherCard?.id && item.month === "2026-10",
    );
    if (!card || !otherCard || !october || !otherOctober)
      throw new Error("A fixture precisa de faturas de outubro em dois cartões");

    const selectedInvoice: Invoice = {
      ...october,
      officialTotal: 108.25,
      payments: [{ personId: "p_tiago", amount: 50, paidAt: "2026-10-23" }],
    };
    const novemberForecast: Invoice = {
      id: `${october.id}_next_2026-11`,
      cardId: card.id,
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: 100,
      status: "em_revisao",
      source: "planilha",
    };
    const decemberForecast: Invoice = {
      id: `${october.id}_next_2026-12`,
      cardId: card.id,
      month: "2026-12",
      dueDate: "2026-12-23",
      officialTotal: 100,
      status: "em_revisao",
      source: "planilha",
    };
    const novemberActualInvoice: Invoice = {
      id: "pdf_november_actual_other_card",
      cardId: otherCard.id,
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: 40,
      status: "em_revisao",
      source: "pdf",
    };
    const octoberPurchase: Transaction = {
      id: "tx_october_purchase",
      invoiceId: selectedInvoice.id,
      date: "2026-10-10",
      description: "Compra de outubro",
      amount: 100,
      type: "parcela",
      installmentNumber: 1,
      installmentTotal: 6,
      allocations: [{ personId: "p_tiago", amount: 100 }],
    };
    const otherCardOctoberPurchase: Transaction = {
      ...octoberPurchase,
      id: "tx_other_card_october_purchase",
      invoiceId: otherOctober.id,
      description: "Compra do outro cartão em outubro",
    };
    const octoberPayment: Transaction = {
      id: "tx_october_payment",
      invoiceId: selectedInvoice.id,
      date: "2026-10-23",
      description: "Pagamento da fatura",
      amount: -50,
      type: "pagamento",
      allocations: [],
    };
    const novemberProjection: Transaction = {
      ...octoberPurchase,
      id: "tx_november_projection",
      invoiceId: novemberForecast.id,
      date: "2026-11-10",
      description: "Compra de outubro 2/6",
      installmentNumber: 2,
      isProjected: true,
      projectionSourceId: octoberPurchase.id,
    };
    const decemberProjection: Transaction = {
      ...novemberProjection,
      id: "tx_december_projection",
      invoiceId: decemberForecast.id,
      date: "2026-12-10",
      description: "Compra de outubro 3/6",
      installmentNumber: 3,
    };
    const novemberActual: Transaction = {
      ...novemberProjection,
      id: "tx_november_actual",
      invoiceId: novemberActualInvoice.id,
      description: "Parcela real de novembro",
      isProjected: false,
    };
    const personalPayment: PersonPayment = {
      id: "person_payment_october",
      personId: "p_tiago",
      amount: 50,
      paidAt: "2026-10-23",
      month: "2026-10",
    };
    const initial: FinanceState = {
      ...base,
      invoices: [
        selectedInvoice,
        otherOctober,
        novemberForecast,
        decemberForecast,
        novemberActualInvoice,
      ],
      transactions: [
        octoberPurchase,
        otherCardOctoberPurchase,
        octoberPayment,
        novemberProjection,
        decemberProjection,
        novemberActual,
      ],
      plans: [],
      recurringCharges: [],
      payments: [personalPayment],
    };

    const cleared = reducer(initial, { type: "clearMonthTransactions", month: "2026-10" });
    const remainingIds = new Set(cleared.transactions.map((transaction) => transaction.id));

    expect(remainingIds.has(octoberPurchase.id)).toBe(false);
    expect(remainingIds.has(otherCardOctoberPurchase.id)).toBe(false);
    expect(remainingIds.has(octoberPayment.id)).toBe(false);
    expect(remainingIds.has(novemberProjection.id)).toBe(false);
    expect(remainingIds.has(decemberProjection.id)).toBe(false);
    expect(
      cleared.transactions.find((transaction) => transaction.id === novemberActual.id),
    ).toEqual(novemberActual);
    expect(cleared.invoices.some((invoice) => invoice.id === selectedInvoice.id)).toBe(false);
    expect(cleared.invoices.some((invoice) => invoice.id === otherOctober.id)).toBe(false);
    expect(cleared.invoices.some((invoice) => invoice.id === novemberActualInvoice.id)).toBe(true);
    expect(cleared.payments).toEqual([personalPayment]);
  });
});
