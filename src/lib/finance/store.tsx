import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureWorkspace, loadCloudState, saveCloudState } from "./cloud";
import { createDemoState } from "./mock";
import {
  addMonths,
  dateInMonth,
  planAmountAt,
  planNumberAt,
  planStatusAt,
  recurringChargeAppliesAt,
} from "./calc";
import { round2 } from "./format";
import { OCTOBER_ASSIGNMENTS } from "./octoberAssignments";
import type {
  Allocation,
  CreditCard,
  FinanceState,
  InstallmentPlan,
  Invoice,
  Person,
  PersonPayment,
  RecurringCharge,
  Settings,
  SpreadsheetArchive,
  Transaction,
  TxType,
} from "./types";

const STORAGE_KEY = "fatura-organizer-real-itau-v2";

export type Action =
  | { type: "hydrate"; state: FinanceState }
  | { type: "reset" }
  | { type: "setMonth"; month: string }
  | { type: "updateSettings"; patch: Partial<Settings> }
  | { type: "allocate"; txIds: string[]; personId: string }
  | { type: "split"; txId: string; allocations: Allocation[]; adjustmentNote?: string }
  | { type: "unassign"; txIds: string[] }
  | {
      type: "updateTransaction";
      txId: string;
      patch: {
        description: string;
        date: string;
        amount: number;
        installmentNumber: number | null;
        installmentTotal: number | null;
      };
    }
  | { type: "deleteTransaction"; txId: string }
  | { type: "addTransaction"; transaction: Transaction }
  | { type: "setTxType"; txId: string; txType: TxType }
  | { type: "upsertPerson"; person: Person }
  | { type: "deletePerson"; personId: string }
  | { type: "upsertCard"; card: CreditCard }
  | { type: "upsertPlan"; plan: InstallmentPlan }
  | { type: "deletePlan"; planId: string }
  | { type: "upsertRecurringCharge"; charge: RecurringCharge }
  | { type: "cancelRecurringCharge"; chargeId: string; cancelledFromMonth: string }
  | { type: "importInvoice"; invoice: Invoice; transactions: Transaction[] }
  | { type: "setInvoicePayments"; invoiceId: string; payments: NonNullable<Invoice["payments"]> }
  | { type: "setInvoiceStatus"; invoiceId: string; status: Invoice["status"] }
  | { type: "addSpreadsheet"; spreadsheet: SpreadsheetArchive }
  | { type: "removeSpreadsheet"; spreadsheetId: string }
  | { type: "recordPersonPayment"; payment: PersonPayment }
  | { type: "removePersonPayment"; paymentId: string }
  | { type: "markInvoicePaid"; invoiceId: string; paidAt: string }
  | { type: "prepareNextInvoice"; invoiceId: string };

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];

type InstallmentReference = { number: number; total: number };

/** Lê n/total tanto dos campos estruturados quanto da descrição original da fatura. */
const installmentReferenceOf = (
  transaction: Pick<Transaction, "description" | "installmentNumber" | "installmentTotal">,
): InstallmentReference | null => {
  if (
    Number.isInteger(transaction.installmentNumber) &&
    Number.isInteger(transaction.installmentTotal) &&
    transaction.installmentNumber! >= 1 &&
    transaction.installmentTotal! >= transaction.installmentNumber!
  ) {
    return { number: transaction.installmentNumber!, total: transaction.installmentTotal! };
  }
  const match = transaction.description.match(/(?:^|[^0-9])(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/);
  if (!match) return null;
  const number = Number(match[1]);
  const total = Number(match[2]);
  return number >= 1 && total >= number ? { number, total } : null;
};

const nextInstallmentDescription = (description: string, reference: InstallmentReference) => {
  const next = `${reference.number + 1}/${reference.total}`;
  return /(?:^|[^0-9])\d{1,2}\s*\/\s*\d{1,2}(?!\d)/.test(description)
    ? description.replace(/\d{1,2}\s*\/\s*\d{1,2}(?!\d)/, next)
    : `${description} ${next}`;
};

const projectionKey = (description: string, amount: number) =>
  `${description
    .toLowerCase()
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}|${amount.toFixed(2)}`;

const scaledAllocations = (transaction: Transaction, amount: number): Allocation[] => {
  if (transaction.amount <= 0 || transaction.allocations.length === 0) return [];
  const total = round2(transaction.allocations.reduce((sum, item) => sum + item.amount, 0));
  if (total !== round2(transaction.amount)) return [];
  const allocations = transaction.allocations.map((item) => ({
    personId: item.personId,
    amount: round2((item.amount / transaction.amount) * amount),
  }));
  const last = allocations.at(-1);
  if (last) {
    last.amount = round2(
      amount - allocations.slice(0, -1).reduce((sum, item) => sum + item.amount, 0),
    );
  }
  return allocations;
};

const prepareNextInvoice = (state: FinanceState, invoiceId: string): FinanceState => {
  const current = state.invoices.find((invoice) => invoice.id === invoiceId);
  if (!current) return state;
  const nextMonth = addMonths(current.month, 1);
  if (
    state.invoices.some(
      (invoice) => invoice.cardId === current.cardId && invoice.month === nextMonth,
    )
  )
    return state;
  const card = state.cards.find((item) => item.id === current.cardId);
  if (!card) return state;
  const nextId = `${current.id}_next_${nextMonth}`;
  const installmentTransactions = state.plans.flatMap((plan) => {
    if (plan.cardId !== current.cardId) return [];
    const amount = planAmountAt(plan, nextMonth);
    if (!amount) return [];
    const installmentNumber = planNumberAt(plan, nextMonth);
    return [
      {
        id: `${nextId}_${plan.id}`,
        invoiceId: nextId,
        date: dateInMonth(nextMonth, card.closingDay),
        description: `${plan.description} ${installmentNumber}/${plan.amounts.length}`,
        amount,
        type: "parcela" as const,
        planId: plan.id,
        installmentNumber,
        installmentTotal: plan.amounts.length,
        allocations: plan.shares.map((share) => ({
          personId: share.personId,
          amount: round2((amount * share.pct) / 100),
        })),
      },
    ];
  });
  const projectedPlanKeys = new Set(
    installmentTransactions.map((transaction) =>
      projectionKey(transaction.description, transaction.amount),
    ),
  );
  const descriptionInstallments = state.transactions.flatMap((transaction) => {
    if (transaction.invoiceId !== current.id || transaction.amount <= 0) return [];
    const reference = installmentReferenceOf(transaction);
    if (!reference || reference.number >= reference.total || transaction.type === "pagamento")
      return [];
    // Um plano cadastrado é a fonte estruturada; não duplique sua parcela pela descrição.
    if (transaction.planId && state.plans.some((plan) => plan.id === transaction.planId)) return [];
    const description = nextInstallmentDescription(transaction.description, reference);
    if (projectedPlanKeys.has(projectionKey(description, transaction.amount))) return [];
    return [
      {
        id: `${nextId}_installment_${transaction.id}`,
        invoiceId: nextId,
        date: dateInMonth(nextMonth, card.closingDay),
        description,
        amount: transaction.amount,
        type: "parcela" as const,
        installmentNumber: reference.number + 1,
        installmentTotal: reference.total,
        allocations: scaledAllocations(transaction, transaction.amount),
      },
    ];
  });
  const recurringTransactions = state.recurringCharges
    .filter(
      (charge) => charge.cardId === current.cardId && recurringChargeAppliesAt(charge, nextMonth),
    )
    .map((charge) => ({
      id: `${nextId}_${charge.id}`,
      invoiceId: nextId,
      date: dateInMonth(nextMonth, card.closingDay),
      description: charge.description,
      amount: charge.amount,
      type: "compra" as const,
      recurringChargeId: charge.id,
      allocations: charge.shares.map((share) => ({
        personId: share.personId,
        amount: round2((charge.amount * share.pct) / 100),
      })),
    }));
  const transactions = [
    ...installmentTransactions,
    ...descriptionInstallments,
    ...recurringTransactions,
  ];
  return {
    ...state,
    invoices: [
      ...state.invoices,
      {
        id: nextId,
        cardId: current.cardId,
        month: nextMonth,
        dueDate: dateInMonth(nextMonth, card.dueDay),
        officialTotal: round2(
          transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
        ),
        status: "em_revisao",
        source: "planilha",
      },
    ],
    transactions: [...state.transactions, ...transactions],
  };
};

const isForecastInvoice = (invoice: Invoice) =>
  invoice.source === "planilha" && invoice.id.includes("_next_");

/** Ao reabrir uma conta, retoma a projeção da próxima fatura que já foi paga. */
const ensurePaidInvoiceProjections = (state: FinanceState): FinanceState => {
  let result = state;
  result.invoices
    .filter((invoice) => invoice.status === "paga" && !isForecastInvoice(invoice))
    .sort((a, b) => b.month.localeCompare(a.month))
    .forEach((invoice) => {
      result = prepareNextInvoice(result, invoice.id);
    });
  return result;
};

const ensureRecurringProjections = (state: FinanceState): FinanceState => {
  let result = state;
  const cardIds = [...new Set(result.recurringCharges.map((charge) => charge.cardId))];
  for (const cardId of cardIds) {
    const latestActual = result.invoices
      .filter((invoice) => invoice.cardId === cardId && !isForecastInvoice(invoice))
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    if (!latestActual) continue;
    const nextMonth = addMonths(latestActual.month, 1);
    if (
      !result.recurringCharges.some(
        (charge) => charge.cardId === cardId && recurringChargeAppliesAt(charge, nextMonth),
      )
    )
      continue;
    const existing = result.invoices.find(
      (invoice) => invoice.cardId === cardId && invoice.month === nextMonth,
    );
    if (!existing) {
      result = prepareNextInvoice(result, latestActual.id);
      continue;
    }
    if (!isForecastInvoice(existing)) continue;
    const card = result.cards.find((item) => item.id === cardId);
    if (!card) continue;
    const missing = result.recurringCharges
      .filter((charge) => charge.cardId === cardId && recurringChargeAppliesAt(charge, nextMonth))
      .filter(
        (charge) =>
          !result.transactions.some(
            (transaction) => transaction.id === `${existing.id}_${charge.id}`,
          ),
      )
      .map((charge) => ({
        id: `${existing.id}_${charge.id}`,
        invoiceId: existing.id,
        date: dateInMonth(nextMonth, card.closingDay),
        description: charge.description,
        amount: charge.amount,
        type: "compra" as const,
        recurringChargeId: charge.id,
        allocations: charge.shares.map((share) => ({
          personId: share.personId,
          amount: round2((charge.amount * share.pct) / 100),
        })),
      }));
    if (!missing.length) continue;
    const transactions = [...result.transactions, ...missing];
    const officialTotal = round2(
      transactions
        .filter(
          (transaction) =>
            transaction.invoiceId === existing.id && transaction.type !== "pagamento",
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    );
    result = {
      ...result,
      transactions,
      invoices: result.invoices.map((invoice) =>
        invoice.id === existing.id ? { ...invoice, officialTotal } : invoice,
      ),
    };
  }
  return result;
};

const transactionMatchKey = (transaction: Pick<Transaction, "description" | "amount">) =>
  `${transaction.description
    .toLowerCase()
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}|${transaction.amount.toFixed(2)}`;

const previousInvoiceFor = (state: FinanceState, invoice: Invoice) =>
  state.invoices
    .filter(
      (candidate) =>
        candidate.cardId === invoice.cardId &&
        candidate.id !== invoice.id &&
        candidate.month < invoice.month,
    )
    .sort((a, b) => b.month.localeCompare(a.month))[0];

/** Recupera o cartão 0548 da fatura real quando uma versão local antiga não o tinha. */
const ensure0548 = (state: FinanceState): FinanceState => {
  const baseline = createDemoState();
  const baselineCard = baseline.cards.find((card) => card.id === "c_0548");
  const baselineInvoice = baseline.invoices.find((invoice) => invoice.cardId === "c_0548");
  if (!baselineCard || !baselineInvoice) return state;

  const cards = state.cards.some((card) => card.id === baselineCard.id)
    ? state.cards
    : [...state.cards, baselineCard];
  const invoices = state.invoices.some((invoice) => invoice.id === baselineInvoice.id)
    ? state.invoices
    : [...state.invoices, baselineInvoice];
  const people = state.people.map((person) =>
    person.id === "p_tiago" && !person.cardIds.includes("c_0548")
      ? { ...person, cardIds: [...person.cardIds, "c_0548"] }
      : person,
  );
  const knownTransactionIds = new Set(state.transactions.map((transaction) => transaction.id));
  const transactions = [
    ...state.transactions,
    ...baseline.transactions.filter(
      (transaction) =>
        !knownTransactionIds.has(transaction.id) && transaction.invoiceId === baselineInvoice.id,
    ),
  ];
  return { ...state, cards, invoices, people, transactions };
};

/** Preenche somente lançamentos ainda sem atribuição usando o titular cadastrado do cartão. */
const assignInitialCardholders = (state: FinanceState): FinanceState => ({
  ...state,
  transactions: state.transactions.map((transaction) => {
    if (transaction.allocations.length > 0 || transaction.type === "pagamento") return transaction;
    const invoice = state.invoices.find((item) => item.id === transaction.invoiceId);
    const card = invoice ? state.cards.find((item) => item.id === invoice.cardId) : undefined;
    const holder = card
      ? state.people.find((person) => person.cardIds.includes(card.id))
      : undefined;
    return holder
      ? { ...transaction, allocations: [{ personId: holder.id, amount: transaction.amount }] }
      : transaction;
  }),
});

const assignmentKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\b\d+[\d.,]*\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["para", "santa", "loja"].includes(token));

/** Aplica somente correspondências da planilha a lançamentos já existentes e pendentes. */
const assignOctoberPurchases = (state: FinanceState): FinanceState => {
  if (state.spreadsheetAssignmentVersion === 2) return state;
  const people = OCTOBER_ASSIGNMENTS.map((item) => {
    const person = state.people.find((candidate) => {
      const candidateName = candidate.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return (
        candidateName ===
          item.personName
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase() ||
        candidateName.startsWith(
          item.personName
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        )
      );
    });
    return { item, person };
  }).filter((entry): entry is { item: (typeof OCTOBER_ASSIGNMENTS)[number]; person: Person } =>
    Boolean(entry.person),
  );
  const available = state.transactions.map((transaction) => ({ transaction, used: false }));
  const updates = new Map<string, Allocation[]>();
  for (const { item, person } of people) {
    const wanted = assignmentKey(item.description);
    const candidate = available
      .filter(({ transaction, used }) => !used && Math.abs(transaction.amount - item.amount) < 0.01)
      .map((entry) => ({
        ...entry,
        score: assignmentKey(entry.transaction.description).filter((token) =>
          wanted.includes(token),
        ).length,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) continue;
    candidate.used = true;
    updates.set(candidate.transaction.id, [{ personId: person.id, amount: item.amount }]);
  }
  if (!updates.size) return state;
  return {
    ...state,
    spreadsheetAssignmentVersion: 2,
    transactions: state.transactions.map((transaction) =>
      updates.has(transaction.id)
        ? { ...transaction, allocations: updates.get(transaction.id)! }
        : transaction,
    ),
  };
};

const ensureSpreadsheetArchive = (state: FinanceState): FinanceState => {
  const spreadsheets = state.spreadsheets ?? [];
  if (spreadsheets.some((item) => item.id === "sheet_outubro_2020"))
    return { ...state, spreadsheets };
  return {
    ...state,
    spreadsheets: [
      ...spreadsheets,
      {
        id: "sheet_outubro_2020",
        fileName: "OUTUBRODE2020.xlsx",
        month: "2020-10",
        uploadedAt: "2026-10-23T21:00:00.000Z",
        publicPath: "/planilhas/OUTUBRODE2020.xlsx",
      },
    ],
  };
};

const reconcileImportedTransactions = (
  state: FinanceState,
  invoice: Invoice,
  incoming: Transaction[],
) => {
  const prepared = state.invoices.find(
    (candidate) => candidate.cardId === invoice.cardId && candidate.month === invoice.month,
  );
  const previous = previousInvoiceFor(state, invoice);
  const candidates = state.transactions.filter(
    (transaction) =>
      transaction.invoiceId === prepared?.id || transaction.invoiceId === previous?.id,
  );
  const used = new Set<string>();
  const transactions = incoming.map((transaction) => {
    const match = candidates.find(
      (candidate) =>
        !used.has(candidate.id) &&
        transactionMatchKey(candidate) === transactionMatchKey(transaction),
    );
    if (!match) return transaction;
    used.add(match.id);
    const restored: Transaction = {
      ...transaction,
      allocations: match.allocations,
      ...(match.adjustmentNote !== undefined ? { adjustmentNote: match.adjustmentNote } : {}),
    };
    if (match.planId !== undefined) restored.planId = match.planId;
    if (match.recurringChargeId !== undefined) restored.recurringChargeId = match.recurringChargeId;
    if (transaction.installmentNumber === undefined && match.installmentNumber !== undefined)
      restored.installmentNumber = match.installmentNumber;
    if (transaction.installmentTotal === undefined && match.installmentTotal !== undefined)
      restored.installmentTotal = match.installmentTotal;
    return restored;
  });
  return transactions;
};

export function reducer(s: FinanceState, a: Action): FinanceState {
  switch (a.type) {
    case "hydrate": {
      const raw = a.state as FinanceState & { recurringCharges?: RecurringCharge[] };
      const seededCharges = createDemoState().recurringCharges.filter((charge) =>
        raw.transactions.some((transaction) => transaction.id === charge.sourceTransactionId),
      );
      const recurringCharges = raw.recurringCharges ?? seededCharges;
      const transactions = raw.transactions.map((transaction) => {
        const charge = recurringCharges.find((item) => item.sourceTransactionId === transaction.id);
        return transaction.recurringChargeId || !charge
          ? transaction
          : { ...transaction, recurringChargeId: charge.id };
      });
      const normalized = { ...raw, recurringCharges, transactions, payments: raw.payments ?? [] };
      return ensureRecurringProjections(
        ensurePaidInvoiceProjections(
          ensureSpreadsheetArchive({
            ...assignInitialCardholders(assignOctoberPurchases(ensure0548(normalized))),
          }),
        ),
      );
    }
    case "reset":
      return ensureRecurringProjections(createDemoState());
    case "setMonth":
      return { ...s, settings: { ...s.settings, month: a.month } };
    case "updateSettings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "allocate":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          a.txIds.includes(t.id) && t.type !== "pagamento"
            ? {
                ...t,
                allocations: [{ personId: a.personId, amount: t.amount }],
                adjustmentNote: undefined,
              }
            : t,
        ),
      };
    case "split":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          t.id === a.txId
            ? { ...t, allocations: a.allocations, adjustmentNote: a.adjustmentNote }
            : t,
        ),
      };
    case "unassign":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          a.txIds.includes(t.id) ? { ...t, allocations: [], adjustmentNote: undefined } : t,
        ),
      };
    case "updateTransaction":
      return {
        ...s,
        transactions: s.transactions.map((t) => {
          if (t.id !== a.txId) return t;
          const updated: Transaction = {
            ...t,
            description: a.patch.description,
            date: a.patch.date,
            amount: a.patch.amount,
          };
          if (a.patch.installmentNumber === null) delete updated.installmentNumber;
          else updated.installmentNumber = a.patch.installmentNumber;
          if (a.patch.installmentTotal === null) delete updated.installmentTotal;
          else updated.installmentTotal = a.patch.installmentTotal;
          return updated;
        }),
      };
    case "deleteTransaction":
      return { ...s, transactions: s.transactions.filter((t) => t.id !== a.txId) };
    case "addTransaction":
      return { ...s, transactions: [...s.transactions, a.transaction] };
    case "setTxType":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          t.id === a.txId
            ? { ...t, type: a.txType, allocations: a.txType === "pagamento" ? [] : t.allocations }
            : t,
        ),
      };
    case "upsertPerson":
      return { ...s, people: upsert(s.people, a.person) };
    case "deletePerson":
      return {
        ...s,
        people: s.people.filter((p) => p.id !== a.personId),
        // Compras da pessoa voltam para pendências (nada é descartado silenciosamente)
        transactions: s.transactions.map((t) =>
          t.allocations.some((x) => x.personId === a.personId) ? { ...t, allocations: [] } : t,
        ),
        plans: s.plans.map((p) => ({
          ...p,
          shares: p.shares.filter((x) => x.personId !== a.personId),
        })),
        recurringCharges: s.recurringCharges.map((charge) => ({
          ...charge,
          shares: charge.shares.filter((share) => share.personId !== a.personId),
        })),
      };
    case "upsertCard":
      return { ...s, cards: upsert(s.cards, a.card) };
    case "upsertPlan":
      return { ...s, plans: upsert(s.plans, a.plan) };
    case "deletePlan":
      return {
        ...s,
        plans: s.plans.filter((p) => p.id !== a.planId),
        transactions: s.transactions.map((t) =>
          t.planId === a.planId ? { ...t, planId: undefined } : t,
        ),
      };
    case "upsertRecurringCharge": {
      const next = {
        ...s,
        recurringCharges: upsert(s.recurringCharges, a.charge),
        transactions: s.transactions.map((transaction) =>
          transaction.id === a.charge.sourceTransactionId
            ? { ...transaction, recurringChargeId: a.charge.id }
            : transaction,
        ),
      };
      return ensureRecurringProjections(next);
    }
    case "cancelRecurringCharge": {
      const charge = s.recurringCharges.find((item) => item.id === a.chargeId);
      if (!charge) return s;
      const removedInvoices = new Set<string>();
      const transactions = s.transactions.filter((transaction) => {
        const invoice = s.invoices.find((item) => item.id === transaction.invoiceId);
        const remove =
          transaction.recurringChargeId === charge.id &&
          invoice &&
          isForecastInvoice(invoice) &&
          invoice.month >= a.cancelledFromMonth &&
          transaction.id === `${invoice.id}_${charge.id}`;
        if (remove) removedInvoices.add(invoice.id);
        return !remove;
      });
      const invoices = s.invoices.map((invoice) =>
        removedInvoices.has(invoice.id)
          ? {
              ...invoice,
              officialTotal: round2(
                transactions
                  .filter(
                    (transaction) =>
                      transaction.invoiceId === invoice.id && transaction.type !== "pagamento",
                  )
                  .reduce((sum, transaction) => sum + transaction.amount, 0),
              ),
            }
          : invoice,
      );
      return {
        ...s,
        recurringCharges: s.recurringCharges.map((item) =>
          item.id === charge.id ? { ...item, cancelledFromMonth: a.cancelledFromMonth } : item,
        ),
        invoices,
        transactions,
      };
    }
    case "importInvoice": {
      const existing = s.invoices.find(
        (invoice) => invoice.cardId === a.invoice.cardId && invoice.month === a.invoice.month,
      );
      const invoice = existing ? { ...a.invoice, id: existing.id } : a.invoice;
      const incoming = a.transactions.map((transaction) => ({
        ...transaction,
        invoiceId: invoice.id,
      }));
      const reconciled = reconcileImportedTransactions(s, invoice, incoming);
      const imported = {
        ...s,
        invoices: upsert(s.invoices, invoice),
        plans: s.plans.filter(
          (plan) =>
            plan.cardId !== invoice.cardId || planStatusAt(plan, invoice.month) !== "finalizado",
        ),
        transactions: [
          ...s.transactions.filter(
            (transaction) =>
              transaction.invoiceId !== invoice.id && transaction.invoiceId !== a.invoice.id,
          ),
          ...reconciled,
        ],
      };
      return ensureRecurringProjections(imported);
    }
    case "setInvoiceStatus":
      return {
        ...s,
        invoices: s.invoices.map((i) => (i.id === a.invoiceId ? { ...i, status: a.status } : i)),
      };
    case "setInvoicePayments":
      return {
        ...s,
        invoices: s.invoices.map((i) =>
          i.id === a.invoiceId ? { ...i, payments: a.payments } : i,
        ),
      };
    case "addSpreadsheet":
      return { ...s, spreadsheets: upsert(s.spreadsheets ?? [], a.spreadsheet) };
    case "removeSpreadsheet":
      return {
        ...s,
        spreadsheets: (s.spreadsheets ?? []).filter((item) => item.id !== a.spreadsheetId),
      };
    case "recordPersonPayment":
      return { ...s, payments: upsert(s.payments ?? [], a.payment) };
    case "removePersonPayment":
      return { ...s, payments: (s.payments ?? []).filter((payment) => payment.id !== a.paymentId) };
    case "markInvoicePaid": {
      const paid: FinanceState = {
        ...s,
        invoices: s.invoices.map((invoice) =>
          invoice.id === a.invoiceId ? { ...invoice, status: "paga", paidAt: a.paidAt } : invoice,
        ),
      };
      return prepareNextInvoice(paid, a.invoiceId);
    }
    case "prepareNextInvoice":
      return prepareNextInvoice(s, a.invoiceId);
  }
}

type FinanceCtx = { state: FinanceState; dispatch: React.Dispatch<Action> } | null;
// Contexto único mesmo quando o arquivo é recarregado durante a edição (evita "fora do FinanceProvider").
const g = globalThis as unknown as { __financeCtx?: React.Context<FinanceCtx> };
const Ctx = g.__financeCtx ?? (g.__financeCtx = createContext<FinanceCtx>(null));

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const initial = createDemoState();
    return reducer(initial, { type: "hydrate", state: initial });
  });
  const hydrated = useRef(false);
  const workspaceId = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Cópia local (funciona offline e evita "flash" de dados demonstrativos).
  const lastSynced = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "hydrate", state: JSON.parse(raw) });
    } catch {
      /* dados corrompidos: mantém demonstração */
    }
    hydrated.current = true;
  }, []);

  // Nuvem: carrega os dados da conta ao entrar e passa a salvar a cada alteração.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Recebe na hora as alterações feitas pela outra conta.
    const subscribeRemote = (ws: string) => {
      if (channel) void supabase.removeChannel(channel);
      channel = supabase
        .channel(`ws-state-${ws}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_state",
            filter: `workspace_id=eq.${ws}`,
          },
          (payload) => {
            const remote = (payload.new as { data?: unknown } | null)?.data;
            if (!remote || typeof remote !== "object") return;
            const json = JSON.stringify(remote);
            if (json === lastSynced.current) return;
            lastSynced.current = json;
            dispatch({ type: "hydrate", state: remote as FinanceState });
          },
        )
        .subscribe();
    };

    const loadFromCloud = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || cancelled) return;
      const ws = await ensureWorkspace();
      if (!ws || cancelled) return;
      workspaceId.current = ws;
      subscribeRemote(ws);
      const cloud = await loadCloudState(ws);
      if (cancelled) return;
      if (cloud) {
        lastSynced.current = JSON.stringify(cloud);
        dispatch({ type: "hydrate", state: cloud });
      } else if (stateRef.current) {
        // Primeira entrada: publica o estado local na nuvem.
        await saveCloudState(ws, stateRef.current);
      }
    };

    void loadFromCloud();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        workspaceId.current = null;
        lastSynced.current = null;
        if (channel) {
          void supabase.removeChannel(channel);
          channel = null;
        }
        dispatch({ type: "hydrate", state: createDemoState() });
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void loadFromCloud();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      if (state.settings.persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (!workspaceId.current || !state.settings.persist) return;
    // Salva na nuvem com pequena espera para agrupar alterações em sequência.
    const timer = setTimeout(() => {
      if (!workspaceId.current) return;
      const json = JSON.stringify(stateRef.current);
      if (json === lastSynced.current) return; // nada novo (ou veio da outra conta)
      lastSynced.current = json;
      void saveCloudState(workspaceId.current, stateRef.current);
    }, 600);
    return () => clearTimeout(timer);
  }, [state]);

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useFinance() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance fora do FinanceProvider");
  return v;
}
