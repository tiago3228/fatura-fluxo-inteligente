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
import { createDemoState, createEmptyFinanceState } from "./mock";
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
import { fmtMonthLong, round2, uid } from "./format";
import { decideCachedState, stableSerialize } from "./syncMerge";
import { OCTOBER_ASSIGNMENTS } from "./octoberAssignments";
import {
  categoryForMerchant,
  DEFAULT_CATEGORY_RULES,
  learnCategoryRule,
  mergeCategoryRules,
  normalizeMerchant,
} from "./categories";
import type {
  Allocation,
  AuditEntry,
  CreditCard,
  FinanceState,
  InstallmentPlan,
  Invoice,
  OtherAccount,
  OtherAccountCategory,
  OtherAccountStatus,
  Person,
  PersonPayment,
  RecurringCharge,
  Settings,
  SpreadsheetArchive,
  Transaction,
  TxType,
} from "./types";
import {
  isValidOtherAccount,
  withDefaultOtherAccountCategories,
} from "./otherAccounts";

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
        category?: string;
        date: string;
        amount: number;
        installmentNumber: number | null;
        installmentTotal: number | null;
      };
    }
  | { type: "setTransactionCategory"; txIds: string[]; category?: string }
  | { type: "setTransactionNote"; txId: string; note: string }
  | { type: "deleteTransaction"; txId: string }
  | { type: "addTransaction"; transaction: Transaction }
  | { type: "setTxType"; txId: string; txType: TxType }
  | { type: "upsertPerson"; person: Person }
  | { type: "deletePerson"; personId: string }
  | { type: "upsertCard"; card: CreditCard }
  | { type: "upsertPlan"; plan: InstallmentPlan }
  | { type: "deletePlan"; planId: string }
  | { type: "upsertRecurringCharge"; charge: RecurringCharge }
  | { type: "upsertOtherAccountCategory"; category: OtherAccountCategory }
  | { type: "deleteOtherAccountCategory"; categoryId: string }
  | { type: "upsertOtherAccount"; account: OtherAccount }
  | { type: "deleteOtherAccount"; accountId: string }
  | { type: "setOtherAccountStatus"; accountId: string; status: OtherAccountStatus; paidAt?: string }
  | { type: "cancelRecurringCharge"; chargeId: string; cancelledFromMonth: string }
  | {
      type: "importInvoice";
      invoice: Invoice;
      transactions: Transaction[];
      personOverrides?: Record<string, Allocation[]>;
    }
  | { type: "setInvoicePayments"; invoiceId: string; payments: NonNullable<Invoice["payments"]> }
  | { type: "setInvoiceStatus"; invoiceId: string; status: Invoice["status"] }
  | { type: "addSpreadsheet"; spreadsheet: SpreadsheetArchive }
  | { type: "removeSpreadsheet"; spreadsheetId: string }
  | { type: "recordPersonPayment"; payment: PersonPayment }
  | { type: "recordPersonPaymentBatch"; payments: PersonPayment[] }
  | { type: "removePersonPayment"; paymentId: string }
  | { type: "clearPersonMonthPayments"; personId: string; month: string }
  | { type: "markInvoicePaid"; invoiceId: string; paidAt: string }
  | { type: "markMonthInvoicesPaid"; month: string; paidAt: string }
  | { type: "appendAudit"; entry: AuditEntry }
  | { type: "dismissAlert"; alertId: string }
  | { type: "dismissAllAlerts"; alertIds: string[] }
  | { type: "undoAudit"; auditId: string }
  | { type: "redoAudit"; auditId: string }
  | { type: "prepareNextInvoice"; invoiceId: string };

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];

const applyCategoryRules = (transactions: Transaction[], rules: FinanceState["categoryRules"]) =>
  transactions.map((transaction) => {
    if (transaction.category) return transaction;
    const category = categoryForMerchant(transaction.description, rules ?? []);
    return category ? { ...transaction, category } : transaction;
  });

const learnFromTransactions = (
  initialRules: NonNullable<FinanceState["categoryRules"]>,
  transactions: Transaction[],
) => {
  const rules = new Map(
    initialRules.map((rule) => [normalizeMerchant(rule.merchant), rule] as const),
  );
  for (const transaction of transactions) {
    const merchant = normalizeMerchant(transaction.description);
    if (merchant && transaction.category) {
      rules.set(merchant, { merchant, category: transaction.category });
    }
  }
  return Array.from(rules.values());
};

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
        category: transaction.category,
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
          category: charge.category,
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
  // Esta correção só é válida para a conta legada já identificada; nunca semear
  // cartões ou lançamentos do fixture em uma conta nova/vazia.
  if (
    !state.people.some((person) => person.id === "p_tiago") ||
    !state.cards.some((card) => card.id === "c_7432")
  ) return state;
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
  // A ausência do campo identifica estados antigos que ainda precisam receber
  // o marcador legado; uma lista vazia é uma exclusão intencional do usuário.
  if (state.spreadsheets !== undefined) return state;
  return {
    ...state,
    spreadsheets: [
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
    const match = candidates.find((candidate) => {
      if (used.has(candidate.id)) return false;
      if (sameInstallmentSeries(candidate, transaction, prepared?.id, previous?.id)) return true;

      // Uma compra comum não pode consumir a correspondência de uma parcela,
      // mesmo que descrição e valor coincidam. Parcelas são conciliadas pela
      // série e pelo avanço n -> n+1; compras comuns, só no mesmo mês preparado
      // ou quando há uma recorrência válida para a competência importada.
      if (installmentReferenceOf(candidate) || installmentReferenceOf(transaction)) return false;
      if (transactionMatchKey(candidate) !== transactionMatchKey(transaction)) return false;
      if (candidate.invoiceId === prepared?.id) return true;
      return (
        candidate.invoiceId === previous?.id &&
        candidate.recurringChargeId !== undefined &&
        state.recurringCharges.some(
          (charge) =>
            charge.id === candidate.recurringChargeId &&
            charge.cardId === invoice.cardId &&
            recurringChargeAppliesAt(charge, invoice.month),
        )
      );
    });
    if (!match) return transaction;
    used.add(match.id);
    const restored: Transaction = {
      ...transaction,
      allocations: match.allocations,
      ...(match.adjustmentNote !== undefined ? { adjustmentNote: match.adjustmentNote } : {}),
      ...(match.note !== undefined ? { note: match.note } : {}),
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

type AuditActor = { id: string; name: string };

const actorNameFromUser = (
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null,
) => {
  const metadata = user?.user_metadata;
  const metadataName = metadata?.["full_name"] ?? metadata?.["name"];
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  const localPart = user?.email
    ?.split("@")[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  if (!localPart) return "Usuário";
  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const invoiceLabel = (state: FinanceState, invoice: Invoice) => {
  const card = state.cards.find((item) => item.id === invoice.cardId);
  return `${fmtMonthLong(invoice.month)}${card ? ` do cartão ${card.name} •••• ${card.last4}` : ""}`;
};

type UndoField =
  | "invoices"
  | "transactions"
  | "categoryRules"
  | "people"
  | "cards"
  | "plans"
  | "recurringCharges"
  | "settings"
  | "payments"
  | "spreadsheets"
  | "suppressedProjectionSources"
  | "otherAccountCategories"
  | "otherAccounts";

const undoSnapshot = (
  before: FinanceState,
  fields: UndoField[],
): NonNullable<AuditEntry["undo"]> => {
  const snapshot: NonNullable<AuditEntry["undo"]> = { kind: "restoreFinance" };
  for (const field of fields) Object.assign(snapshot, { [field]: before[field] });
  return snapshot;
};

const snapshotFields = (snapshot: NonNullable<AuditEntry["undo"]>): UndoField[] =>
  Object.keys(snapshot).filter((field) => field !== "kind") as UndoField[];

const auditForAction = (
  action: Action,
  before: FinanceState,
  actor: AuditActor,
): AuditEntry | null => {
  if (
    action.type === "hydrate" ||
    action.type === "appendAudit" ||
    action.type === "setMonth" ||
    action.type === "dismissAlert" ||
    action.type === "dismissAllAlerts"
  )
    return null;
  if (action.type === "undoAudit") {
    const original = before.auditLog?.find((entry) => entry.id === action.auditId);
    if (!original || !original.undo || original.undoneAt) return null;
    return {
      id: uid("audit"),
      actorId: actor.id,
      actorName: actor.name,
      description: `${actor.name} desfez: ${original.description}`,
      createdAt: new Date().toISOString(),
      entityType: original.entityType,
      entityId: original.entityId,
    };
  }
  if (action.type === "redoAudit") {
    const original = before.auditLog?.find((entry) => entry.id === action.auditId);
    if (!original || !original.redo || !original.undoneAt) return null;
    return {
      id: uid("audit"),
      actorId: actor.id,
      actorName: actor.name,
      description: `${actor.name} refez: ${original.description}`,
      createdAt: new Date().toISOString(),
      entityType: original.entityType,
      entityId: original.entityId,
    };
  }

  let description = `${actor.name} executou a ação “${action.type}”.`;
  let entityType: AuditEntry["entityType"] = "system";
  let entityId: string | undefined;
  let undo: AuditEntry["undo"];

  switch (action.type) {
    case "markInvoicePaid": {
      const invoice = before.invoices.find((item) => item.id === action.invoiceId);
      if (!invoice || invoice.status === "paga") return null;
      description = `${actor.name} marcou como paga a fatura de ${invoiceLabel(before, invoice)}.`;
      entityType = "invoice";
      entityId = invoice.id;
      undo = undoSnapshot(before, ["invoices", "transactions"]);
      break;
    }
    case "markMonthInvoicesPaid": {
      const invoices = before.invoices.filter(
        (invoice) => invoice.month === action.month && invoice.status !== "paga",
      );
      if (invoices.length === 0) return null;
      description = `${actor.name} marcou como pagas as faturas de ${fmtMonthLong(action.month)}.`;
      entityType = "invoice";
      entityId = action.month;
      undo = undoSnapshot(before, ["invoices", "transactions"]);
      break;
    }
    case "addTransaction":
      description = `${actor.name} inseriu a compra “${action.transaction.description}”.`;
      entityType = "transaction";
      entityId = action.transaction.id;
      undo = undoSnapshot(before, [
        "invoices",
        "transactions",
        "categoryRules",
        "suppressedProjectionSources",
      ]);
      break;
    case "deleteTransaction": {
      const transaction = before.transactions.find((item) => item.id === action.txId);
      description = `${actor.name} excluiu a compra “${transaction?.description ?? action.txId}”.`;
      entityType = "transaction";
      entityId = action.txId;
      undo = undoSnapshot(before, ["invoices", "transactions", "suppressedProjectionSources"]);
      break;
    }
    case "updateTransaction": {
      const transaction = before.transactions.find((item) => item.id === action.txId);
      description = `${actor.name} alterou a compra “${transaction?.description ?? action.txId}”.`;
      entityType = "transaction";
      entityId = action.txId;
      undo = undoSnapshot(before, [
        "invoices",
        "transactions",
        "categoryRules",
        "suppressedProjectionSources",
      ]);
      break;
    }
    case "setTransactionCategory": {
      const count = action.txIds.filter((id) =>
        before.transactions.some((item) => item.id === id),
      ).length;
      description = `${actor.name} categorizou ${count} compra(s)${action.category ? ` como “${action.category}”` : " sem categoria"}.`;
      entityType = "transaction";
      entityId = action.txIds[0];
      undo = undoSnapshot(before, ["transactions", "categoryRules"]);
      break;
    }
    case "setTransactionNote": {
      const transaction = before.transactions.find((item) => item.id === action.txId);
      description = `${actor.name} alterou a descrição da compra “${transaction?.description ?? action.txId}”.`;
      entityType = "transaction";
      entityId = action.txId;
      undo = undoSnapshot(before, ["transactions"]);
      break;
    }
    case "setTxType": {
      description = `${actor.name} alterou o tipo de um lançamento.`;
      entityType = "transaction";
      entityId = action.txId;
      undo = undoSnapshot(before, ["invoices", "transactions", "suppressedProjectionSources"]);
      break;
    }
    case "allocate":
    case "split":
    case "unassign":
      description = `${actor.name} alterou a atribuição de responsáveis em lançamentos.`;
      entityType = "transaction";
      undo = undoSnapshot(before, ["transactions"]);
      break;
    case "importInvoice":
      description = `${actor.name} importou a fatura de ${invoiceLabel(before, action.invoice)}.`;
      entityType = "invoice";
      entityId = action.invoice.id;
      undo = undoSnapshot(before, [
        "invoices",
        "transactions",
        "categoryRules",
        "plans",
        "recurringCharges",
      ]);
      break;
    case "upsertPerson":
      description = `${actor.name} ${before.people.some((person) => person.id === action.person.id) ? "alterou" : "inseriu"} a pessoa “${action.person.name}”.`;
      entityType = "person";
      entityId = action.person.id;
      undo = undoSnapshot(before, ["people"]);
      break;
    case "deletePerson": {
      const person = before.people.find((item) => item.id === action.personId);
      description = `${actor.name} excluiu a pessoa “${person?.name ?? action.personId}”.`;
      entityType = "person";
      entityId = action.personId;
      undo = undoSnapshot(before, ["people", "transactions", "plans", "recurringCharges"]);
      break;
    }
    case "upsertOtherAccountCategory": {
      const categories = withDefaultOtherAccountCategories(before.otherAccountCategories);
      const existing = categories.find((category) => category.id === action.category.id);
      const name = action.category.name.trim();
      if (
        !action.category.id.trim() ||
        !name ||
        existing?.builtIn ||
        categories.some(
          (category) =>
            category.id !== action.category.id &&
            category.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
        )
      )
        return null;
      description = `${actor.name} ${existing ? "alterou" : "adicionou"} o tipo de conta “${name}”.`;
      entityType = "otherAccountCategory";
      entityId = action.category.id;
      undo = undoSnapshot(before, ["otherAccountCategories"]);
      break;
    }
    case "deleteOtherAccountCategory": {
      const categories = withDefaultOtherAccountCategories(before.otherAccountCategories);
      const category = categories.find((item) => item.id === action.categoryId);
      if (
        !category ||
        category.builtIn ||
        (before.otherAccounts ?? []).some((account) => account.categoryId === action.categoryId)
      )
        return null;
      description = `${actor.name} removeu o tipo de conta “${category.name}”.`;
      entityType = "otherAccountCategory";
      entityId = category.id;
      undo = undoSnapshot(before, ["otherAccountCategories"]);
      break;
    }
    case "upsertOtherAccount": {
      const categories = withDefaultOtherAccountCategories(before.otherAccountCategories);
      if (!isValidOtherAccount(action.account, categories)) return null;
      const exists = (before.otherAccounts ?? []).some((account) => account.id === action.account.id);
      description = `${actor.name} ${exists ? "alterou" : "adicionou"} a conta “${action.account.description.trim()}”.`;
      entityType = "otherAccount";
      entityId = action.account.id;
      undo = undoSnapshot(before, ["otherAccounts"]);
      break;
    }
    case "deleteOtherAccount": {
      const account = before.otherAccounts?.find((item) => item.id === action.accountId);
      if (!account) return null;
      description = `${actor.name} removeu a conta “${account.description}”.`;
      entityType = "otherAccount";
      entityId = account.id;
      undo = undoSnapshot(before, ["otherAccounts"]);
      break;
    }
    case "setOtherAccountStatus": {
      const account = before.otherAccounts?.find((item) => item.id === action.accountId);
      if (!account || account.status === action.status) return null;
      description = `${actor.name} marcou “${account.description}” como ${action.status === "paid" ? "paga" : "pendente"}.`;
      entityType = "otherAccount";
      entityId = account.id;
      undo = undoSnapshot(before, ["otherAccounts"]);
      break;
    }
    case "upsertCard":
      description = `${actor.name} ${before.cards.some((card) => card.id === action.card.id) ? "alterou" : "inseriu"} o cartão “${action.card.name} •••• ${action.card.last4}”.`;
      entityType = "card";
      entityId = action.card.id;
      undo = undoSnapshot(before, ["cards"]);
      break;
    case "upsertPlan":
      description = `${actor.name} ${before.plans.some((plan) => plan.id === action.plan.id) ? "alterou" : "inseriu"} o parcelamento “${action.plan.description}”.`;
      entityType = "plan";
      entityId = action.plan.id;
      undo = undoSnapshot(before, [
        "plans",
        "invoices",
        "transactions",
        "suppressedProjectionSources",
      ]);
      break;
    case "deletePlan":
      description = `${actor.name} excluiu um parcelamento.`;
      entityType = "plan";
      entityId = action.planId;
      undo = undoSnapshot(before, [
        "plans",
        "invoices",
        "transactions",
        "suppressedProjectionSources",
      ]);
      break;
    case "upsertRecurringCharge":
      description = `${actor.name} alterou uma cobrança recorrente.`;
      entityType = "plan";
      entityId = action.charge.id;
      undo = undoSnapshot(before, ["recurringCharges", "invoices", "transactions"]);
      break;
    case "cancelRecurringCharge":
      description = `${actor.name} cancelou uma cobrança recorrente a partir de ${fmtMonthLong(action.cancelledFromMonth)}.`;
      entityType = "plan";
      entityId = action.chargeId;
      undo = undoSnapshot(before, ["recurringCharges", "invoices", "transactions"]);
      break;
    case "updateSettings":
      description = `${actor.name} alterou as configurações da aplicação.`;
      entityType = "settings";
      undo = undoSnapshot(before, ["settings"]);
      break;
    case "setInvoicePayments":
      description = `${actor.name} atualizou os pagamentos por pessoa da fatura.`;
      entityType = "invoice";
      entityId = action.invoiceId;
      undo = undoSnapshot(before, ["invoices"]);
      break;
    case "recordPersonPayment":
      description = `${actor.name} registrou um pagamento de pessoa.`;
      entityType = "system";
      undo = undoSnapshot(before, ["payments"]);
      break;
    case "recordPersonPaymentBatch":
      description = `${actor.name} registrou um recebimento de pessoa.`;
      entityType = "system";
      undo = undoSnapshot(before, ["payments"]);
      break;
    case "removePersonPayment":
      description = `${actor.name} removeu um pagamento de pessoa.`;
      entityType = "system";
      entityId = action.paymentId;
      undo = undoSnapshot(before, ["payments"]);
      break;
    case "clearPersonMonthPayments": {
      const person = before.people.find((item) => item.id === action.personId);
      const count = (before.payments ?? []).filter(
        (payment) => payment.personId === action.personId && payment.month === action.month,
      ).length;
      if (count === 0) return null;
      description = `${actor.name} marcou ${person?.name ?? action.personId} como pendente em ${fmtMonthLong(action.month)}.`;
      entityType = "person";
      entityId = action.personId;
      undo = undoSnapshot(before, ["payments"]);
      break;
    }
    case "setInvoiceStatus":
      description = `${actor.name} alterou o status de uma fatura.`;
      entityType = "invoice";
      entityId = action.invoiceId;
      undo = undoSnapshot(before, ["invoices"]);
      break;
    case "addSpreadsheet":
      description = `${actor.name} adicionou a planilha “${action.spreadsheet.fileName}”.`;
      entityType = "system";
      entityId = action.spreadsheet.id;
      undo = undoSnapshot(before, ["spreadsheets"]);
      break;
    case "removeSpreadsheet":
      description = `${actor.name} removeu uma planilha.`;
      entityType = "system";
      entityId = action.spreadsheetId;
      undo = undoSnapshot(before, ["spreadsheets"]);
      break;
    case "reset":
      description = `${actor.name} redefiniu os dados de demonstração.`;
      entityType = "system";
      break;
    default:
      break;
  }

  return {
    id: uid("audit"),
    actorId: actor.id,
    actorName: actor.name,
    description,
    createdAt: new Date().toISOString(),
    entityType,
    entityId,
    ...(undo ? { undo } : {}),
  };
};

export function reducer(s: FinanceState, a: Action): FinanceState {
  switch (a.type) {
    case "hydrate": {
      const raw = a.state as FinanceState & { recurringCharges?: RecurringCharge[] };
      const categoryRules = Array.isArray(raw.categoryRules)
        ? mergeCategoryRules(DEFAULT_CATEGORY_RULES, raw.categoryRules)
        : learnFromTransactions(DEFAULT_CATEGORY_RULES, raw.transactions);
      const categorizedTransactions = applyCategoryRules(raw.transactions, categoryRules);
      const isLegacyFixture = raw.people.some((person) => person.id === "p_tiago") &&
        raw.cards.some((card) => card.id === "c_7432");
      const seededCharges = isLegacyFixture
        ? createDemoState().recurringCharges.filter((charge) =>
            raw.transactions.some((transaction) => transaction.id === charge.sourceTransactionId),
          )
        : [];
      const recurringCharges = raw.recurringCharges ?? seededCharges;
      const transactions = categorizedTransactions.map((transaction) => {
        const charge = recurringCharges.find((item) => item.sourceTransactionId === transaction.id);
        return transaction.recurringChargeId || !charge
          ? transaction
          : { ...transaction, recurringChargeId: charge.id };
      });
      const normalized = {
        ...raw,
        recurringCharges,
        otherAccountCategories: withDefaultOtherAccountCategories(raw.otherAccountCategories),
        otherAccounts: Array.isArray(raw.otherAccounts)
          ? raw.otherAccounts.filter((account) =>
              isValidOtherAccount(
                account,
                withDefaultOtherAccountCategories(raw.otherAccountCategories),
              ),
            )
          : [],
        categoryRules,
        transactions,
        payments: raw.payments ?? [],
        suppressedProjectionSources: raw.suppressedProjectionSources ?? [],
        auditLog: (raw.auditLog ?? []).map((entry, index) => {
          if (index < 5 || (!entry.undo && !entry.redo)) return entry;
          const light = { ...entry };
          delete light.undo;
          delete light.redo;
          return light;
        }),
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
      return createEmptyFinanceState();
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
          category: a.patch.category,
          date: a.patch.date,
          amount: a.patch.amount,
        };
        if (a.patch.installmentNumber === null) delete updated.installmentNumber;
        else updated.installmentNumber = a.patch.installmentNumber;
        if (a.patch.installmentTotal === null) delete updated.installmentTotal;
        else updated.installmentTotal = a.patch.installmentTotal;
        return updated;
      });
      const categoryRules = a.patch.category
        ? learnCategoryRule(
            s.categoryRules ?? DEFAULT_CATEGORY_RULES,
            a.patch.description,
            a.patch.category,
          )
        : (s.categoryRules ?? DEFAULT_CATEGORY_RULES);
      const categorizedUpdates = applyCategoryRules(updatedTransactions, categoryRules);
      if (original.isProjected) {
        return recalculateForecastTotals({
          ...s,
          categoryRules,
          transactions: syncProjectedAllocations(categorizedUpdates),
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
          categoryRules,
          transactions: syncProjectedAllocations(
            applyCategoryRules(remainingTransactions, categoryRules),
          ),
          suppressedProjectionSources,
        }),
      );
      return ensureInstallmentProjections(next);
    }
    case "setTransactionNote": {
      const note = a.note.trim();
      return {
        ...s,
        transactions: s.transactions.map((transaction) => {
          if (transaction.id !== a.txId) return transaction;
          const updated = { ...transaction };
          if (note) updated.note = note;
          else delete updated.note;
          return updated;
        }),
      };
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
    case "addTransaction": {
      const categoryRules = a.transaction.category
        ? learnCategoryRule(
            s.categoryRules ?? DEFAULT_CATEGORY_RULES,
            a.transaction.description,
            a.transaction.category,
          )
        : (s.categoryRules ?? DEFAULT_CATEGORY_RULES);
      return ensureInstallmentProjections(
        normalizeInstallmentTransactions({
          ...s,
          categoryRules,
          transactions: applyCategoryRules([...s.transactions, a.transaction], categoryRules),
        }),
      );
    }
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
    case "upsertOtherAccountCategory": {
      const categories = withDefaultOtherAccountCategories(s.otherAccountCategories);
      const name = a.category.name.trim();
      const existing = categories.find((category) => category.id === a.category.id);
      if (
        !a.category.id.trim() ||
        !name ||
        existing?.builtIn ||
        categories.some(
          (category) =>
            category.id !== a.category.id &&
            category.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
        )
      )
        return s;
      const category = { ...a.category, name, builtIn: false };
      return { ...s, otherAccountCategories: upsert(categories, category) };
    }
    case "deleteOtherAccountCategory": {
      const categories = withDefaultOtherAccountCategories(s.otherAccountCategories);
      const category = categories.find((item) => item.id === a.categoryId);
      if (
        !category ||
        category.builtIn ||
        (s.otherAccounts ?? []).some((account) => account.categoryId === a.categoryId)
      )
        return s;
      return {
        ...s,
        otherAccountCategories: categories.filter((item) => item.id !== a.categoryId),
      };
    }
    case "upsertOtherAccount": {
      const categories = withDefaultOtherAccountCategories(s.otherAccountCategories);
      if (!isValidOtherAccount(a.account, categories)) return s;
      return {
        ...s,
        otherAccountCategories: categories,
        otherAccounts: upsert(s.otherAccounts ?? [], a.account),
      };
    }
    case "deleteOtherAccount":
      return {
        ...s,
        otherAccounts: (s.otherAccounts ?? []).filter((account) => account.id !== a.accountId),
      };
    case "setOtherAccountStatus": {
      const current = (s.otherAccounts ?? []).find((account) => account.id === a.accountId);
      if (!current || current.status === a.status) return s;
      return {
        ...s,
        otherAccounts: (s.otherAccounts ?? []).map((account) => {
          if (account.id !== a.accountId) return account;
          const updated: OtherAccount = { ...account, status: a.status };
          if (a.status === "paid") updated.paidAt = a.paidAt ?? new Date().toISOString().slice(0, 10);
          else delete updated.paidAt;
          return updated;
        }),
      };
    }
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
            importHistory: [
              ...(existing.importHistory ?? []),
              ...(a.invoice.importHistory ?? []),
            ],
            ...(existing.status === "paga"
              ? { status: "paga" as const, paidAt: existing.paidAt }
              : {}),
            ...(existing.payments !== undefined ? { payments: existing.payments } : {}),
          }
        : { ...a.invoice, importHistory: a.invoice.importHistory ?? [] };
      const categoryRules = learnFromTransactions(
        s.categoryRules ?? DEFAULT_CATEGORY_RULES,
        a.transactions,
      );
      const incoming = applyCategoryRules(
        a.transactions.map((transaction) => ({
          ...transaction,
          invoiceId: invoice.id,
        })),
        categoryRules,
      );
      const reconciled = reconcileImportedTransactions(s, invoice, incoming);
      const imported = {
        ...s,
        categoryRules,
        invoices: upsert(s.invoices, invoice),
        plans: s.plans.filter(
          (plan) =>
            plan.cardId !== invoice.cardId || planStatusAt(plan, invoice.month) !== "finalizado",
        ),
        transactions: [
          ...s.transactions.filter((transaction) => {
            if (transaction.invoiceId !== invoice.id && transaction.invoiceId !== a.invoice.id)
              return true;
            // Substitui apenas projeções previstas; lançamentos efetivamente importados/ajustados
            // permanecem se esta importação incluiu somente linhas novas ou ignorou duplicatas.
            return !transaction.isProjected;
          }),
          ...reconciled,
        ],
      };
      const projected = assignInitialCardholders(
        ensureInstallmentProjections(ensureRecurringProjections(imported)),
      );
      return {
        ...projected,
        transactions: projected.transactions.map((transaction) =>
          a.personOverrides && Object.hasOwn(a.personOverrides, transaction.id)
            ? { ...transaction, allocations: a.personOverrides[transaction.id]! }
            : transaction,
        ),
      };
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
    case "recordPersonPaymentBatch":
      return {
        ...s,
        payments: a.payments.reduce(
          (payments, payment) => upsert(payments, payment),
          s.payments ?? [],
        ),
      };
    case "removePersonPayment":
      return { ...s, payments: (s.payments ?? []).filter((payment) => payment.id !== a.paymentId) };
    case "clearPersonMonthPayments":
      return {
        ...s,
        payments: (s.payments ?? []).filter(
          (payment) => !(payment.personId === a.personId && payment.month === a.month),
        ),
      };
    case "markInvoicePaid": {
      const paid: FinanceState = {
        ...s,
        invoices: s.invoices.map((invoice) =>
          invoice.id === a.invoiceId ? { ...invoice, status: "paga", paidAt: a.paidAt } : invoice,
        ),
      };
      return ensureInstallmentProjections(prepareNextInvoice(paid, a.invoiceId));
    }
    case "markMonthInvoicesPaid": {
      const invoiceIds = s.invoices
        .filter((invoice) => invoice.month === a.month)
        .map((invoice) => invoice.id);
      let paid: FinanceState = {
        ...s,
        invoices: s.invoices.map((invoice) =>
          invoice.month === a.month
            ? { ...invoice, status: "paga" as const, paidAt: a.paidAt }
            : invoice,
        ),
      };
      for (const invoiceId of invoiceIds) {
        paid = ensureInstallmentProjections(prepareNextInvoice(paid, invoiceId));
      }
      return paid;
    }
    case "setTransactionCategory": {
      const selectedTransactions = s.transactions.filter((transaction) =>
        a.txIds.includes(transaction.id),
      );
      const categoryRules = a.category
        ? selectedTransactions.reduce(
            (rules, transaction) => learnCategoryRule(rules, transaction.description, a.category),
            s.categoryRules ?? DEFAULT_CATEGORY_RULES,
          )
        : (s.categoryRules ?? DEFAULT_CATEGORY_RULES);
      return {
        ...s,
        categoryRules,
        transactions: applyCategoryRules(
          s.transactions.map((transaction) =>
            a.txIds.includes(transaction.id)
              ? { ...transaction, category: a.category || undefined }
              : transaction,
          ),
          categoryRules,
        ),
      };
    }
    case "appendAudit":
      // Snapshots de desfazer são grandes: guardamos só nas 5 entradas mais recentes
      // para o documento sincronizado não crescer até estourar o tempo do banco.
      return {
        ...s,
        auditLog: [
          a.entry,
          ...(s.auditLog ?? []).map((entry) => {
            if (!a.entry.undo || !entry.redo) return entry;
            const cleared = { ...entry };
            delete cleared.redo;
            return cleared;
          }),
        ]
          .slice(0, 500)
          .map((entry, index) => {
            if (index < 5 || (!entry.undo && !entry.redo)) return entry;
            const light = { ...entry };
            delete light.undo;
            delete light.redo;
            return light;
          }),
      };
    case "dismissAlert":
      return {
        ...s,
        dismissedAlertIds: Array.from(new Set([...(s.dismissedAlertIds ?? []), a.alertId])),
      };
    case "dismissAllAlerts":
      return {
        ...s,
        dismissedAlertIds: Array.from(new Set([...(s.dismissedAlertIds ?? []), ...a.alertIds])),
      };
    case "undoAudit": {
      const entry = s.auditLog?.find((item) => item.id === a.auditId);
      if (!entry?.undo || entry.undoneAt) return s;
      const hasSnapshot = (field: keyof NonNullable<AuditEntry["undo"]>) =>
        Object.prototype.hasOwnProperty.call(entry.undo, field);
      return {
        ...s,
        ...(hasSnapshot("invoices") ? { invoices: entry.undo.invoices } : {}),
        ...(hasSnapshot("transactions") ? { transactions: entry.undo.transactions } : {}),
        ...(hasSnapshot("categoryRules") ? { categoryRules: entry.undo.categoryRules } : {}),
        ...(hasSnapshot("people") ? { people: entry.undo.people } : {}),
        ...(hasSnapshot("cards") ? { cards: entry.undo.cards } : {}),
        ...(hasSnapshot("plans") ? { plans: entry.undo.plans } : {}),
        ...(hasSnapshot("recurringCharges")
          ? { recurringCharges: entry.undo.recurringCharges }
          : {}),
        ...(hasSnapshot("settings") ? { settings: entry.undo.settings } : {}),
        ...(hasSnapshot("payments") ? { payments: entry.undo.payments } : {}),
        ...(hasSnapshot("spreadsheets") ? { spreadsheets: entry.undo.spreadsheets } : {}),
        ...(hasSnapshot("suppressedProjectionSources")
          ? { suppressedProjectionSources: entry.undo.suppressedProjectionSources }
          : {}),
        ...(hasSnapshot("otherAccountCategories")
          ? { otherAccountCategories: entry.undo.otherAccountCategories }
          : {}),
        ...(hasSnapshot("otherAccounts") ? { otherAccounts: entry.undo.otherAccounts } : {}),
        auditLog: s.auditLog?.map((item) =>
          item.id === a.auditId ? { ...item, undoneAt: new Date().toISOString() } : item,
        ),
      };
    }
    case "redoAudit": {
      const entry = s.auditLog?.find((item) => item.id === a.auditId);
      if (!entry?.redo || !entry.undoneAt) return s;
      const hasSnapshot = (field: keyof NonNullable<AuditEntry["redo"]>) =>
        Object.prototype.hasOwnProperty.call(entry.redo, field);
      return {
        ...s,
        ...(hasSnapshot("invoices") ? { invoices: entry.redo.invoices } : {}),
        ...(hasSnapshot("transactions") ? { transactions: entry.redo.transactions } : {}),
        ...(hasSnapshot("categoryRules") ? { categoryRules: entry.redo.categoryRules } : {}),
        ...(hasSnapshot("people") ? { people: entry.redo.people } : {}),
        ...(hasSnapshot("cards") ? { cards: entry.redo.cards } : {}),
        ...(hasSnapshot("plans") ? { plans: entry.redo.plans } : {}),
        ...(hasSnapshot("recurringCharges")
          ? { recurringCharges: entry.redo.recurringCharges }
          : {}),
        ...(hasSnapshot("settings") ? { settings: entry.redo.settings } : {}),
        ...(hasSnapshot("payments") ? { payments: entry.redo.payments } : {}),
        ...(hasSnapshot("spreadsheets") ? { spreadsheets: entry.redo.spreadsheets } : {}),
        ...(hasSnapshot("suppressedProjectionSources")
          ? { suppressedProjectionSources: entry.redo.suppressedProjectionSources }
          : {}),
        ...(hasSnapshot("otherAccountCategories")
          ? { otherAccountCategories: entry.redo.otherAccountCategories }
          : {}),
        ...(hasSnapshot("otherAccounts") ? { otherAccounts: entry.redo.otherAccounts } : {}),
        auditLog: s.auditLog?.map((item) => {
          if (item.id !== a.auditId) return item;
          const active = { ...item };
          delete active.undoneAt;
          return active;
        }),
      };
    }
    case "prepareNextInvoice":
      return ensureInstallmentProjections(prepareNextInvoice(s, a.invoiceId));
  }
}

export type FinanceSyncStatus = {
  phase: "checking" | "local" | "synced" | "saving" | "offline" | "error" | "conflict";
  message?: string;
};
type RemoteConflict = { state: FinanceState; revision: number };
type FinanceCtx = {
  state: FinanceState;
  dispatch: React.Dispatch<Action>;
  syncStatus: FinanceSyncStatus;
  retrySync: () => void;
  resolveSyncConflict: (choice: "useRemote" | "keepLocal") => void;
  legacyMigrationAvailable: boolean;
  migrateLegacyData: () => void;
} | null;
// Contexto único mesmo quando o arquivo é recarregado durante a edição.
const g = globalThis as unknown as { __financeCtx?: React.Context<FinanceCtx> };
const Ctx = g.__financeCtx ?? (g.__financeCtx = createContext<FinanceCtx>(null));
const anonymousStorageKey = `${STORAGE_KEY}:anonymous`;
const legacyMigrationMarker = (key: string) => `${key}:legacy-migration-pending`;
const userWorkspaceKey = (userId: string, ws: string) =>
  `${STORAGE_KEY}:user:${userId}:workspace:${ws}`;
const userWorkspacePointer = (userId: string) => `${STORAGE_KEY}:user:${userId}:workspace-id`;
const syncBaselineKey = (key: string) => `${key}:last-synced`;

function readLocalFinanceState(key: string): FinanceState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as FinanceState | null;
    return parsed && typeof parsed === "object" && Array.isArray(parsed.people) ? parsed : null;
  } catch {
    return null;
  }
}
function readSyncBaseline(key: string): string | null {
  try {
    return localStorage.getItem(syncBaselineKey(key));
  } catch {
    return null;
  }
}
function writeSyncBaseline(key: string, value: string): void {
  try {
    localStorage.setItem(syncBaselineKey(key), value);
  } catch {
    /* cache local indisponível */
  }
}
function hasFinanceContent(value: FinanceState | null): value is FinanceState {
  return !!value && [
    value.people, value.cards, value.invoices, value.transactions, value.plans,
    value.recurringCharges, value.spreadsheets ?? [], value.payments ?? [],
  ].some((items) => items.length > 0);
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createEmptyFinanceState);
  const [syncStatus, setSyncStatus] = useState<FinanceSyncStatus>({ phase: "checking" });
  const [legacyMigrationAvailable, setLegacyMigrationAvailable] = useState(false);
  const hydrated = useRef(false);
  const workspaceId = useRef<string | null>(null);
  const userId = useRef<string | null>(null);
  const storageKey = useRef<string | null>(null);
  const revision = useRef(0);
  const saveSequence = useRef(0);
  const lastSynced = useRef<string | null>(null);
  const remoteConflict = useRef<RemoteConflict | null>(null);
  const pendingLegacyMigration = useRef<FinanceState | null>(null);
  const stateRef = useRef(state);
  const retryRef = useRef<() => void>(() => undefined);
  const actorRef = useRef<AuditActor>({ id: "anonymous", name: "Usuário" });
  stateRef.current = state;

  const clearLegacyMigration = () => {
    pendingLegacyMigration.current = null;
    setLegacyMigrationAvailable(false);
    if (storageKey.current) {
      try {
        localStorage.removeItem(legacyMigrationMarker(storageKey.current));
      } catch {
        /* preserva o cache original */
      }
    }
  };

  const migrateLegacyData = () => {
    const ws = workspaceId.current;
    const key = storageKey.current;
    const candidate = pendingLegacyMigration.current;
    if (!candidate || !ws || !key) return;
    const local = stateRef.current;
    if (!local.settings.persist) {
      setSyncStatus({ phase: "local", message: "Ative a persistência local antes da migração manual." });
      return;
    }
    const payload = stableSerialize(local) === stableSerialize(createEmptyFinanceState())
      ? candidate
      : local;
    setSyncStatus({ phase: "saving", message: "Enviando o cache local após sua confirmação…" });
    void saveCloudState(ws, payload, revision.current).then((result) => {
      if (workspaceId.current !== ws) return;
      if (result.kind === "saved") {
        revision.current = result.revision;
        lastSynced.current = stableSerialize(payload);
        writeSyncBaseline(key, lastSynced.current);
        clearLegacyMigration();
        dispatch({ type: "hydrate", state: payload });
        setSyncStatus({ phase: "synced", message: "Migração concluída; o cache anterior foi preservado neste navegador." });
      } else if (result.kind === "conflict") {
        remoteConflict.current = { state: result.state, revision: result.revision };
        setSyncStatus({ phase: "conflict", message: "A nuvem mudou durante a migração. Escolha qual versão manter." });
      } else {
        setSyncStatus({ phase: "error", message: result.message });
      }
    }).catch((error: unknown) => setSyncStatus({ phase: "error", message: error instanceof Error ? error.message : "Falha ao migrar dados locais." }));
  };

  const resolveSyncConflict = (choice: "useRemote" | "keepLocal") => {
    const remote = remoteConflict.current;
    const ws = workspaceId.current;
    const key = storageKey.current;
    if (!remote || !ws || !key) return;
    if (choice === "useRemote") {
      revision.current = remote.revision;
      lastSynced.current = stableSerialize(remote.state);
      writeSyncBaseline(key, lastSynced.current);
      remoteConflict.current = null;
      clearLegacyMigration();
      dispatch({ type: "hydrate", state: remote.state });
      setSyncStatus({ phase: "synced", message: "Versão remota carregada." });
      return;
    }
    const local = pendingLegacyMigration.current ?? stateRef.current;
    setSyncStatus({ phase: "saving", message: "Salvando a versão deste dispositivo por CAS…" });
    void saveCloudState(ws, local, remote.revision).then((result) => {
      if (workspaceId.current !== ws) return;
      if (result.kind === "saved") {
        revision.current = result.revision;
        lastSynced.current = stableSerialize(local);
        writeSyncBaseline(key, lastSynced.current);
        remoteConflict.current = null;
        clearLegacyMigration();
        dispatch({ type: "hydrate", state: local });
        setSyncStatus({ phase: "synced", message: "Versão deste dispositivo sincronizada." });
      } else if (result.kind === "conflict") {
        remoteConflict.current = { state: result.state, revision: result.revision };
        setSyncStatus({ phase: "conflict", message: "A nuvem mudou novamente. Compare antes de escolher." });
      } else {
        setSyncStatus({ phase: "error", message: result.message });
      }
    }).catch((error: unknown) => setSyncStatus({ phase: "error", message: error instanceof Error ? error.message : "Falha ao resolver conflito." }));
  };

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeRemote = (ws: string) => {
      if (channel) void supabase.removeChannel(channel);
      channel = supabase.channel(`ws-state-${ws}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "workspace_state", filter: `workspace_id=eq.${ws}`,
        }, (payload) => {
          const row = payload.new as { data?: unknown; revision?: number } | null;
          if (!row?.data || typeof row.data !== "object" || Array.isArray(row.data) || typeof row.revision !== "number") return;
          const remote = row.data as FinanceState;
          const json = stableSerialize(remote);
          const localJson = stableSerialize(stateRef.current);
          if (json === localJson) {
            saveSequence.current++;
            revision.current = row.revision;
            lastSynced.current = json;
            if (storageKey.current) writeSyncBaseline(storageKey.current, json);
            remoteConflict.current = null;
            setSyncStatus({ phase: "synced" });
          } else if (lastSynced.current !== null && localJson !== lastSynced.current) {
            saveSequence.current++;
            remoteConflict.current = { state: remote, revision: row.revision };
            setSyncStatus({ phase: "conflict", message: "Outro dispositivo alterou os dados enquanto havia mudanças locais." });
          } else {
            saveSequence.current++;
            revision.current = row.revision;
            lastSynced.current = json;
            if (storageKey.current) writeSyncBaseline(storageKey.current, json);
            remoteConflict.current = null;
            dispatch({ type: "hydrate", state: remote });
            setSyncStatus({ phase: "synced", message: "Alterações de outro dispositivo recebidas." });
          }
        }).subscribe();
    };

    const loadFromCloud = async () => {
      const currentGeneration = ++generation;
      setSyncStatus({ phase: "checking" });
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled || currentGeneration !== generation) return;
        if (error) throw error;
        const session = data.session;
        if (!session) {
          workspaceId.current = null;
          userId.current = null;
          storageKey.current = anonymousStorageKey;
          revision.current = 0;
          lastSynced.current = null;
          const local = readLocalFinanceState(anonymousStorageKey) ?? readLocalFinanceState(STORAGE_KEY);
          dispatch({ type: "hydrate", state: local ?? createEmptyFinanceState() });
          hydrated.current = true;
          setLegacyMigrationAvailable(false);
          setSyncStatus({ phase: "local", message: local ? "Cache preservado neste navegador; sem sessão, nada é enviado à nuvem." : "Sem sessão autenticada; dados ficam somente neste navegador." });
          return;
        }

        if (userId.current !== session.user.id) {
          saveSequence.current++;
          pendingLegacyMigration.current = null;
          setLegacyMigrationAvailable(false);
          remoteConflict.current = null;
          workspaceId.current = null;
          storageKey.current = null;
          revision.current = 0;
          lastSynced.current = null;
          hydrated.current = false;
          // Não mostrar nem persistir dados de outra sessão durante o carregamento.
          dispatch({ type: "hydrate", state: createEmptyFinanceState() });
        }
        userId.current = session.user.id;
        actorRef.current = { id: session.user.id, name: actorNameFromUser(session.user) };
        let previousWorkspace: string | null = null;
        try { previousWorkspace = localStorage.getItem(userWorkspacePointer(session.user.id)); } catch { /* cache indisponível */ }
        const fallbackKey = previousWorkspace
          ? userWorkspaceKey(session.user.id, previousWorkspace)
          : `${STORAGE_KEY}:user:${session.user.id}:pending-workspace`;
        const workspace = await ensureWorkspace();
        if (cancelled || currentGeneration !== generation) return;
        if (workspace.workspaceId === null) {
          storageKey.current = fallbackKey;
          const local = readLocalFinanceState(fallbackKey);
          if (local) dispatch({ type: "hydrate", state: local });
          hydrated.current = true;
          setSyncStatus({ phase: "error", message: workspace.error });
          return;
        }

        const ws = workspace.workspaceId;
        workspaceId.current = ws;
        const key = userWorkspaceKey(session.user.id, ws);
        storageKey.current = key;
        try { localStorage.setItem(userWorkspacePointer(session.user.id), ws); } catch { /* cache indisponível */ }
        subscribeRemote(ws);
        const cloud = await loadCloudState(ws);
        if (cancelled || currentGeneration !== generation) return;
        const local = readLocalFinanceState(key);
        const legacy = readLocalFinanceState(STORAGE_KEY);
        const hasLegacy = hasFinanceContent(legacy);
        let migrationPending = false;
        try { migrationPending = localStorage.getItem(legacyMigrationMarker(key)) === "true"; } catch { /* ignore */ }

        if (cloud.kind === "loaded") {
          const cloudJson = stableSerialize(cloud.state);
          const baseline = readSyncBaseline(key);
          const decision = decideCachedState(local, cloud.state, baseline);
          if (migrationPending && local && stableSerialize(local) !== cloudJson) {
            pendingLegacyMigration.current = local;
            setLegacyMigrationAvailable(true);
            revision.current = cloud.revision;
            remoteConflict.current = { state: cloud.state, revision: cloud.revision };
            hydrated.current = true;
            dispatch({ type: "hydrate", state: local });
            setSyncStatus({ phase: "conflict", message: "Cache local pendente e nuvem diferem. Escolha qual versão usar." });
            return;
          }
          if (migrationPending) clearLegacyMigration();
          if (local && decision === "pushLocal") {
            revision.current = cloud.revision;
            lastSynced.current = cloudJson;
            hydrated.current = true;
            dispatch({ type: "hydrate", state: local });
            setSyncStatus({ phase: "saving", message: "Alterações offline detectadas; tentando sincronizar sem substituir dados mais recentes." });
            return;
          }
          if (local && decision === "conflict") {
            revision.current = cloud.revision;
            remoteConflict.current = { state: cloud.state, revision: cloud.revision };
            hydrated.current = true;
            dispatch({ type: "hydrate", state: local });
            setSyncStatus({ phase: "conflict", message: "Cache local e nuvem divergem. Escolha qual versão manter." });
            return;
          }
          revision.current = cloud.revision;
          lastSynced.current = cloudJson;
          writeSyncBaseline(key, cloudJson);
          remoteConflict.current = null;
          hydrated.current = true;
          dispatch({ type: "hydrate", state: cloud.state });
          setSyncStatus({ phase: "synced" });
          return;
        }
        if (cloud.kind === "error") {
          saveSequence.current++;
          workspaceId.current = null;
          if (channel) { void supabase.removeChannel(channel); channel = null; }
          const localFallback = local ?? createEmptyFinanceState();
          dispatch({ type: "hydrate", state: localFallback });
          hydrated.current = true;
          setSyncStatus({ phase: "error", message: cloud.message });
          return;
        }

        revision.current = 0;
        lastSynced.current = null;
        if (hasFinanceContent(local) || hasLegacy) {
          const migrationState = hasFinanceContent(local) ? local : legacy!;
          pendingLegacyMigration.current = migrationState;
          setLegacyMigrationAvailable(true);
          hydrated.current = true;
          try { localStorage.setItem(legacyMigrationMarker(key), "true"); } catch { /* legado preservado */ }
          dispatch({ type: "hydrate", state: migrationState });
          setSyncStatus({ phase: "local", message: "Cache local detectado. Ele não será enviado até você confirmar a migração." });
          return;
        }

        const initial = local ?? createEmptyFinanceState();
        dispatch({ type: "hydrate", state: initial });
        const saved = await saveCloudState(ws, initial, 0);
        if (cancelled || currentGeneration !== generation) return;
        hydrated.current = true;
        if (saved.kind === "saved") {
          revision.current = saved.revision;
          lastSynced.current = stableSerialize(initial);
          writeSyncBaseline(key, lastSynced.current);
          setSyncStatus({ phase: "synced", message: "Workspace privado inicializado sem dados de demonstração." });
        } else if (saved.kind === "conflict") {
          remoteConflict.current = { state: saved.state, revision: saved.revision };
          setSyncStatus({ phase: "conflict", message: "Outro dispositivo inicializou o workspace. Escolha a versão a manter." });
        } else {
          setSyncStatus({ phase: "error", message: saved.message });
        }
      } catch (error) {
        if (cancelled || currentGeneration !== generation) return;
        const uid = userId.current;
        let pointer: string | null = null;
        try { pointer = uid ? localStorage.getItem(userWorkspacePointer(uid)) : null; } catch { /* ignore */ }
        const fallbackKey = uid && pointer ? userWorkspaceKey(uid, pointer) : anonymousStorageKey;
        storageKey.current = fallbackKey;
        const local = readLocalFinanceState(fallbackKey) ?? createEmptyFinanceState();
        dispatch({ type: "hydrate", state: local });
        hydrated.current = true;
        setSyncStatus({ phase: "error", message: error instanceof Error ? error.message : "Supabase indisponível; cache local preservado, nenhuma gravação remota foi simulada." });
      }
    };

    retryRef.current = () => { void loadFromCloud(); };
    void loadFromCloud();
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      subscription = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          generation++;
          saveSequence.current++;
          workspaceId.current = null;
          userId.current = null;
          storageKey.current = anonymousStorageKey;
          revision.current = 0;
          lastSynced.current = null;
          remoteConflict.current = null;
          pendingLegacyMigration.current = null;
          setLegacyMigrationAvailable(false);
          if (channel) { void supabase.removeChannel(channel); channel = null; }
          dispatch({ type: "hydrate", state: readLocalFinanceState(anonymousStorageKey) ?? createEmptyFinanceState() });
          setSyncStatus({ phase: "local", message: "Sessão encerrada; cache da conta preservado e isolado." });
        } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          void loadFromCloud();
        }
      }).data.subscription;
    } catch {
      hydrated.current = true;
      setSyncStatus({ phase: "error", message: "Supabase não configurado. A sincronização está desativada; dados locais continuam disponíveis." });
    }
    const onOffline = () => setSyncStatus({ phase: "offline", message: "Sem conexão. Alterações ficam no cache separado desta conta." });
    const onOnline = () => { void loadFromCloud(); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      generation++;
      subscription?.unsubscribe();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const key = storageKey.current;
    if (key) {
      try {
        if (state.settings.persist) localStorage.setItem(key, JSON.stringify(state));
        else localStorage.removeItem(key);
      } catch { /* cache local indisponível */ }
    }
    const ws = workspaceId.current;
    if (!ws || !state.settings.persist || remoteConflict.current !== null || pendingLegacyMigration.current !== null) return;
    const json = stableSerialize(state);
    if (json === lastSynced.current) return;
    const timer = setTimeout(() => {
      if (workspaceId.current !== ws) return;
      const requestSequence = ++saveSequence.current;
      setSyncStatus({ phase: "saving" });
      void saveCloudState(ws, state, revision.current).then((result) => {
        if (workspaceId.current !== ws || requestSequence !== saveSequence.current) return;
        if (result.kind === "saved") {
          revision.current = result.revision;
          lastSynced.current = json;
          if (storageKey.current) writeSyncBaseline(storageKey.current, json);
          setSyncStatus(
            stableSerialize(stateRef.current) === json
              ? { phase: "synced" }
              : { phase: "saving", message: "A alteração mais recente ainda está aguardando sincronização." },
          );
        } else if (result.kind === "conflict") {
          remoteConflict.current = { state: result.state, revision: result.revision };
          setSyncStatus({ phase: "conflict", message: "Há alterações de outro dispositivo. Compare e escolha uma versão." });
        } else {
          setSyncStatus({ phase: "error", message: result.message });
        }
      }).catch((error: unknown) => {
        if (workspaceId.current !== ws || requestSequence !== saveSequence.current) return;
        setSyncStatus({ phase: "error", message: error instanceof Error ? error.message : "Falha ao sincronizar dados." });
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [state]);

  const auditedDispatch: React.Dispatch<Action> = (action) => {
    const before = stateRef.current;
    const next = reducer(before, action);
    let entry = auditForAction(action, before, actorRef.current);
    if (entry?.undo && next !== before) {
      entry = { ...entry, redo: undoSnapshot(next, snapshotFields(entry.undo)) };
    }
    dispatch(action);
    if (entry) dispatch({ type: "appendAudit", entry });
  };

  return (
    <Ctx.Provider value={{
      state, dispatch: auditedDispatch, syncStatus, retrySync: () => retryRef.current(),
      resolveSyncConflict, legacyMigrationAvailable, migrateLegacyData,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFinance() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance fora do FinanceProvider");
  return v;
}
