import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureWorkspace, loadCloudState, saveCloudState } from "./cloud";
import { createDemoState } from "./mock";
import {
  addMonths,
  allocateByPercent,
  dateInMonth,
  installmentReferenceFromDescription,
  planAmountAt,
  planNumberAt,
  planStatusAt,
  replaceInstallmentReference,
  recurringChargeAppliesAt,
  stripInstallmentReference,
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
  return installmentReferenceFromDescription(transaction.description);
};

const nextInstallmentDescription = (description: string, reference: InstallmentReference) => {
  return replaceInstallmentReference(description, {
    number: reference.number + 1,
    total: reference.total,
  });
};

const projectionKey = (description: string, amount: number) =>
  `${stripInstallmentReference(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}|${amount.toFixed(2)}`;

const projectionMatchKey = (
  transaction: Pick<
    Transaction,
    "description" | "amount" | "installmentNumber" | "installmentTotal"
  >,
) => {
  const reference = installmentReferenceOf(transaction);
  return `${projectionKey(transaction.description, transaction.amount)}|${reference?.number ?? ""}/${reference?.total ?? ""}`;
};

const scaleAllocationList = (
  sourceAllocations: Allocation[],
  sourceAmount: number,
  amount: number,
): Allocation[] => {
  if (sourceAmount <= 0 || sourceAllocations.length === 0) return [];
  const sourceTotal = round2(sourceAllocations.reduce((sum, item) => sum + item.amount, 0));
  if (sourceTotal <= 0 || sourceTotal > round2(sourceAmount)) return [];
  const targetTotal = round2((sourceTotal / sourceAmount) * amount);
  const allocations = sourceAllocations.map((item) => ({
    personId: item.personId,
    amount: round2((item.amount / sourceAmount) * amount),
  }));
  const last = allocations.at(-1);
  if (last) {
    last.amount = round2(
      targetTotal - allocations.slice(0, -1).reduce((sum, item) => sum + item.amount, 0),
    );
  }
  return allocations;
};

const scaledAllocations = (transaction: Transaction, amount: number): Allocation[] =>
  scaleAllocationList(transaction.allocations, transaction.amount, amount);

const projectionSourcesFor = (transactions: Transaction[], transactionIds: string[]) => {
  const selected = new Set(transactionIds);
  return new Set(
    transactions
      .filter(
        (transaction) =>
          selected.has(transaction.id) &&
          transaction.projectionSourceId &&
          transactions.some((source) => source.id === transaction.projectionSourceId),
      )
      .map((transaction) => transaction.projectionSourceId!),
  );
};

const syncProjectedAllocations = (transactions: Transaction[]) => {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  return transactions.map((transaction) => {
    if (!transaction.isProjected || !transaction.projectionSourceId) return transaction;
    const source = byId.get(transaction.projectionSourceId);
    if (!source) return transaction;
    return { ...transaction, allocations: scaledAllocations(source, transaction.amount) };
  });
};

const prepareNextInvoice = (
  state: FinanceState,
  invoiceId: string,
  includeRecurring = true,
): FinanceState => {
  const current = state.invoices.find((invoice) => invoice.id === invoiceId);
  if (!current) return state;
  const nextMonth = addMonths(current.month, 1);
  const existing = state.invoices.find(
    (invoice) => invoice.cardId === current.cardId && invoice.month === nextMonth,
  );
  const card = state.cards.find((item) => item.id === current.cardId);
  if (!card) return state;
  const nextId = existing?.id ?? `${current.id}_next_${nextMonth}`;
  const installmentTransactions = state.plans.flatMap((plan) => {
    if (
      plan.cardId !== current.cardId ||
      state.suppressedProjectionSources?.includes(`plan:${plan.id}`)
    )
      return [];
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
        projectionSourceId: `plan:${plan.id}`,
        isProjected: true,
        allocations: allocateByPercent(amount, plan.shares),
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
    const projectionSourceId = transaction.projectionSourceId ?? transaction.id;
    if (state.suppressedProjectionSources?.includes(projectionSourceId)) return [];
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
        projectionSourceId,
        isProjected: true,
        allocations: scaledAllocations(transaction, transaction.amount),
      },
    ];
  });
  const recurringTransactions = includeRecurring
    ? state.recurringCharges
        .filter(
          (charge) =>
            charge.cardId === current.cardId && recurringChargeAppliesAt(charge, nextMonth),
        )
        .map((charge) => ({
          id: `${nextId}_${charge.id}`,
          invoiceId: nextId,
          date: dateInMonth(nextMonth, card.closingDay),
          description: charge.description,
          amount: charge.amount,
          type: "compra" as const,
          recurringChargeId: charge.id,
          allocations: allocateByPercent(charge.amount, charge.shares),
        }))
    : [];
  const transactions: Transaction[] = [
    ...installmentTransactions,
    ...descriptionInstallments,
    ...recurringTransactions,
  ];
  const existingTargetTransactions = state.transactions.filter(
    (transaction) => transaction.invoiceId === nextId,
  );
  const matchedTargetIds = new Set<string>();
  const newTransactions = transactions.filter((transaction) => {
    if (state.transactions.some((item) => item.id === transaction.id)) return false;
    const key = projectionMatchKey(transaction);
    const matching = existingTargetTransactions.find(
      (item) =>
        !matchedTargetIds.has(item.id) &&
        ((transaction.projectionSourceId !== undefined &&
          transaction.projectionSourceId === item.projectionSourceId) ||
          projectionMatchKey(item) === key),
    );
    if (matching) {
      matchedTargetIds.add(matching.id);
      return false;
    }
    return true;
  });
  const nextInvoiceTransactions = [
    ...state.transactions.filter((transaction) => transaction.invoiceId === nextId),
    ...newTransactions,
  ];
  const calculatedTotal = round2(
    nextInvoiceTransactions
      .filter((transaction) => transaction.type !== "pagamento")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const officialTotal =
    existing && !isForecastInvoice(existing) ? existing.officialTotal : calculatedTotal;
  return {
    ...state,
    invoices: existing
      ? state.invoices.map((invoice) =>
          invoice.id === existing.id && isForecastInvoice(existing)
            ? { ...invoice, officialTotal }
            : invoice,
        )
      : [
          ...state.invoices,
          {
            id: nextId,
            cardId: current.cardId,
            month: nextMonth,
            dueDate: dateInMonth(nextMonth, card.dueDay),
            officialTotal,
            status: "em_revisao" as const,
            source: "planilha" as const,
          },
        ],
    transactions: [...state.transactions, ...newTransactions],
  };
};

const isForecastInvoice = (invoice: Invoice) =>
  invoice.source === "planilha" && invoice.id.includes("_next_");

const recalculateForecastTotals = (state: FinanceState): FinanceState => ({
  ...state,
  invoices: state.invoices.map((invoice) =>
    isForecastInvoice(invoice)
      ? {
          ...invoice,
          officialTotal: round2(
            state.transactions
              .filter(
                (transaction) =>
                  transaction.invoiceId === invoice.id && transaction.type !== "pagamento",
              )
              .reduce((sum, transaction) => sum + transaction.amount, 0),
          ),
        }
      : invoice,
  ),
});

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

/** Migra descrições antigas para campos estruturados sem alterar lançamentos que não são compras. */
const normalizeInstallmentTransactions = (state: FinanceState): FinanceState => ({
  ...state,
  transactions: state.transactions.map((transaction) => {
    if (
      transaction.amount <= 0 ||
      (transaction.type !== "compra" && transaction.type !== "parcela")
    )
      return transaction;
    const reference = installmentReferenceOf(transaction);
    if (!reference) return transaction;
    if (
      transaction.type === "parcela" &&
      transaction.installmentNumber === reference.number &&
      transaction.installmentTotal === reference.total
    )
      return transaction;
    return {
      ...transaction,
      type: "parcela" as const,
      installmentNumber: reference.number,
      installmentTotal: reference.total,
    };
  }),
});

/** Projeta parcelas já identificáveis mesmo em estados antigos e em faturas ainda não pagas. */
const ensureInstallmentProjections = (state: FinanceState): FinanceState => {
  let result = state;
  for (let pass = 0; pass < 100; pass += 1) {
    const transactionCount = result.transactions.length;
    const invoiceCount = result.invoices.length;
    const invoiceIds = result.invoices
      .filter((invoice) => {
        const nextMonth = addMonths(invoice.month, 1);
        const hasInstallmentTransaction = result.transactions.some(
          (transaction) =>
            transaction.invoiceId === invoice.id &&
            transaction.amount > 0 &&
            (transaction.type === "compra" || transaction.type === "parcela") &&
            installmentReferenceOf(transaction) !== null,
        );
        const hasPlanInstallment = result.plans.some(
          (plan) => plan.cardId === invoice.cardId && (planAmountAt(plan, nextMonth) ?? 0) > 0,
        );
        return hasInstallmentTransaction || hasPlanInstallment;
      })
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((invoice) => invoice.id);
    for (const invoiceId of invoiceIds) result = prepareNextInvoice(result, invoiceId, false);
    if (result.transactions.length === transactionCount && result.invoices.length === invoiceCount)
      break;
  }
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
    result = prepareNextInvoice(result, latestActual.id);
  }
  return result;
};

const transactionDescriptionKey = (description: string) =>
  stripInstallmentReference(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const transactionMatchKey = (transaction: Pick<Transaction, "description" | "amount">) =>
  `${transactionDescriptionKey(transaction.description)}|${transaction.amount.toFixed(2)}`;

const sameInstallmentSeries = (
  previous: Transaction,
  incoming: Transaction,
  preparedInvoiceId: string | undefined,
  previousInvoiceId: string | undefined,
) => {
  const previousReference = installmentReferenceOf(previous);
  const incomingReference = installmentReferenceOf(incoming);
  if (
    !previousReference ||
    !incomingReference ||
    previousReference.total !== incomingReference.total ||
    transactionDescriptionKey(previous.description) !==
      transactionDescriptionKey(incoming.description)
  )
    return false;
  if (previous.invoiceId === preparedInvoiceId)
    return previousReference.number === incomingReference.number;
  if (previous.invoiceId === previousInvoiceId)
    return incomingReference.number === previousReference.number + 1;
  return false;
};

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
        (transactionMatchKey(candidate) === transactionMatchKey(transaction) ||
          sameInstallmentSeries(candidate, transaction, prepared?.id, previous?.id)),
    );
    if (!match) return transaction;
    used.add(match.id);
    const restored: Transaction = {
      ...transaction,
      allocations: match.allocations,
      ...(match.adjustmentNote !== undefined ? { adjustmentNote: match.adjustmentNote } : {}),
    };
    delete restored.isProjected;
    if (match.planId !== undefined) restored.planId = match.planId;
    if (match.recurringChargeId !== undefined) restored.recurringChargeId = match.recurringChargeId;
    if (match.projectionSourceId !== undefined)
      restored.projectionSourceId = match.projectionSourceId;
    else if (installmentReferenceOf(match))
      restored.projectionSourceId = match.invoiceId === prepared?.id ? transaction.id : match.id;
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
      const normalized = {
        ...raw,
        recurringCharges,
        transactions,
        payments: raw.payments ?? [],
        suppressedProjectionSources: raw.suppressedProjectionSources ?? [],
      };
      const migrated = normalizeInstallmentTransactions(
        ensureSpreadsheetArchive({
          ...assignInitialCardholders(assignOctoberPurchases(ensure0548(normalized))),
        }),
      );
      return ensureInstallmentProjections(
        ensureRecurringProjections(ensurePaidInvoiceProjections(migrated)),
      );
    }
    case "reset":
      return ensureInstallmentProjections(ensureRecurringProjections(createDemoState()));
    case "setMonth":
      return { ...s, settings: { ...s.settings, month: a.month } };
    case "updateSettings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "allocate": {
      const sourceIds = projectionSourcesFor(s.transactions, a.txIds);
      const targetIds = new Set([...a.txIds, ...sourceIds]);
      return {
        ...s,
        transactions: syncProjectedAllocations(
          s.transactions.map((t) =>
            targetIds.has(t.id) && t.type !== "pagamento"
              ? {
                  ...t,
                  allocations: [{ personId: a.personId, amount: t.amount }],
                  adjustmentNote: undefined,
                }
              : t,
          ),
        ),
      };
    }
    case "split": {
      const selected = s.transactions.find((transaction) => transaction.id === a.txId);
      const source = selected?.projectionSourceId
        ? s.transactions.find((transaction) => transaction.id === selected.projectionSourceId)
        : undefined;
      const sourceAllocations =
        selected && source
          ? scaleAllocationList(a.allocations, selected.amount, source.amount)
          : [];
      return {
        ...s,
        transactions: syncProjectedAllocations(
          s.transactions.map((t) =>
            t.id === a.txId
              ? { ...t, allocations: a.allocations, adjustmentNote: a.adjustmentNote }
              : source && t.id === source.id
                ? { ...t, allocations: sourceAllocations, adjustmentNote: a.adjustmentNote }
                : t,
          ),
        ),
      };
    }
    case "unassign": {
      const sourceIds = projectionSourcesFor(s.transactions, a.txIds);
      const targetIds = new Set([...a.txIds, ...sourceIds]);
      return {
        ...s,
        transactions: syncProjectedAllocations(
          s.transactions.map((t) =>
            targetIds.has(t.id) ? { ...t, allocations: [], adjustmentNote: undefined } : t,
          ),
        ),
      };
    }
    case "updateTransaction": {
      const original = s.transactions.find((transaction) => transaction.id === a.txId);
      if (!original) return s;
      const updatedTransactions = s.transactions.map((t) => {
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
      });
      if (original.isProjected) {
        return recalculateForecastTotals({
          ...s,
          transactions: syncProjectedAllocations(updatedTransactions),
        });
      }
      const projectionRoot = original.projectionSourceId ?? original.id;
      const remainingTransactions = updatedTransactions.filter(
        (transaction) =>
          !(
            projectionRoot &&
            transaction.isProjected &&
            transaction.projectionSourceId === projectionRoot &&
            transaction.id !== a.txId
          ),
      );
      const suppressedProjectionSources = (s.suppressedProjectionSources ?? []).filter(
        (sourceId) => sourceId !== projectionRoot,
      );
      const next = normalizeInstallmentTransactions(
        recalculateForecastTotals({
          ...s,
          transactions: syncProjectedAllocations(remainingTransactions),
          suppressedProjectionSources,
        }),
      );
      return ensureInstallmentProjections(next);
    }
    case "deleteTransaction": {
      const original = s.transactions.find((transaction) => transaction.id === a.txId);
      if (!original) return s;
      const projectionRoot = original.projectionSourceId ?? original.id;
      const shouldSuppress = original.isProjected || original.projectionSourceId !== undefined;
      const suppressedProjectionSources = shouldSuppress
        ? [...new Set([...(s.suppressedProjectionSources ?? []), projectionRoot])]
        : s.suppressedProjectionSources;
      return recalculateForecastTotals({
        ...s,
        transactions: s.transactions.filter(
          (transaction) =>
            transaction.id !== a.txId &&
            !(transaction.isProjected && transaction.projectionSourceId === projectionRoot),
        ),
        ...(suppressedProjectionSources ? { suppressedProjectionSources } : {}),
      });
    }
    case "addTransaction":
      return ensureInstallmentProjections(
        normalizeInstallmentTransactions({
          ...s,
          transactions: [...s.transactions, a.transaction],
        }),
      );
    case "setTxType": {
      const next = normalizeInstallmentTransactions({
        ...s,
        transactions: s.transactions.map((t) =>
          t.id === a.txId
            ? { ...t, type: a.txType, allocations: a.txType === "pagamento" ? [] : t.allocations }
            : t,
        ),
      });
      return ensureInstallmentProjections(next);
    }
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
    case "upsertPlan": {
      const transactions = s.transactions.filter(
        (transaction) => !(transaction.isProjected && transaction.planId === a.plan.id),
      );
      const invoices = s.invoices.map((invoice) =>
        isForecastInvoice(invoice)
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
      return ensureInstallmentProjections({
        ...s,
        invoices,
        transactions,
        plans: upsert(s.plans, a.plan),
        suppressedProjectionSources: (s.suppressedProjectionSources ?? []).filter(
          (sourceId) => sourceId !== `plan:${a.plan.id}`,
        ),
      });
    }
    case "deletePlan": {
      const transactions = s.transactions
        .filter(
          (transaction) =>
            !(transaction.isProjected && transaction.projectionSourceId === `plan:${a.planId}`),
        )
        .map((transaction) =>
          transaction.planId === a.planId ? { ...transaction, planId: undefined } : transaction,
        );
      const invoices = s.invoices.map((invoice) =>
        isForecastInvoice(invoice)
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
        plans: s.plans.filter((p) => p.id !== a.planId),
        invoices,
        transactions,
        suppressedProjectionSources: (s.suppressedProjectionSources ?? []).filter(
          (sourceId) => sourceId !== `plan:${a.planId}`,
        ),
      };
    }
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
      const invoice: Invoice = existing
        ? {
            ...a.invoice,
            id: existing.id,
            ...(existing.status === "paga"
              ? { status: "paga" as const, paidAt: existing.paidAt }
              : {}),
            ...(existing.payments !== undefined ? { payments: existing.payments } : {}),
          }
        : a.invoice;
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
      return ensureInstallmentProjections(
        ensureRecurringProjections(assignInitialCardholders(imported)),
      );
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
      return ensureInstallmentProjections(prepareNextInvoice(paid, a.invoiceId));
    }
    case "prepareNextInvoice":
      return ensureInstallmentProjections(prepareNextInvoice(s, a.invoiceId));
  }
}

export type SyncStatus = "loading" | "local" | "saving" | "synced" | "error" | "conflict";
type FinanceCtx = {
  state: FinanceState;
  dispatch: React.Dispatch<Action>;
  syncStatus: SyncStatus;
  isCloudConnected: boolean;
} | null;
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
  const cloudReady = useRef(false);
  const savingJson = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [syncStatus, setSyncStatusState] = useState<SyncStatus>("loading");
  const syncStatusRef = useRef<SyncStatus>("loading");
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [cloudReadyVersion, setCloudReadyVersion] = useState(0);
  const setSyncStatus = (next: SyncStatus) => {
    syncStatusRef.current = next;
    setSyncStatusState(next);
  };

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
    let loadGeneration = 0;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pendingRemote: FinanceState | null = null;

    const applyRemote = (remote: FinanceState) => {
      const json = JSON.stringify(remote);
      if (json === lastSynced.current) return;
      if (json === savingJson.current) {
        lastSynced.current = json;
        return;
      }
      const localJson = JSON.stringify(stateRef.current);
      if (lastSynced.current !== null && localJson !== lastSynced.current) {
        setSyncStatus("conflict");
        return;
      }
      lastSynced.current = json;
      stateRef.current = remote;
      dispatch({ type: "hydrate", state: remote });
      setSyncStatus("synced");
    };

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
            if (!remote || typeof remote !== "object" || Array.isArray(remote)) return;
            const parsed = remote as FinanceState;
            if (!cloudReady.current) {
              pendingRemote = parsed;
              return;
            }
            applyRemote(parsed);
          },
        )
        .subscribe();
    };

    const loadFromCloud = async () => {
      const generation = ++loadGeneration;
      cloudReady.current = false;
      workspaceId.current = null;
      lastSynced.current = null;
      savingJson.current = null;
      setIsCloudConnected(false);
      setSyncStatus("loading");
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled || generation !== loadGeneration) return;
        if (error) {
          setSyncStatus("error");
          return;
        }
        if (!data.session) {
          setSyncStatus("local");
          return;
        }
        const ws = await ensureWorkspace();
        if (cancelled || generation !== loadGeneration) return;
        if (!ws) {
          setSyncStatus("error");
          return;
        }
        workspaceId.current = ws;
        setIsCloudConnected(true);
        subscribeRemote(ws);

        const result = await loadCloudState(ws);
        if (cancelled || generation !== loadGeneration || workspaceId.current !== ws) return;
        if (result.kind === "error") {
          // Uma falha de leitura nunca deve ser tratada como um documento ausente.
          setSyncStatus("error");
          return;
        }

        const cloudState = pendingRemote ?? (result.kind === "loaded" ? result.state : null);
        if (cloudState) {
          lastSynced.current = JSON.stringify(cloudState);
          stateRef.current = cloudState;
          cloudReady.current = true;
          setCloudReadyVersion((version) => version + 1);
          dispatch({ type: "hydrate", state: cloudState });
          setSyncStatus("synced");
          pendingRemote = null;
          return;
        }

        // Primeira entrada confirmada: publica o estado local; falha deixa o sync bloqueado.
        setSyncStatus("saving");
        const initialState = stateRef.current;
        const saved = await saveCloudState(ws, initialState);
        if (cancelled || generation !== loadGeneration || workspaceId.current !== ws) return;
        if (!saved) {
          setSyncStatus("error");
          return;
        }
        lastSynced.current = JSON.stringify(initialState);
        cloudReady.current = true;
        setCloudReadyVersion((version) => version + 1);
        setSyncStatus("synced");
      } catch {
        if (!cancelled && generation === loadGeneration) setSyncStatus("error");
      }
    };

    void loadFromCloud();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        loadGeneration += 1;
        cloudReady.current = false;
        workspaceId.current = null;
        lastSynced.current = null;
        savingJson.current = null;
        setIsCloudConnected(false);
        setSyncStatus("local");
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
      loadGeneration += 1;
      cloudReady.current = false;
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
    if (!workspaceId.current || !cloudReady.current || syncStatusRef.current === "conflict") return;
    // Salva na nuvem com pequena espera para agrupar alterações em sequência.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const saveCurrentState = async (attempt = 0) => {
      if (
        cancelled ||
        !workspaceId.current ||
        !cloudReady.current ||
        syncStatusRef.current === "conflict"
      )
        return;
      const ws = workspaceId.current;
      const snapshot = stateRef.current;
      const json = JSON.stringify(snapshot);
      if (json === lastSynced.current) {
        setSyncStatus("synced");
        return;
      }
      savingJson.current = json;
      setSyncStatus("saving");
      const saved = await saveCloudState(ws, snapshot);
      if (ws !== workspaceId.current) return;
      if (saved) {
        lastSynced.current = json;
        if (savingJson.current === json) savingJson.current = null;
        if ((syncStatusRef.current as SyncStatus) !== "conflict") {
          setSyncStatus(JSON.stringify(stateRef.current) === json ? "synced" : "saving");
        }
        return;
      }
      if (savingJson.current === json) savingJson.current = null;
      if ((syncStatusRef.current as SyncStatus) !== "conflict") setSyncStatus("error");
      const delays = [2000, 5000, 15000, 30000];
      if (attempt < delays.length) {
        retryTimer = setTimeout(() => void saveCurrentState(attempt + 1), delays[attempt]);
      }
    };
    const timer = setTimeout(() => void saveCurrentState(), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [state, cloudReadyVersion]);

  return (
    <Ctx.Provider value={{ state, dispatch, syncStatus, isCloudConnected }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFinance() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance fora do FinanceProvider");
  return v;
}
