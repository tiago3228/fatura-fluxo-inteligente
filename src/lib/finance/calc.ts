import { round2 } from "./format";
import type {
  CreditCard,
  FinanceState,
  InstallmentPlan,
  Invoice,
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

export const recurringChargeAppliesAt = (charge: RecurringCharge, month: string) =>
  month >= charge.startMonth && (!charge.cancelledFromMonth || month < charge.cancelledFromMonth);

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
  const representedPlanIds = new Set(
    committedTransactions
      .map((transaction) => transaction.planId)
      .filter((planId): planId is string => Boolean(planId)),
  );
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
  const plans = s.plans.reduce((sum, p) => {
    const f = planFutureCommitted(p, month);
    if (!personId) return sum + f;
    const share = p.shares.find((x) => x.personId === personId)?.pct ?? 0;
    return sum + (f * share) / 100;
  }, 0);
  const projectedDescriptionInstallments = s.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "parcela" || transaction.planId || transaction.amount <= 0) return sum;
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

/** Divide um valor em partes iguais preservando centavos (resto vai para a primeira parte) */
export const splitEqually = (amount: number, n: number) => {
  const cents = Math.round(amount * 100);
  const base = Math.trunc(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? rest : 0)) / 100);
};
