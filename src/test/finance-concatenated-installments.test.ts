import { describe, expect, it } from "vitest";
import {
  installmentReferenceFromDescription,
  replaceInstallmentReference,
  stripAllInstallmentReferences,
} from "@/lib/finance/calc";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { FinanceState, Transaction } from "@/lib/finance/types";

const personId = "p_tiago";

describe("referências de parcela concatenadas ao código da compra", () => {
  it.each([
    ["ClubeWPrePago 611304/12", 4, 12],
    ["ClubeWPrePago 621502/09", 2, 9],
  ])("extrai a parcela de %s", (description, number, total) => {
    expect(installmentReferenceFromDescription(description)).toEqual({ number, total });
  });

  it("substitui só o sufixo da parcela e remove referências duplicadas antigas", () => {
    expect(replaceInstallmentReference("ClubeWPrePago 611304/12", { number: 5, total: 12 })).toBe(
      "ClubeWPrePago 611305/12",
    );
    expect(stripAllInstallmentReferences("ClubeWPrePago 611303/12 4/12")).toBe(
      "ClubeWPrePago 61130",
    );
  });

  it.each([
    {
      sourceDescription: "ClubeWPrePago 611303/12",
      incomingDescription: "ClubeWPrePago 611304/12",
      nextDescription: "ClubeWPrePago 611305/12",
      previousNumber: 3,
      installmentNumber: 4,
      total: 12,
      amount: 74.25,
    },
    {
      sourceDescription: "ClubeWPrePago 621501/09",
      incomingDescription: "ClubeWPrePago 621502/09",
      nextDescription: "ClubeWPrePago 621503/09",
      previousNumber: 1,
      installmentNumber: 2,
      total: 9,
      amount: 32.49,
    },
  ])("reconcilia $incomingDescription sem duplicar a projeção", (fixture) => {
    const base = createDemoState();
    const card = base.cards.find((item) => item.id === "c_7432");
    const october = base.invoices.find(
      (item) => item.cardId === "c_7432" && item.month === "2026-10",
    );
    if (!card || !october) throw new Error("A fixture precisa do cartão e da fatura de outubro");

    const source: Transaction = {
      id: "tx_clubew_source",
      invoiceId: october.id,
      date: "2026-10-06",
      description: fixture.sourceDescription,
      category: "Alimentação",
      amount: fixture.amount,
      type: "parcela",
      installmentNumber: fixture.previousNumber,
      installmentTotal: fixture.total,
      note: "Vinhos",
      allocations: [{ personId, amount: fixture.amount }],
    };
    const novemberInvoice = {
      id: "sheet_november_clubew",
      cardId: card.id,
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: fixture.amount,
      status: "em_revisao" as const,
      source: "planilha" as const,
    };
    const legacyProjection: Transaction = {
      id: "tx_clubew_november_projection",
      invoiceId: novemberInvoice.id,
      date: "2026-11-06",
      description: `${fixture.sourceDescription} ${fixture.installmentNumber}/${fixture.total}`,
      category: "Alimentação",
      amount: fixture.amount,
      type: "parcela",
      installmentNumber: fixture.installmentNumber,
      installmentTotal: fixture.total,
      note: "Vinhos",
      projectionSourceId: source.id,
      isProjected: true,
      allocations: [{ personId, amount: fixture.amount }],
    };
    const initial: FinanceState = {
      ...base,
      invoices: [october, novemberInvoice],
      transactions: [source, legacyProjection],
      plans: [],
      recurringCharges: [],
      payments: [],
    };
    const imported = reducer(initial, {
      type: "importInvoice",
      invoice: novemberInvoice,
      transactions: [
        {
          id: "tx_clubew_november_imported",
          invoiceId: novemberInvoice.id,
          date: "2026-11-06",
          description: fixture.incomingDescription,
          amount: fixture.amount,
          type: "parcela",
          installmentNumber: fixture.installmentNumber,
          installmentTotal: fixture.total,
          allocations: [],
        },
      ],
    });

    const novemberRows = imported.transactions.filter(
      (transaction) => transaction.invoiceId === novemberInvoice.id && transaction.amount > 0,
    );
    expect(novemberRows).toHaveLength(1);
    expect(novemberRows[0]).toMatchObject({
      id: "tx_clubew_november_imported",
      type: "parcela",
      installmentNumber: fixture.installmentNumber,
      installmentTotal: fixture.total,
      category: "Alimentação",
      note: "Vinhos",
      allocations: [{ personId, amount: fixture.amount }],
    });

    const decemberInvoice = imported.invoices.find(
      (item) => item.cardId === card.id && item.month === "2026-12",
    );
    expect(
      imported.transactions.find((item) => item.invoiceId === decemberInvoice?.id),
    ).toMatchObject({
      description: fixture.nextDescription,
      installmentNumber: fixture.installmentNumber + 1,
      installmentTotal: fixture.total,
    });
  });

  it.each([
    {
      description: "ClubeWPrePago 611304/12",
      nextDescription: "ClubeWPrePago 611305/12",
      installmentNumber: 4,
      total: 12,
      amount: 74.25,
    },
    {
      description: "ClubeWPrePago 621502/09",
      nextDescription: "ClubeWPrePago 621503/09",
      installmentNumber: 2,
      total: 9,
      amount: 32.49,
    },
  ])("projeta dezembro a partir de novembro sem depender do histórico de outubro", (fixture) => {
    const base = createDemoState();
    const card = base.cards.find((item) => item.id === "c_7432");
    if (!card) throw new Error("A fixture precisa do cartão 7432");
    const novemberInvoice = {
      id: "sheet_november_clean_baseline",
      cardId: card.id,
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: fixture.amount,
      status: "em_revisao" as const,
      source: "planilha" as const,
    };
    const initial: FinanceState = {
      ...base,
      invoices: [],
      transactions: [],
      plans: [],
      recurringCharges: [],
      payments: [],
    };
    const imported = reducer(initial, {
      type: "importInvoice",
      invoice: novemberInvoice,
      transactions: [
        {
          id: "tx_november_clean_baseline",
          invoiceId: novemberInvoice.id,
          date: "2026-11-06",
          description: fixture.description,
          amount: fixture.amount,
          type: "parcela",
          installmentNumber: fixture.installmentNumber,
          installmentTotal: fixture.total,
          allocations: [{ personId, amount: fixture.amount }],
        },
      ],
    });
    const decemberInvoice = imported.invoices.find(
      (item) => item.cardId === card.id && item.month === "2026-12",
    );
    expect(
      imported.transactions.find((item) => item.invoiceId === decemberInvoice?.id),
    ).toMatchObject({
      description: fixture.nextDescription,
      installmentNumber: fixture.installmentNumber + 1,
      installmentTotal: fixture.total,
      allocations: [{ personId, amount: fixture.amount }],
    });
  });
});
