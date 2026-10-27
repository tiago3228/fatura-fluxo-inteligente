import { describe, expect, it } from "vitest";
import {
  cardLimitAvailable,
  cardLimitUsed,
  committedMonthTotal,
  detectedInstallmentPlans,
  filterInstallmentPlanEntries,
  forecast,
  planStatusAt,
  personDebtTotal,
  personMonthPaid,
  personMonthRemaining,
  personPaymentStatus,
  personMonthTotal,
  totalCardLimit,
  totalCardLimitAvailable,
  totalCardLimitUsed,
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

function stateWithCarineGol() {
  const base = createDemoState();
  const gol = base.transactions.find(
    (transaction) => transaction.description === "GOL LINHAS A*EWQKW01/04",
  );
  if (!gol) throw new Error("A fixture precisa conter a compra parcelada da GOL");
  const carine = {
    id: "p_carine",
    name: "Carine",
    limit: 1500,
    active: true,
    cardIds: [],
  };
  const initial: FinanceState = {
    ...base,
    people: [...base.people, carine],
    transactions: base.transactions.map((transaction) =>
      transaction.id === gol.id
        ? { ...transaction, allocations: [{ personId: carine.id, amount: transaction.amount }] }
        : transaction,
    ),
  };
  return { initial, carine, gol };
}

const transactionsForCardMonth = (state: FinanceState, cardId: string, month: string) => {
  const invoice = state.invoices.find((item) => item.cardId === cardId && item.month === month);
  return invoice ? state.transactions.filter((item) => item.invoiceId === invoice.id) : [];
};

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

  it("projeta automaticamente GOL 01/04 até 04/04 sem exigir pagamento da fatura", () => {
    const { initial, carine, gol } = stateWithCarineGol();
    expect(initial.people.find((person) => person.id === "p_tiago")?.cardIds).toContain("c_8222");
    expect(carine.cardIds).not.toContain("c_8222");
    expect(gol.type).toBe("parcela");
    expect(gol).toMatchObject({ installmentNumber: 1, installmentTotal: 4 });

    const hydrated = reducer(initial, { type: "hydrate", state: initial });
    for (const [month, number] of [
      ["2026-11", 2],
      ["2026-12", 3],
      ["2027-01", 4],
    ] as const) {
      const golRows = transactionsForCardMonth(hydrated, "c_8222", month).filter((transaction) =>
        transaction.description.startsWith("GOL LINHAS A*EWQKW"),
      );
      expect(golRows).toHaveLength(1);
      expect(golRows[0]).toMatchObject({
        installmentNumber: number,
        installmentTotal: 4,
        amount: 329.88,
        type: "parcela",
        isProjected: true,
        allocations: [{ personId: carine.id, amount: 329.88 }],
      });
    }
    expect(personMonthTotal(hydrated, carine.id, "2026-11")).toBe(329.88);
    expect(
      transactionsForCardMonth(hydrated, "c_8222", "2027-02").some((transaction) =>
        transaction.description.startsWith("GOL LINHAS A*EWQKW"),
      ),
    ).toBe(false);

    const hydratedAgain = reducer(hydrated, { type: "hydrate", state: hydrated });
    expect(
      transactionsForCardMonth(hydratedAgain, "c_8222", "2026-11").filter((transaction) =>
        transaction.description.startsWith("GOL LINHAS A*EWQKW"),
      ),
    ).toHaveLength(1);
  });

  it("calcula o limite disponível pelo saldo do cartão, sem descontar faturas pagas ou recorrências futuras", () => {
    const { initial, carine, gol } = stateWithCarineGol();
    const sourceInvoice = initial.invoices.find((invoice) => invoice.id === gol.invoiceId);
    if (!sourceInvoice) throw new Error("A compra da GOL precisa estar vinculada a uma fatura");
    const openInvoice = { ...sourceInvoice, status: "em_revisao" as const, officialTotal: 329.88 };
    const futureInvoice = {
      ...openInvoice,
      id: `${sourceInvoice.id}_next_2026-11`,
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: 379.88,
      source: "planilha" as const,
    };
    const paidInvoice = {
      ...openInvoice,
      id: "invoice_already_paid",
      month: "2026-09",
      status: "paga" as const,
      officialTotal: 500,
    };
    const currentPurchase: Transaction = {
      ...gol,
      invoiceId: openInvoice.id,
      allocations: [{ personId: carine.id, amount: 329.88 }],
    };
    const futureInstallment: Transaction = {
      ...currentPurchase,
      id: "tx_gol_future_installment",
      invoiceId: futureInvoice.id,
      date: "2026-11-16",
      description: "GOL LINHAS A*EWQKW02/04",
      installmentNumber: 2,
      installmentTotal: 4,
      projectionSourceId: gol.id,
      isProjected: true,
    };
    const futureRecurring: Transaction = {
      ...futureInstallment,
      id: "tx_future_recurring",
      description: "Serviço mensal previsto",
      amount: 50,
      type: "compra",
      installmentNumber: undefined,
      installmentTotal: undefined,
      projectionSourceId: undefined,
      isProjected: undefined,
      recurringChargeId: "recurring_test",
    };
    const alreadyPaidPurchase: Transaction = {
      ...currentPurchase,
      id: "tx_already_paid",
      invoiceId: paidInvoice.id,
      amount: 500,
      allocations: [{ personId: carine.id, amount: 500 }],
    };
    const state: FinanceState = {
      ...initial,
      cards: initial.cards.map((card) =>
        card.id === "c_8222" ? { ...card, creditLimit: 1000 } : card,
      ),
      invoices: [openInvoice, futureInvoice, paidInvoice],
      transactions: [currentPurchase, futureInstallment, futureRecurring, alreadyPaidPurchase],
    };

    expect(cardLimitUsed(state, "c_8222")).toBe(659.76);
    expect(cardLimitAvailable(state, "c_8222")).toBe(340.24);

    const paidCurrentInvoice: FinanceState = {
      ...state,
      invoices: state.invoices.map((invoice) =>
        invoice.id === openInvoice.id ? { ...invoice, status: "paga" as const } : invoice,
      ),
    };
    expect(cardLimitUsed(paidCurrentInvoice, "c_8222")).toBe(329.88);
    expect(cardLimitAvailable(paidCurrentInvoice, "c_8222")).toBe(670.12);
  });

  it("unifica o limite e soma os compromissos de todos os cartões", () => {
    const initial = createDemoState();
    const sourceInvoice = initial.invoices.find((invoice) => invoice.cardId === "c_8222");
    const sourceCard = initial.cards.find((card) => card.id === "c_8222");
    if (!sourceInvoice || !sourceCard)
      throw new Error("A fixture precisa do cartão e da fatura GOL");
    const firstCard = { ...sourceCard, creditLimit: 1000 };
    const secondCard = {
      ...sourceCard,
      id: "c_shared_limit",
      name: "Cartão compartilhado",
      creditLimit: 500,
    };
    const openInvoice = {
      ...sourceInvoice,
      id: "invoice_shared_open",
      officialTotal: 329.88,
      status: "em_revisao" as const,
    };
    const futureInvoice = {
      ...openInvoice,
      id: "invoice_shared_future",
      month: "2026-11",
      dueDate: "2026-11-23",
      source: "pdf" as const,
    };
    const paidInvoice = {
      ...openInvoice,
      id: "invoice_shared_paid",
      month: "2026-09",
      status: "paga" as const,
      officialTotal: 500,
    };
    const secondInvoice = {
      ...openInvoice,
      id: "invoice_shared_limit",
      cardId: secondCard.id,
      officialTotal: 100,
    };
    const sharedState: FinanceState = {
      ...initial,
      settings: { ...initial.settings, cardLimitTotal: 2000 },
      cards: [firstCard, secondCard],
      invoices: [openInvoice, futureInvoice, paidInvoice, secondInvoice],
      transactions: [],
    };

    expect(totalCardLimitUsed(sharedState)).toBe(759.76);
    expect(totalCardLimitAvailable(sharedState)).toBe(1240.24);
    expect(totalCardLimit(sharedState)).toBe(2000);
    expect(
      totalCardLimit({
        ...sharedState,
        settings: { ...sharedState.settings, cardLimitTotal: undefined },
      }),
    ).toBe(1500);
  });

  it("detecta parcelamentos importados e associa os responsáveis para o filtro por pessoa", () => {
    const state = createDemoState();
    const detected = detectedInstallmentPlans(state);
    const atenaPlans = detected.filter(({ plan }) =>
      plan.shares.some((share) => share.personId === "p_atena"),
    );

    expect(state.plans).toHaveLength(0);
    expect(detected.length).toBeGreaterThan(0);
    expect(atenaPlans.length).toBeGreaterThan(0);
    expect(atenaPlans.some(({ plan }) => plan.cardId === "c_7264")).toBe(true);
  });

  it("agrupa parcelas importadas da mesma compra entre faturas e estima as parcelas ausentes", () => {
    const initial = createDemoState();
    const card = initial.cards.find((item) => item.id === "c_7264");
    const templateInvoice = initial.invoices.find((invoice) => invoice.cardId === "c_7264");
    if (!card || !templateInvoice) throw new Error("A fixture precisa do cartão da Atena");
    const septemberInvoice = {
      ...templateInvoice,
      id: "invoice_installment_september",
      month: "2026-09",
      dueDate: "2026-09-23",
    };
    const octoberInvoice = {
      ...templateInvoice,
      id: "invoice_installment_october",
      month: "2026-10",
      dueDate: "2026-10-23",
    };
    const firstInstallment: Transaction = {
      id: "tx_installment_first",
      invoiceId: septemberInvoice.id,
      date: "2026-09-05",
      description: "05/09 Loja Teste 01/03",
      amount: 100,
      type: "parcela",
      installmentNumber: 1,
      installmentTotal: 3,
      allocations: [{ personId: "p_atena", amount: 100 }],
    };
    const secondInstallment: Transaction = {
      ...firstInstallment,
      id: "tx_installment_second",
      invoiceId: octoberInvoice.id,
      date: "2026-10-05",
      description: "05/10 Loja Teste 02/03",
      installmentNumber: 2,
    };
    const state: FinanceState = {
      ...initial,
      settings: { ...initial.settings, month: "2026-10" },
      cards: [card],
      invoices: [septemberInvoice, octoberInvoice],
      transactions: [firstInstallment, secondInstallment],
      plans: [],
    };
    const detected = detectedInstallmentPlans(state);

    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      estimated: true,
      plan: {
        description: "Loja Teste",
        firstMonth: "2026-09",
        total: 300,
        amounts: [100, 100, 100],
        shares: [{ personId: "p_atena", pct: 100 }],
      },
    });
  });

  it("filtra por cartão e status entre parcelamentos de titulares e cartões diferentes", () => {
    const initial = createDemoState();
    const extraPlans: InstallmentPlan[] = [
      {
        id: "fixture_active_atena",
        description: "Plano ativo Atena",
        cardId: "c_4494",
        purchaseDate: "2026-10-01",
        total: 300,
        amounts: [100, 100, 100],
        firstMonth: "2026-10",
        shares: [{ personId: "p_atena", pct: 100 }],
      },
      {
        id: "fixture_future_tiago",
        description: "Plano futuro Tiago",
        cardId: "c_7432",
        purchaseDate: "2026-12-01",
        total: 300,
        amounts: [100, 100, 100],
        firstMonth: "2026-12",
        shares: [{ personId: "p_tiago", pct: 100 }],
      },
      {
        id: "fixture_finished_atena",
        description: "Plano finalizado Atena",
        cardId: "c_7264",
        purchaseDate: "2026-01-01",
        total: 200,
        amounts: [100, 100],
        firstMonth: "2026-01",
        shares: [{ personId: "p_atena", pct: 100 }],
      },
    ];
    const entries = [
      ...initial.plans.map((plan) => ({ plan })),
      ...detectedInstallmentPlans(initial).map(({ plan }) => ({ plan })),
      ...extraPlans.map((plan) => ({ plan })),
    ];
    const month = "2026-11";
    const cardIds = [...new Set(entries.map(({ plan }) => plan.cardId))];

    for (const cardId of cardIds) {
      const filtered = filterInstallmentPlanEntries(entries, month, { cardId });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(({ plan }) => plan.cardId === cardId)).toBe(true);
    }

    const expectedByStatus = {
      ativo: "fixture_active_atena",
      futuro: "fixture_future_tiago",
      finalizado: "fixture_finished_atena",
    };
    for (const [status, expectedId] of Object.entries(expectedByStatus)) {
      const filtered = filterInstallmentPlanEntries(entries, month, { status });
      expect(filtered.some(({ plan }) => plan.id === expectedId)).toBe(true);
      expect(filtered.every(({ plan }) => planStatusAt(plan, month) === status)).toBe(true);
    }

    for (const personId of ["p_atena", "p_tiago"]) {
      const filtered = filterInstallmentPlanEntries(entries, month, { personId });
      expect(filtered.length).toBeGreaterThan(0);
      expect(
        filtered.every(({ plan }) => plan.shares.some((share) => share.personId === personId)),
      ).toBe(true);
    }
  });

  it("propaga a atribuição iniciada na parcela futura à compra original e às parcelas seguintes", () => {
    const { initial, carine, gol } = stateWithCarineGol();
    const unassigned: FinanceState = {
      ...initial,
      transactions: initial.transactions.map((transaction) =>
        transaction.id === gol.id ? { ...transaction, allocations: [] } : transaction,
      ),
    };
    const hydrated = reducer(unassigned, { type: "hydrate", state: unassigned });
    const novemberRow = transactionsForCardMonth(hydrated, "c_8222", "2026-11").find(
      (transaction) => transaction.description.startsWith("GOL LINHAS A*EWQKW"),
    );
    if (!novemberRow) throw new Error("A parcela de novembro deveria estar projetada");

    const allocated = reducer(hydrated, {
      type: "allocate",
      txIds: [novemberRow.id],
      personId: carine.id,
    });
    expect(allocated.transactions.find((transaction) => transaction.id === gol.id)?.allocations).toEqual([
      { personId: carine.id, amount: 329.88 },
    ]);
    for (const month of ["2026-11", "2026-12", "2027-01"]) {
      expect(
        transactionsForCardMonth(allocated, "c_8222", month).find((transaction) =>
          transaction.description.startsWith("GOL LINHAS A*EWQKW"),
        )?.allocations,
      ).toEqual([{ personId: carine.id, amount: 329.88 }]);
    }
  });

  it("não recria uma cadeia de parcelas removida após nova hidratação", () => {
    const { initial, gol } = stateWithCarineGol();
    const hydrated = reducer(initial, { type: "hydrate", state: initial });
    const novemberRow = transactionsForCardMonth(hydrated, "c_8222", "2026-11").find(
      (transaction) => transaction.description.startsWith("GOL LINHAS A*EWQKW"),
    );
    if (!novemberRow) throw new Error("A parcela de novembro deveria estar projetada");

    const deleted = reducer(hydrated, { type: "deleteTransaction", txId: novemberRow.id });
    const rehydrated = reducer(deleted, { type: "hydrate", state: deleted });
    for (const month of ["2026-11", "2026-12", "2027-01"]) {
      expect(
        transactionsForCardMonth(rehydrated, "c_8222", month).some((transaction) =>
          transaction.description.startsWith("GOL LINHAS A*EWQKW"),
        ),
      ).toBe(false);
    }

    const editedSource = reducer(rehydrated, {
      type: "updateTransaction",
      txId: gol.id,
      patch: {
        description: gol.description,
        date: gol.date,
        amount: gol.amount,
        installmentNumber: 1,
        installmentTotal: 4,
      },
    });
    expect(
      transactionsForCardMonth(editedSource, "c_8222", "2026-11").some((transaction) =>
        transaction.description.startsWith("GOL LINHAS A*EWQKW"),
      ),
    ).toBe(true);
  });

  it("completa uma fatura real já existente sem alterar total, pagamento ou status pago", () => {
    const { initial, carine } = stateWithCarineGol();
    const novemberInvoice = {
      id: "inv_real_nov_8222",
      cardId: "c_8222",
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: 1400,
      status: "paga" as const,
      paidAt: "2026-11-22T12:00:00.000Z",
      payments: [{ personId: carine.id, amount: 1400, paidAt: "2026-11-22" }],
      source: "pdf" as const,
    };
    const withNovemberInvoice: FinanceState = {
      ...initial,
      invoices: [...initial.invoices, novemberInvoice],
    };
    const hydrated = reducer(withNovemberInvoice, {
      type: "hydrate",
      state: withNovemberInvoice,
    });
    const projected = transactionsForCardMonth(hydrated, "c_8222", "2026-11").filter(
      (transaction) => transaction.description.startsWith("GOL LINHAS A*EWQKW"),
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ installmentNumber: 2, amount: 329.88 });
    expect(hydrated.invoices.find((invoice) => invoice.id === novemberInvoice.id)).toMatchObject({
      officialTotal: 1400,
      status: "paga",
      paidAt: novemberInvoice.paidAt,
      payments: novemberInvoice.payments,
    });

    const reimported = reducer(hydrated, {
      type: "importInvoice",
      invoice: { ...novemberInvoice, id: "pdf_nov_reimport", status: "em_revisao", officialTotal: 1450 },
      transactions: [
        {
          id: "tx_gol_nov_real",
          invoiceId: "pdf_nov_reimport",
          date: "2026-11-16",
          description: "GOL LINHAS A*EWQKW02/04",
          amount: 329.88,
          type: "parcela" as const,
          installmentNumber: 2,
          installmentTotal: 4,
          allocations: [],
        },
      ],
    });
    expect(reimported.invoices.find((invoice) => invoice.id === novemberInvoice.id)).toMatchObject({
      officialTotal: 1450,
      status: "paga",
      paidAt: novemberInvoice.paidAt,
      payments: novemberInvoice.payments,
    });
    const realGolRows = transactionsForCardMonth(reimported, "c_8222", "2026-11").filter(
      (transaction) => transaction.description.startsWith("GOL LINHAS A*EWQKW"),
    );
    expect(realGolRows).toHaveLength(1);
    expect(realGolRows[0]).toMatchObject({
      id: "tx_gol_nov_real",
      allocations: [{ personId: carine.id, amount: 329.88 }],
    });
    expect(realGolRows[0]?.isProjected).toBeUndefined();
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
    expect(totalFutureCommitted(november, "2026-10")).toBe(1972.28);

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
    const forecastBeforeCancellation = forecast(hydrated, "2026-10", 3).map(
      (month) => month.value,
    );
    expect(forecastBeforeCancellation.every((value) => value > 0)).toBe(true);

    const historyBefore = hydrated.transactions.filter(
      (transaction) => transaction.recurringChargeId,
    );
    const canceled = reducer(hydrated, {
      type: "cancelRecurringCharge",
      chargeId: "rec_totalpass_11990",
      cancelledFromMonth: "2026-11",
    });
    expect(forecast(canceled, "2026-10", 3).map((month) => month.value)).toEqual(
      forecastBeforeCancellation.map((value) => Number((value - 119.9).toFixed(2))),
    );
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

  it("completa uma previsão antiga que tinha apenas recorrências", () => {
    const initial = createDemoState();
    const hydrated = reducer(initial, { type: "hydrate", state: initial });
    const november = hydrated.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-11",
    );
    if (!november) throw new Error("A previsão de novembro não foi criada");
    const stale: FinanceState = {
      ...hydrated,
      invoices: hydrated.invoices.map((invoice) =>
        invoice.id === november.id
          ? {
              ...invoice,
              officialTotal: 229.8,
            }
          : invoice,
      ),
      transactions: hydrated.transactions.filter(
        (transaction) =>
          transaction.invoiceId !== november.id || transaction.recurringChargeId !== undefined,
      ),
    };

    const repaired = reducer(stale, { type: "hydrate", state: stale });
    const repairedInstallments = repaired.transactions.filter(
      (transaction) => transaction.invoiceId === november.id && transaction.type === "parcela",
    );
    expect(repairedInstallments.length).toBeGreaterThan(0);
    expect(repaired.invoices.find((invoice) => invoice.id === november.id)?.officialTotal).toBe(
      3176.77,
    );
  });
});
