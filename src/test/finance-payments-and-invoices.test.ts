import { describe, expect, it } from "vitest";
import {
  committedMonthTotal,
  forecast,
  personDebtTotal,
  personMonthPaid,
  personMonthRemaining,
  personPaymentStatus,
  personMonthTotal,
  totalFutureCommitted,
} from "@/lib/finance/calc";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { FinanceState, InstallmentPlan, Transaction } from "@/lib/finance/types";

const personId = "p_tiago";

function stateWithSinglePurchase(amount = 120): FinanceState {
  const base = createDemoState();
  const invoice = base.invoices.find(
    (item) => item.cardId === "c_7432" && item.month === "2026-10",
  );
  if (!invoice) throw new Error("A fixture precisa de uma fatura de outubro de 2026");
  const purchase: Transaction = {
    id: "tx_test_due",
    invoiceId: invoice.id,
    date: "2026-10-10",
    description: "Compra de teste",
    amount,
    type: "compra",
    allocations: [{ personId, amount }],
  };
  return {
    ...base,
    invoices: [invoice],
    transactions: [purchase],
    plans: [],
    recurringCharges: [],
    payments: [],
  };
}

function stateWithTwelveInstallments(): {
  state: FinanceState;
  currentInvoiceId: string;
  plan: InstallmentPlan;
  historical: Transaction;
} {
  const base = createDemoState();
  const card = base.cards.find((item) => item.id === "c_7432");
  const currentInvoice = base.invoices.find(
    (item) => item.cardId === "c_7432" && item.month === "2026-10",
  );
  if (!card || !currentInvoice) throw new Error("A fixture precisa do cartão e fatura de outubro");
  const plan: InstallmentPlan = {
    id: "plan_twelve",
    description: "Produto parcelado",
    cardId: card.id,
    purchaseDate: "2026-01-10",
    total: 120,
    amounts: Array.from({ length: 12 }, () => 10),
    firstMonth: "2026-01",
    shares: [{ personId, pct: 100 }],
  };
  const historical: Transaction = {
    id: "tx_10_of_12",
    invoiceId: currentInvoice.id,
    date: "2026-10-16",
    description: "Produto parcelado 10/12",
    amount: 10,
    type: "parcela",
    planId: plan.id,
    installmentNumber: 10,
    installmentTotal: 12,
    allocations: [{ personId, amount: 10 }],
  };
  const cashPurchase: Transaction = {
    id: "tx_cash_purchase",
    invoiceId: currentInvoice.id,
    date: "2026-10-12",
    description: "Compra à vista",
    amount: 5,
    type: "compra",
    allocations: [{ personId, amount: 5 }],
  };
  return {
    currentInvoiceId: currentInvoice.id,
    plan,
    historical,
    state: {
      ...base,
      invoices: [currentInvoice],
      transactions: [historical, cashPurchase],
      plans: [plan],
      recurringCharges: [],
      payments: [],
    },
  };
}

describe("pagamentos e competências", () => {
  it("calcula pagamentos parciais e integrais sem reaplicar o mesmo pagamento", () => {
    let state = stateWithSinglePurchase();
    expect(personMonthTotal(state, personId, "2026-10")).toBe(120);

    state = reducer(state, {
      type: "recordPersonPayment",
      payment: { id: "payment_1", personId, amount: 40, paidAt: "2026-10-20", month: "2026-10" },
    });
    const secondPayment = {
      id: "payment_2",
      personId,
      amount: 20,
      paidAt: "2026-10-21",
      month: "2026-10",
    };
    state = reducer(state, { type: "recordPersonPayment", payment: secondPayment });
    state = reducer(state, { type: "recordPersonPayment", payment: secondPayment });

    expect(personMonthPaid(state, personId, "2026-10")).toBe(60);
    expect(personMonthRemaining(state, personId, "2026-10")).toBe(60);
    expect(personDebtTotal(state, personId)).toBe(60);
    expect(personPaymentStatus(state, personId, "2026-10")).toBe("parcial");

    state = reducer(state, {
      type: "recordPersonPayment",
      payment: { id: "payment_3", personId, amount: 60, paidAt: "2026-10-22", month: "2026-10" },
    });
    expect(personMonthPaid(state, personId, "2026-10")).toBe(120);
    expect(personMonthRemaining(state, personId, "2026-10")).toBe(0);
    expect(personDebtTotal(state, personId)).toBe(0);
    expect(personPaymentStatus(state, personId, "2026-10")).toBe("pago");
  });

  it("não confunde o pagamento da fatura do cartão com recebimento da pessoa", () => {
    const state = stateWithSinglePurchase();
    const invoiceId = state.invoices[0]!.id;
    const cardPaid = reducer(state, { type: "markInvoicePaid", invoiceId, paidAt: "2026-10-23" });

    expect(cardPaid.invoices[0]?.status).toBe("paga");
    expect(personMonthPaid(cardPaid, personId, "2026-10")).toBe(0);
    expect(personMonthRemaining(cardPaid, personId, "2026-10")).toBe(120);
    expect(personDebtTotal(cardPaid, personId)).toBe(120);

    const personPaid = reducer(cardPaid, {
      type: "recordPersonPayment",
      payment: {
        id: "person_payment",
        personId,
        amount: 120,
        paidAt: "2026-10-24",
        month: "2026-10",
      },
    });
    expect(personMonthPaid(personPaid, personId, "2026-10")).toBe(120);
    expect(personDebtTotal(personPaid, personId)).toBe(0);
    expect(personPaid.invoices[0]?.status).toBe("paga");
  });

  it("avança 10/12 para 11/12 e 12/12, sem copiar compra à vista nem alterar o histórico", () => {
    const { state: initial, currentInvoiceId, historical } = stateWithTwelveInstallments();
    const november = reducer(initial, { type: "prepareNextInvoice", invoiceId: currentInvoiceId });
    const novemberInvoice = november.invoices.find((invoice) => invoice.month === "2026-11");
    expect(novemberInvoice).toBeDefined();
    if (!novemberInvoice) throw new Error("A previsão de novembro não foi criada");
    const novemberTransactions = november.transactions.filter(
      (transaction) => transaction.invoiceId === novemberInvoice.id,
    );
    expect(novemberTransactions).toHaveLength(1);
    expect(novemberTransactions[0]?.installmentNumber).toBe(11);
    expect(novemberTransactions[0]?.description).toContain("11/12");
    expect(novemberTransactions.some((transaction) => transaction.id === "tx_cash_purchase")).toBe(
      false,
    );

    const december = reducer(november, {
      type: "prepareNextInvoice",
      invoiceId: novemberInvoice.id,
    });
    const decemberInvoice = december.invoices.find((invoice) => invoice.month === "2026-12");
    expect(decemberInvoice).toBeDefined();
    if (!decemberInvoice) throw new Error("A previsão de dezembro não foi criada");
    const decemberTransactions = december.transactions.filter(
      (transaction) => transaction.invoiceId === decemberInvoice.id,
    );
    expect(decemberTransactions).toHaveLength(1);
    expect(decemberTransactions[0]?.installmentNumber).toBe(12);
    expect(decemberTransactions[0]?.description).toContain("12/12");
    expect(december.transactions.find((transaction) => transaction.id === historical.id)).toEqual(
      historical,
    );

    const finalized = reducer(december, {
      type: "importInvoice",
      invoice: { ...decemberInvoice, source: "pdf" },
      transactions: decemberTransactions,
    });
    expect(finalized.transactions.find((transaction) => transaction.id === historical.id)).toEqual(
      historical,
    );
    expect(finalized.plans).toHaveLength(1);

    const january = reducer(finalized, {
      type: "prepareNextInvoice",
      invoiceId: decemberInvoice.id,
    });
    const januaryInvoice = january.invoices.find((invoice) => invoice.month === "2027-01");
    expect(januaryInvoice).toBeDefined();
    expect(
      january.transactions.filter((transaction) => transaction.invoiceId === januaryInvoice?.id),
    ).toHaveLength(0);
  });

  it("projeta referências n/total da descrição, mesmo sem campos estruturados", () => {
    const base = createDemoState();
    const currentInvoice = base.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-10",
    );
    if (!currentInvoice) throw new Error("A fixture precisa da fatura de outubro");
    const transaction = (id: string, description: string, amount: number): Transaction => ({
      id,
      invoiceId: currentInvoice.id,
      date: "2026-10-20",
      description,
      amount,
      type: "compra",
      allocations: [{ personId, amount }],
    });
    const initial: FinanceState = {
      ...base,
      invoices: [{ ...currentInvoice, status: "paga" }],
      transactions: [
        transaction("tx_barbearia", "BARBEARIA JO-CT 10/12", 986.14),
        transaction("tx_final", "CENTRO ODONTOLOGIC12/12", 208.37),
        transaction("tx_spotify", "DM*Spotify P4726", 12.9),
      ],
      plans: [],
      recurringCharges: [],
      payments: [],
    };

    const november = reducer(initial, {
      type: "markInvoicePaid",
      invoiceId: currentInvoice.id,
      paidAt: "2026-10-23",
    });
    const novemberInvoice = november.invoices.find((invoice) => invoice.month === "2026-11");
    expect(novemberInvoice).toBeDefined();
    const novemberTransactions = november.transactions.filter(
      (transaction) => transaction.invoiceId === novemberInvoice?.id,
    );
    expect(novemberTransactions.map((transaction) => transaction.description)).toEqual([
      "BARBEARIA JO-CT 11/12",
    ]);
    expect(novemberTransactions[0]).toMatchObject({
      installmentNumber: 11,
      installmentTotal: 12,
      amount: 986.14,
      allocations: [{ personId, amount: 986.14 }],
    });
    expect(committedMonthTotal(november, "2026-11")).toBe(986.14);
    expect(forecast(november, "2026-10", 1)[0]?.value).toBe(986.14);
    expect(totalFutureCommitted(november, "2026-10")).toBe(986.14);

    const december = reducer(november, {
      type: "prepareNextInvoice",
      invoiceId: novemberInvoice!.id,
    });
    const decemberInvoice = december.invoices.find((invoice) => invoice.month === "2026-12");
    expect(
      december.transactions.filter((transaction) => transaction.invoiceId === decemberInvoice?.id),
    ).toHaveLength(1);
    expect(
      december.transactions.find((transaction) => transaction.invoiceId === decemberInvoice?.id),
    ).toMatchObject({
      description: "BARBEARIA JO-CT 12/12",
      installmentNumber: 12,
    });
    expect(
      december.transactions
        .filter((transaction) => transaction.invoiceId === decemberInvoice?.id)
        .some((transaction) => transaction.description.includes("Spotify")),
    ).toBe(false);

    const january = reducer(december, {
      type: "prepareNextInvoice",
      invoiceId: decemberInvoice!.id,
    });
    const januaryInvoice = january.invoices.find((invoice) => invoice.month === "2027-01");
    expect(januaryInvoice).toBeDefined();
    expect(
      january.transactions.filter((transaction) => transaction.invoiceId === januaryInvoice?.id),
    ).toHaveLength(0);
  });

  it("soma o valor total devido por competência e não reaplica pagamentos em meses futuros", () => {
    const { state: initial, currentInvoiceId } = stateWithTwelveInstallments();
    const november = reducer(initial, { type: "prepareNextInvoice", invoiceId: currentInvoiceId });
    const novemberInvoice = november.invoices.find((invoice) => invoice.month === "2026-11");
    if (!novemberInvoice) throw new Error("A previsão de novembro não foi criada");
    const december = reducer(november, {
      type: "prepareNextInvoice",
      invoiceId: novemberInvoice.id,
    });

    expect(personDebtTotal(december, personId)).toBe(35);
    const afterOctober = reducer(december, {
      type: "recordPersonPayment",
      payment: {
        id: "payment_october",
        personId,
        amount: 15,
        paidAt: "2026-10-25",
        month: "2026-10",
      },
    });
    expect(personDebtTotal(afterOctober, personId)).toBe(20);
    const afterNovember = reducer(afterOctober, {
      type: "recordPersonPayment",
      payment: {
        id: "payment_november",
        personId,
        amount: 10,
        paidAt: "2026-11-25",
        month: "2026-11",
      },
    });
    expect(personDebtTotal(afterNovember, personId)).toBe(10);
    const fullyPaid = reducer(afterNovember, {
      type: "recordPersonPayment",
      payment: {
        id: "payment_december",
        personId,
        amount: 10,
        paidAt: "2026-12-25",
        month: "2026-12",
      },
    });
    expect(personDebtTotal(fullyPaid, personId)).toBe(0);
  });

  it("não duplica a fatura preparada quando a importação real chega para a mesma competência", () => {
    const { state: initial, currentInvoiceId } = stateWithTwelveInstallments();
    const prepared = reducer(initial, { type: "prepareNextInvoice", invoiceId: currentInvoiceId });
    const provisional = prepared.invoices.find((invoice) => invoice.month === "2026-11");
    if (!provisional) throw new Error("A previsão de novembro não foi criada");
    const predicted = prepared.transactions.find(
      (transaction) => transaction.invoiceId === provisional.id,
    );
    if (!predicted) throw new Error("A parcela prevista não foi criada");

    const imported = reducer(prepared, {
      type: "importInvoice",
      invoice: {
        ...provisional,
        id: "pdf_november",
        officialTotal: 10,
        source: "pdf",
        status: "em_revisao",
      },
      transactions: [
        {
          ...predicted,
          id: "actual_november_installment",
          invoiceId: "pdf_november",
          allocations: [],
        },
      ],
    });

    const novemberInvoices = imported.invoices.filter(
      (invoice) => invoice.cardId === provisional.cardId && invoice.month === "2026-11",
    );
    expect(novemberInvoices).toHaveLength(1);
    expect(novemberInvoices[0]?.id).toBe(provisional.id);
    const novemberTransactions = imported.transactions.filter(
      (transaction) => transaction.invoiceId === provisional.id,
    );
    expect(novemberTransactions).toHaveLength(1);
    expect(novemberTransactions[0]?.id).toBe("actual_november_installment");
    expect(novemberTransactions[0]?.planId).toBe("plan_twelve");
    expect(novemberTransactions[0]?.installmentNumber).toBe(11);
  });

  it("projeta as duas TOTALPASS todos os meses e permite cancelar sem apagar o histórico", () => {
    const initial = createDemoState();
    const hydrated = reducer(initial, { type: "hydrate", state: initial });
    const november = hydrated.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-11",
    );
    expect(november).toBeDefined();
    const projected = hydrated.transactions.filter(
      (transaction) => transaction.invoiceId === november?.id && transaction.recurringChargeId,
    );
    expect(projected.map((transaction) => transaction.amount).sort((a, b) => a - b)).toEqual([
      109.9, 119.9,
    ]);
    expect(projected.every((transaction) => transaction.type === "compra")).toBe(true);
    expect(
      projected.every((transaction) => transaction.allocations[0]?.personId === personId),
    ).toBe(true);
    expect(forecast(hydrated, "2026-10", 3).map((month) => month.value)).toEqual([
      3176.77, 229.8, 229.8,
    ]);

    const historyBefore = hydrated.transactions.filter(
      (transaction) => transaction.recurringChargeId,
    );
    const canceled = reducer(hydrated, {
      type: "cancelRecurringCharge",
      chargeId: "rec_totalpass_11990",
      cancelledFromMonth: "2026-11",
    });
    expect(forecast(canceled, "2026-10", 3).map((month) => month.value)).toEqual([
      3056.87, 109.9, 109.9,
    ]);
    for (const historical of historyBefore.filter(
      (transaction) => transaction.invoiceId !== november?.id,
    )) {
      expect(canceled.transactions.find((transaction) => transaction.id === historical.id)).toEqual(
        historical,
      );
    }
    const novemberRemaining = canceled.transactions.filter(
      (transaction) => transaction.invoiceId === november?.id && transaction.recurringChargeId,
    );
    expect(novemberRemaining).toHaveLength(1);
    expect(novemberRemaining[0]?.amount).toBe(109.9);
    expect(
      canceled.invoices.find((invoice) => invoice.id === november?.id)?.officialTotal,
    ).toBeCloseTo(
      canceled.transactions
        .filter((transaction) => transaction.invoiceId === november?.id)
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      2,
    );
  });

  it("marca uma compra como recorrente, projeta na próxima competência e conserva a regra ao importar o mês seguinte", () => {
    const initial = stateWithSinglePurchase();
    const purchase = initial.transactions[0];
    if (!purchase) throw new Error("A fixture precisa de uma compra");
    const marked = reducer(initial, {
      type: "upsertRecurringCharge",
      charge: {
        id: "rec_manual",
        description: purchase.description,
        cardId: "c_7432",
        amount: purchase.amount,
        startMonth: "2026-11",
        shares: [{ personId, pct: 100 }],
        sourceTransactionId: purchase.id,
      },
    });
    const november = marked.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-11",
    );
    if (!november) throw new Error("A recorrência não projetou novembro automaticamente");
    const predicted = marked.transactions.find(
      (transaction) => transaction.invoiceId === november.id,
    );
    if (!predicted) throw new Error("O lançamento previsto não foi criado");

    const imported = reducer(marked, {
      type: "importInvoice",
      invoice: { ...november, id: "pdf_november", source: "pdf", officialTotal: purchase.amount },
      transactions: [{ ...predicted, id: "actual_november_purchase", invoiceId: "pdf_november" }],
    });
    const novemberActual = imported.transactions.find(
      (transaction) => transaction.id === "actual_november_purchase",
    );
    expect(novemberActual?.recurringChargeId).toBe("rec_manual");
    const december = imported.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-12",
    );
    expect(december).toBeDefined();
    expect(
      imported.transactions.filter((transaction) => transaction.invoiceId === december?.id),
    ).toHaveLength(1);

    const canceled = reducer(imported, {
      type: "cancelRecurringCharge",
      chargeId: "rec_manual",
      cancelledFromMonth: "2026-12",
    });
    expect(
      canceled.transactions.find((transaction) => transaction.id === "tx_test_due"),
    ).toMatchObject(purchase);
    expect(
      canceled.transactions.find((transaction) => transaction.id === "actual_november_purchase"),
    ).toEqual(novemberActual);
    expect(
      canceled.transactions.filter((transaction) => transaction.invoiceId === december?.id),
    ).toHaveLength(0);
    expect(forecast(canceled, "2026-11", 2).map((month) => month.value)).toEqual([0, 0]);
  });

  it("prepara apenas parcelas conhecidas e não duplica a competência", () => {
    const state = createDemoState();
    const current = state.invoices[0];
    if (!current) throw new Error("A fixture precisa de pelo menos uma fatura");
    const prepared = reducer(state, { type: "prepareNextInvoice", invoiceId: current.id });
    expect(
      prepared.invoices.some(
        (invoice) => invoice.cardId === current.cardId && invoice.month === "2026-11",
      ),
    ).toBe(true);
    const again = reducer(prepared, { type: "prepareNextInvoice", invoiceId: current.id });
    expect(
      again.invoices.filter(
        (invoice) => invoice.cardId === current.cardId && invoice.month === "2026-11",
      ),
    ).toHaveLength(1);
  });
});
