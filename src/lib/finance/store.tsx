import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureWorkspace, loadCloudState, saveCloudState } from "./cloud";
import { createDemoState } from "./mock";
import { planStatusAt } from "./calc";
import type {
  Allocation, CreditCard, FinanceState, InstallmentPlan, Invoice, Person, Settings, Transaction, TxType,
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
  | { type: "updateTransaction"; txId: string; patch: { description: string; date: string; amount: number; installmentNumber: number | null; installmentTotal: number | null } }
  | { type: "deleteTransaction"; txId: string }
  | { type: "addTransaction"; transaction: Transaction }
  | { type: "setTxType"; txId: string; txType: TxType }
  | { type: "upsertPerson"; person: Person }
  | { type: "deletePerson"; personId: string }
  | { type: "upsertCard"; card: CreditCard }
  | { type: "upsertPlan"; plan: InstallmentPlan }
  | { type: "deletePlan"; planId: string }
  | { type: "importInvoice"; invoice: Invoice; transactions: Transaction[] }
  | { type: "setInvoicePayments"; invoiceId: string; payments: NonNullable<Invoice["payments"]> }
  | { type: "setInvoiceStatus"; invoiceId: string; status: Invoice["status"] };

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

const transactionMatchKey = (transaction: Pick<Transaction, "description" | "amount">) =>
  `${transaction.description.toLowerCase().replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()}|${transaction.amount.toFixed(2)}`;

const previousInvoiceFor = (state: FinanceState, invoice: Invoice) =>
  state.invoices
    .filter((candidate) => candidate.cardId === invoice.cardId && candidate.id !== invoice.id && candidate.month <= invoice.month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];

/** Recupera o cartão 0548 da fatura real quando uma versão local antiga não o tinha. */
const ensure0548 = (state: FinanceState): FinanceState => {
  const baseline = createDemoState();
  const baselineCard = baseline.cards.find((card) => card.id === "c_0548");
  const baselineInvoice = baseline.invoices.find((invoice) => invoice.cardId === "c_0548");
  if (!baselineCard || !baselineInvoice) return state;

  const cards = state.cards.some((card) => card.id === baselineCard.id) ? state.cards : [...state.cards, baselineCard];
  const invoices = state.invoices.some((invoice) => invoice.id === baselineInvoice.id) ? state.invoices : [...state.invoices, baselineInvoice];
  const people = state.people.map((person) => person.id === "p_tiago" && !person.cardIds.includes("c_0548")
    ? { ...person, cardIds: [...person.cardIds, "c_0548"] }
    : person);
  const knownTransactionIds = new Set(state.transactions.map((transaction) => transaction.id));
  const transactions = [
    ...state.transactions,
    ...baseline.transactions.filter((transaction) => !knownTransactionIds.has(transaction.id) && transaction.invoiceId === baselineInvoice.id),
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
    const holder = card ? state.people.find((person) => person.cardIds.includes(card.id)) : undefined;
    return holder ? { ...transaction, allocations: [{ personId: holder.id, amount: transaction.amount }] } : transaction;
  }),
});

const reconcileImportedTransactions = (state: FinanceState, invoice: Invoice, incoming: Transaction[]) => {
  const previous = previousInvoiceFor(state, invoice);
  if (!previous) return incoming;
  const candidates = state.transactions.filter((transaction) => transaction.invoiceId === previous.id);
  const used = new Set<string>();
  const transactions = incoming.map((transaction) => {
    const match = candidates.find((candidate) => !used.has(candidate.id) && transactionMatchKey(candidate) === transactionMatchKey(transaction));
    if (!match) return transaction;
    used.add(match.id);
    const restored: Transaction = {
      ...transaction,
      allocations: match.allocations,
      ...(match.adjustmentNote !== undefined ? { adjustmentNote: match.adjustmentNote } : {}),
    };
    if (match.planId !== undefined) restored.planId = match.planId;
    if (transaction.installmentNumber === undefined && match.installmentNumber !== undefined) restored.installmentNumber = match.installmentNumber;
    if (transaction.installmentTotal === undefined && match.installmentTotal !== undefined) restored.installmentTotal = match.installmentTotal;
    return restored;
  });
  return transactions;
};

export function reducer(s: FinanceState, a: Action): FinanceState {
  switch (a.type) {
    case "hydrate":
      return assignInitialCardholders(ensure0548(a.state));
    case "reset":
      return createDemoState();
    case "setMonth":
      return { ...s, settings: { ...s.settings, month: a.month } };
    case "updateSettings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "allocate":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          a.txIds.includes(t.id) && t.type !== "pagamento"
            ? { ...t, allocations: [{ personId: a.personId, amount: t.amount }], adjustmentNote: undefined }
            : t,
        ),
      };
    case "split":
      return {
        ...s,
        transactions: s.transactions.map((t) =>
          t.id === a.txId ? { ...t, allocations: a.allocations, adjustmentNote: a.adjustmentNote } : t,
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
          const updated: Transaction = { ...t, description: a.patch.description, date: a.patch.date, amount: a.patch.amount };
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
        plans: s.plans.map((p) => ({ ...p, shares: p.shares.filter((x) => x.personId !== a.personId) })),
      };
    case "upsertCard":
      return { ...s, cards: upsert(s.cards, a.card) };
    case "upsertPlan":
      return { ...s, plans: upsert(s.plans, a.plan) };
    case "deletePlan":
      return {
        ...s,
        plans: s.plans.filter((p) => p.id !== a.planId),
        transactions: s.transactions.map((t) => (t.planId === a.planId ? { ...t, planId: undefined } : t)),
      };
    case "importInvoice":
      {
        const reconciled = reconcileImportedTransactions(s, a.invoice, a.transactions);
        return {
          ...s,
          invoices: upsert(s.invoices, a.invoice),
          plans: s.plans.filter((plan) => plan.cardId !== a.invoice.cardId || planStatusAt(plan, a.invoice.month) !== "finalizado"),
          transactions: [
            ...s.transactions.filter((transaction) => transaction.invoiceId !== a.invoice.id),
            ...reconciled,
          ],
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
        invoices: s.invoices.map((i) => i.id === a.invoiceId ? { ...i, payments: a.payments } : i),
      };
  }
}

const Ctx = createContext<{ state: FinanceState; dispatch: React.Dispatch<Action> } | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createDemoState);
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
          { event: "*", schema: "public", table: "workspace_state", filter: `workspace_id=eq.${ws}` },
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        workspaceId.current = null;
        lastSynced.current = null;
        if (channel) { void supabase.removeChannel(channel); channel = null; }
        dispatch({ type: "hydrate", state: createDemoState() });
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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
