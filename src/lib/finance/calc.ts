import { round2 } from "./format";
import type {
  Allocation,
  CreditCard,
  FinanceState,
  InstallmentPlan,
  Invoice,
  PlanShare,
  RecurringCharge,
  Transaction,
  TxType,
} from "./types";

export const TX_TYPE_LABEL: Record<TxType, string> = {
  compra: "Compra",
  parcela: "Parcela",
  pagamento: "Pagamento",
  credito: "Crédito",
  estorno: "Estorno",
  tarifa: "Tarifa/encargo",
  ajuste: "Ajuste",
};

export const isCreditType = (t: TxType) => t === "credito" || t === "estorno";

/* ---------- Meses ---------- */
export const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthDiff = (a: string, b: string) => {
  const ya = Number(a.slice(0, 4));
  const ma = Number(a.slice(5, 7));
  const yb = Number(b.slice(0, 4));
  const mb = Number(b.slice(5, 7));
  return (yb - ya) * 12 + (mb - ma);
};
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Data com o dia limitado ao último dia do mês (ex.: dia 31 em fevereiro → 28/29) */
export const dateInMonth = (ym: string, day: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = Math.min(day, daysInMonth(y, m));
  return `${ym}-${String(d).padStart(2, "0")}`;
};

export type InstallmentReference = { number: number; total: number };

type InstallmentDescriptionMatch = InstallmentReference & {
  index: number;
  end: number;
  separator: string;
};

const installmentPattern = /(?:^|([^\d]))(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g;

const findInstallmentDescriptionMatch = (
  description: string,
): InstallmentDescriptionMatch | null => {
  let found: InstallmentDescriptionMatch | null = null;
  const pattern = new RegExp(installmentPattern.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(description)) !== null) {
    const number = Number(match[2]);
    const total = Number(match[3]);
    if (number >= 1 && total >= number) {
      found = {
        number,
        total,
        index: match.index,
        end: pattern.lastIndex,
        separator: match[1] ?? "",
      };
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
};

/** Reconhece n/total em descrições antigas, inclusive quando colado ao nome do estabelecimento. */
export const installmentReferenceFromDescription = (
  description: string,
): InstallmentReference | null => {
  const match = findInstallmentDescriptionMatch(description);
  return match ? { number: match.number, total: match.total } : null;
};

export const stripInstallmentReference = (description: string) => {
  const match = findInstallmentDescriptionMatch(description);
  return match
    ? `${description.slice(0, match.index)}${match.separator}${description.slice(match.end)}`.trim()
    : description;
};

export const replaceInstallmentReference = (
  description: string,
  reference: InstallmentReference,
) => {
  const match = findInstallmentDescriptionMatch(description);
  const replacement = `${reference.number}/${reference.total}`;
  if (!match) return `${description} ${replacement}`;
  const prefix = `${description.slice(0, match.index)}${match.separator}`;
  return `${prefix}${replacement}${description.slice(match.end)}`;
};

export const nextOccurrence = (day: number, from: Date = new Date()) => {
  const ym = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
  const today = `${ym}-${String(from.getDate()).padStart(2, "0")}`;
  const candidate = dateInMonth(ym, day);
  return candidate >= today ? candidate : dateInMonth(addMonths(ym, 1), day);
};

/* ---------- Lançamentos ---------- */
export type TxStatus = "pendente" | "atribuida" | "dividida" | "nao_aplica";

export const allocatedSum = (tx: Transaction) =>
  round2(tx.allocations.reduce((s, a) => s + a.amount, 0));

export const txStatus = (tx: Transaction): TxStatus => {
  if (tx.type === "pagamento") return "nao_aplica";
  if (tx.allocations.length === 0) return "pendente";
  return tx.allocations.length > 1 ? "dividida" : "atribuida";
};

export const invoiceOf = (s: FinanceState, tx: Transaction) =>
  s.invoices.find((i) => i.id === tx.invoiceId);
export const cardOf = (s: FinanceState, cardId: string) => s.cards.find((c) => c.id === cardId);
export const txCard = (s: FinanceState, tx: Transaction): CreditCard | undefined => {
  const inv = invoiceOf(s, tx);
  return inv ? cardOf(s, inv.cardId) : undefined;
};
export const txMonth = (s: FinanceState, tx: Transaction) => invoiceOf(s, tx)?.month ?? "";

export const invoiceTxs = (s: FinanceState, invoiceId: string) =>
  s.transactions.filter((t) => t.invoiceId === invoiceId);

export const invoiceHasFinancialData = (s: FinanceState, invoice: Invoice) =>
  invoice.officialTotal !== 0 ||
  invoiceTxs(s, invoice.id).length > 0 ||
  (invoice.payments ?? []).some((payment) => payment.amount !== 0);

/** Soma dos lançamentos da fatura (pagamentos de faturas anteriores não entram) */
export const invoiceLaunchesTotal = (s: FinanceState, inv: Invoice) =>
  round2(
    invoiceTxs(s, inv.id)
      .filter((t) => t.type !== "pagamento")
      .reduce((a, t) => a + t.amount, 0),
  );

export const invoiceDiff = (s: FinanceState, inv: Invoice) =>
  round2(inv.officialTotal - invoiceLaunchesTotal(s, inv));

export const invoiceAllocatedTotal = (s: FinanceState, inv: Invoice) =>
  round2(invoiceTxs(s, inv.id).reduce((a, t) => a + allocatedSum(t), 0));

export const invoicePendingCount = (s: FinanceState, inv: Invoice) =>
  invoiceTxs(s, inv.id).filter((t) => txStatus(t) === "pendente").length;

export const monthInvoices = (s: FinanceState, month: string) =>
  s.invoices.filter((i) => i.month === month);
export const monthTxs = (s: FinanceState, month: string) => {
  const ids = new Set(monthInvoices(s, month).map((i) => i.id));
  return s.transactions.filter((t) => ids.has(t.invoiceId));
};

/**
 * Valor comprometido no cartão: faturas não pagas e parcelas futuras já conhecidas.
 * Faturas previstas não incluem cobranças recorrentes que ainda não foram realizadas.
 */
export const cardLimitUsed = (s: FinanceState, cardId: string) =>
  round2(
    s.invoices
      .filter((invoice) => invoice.cardId === cardId && invoice.status !== "paga")
      .reduce((sum, invoice) => {
        const isForecast = invoice.source === "planilha" && invoice.id.includes("_next_");
        if (!isForecast)
          return sum + Math.max(invoice.officialTotal, invoiceLaunchesTotal(s, invoice));
        return (
          sum +
          s.transactions
            .filter(
              (transaction) =>
                transaction.invoiceId === invoice.id &&
                transaction.type !== "pagamento" &&
                transaction.recurringChargeId === undefined,
            )
            .reduce((total, transaction) => total + transaction.amount, 0)
        );
      }, 0),
  );

export const cardLimitAvailable = (s: FinanceState, cardId: string) => {
  const limit = s.cards.find((card) => card.id === cardId)?.creditLimit;
  return limit === undefined ? null : round2(limit - cardLimitUsed(s, cardId));
};

/** Soma os compromissos de todos os cartões para o limite compartilhado. */
export const totalCardLimitUsed = (s: FinanceState) =>
  round2(s.cards.reduce((sum, card) => sum + cardLimitUsed(s, card.id), 0));

/** Usa o limite unificado salvo; em estados antigos, soma os limites por cartão existentes. */
export const totalCardLimit = (s: FinanceState): number | null => {
  if (s.settings.cardLimitTotal !== undefined) return s.settings.cardLimitTotal;
  const legacyTotal = round2(s.cards.reduce((sum, card) => sum + (card.creditLimit ?? 0), 0));
  return legacyTotal > 0 ? legacyTotal : null;
};

export const totalCardLimitAvailable = (s: FinanceState) => {
  const limit = totalCardLimit(s);
  return limit === null ? null : round2(limit - totalCardLimitUsed(s));
};

export const availableMonths = (s: FinanceState) =>
  Array.from(new Set([...s.invoices.map((i) => i.month), s.settings.month]))
    .sort()
    .reverse();

/* ---------- Pessoas / limites ---------- */
export const personMonthTotal = (s: FinanceState, personId: string, month: string) =>
  round2(
    monthTxs(s, month).reduce(
      (sum, t) =>
        sum +
        t.allocations.filter((a) => a.personId === personId).reduce((x, a) => x + a.amount, 0),
      0,
    ),
  );

/** Saldo do orçamento mensal da pessoa; null indica que não há limite configurado. */
export const personMonthLimitAvailable = (
  s: FinanceState,
  personId: string,
  month: string,
): number | null => {
  const person = s.people.find((item) => item.id === personId);
  if (!person || person.limit <= 0) return null;
  return Math.max(0, round2(person.limit - personMonthTotal(s, personId, month)));
};

export const sortPeopleBySpending = <T extends { total: number }>(people: T[]) =>
  [...people].sort((a, b) => b.total - a.total);

export const personMonthPaid = (s: FinanceState, personId: string, month: string) =>
  round2(
    (s.payments ?? [])
      .filter((payment) => payment.personId === personId && payment.month === month)
      .reduce((sum, payment) => sum + payment.amount, 0),
  );

export const personMonthRemaining = (s: FinanceState, personId: string, month: string) =>
  Math.max(0, round2(personMonthTotal(s, personId, month) - personMonthPaid(s, personId, month)));

/**
 * Saldo total ainda devido, somando o restante de cada competência separadamente.
 * Assim, um pagamento de novembro não é reaplicado sobre dezembro nem sobre meses
 * anteriores, e cada obrigação é abatida no máximo uma vez.
 */
export const personTotalDue = (s: FinanceState, personId: string) =>
  round2(
    [...new Set(s.invoices.map((invoice) => invoice.month))].reduce(
      (sum, month) => sum + personMonthRemaining(s, personId, month),
      0,
    ),
  );

/** Compatibilidade com relatórios e integrações que ainda usam o nome anterior. */
export const personDebtTotal = personTotalDue;

export type PersonPaymentStatus = "pendente" | "parcial" | "pago";
export const personPaymentStatus = (
  s: FinanceState,
  personId: string,
  month: string,
): PersonPaymentStatus => {
  const due = personMonthTotal(s, personId, month);
  const paid = personMonthPaid(s, personId, month);
  if (due > 0 && paid >= due) return "pago";
  if (paid > 0) return "parcial";
  return "pendente";
};

export type LimitStatus = "normal" | "atencao" | "atingido" | "ultrapassado";

export const limitStatus = (total: number, limit: number, warnPct = 80): LimitStatus => {
  if (limit <= 0) return "normal";
  const t = round2(total);
  if (t > limit) return "ultrapassado";
  if (t === round2(limit)) return "atingido";
  if ((t / limit) * 100 >= warnPct) return "atencao";
  return "normal";
};

export const limitPct = (total: number, limit: number) => (limit > 0 ? (total / limit) * 100 : 0);

export const limitMessage = (name: string, total: number, limit: number, warnPct = 80) => {
  const st = limitStatus(total, limit, warnPct);
  const first = name.split(" ")[0];
  if (st === "ultrapassado")
    return `${first} ultrapassou o limite mensal em ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(round2(total - limit))}.`;
  if (st === "atingido") return `O limite mensal de ${first} foi atingido.`;
  if (st === "atencao")
    return `${first} utilizou ${Math.round(limitPct(total, limit))}% do limite mensal.`;
  return null;
};

/* ---------- Parcelamentos ---------- */
export type PlanStatus = "ativo" | "finalizado" | "futuro";

export const planNumberAt = (p: InstallmentPlan, month: string) =>
  monthDiff(p.firstMonth, month) + 1;
export const planCount = (p: InstallmentPlan) => p.amounts.length;
export const planStatusAt = (p: InstallmentPlan, month: string): PlanStatus => {
  const n = planNumberAt(p, month);
  if (n < 1) return "futuro";
  if (n > planCount(p)) return "finalizado";
  return "ativo";
};

export const filterInstallmentPlanEntries = <T extends { plan: InstallmentPlan }>(
  entries: T[],
  month: string,
  filters: { personId?: string; cardId?: string; status?: string } = {},
) =>
  entries.filter(
    ({ plan }) =>
      (!filters.cardId || plan.cardId === filters.cardId) &&
      (!filters.personId || plan.shares.some((share) => share.personId === filters.personId)) &&
      (!filters.status || planStatusAt(plan, month) === filters.status),
  );

export const planAmountAt = (p: InstallmentPlan, month: string) => {
  const n = planNumberAt(p, month);
  return n >= 1 && n <= planCount(p) ? p.amounts[n - 1] : 0;
};
/** Parcelas após o mês de referência (não inclui a parcela já lançada no mês) */
export const planRemainingCount = (p: InstallmentPlan, month: string) =>
  Math.max(0, planCount(p) - Math.max(0, planNumberAt(p, month)));
export const planFutureCommitted = (p: InstallmentPlan, month: string) => {
  const n = Math.max(0, planNumberAt(p, month));
  return round2(p.amounts.slice(n).reduce((a, b) => a + b, 0));
};
export const planNextMonth = (p: InstallmentPlan, month: string) =>
  planRemainingCount(p, month) > 0
    ? planNumberAt(p, month) < 1
      ? p.firstMonth
      : addMonths(month, 1)
    : null;

export interface DetectedInstallmentPlan {
  plan: InstallmentPlan;
  estimated: boolean;
}

type DetectedInstallmentTransaction = {
  transaction: Transaction;
  cardId: string;
  number: number;
  total: number;
  startMonth: string;
  description: string;
  descriptionKey: string;
};

const normalizedInstallmentDescription = (description: string) =>
  stripInstallmentReference(description)
    .replace(/^\s*\d{1,2}\/\d{1,2}\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

/** Detecta compras parceladas lançadas nas faturas e as apresenta como planos inferidos. */
export const detectedInstallmentPlans = (s: FinanceState): DetectedInstallmentPlan[] => {
  const groups = new Map<string, DetectedInstallmentTransaction[]>();
  const registeredPlanIds = new Set(s.plans.map((plan) => plan.id));

  for (const transaction of s.transactions) {
    if (
      transaction.amount <= 0 ||
      (transaction.planId && registeredPlanIds.has(transaction.planId))
    )
      continue;
    const structuredReference =
      Number.isInteger(transaction.installmentNumber) &&
      Number.isInteger(transaction.installmentTotal) &&
      transaction.installmentNumber! >= 1 &&
      transaction.installmentTotal! >= transaction.installmentNumber!
        ? { number: transaction.installmentNumber!, total: transaction.installmentTotal! }
        : null;
    const reference =
      structuredReference ?? installmentReferenceFromDescription(transaction.description);
    if (!reference || reference.total < 2) continue;

    const invoice = invoiceOf(s, transaction);
    if (!invoice || !cardOf(s, invoice.cardId)) continue;
    const description = stripInstallmentReference(transaction.description)
      .replace(/^\s*\d{1,2}\/\d{1,2}\s*/, "")
      .trim();
    const descriptionKey = normalizedInstallmentDescription(transaction.description);
    const startMonth = addMonths(invoice.month, 1 - reference.number);
    const item: DetectedInstallmentTransaction = {
      transaction,
      cardId: invoice.cardId,
      number: reference.number,
      total: reference.total,
      startMonth,
      description: description || transaction.description,
      descriptionKey,
    };
    const key = JSON.stringify([item.cardId, item.startMonth, item.total, item.descriptionKey]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const detected: DetectedInstallmentPlan[] = [];
  for (const items of groups.values()) {
    const first = items[0];
    if (!first) continue;
    const registeredCount = s.plans.filter(
      (plan) =>
        plan.cardId === first.cardId &&
        plan.firstMonth === first.startMonth &&
        plan.amounts.length === first.total &&
        normalizedInstallmentDescription(plan.description) === first.descriptionKey,
    ).length;

    const byNumber = new Map<number, DetectedInstallmentTransaction[]>();
    for (const item of items) {
      const matching = byNumber.get(item.number) ?? [];
      matching.push(item);
      matching.sort(
        (a, b) =>
          a.transaction.date.localeCompare(b.transaction.date) ||
          a.transaction.id.localeCompare(b.transaction.id),
      );
      byNumber.set(item.number, matching);
    }
    const parallelPurchases = Math.max(...[...byNumber.values()].map((rows) => rows.length));

    for (let purchaseIndex = 0; purchaseIndex < parallelPurchases; purchaseIndex += 1) {
      if (purchaseIndex < registeredCount) continue;
      const rows = [...byNumber.values()]
        .map((numberRows) => numberRows[purchaseIndex])
        .filter((item): item is DetectedInstallmentTransaction => item !== undefined)
        .sort((a, b) => a.number - b.number);
      const firstRow = rows[0];
      if (!firstRow) continue;

      const knownAmounts = new Map(
        rows.map((item) => [item.number, round2(item.transaction.amount)]),
      );
      const knownAmountValues = [...knownAmounts.values()];
      const fallbackAmount = round2(
        knownAmountValues.reduce((sum, amount) => sum + amount, 0) / knownAmountValues.length,
      );
      const amounts = Array.from(
        { length: firstRow.total },
        (_, index) => knownAmounts.get(index + 1) ?? fallbackAmount,
      );
      const shareTransaction =
        rows.find((item) =>
          item.transaction.allocations.some((allocation) => allocation.amount > 0),
        )?.transaction ?? firstRow.transaction;
      const allocated = shareTransaction.allocations.filter((allocation) => allocation.amount > 0);
      const allocatedTotal = allocated.reduce((sum, allocation) => sum + allocation.amount, 0);
      const shares = allocatedTotal
        ? allocated.map((allocation) => ({
            personId: allocation.personId,
            pct: (allocation.amount / allocatedTotal) * 100,
          }))
        : [];
      const lastShare = shares.at(-1);
      if (lastShare) {
        lastShare.pct = round2(
          100 - shares.slice(0, -1).reduce((sum, share) => sum + share.pct, 0),
        );
      }
      const firstInstallment = rows.find((item) => item.number === 1);

      detected.push({
        estimated: knownAmounts.size < firstRow.total,
        plan: {
          id: `detected_${rows.map((item) => item.transaction.id).sort()[0]}`,
          description: firstRow.description,
          cardId: firstRow.cardId,
          purchaseDate: firstInstallment?.transaction.date ?? `${firstRow.startMonth}-01`,
          total: round2(amounts.reduce((sum, amount) => sum + amount, 0)),
          amounts,
          firstMonth: firstRow.startMonth,
          shares,
        },
      });
    }
  }

  return detected.sort(
    (a, b) =>
      a.plan.description.localeCompare(b.plan.description, "pt-BR") ||
      a.plan.firstMonth.localeCompare(b.plan.firstMonth),
  );
};

export const recurringChargeAppliesAt = (charge: RecurringCharge, month: string) =>
  month >= charge.startMonth && (!charge.cancelledFromMonth || month < charge.cancelledFromMonth);

/**
 * Encontra correspondências estritas entre parcelas da fatura sem planId e planos cadastrados.
 * Cada plano pode representar no máximo uma linha por número de parcela; linhas extras continuam
 * contabilizadas como compras independentes.
 */
const matchUnlinkedInstallmentsToPlans = (s: FinanceState, transactions: Transaction[]) => {
  const transactionIds = new Set<string>();
  const planIds = new Set<string>();
  const usedPlanInstallments = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.type !== "parcela" || transaction.amount <= 0) continue;
    if (transaction.planId && s.plans.some((plan) => plan.id === transaction.planId)) continue;
    const invoice = invoiceOf(s, transaction);
    if (!invoice) continue;
    const reference =
      Number.isInteger(transaction.installmentNumber) &&
      Number.isInteger(transaction.installmentTotal) &&
      transaction.installmentNumber! >= 1 &&
      transaction.installmentTotal! >= transaction.installmentNumber!
        ? { number: transaction.installmentNumber!, total: transaction.installmentTotal! }
        : installmentReferenceFromDescription(transaction.description);
    if (!reference) continue;

    const plan = s.plans.find((candidate) => {
      const slot = `${candidate.id}:${reference.number}`;
      return (
        !usedPlanInstallments.has(slot) &&
        candidate.cardId === invoice.cardId &&
        candidate.amounts.length === reference.total &&
        planNumberAt(candidate, invoice.month) === reference.number &&
        round2(planAmountAt(candidate, invoice.month) ?? 0) === round2(transaction.amount) &&
        normalizedInstallmentDescription(candidate.description) ===
          normalizedInstallmentDescription(transaction.description)
      );
    });
    if (!plan) continue;
    usedPlanInstallments.add(`${plan.id}:${reference.number}`);
    transactionIds.add(transaction.id);
    planIds.add(plan.id);
  }

  return { transactionIds, planIds };
};

/**
 * Soma os compromissos conhecidos de uma competência.
 * Parcelas já materializadas nas faturas têm prioridade; planos e recorrências
 * só entram como previsão quando ainda não existe seu lançamento correspondente.
 */
export const committedMonthTotal = (s: FinanceState, month: string, personId?: string) => {
  const committedTransactions = monthTxs(s, month).filter(
    (transaction) =>
      transaction.amount > 0 &&
      (transaction.type === "parcela" || transaction.recurringChargeId !== undefined),
  );
  const inferredMatches = matchUnlinkedInstallmentsToPlans(s, committedTransactions);
  const representedPlanIds = new Set(
    committedTransactions
      .map((transaction) => transaction.planId)
      .filter((planId): planId is string => Boolean(planId)),
  );
  for (const planId of inferredMatches.planIds) representedPlanIds.add(planId);
  const representedRecurringIds = new Set(
    committedTransactions
      .map((transaction) => transaction.recurringChargeId)
      .filter((chargeId): chargeId is string => Boolean(chargeId)),
  );
  const transactionValue = committedTransactions.reduce((sum, transaction) => {
    if (!personId) return sum + transaction.amount;
    return (
      sum +
      transaction.allocations
        .filter((allocation) => allocation.personId === personId)
        .reduce((part, allocation) => part + allocation.amount, 0)
    );
  }, 0);
  const planValue = s.plans.reduce((sum, plan) => {
    if (representedPlanIds.has(plan.id)) return sum;
    const amount = planAmountAt(plan, month);
    if (!amount) return sum;
    if (!personId) return sum + amount;
    return (
      sum + (amount * (plan.shares.find((share) => share.personId === personId)?.pct ?? 0)) / 100
    );
  }, 0);
  const recurringValue = (s.recurringCharges ?? []).reduce((sum, charge) => {
    if (representedRecurringIds.has(charge.id) || !recurringChargeAppliesAt(charge, month))
      return sum;
    if (!personId) return sum + charge.amount;
    return (
      sum +
      (charge.amount * (charge.shares.find((share) => share.personId === personId)?.pct ?? 0)) / 100
    );
  }, 0);
  return round2(transactionValue + planValue + recurringValue);
};

export const forecast = (s: FinanceState, fromMonth: string, months = 6, personId?: string) =>
  Array.from({ length: months }, (_, i) => {
    const m = addMonths(fromMonth, i + 1);
    return { month: m, value: committedMonthTotal(s, m, personId) };
  });

export const totalFutureCommitted = (s: FinanceState, month: string, personId?: string) => {
  const projectedDescriptionTransactions = s.transactions.filter((transaction) => {
    if (transaction.type !== "parcela" || transaction.planId || transaction.amount <= 0)
      return false;
    const invoice = invoiceOf(s, transaction);
    return Boolean(invoice && invoice.month > month);
  });
  const inferredMatches = matchUnlinkedInstallmentsToPlans(s, projectedDescriptionTransactions);
  const plans = s.plans.reduce((sum, p) => {
    const f = planFutureCommitted(p, month);
    if (!personId) return sum + f;
    const share = p.shares.find((x) => x.personId === personId)?.pct ?? 0;
    return sum + (f * share) / 100;
  }, 0);
  const projectedDescriptionInstallments = s.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "parcela" || transaction.planId || transaction.amount <= 0) return sum;
    if (inferredMatches.transactionIds.has(transaction.id)) return sum;
    const invoice = invoiceOf(s, transaction);
    if (!invoice || invoice.month <= month) return sum;
    if (!personId) return sum + transaction.amount;
    return (
      sum +
      transaction.allocations
        .filter((allocation) => allocation.personId === personId)
        .reduce((part, allocation) => part + allocation.amount, 0)
    );
  }, 0);
  return round2(plans + projectedDescriptionInstallments);
};

/** Rateia em centavos e ajusta o último participante para preservar o total exato. */
export const allocateByPercent = (amount: number, shares: PlanShare[]): Allocation[] => {
  if (shares.length === 0) return [];
  const weights = shares.map((share) => Math.max(0, share.pct));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) return [];

  const totalCents = Math.round(amount * 100);
  let assignedCents = 0;
  return shares.map((share, index) => {
    const cents =
      index === shares.length - 1
        ? totalCents - assignedCents
        : Math.round((totalCents * (weights[index] ?? 0)) / totalWeight);
    assignedCents += cents;
    return { personId: share.personId, amount: cents / 100 };
  });
};

/** Divide um valor em partes iguais preservando centavos (resto vai para a primeira parte) */
export const splitEqually = (amount: number, n: number) => {
  const cents = Math.round(amount * 100);
  const base = Math.trunc(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? rest : 0)) / 100);
};
