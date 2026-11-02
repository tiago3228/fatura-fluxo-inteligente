import { describe, expect, it } from "vitest";
import { createEmptyFinanceState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import { splitEvenlyInCents } from "@/lib/finance/otherAccounts";
import { stableSerialize } from "@/lib/finance/syncMerge";
import type {
  AuditEntry,
  FinanceState,
  Invoice,
  OtherAccount,
  PersonPayment,
  Transaction,
} from "@/lib/finance/types";

const bill: OtherAccount = {
  id: "bill_cemig",
  categoryId: "energy",
  description: "Cemig",
  amountCents: 10001,
  dueDate: "2026-11-10",
  status: "pending",
  responsibilities: splitEvenlyInCents(10001, [
    { id: "p1", name: "Ana" },
    { id: "p2", name: "Bia" },
  ]),
};

const cardInvoice: Invoice = {
  id: "invoice_card",
  cardId: "card_1",
  month: "2026-11",
  dueDate: "2026-11-20",
  officialTotal: 150,
  status: "em_revisao",
  source: "planilha",
};
const cardTransaction: Transaction = {
  id: "tx_card",
  invoiceId: cardInvoice.id,
  date: "2026-11-01",
  description: "Compra no cartão",
  amount: 150,
  type: "compra",
  allocations: [],
};
const personPayment: PersonPayment = {
  id: "person_payment",
  personId: "p1",
  amount: 50,
  paidAt: "2026-11-02",
  month: "2026-11",
};

describe("reducer de outras contas", () => {
  it("grava e marca conta como paga sem alterar faturas, compras ou pagamentos pessoais", () => {
    const initial = createEmptyFinanceState();
    const state: FinanceState = {
      ...initial,
      invoices: [cardInvoice],
      transactions: [cardTransaction],
      payments: [personPayment],
    };
    const withBill = reducer(state, { type: "upsertOtherAccount", account: bill });
    const paid = reducer(withBill, {
      type: "setOtherAccountStatus",
      accountId: bill.id,
      status: "paid",
      paidAt: "2026-11-02",
    });

    expect(paid.otherAccounts).toEqual([{ ...bill, status: "paid", paidAt: "2026-11-02" }]);
    expect(paid.invoices).toBe(state.invoices);
    expect(paid.transactions).toBe(state.transactions);
    expect(paid.payments).toBe(state.payments);
  });

  it("recusa uma edição cujo rateio não fecha exatamente e preserva o estado anterior", () => {
    const state: FinanceState = { ...createEmptyFinanceState(), otherAccounts: [bill] };
    const invalid = {
      ...bill,
      responsibilities: [{ personId: "p1", personName: "Ana", amountCents: 10000 }],
    };
    expect(reducer(state, { type: "upsertOtherAccount", account: invalid })).toBe(state);
  });

  it("não permite excluir categoria padrão nem categoria referenciada por uma conta", () => {
    const state: FinanceState = { ...createEmptyFinanceState(), otherAccounts: [bill] };
    expect(reducer(state, { type: "deleteOtherAccountCategory", categoryId: "energy" })).toBe(
      state,
    );
    const withCustom = reducer(state, {
      type: "upsertOtherAccountCategory",
      category: { id: "school", name: "Escola" },
    });
    expect(withCustom.otherAccountCategories?.some((item) => item.id === "school")).toBe(true);
    const afterDelete = reducer(withCustom, {
      type: "deleteOtherAccountCategory",
      categoryId: "school",
    });
    expect(afterDelete.otherAccountCategories?.some((item) => item.id === "school")).toBe(false);
  });

  it("migra caches antigos sem campo novo e mantém as categorias padrão", () => {
    const initial = createEmptyFinanceState();
    const legacy = { ...initial, otherAccountCategories: undefined, otherAccounts: undefined };
    const hydrated = reducer(initial, { type: "hydrate", state: legacy });
    expect(hydrated.otherAccountCategories?.map((item) => item.id)).toEqual([
      "energy",
      "water",
      "internet",
      "gas-bottle",
      "condominium",
      "iptu",
      "ipva",
    ]);
    expect(hydrated.otherAccounts).toEqual([]);
  });

  it("descarta registros malformados ao hidratar cache/nuvem sem interromper a carga", () => {
    const initial = createEmptyFinanceState();
    const legacy = {
      ...initial,
      otherAccounts: [null, { ...bill, responsibilities: [null] }],
    } as unknown as FinanceState;
    const hydrated = reducer(initial, { type: "hydrate", state: legacy });
    expect(hydrated.otherAccounts).toEqual([]);
  });

  it("preserva as novas coleções no round-trip JSON e no serializador de sync", () => {
    const state: FinanceState = {
      ...createEmptyFinanceState(),
      otherAccounts: [bill],
      otherAccountCategories: [
        ...(createEmptyFinanceState().otherAccountCategories ?? []),
        { id: "school", name: "Escola", builtIn: false },
      ],
    };
    const restored = JSON.parse(JSON.stringify(state)) as FinanceState;
    expect(restored.otherAccounts).toEqual([bill]);
    expect(restored.otherAccountCategories?.some((item) => item.id === "school")).toBe(true);
    expect(stableSerialize(restored)).toBe(stableSerialize(state));
  });

  it("undo e redo restauram contas e categorias como snapshots auditáveis", () => {
    const defaultCategories = createEmptyFinanceState().otherAccountCategories ?? [];
    const categoriesWithCustom = [
      ...defaultCategories,
      { id: "school", name: "Escola", builtIn: false },
    ];
    const entry: AuditEntry = {
      id: "audit_bill",
      actorId: "user",
      actorName: "Usuário",
      description: "adicionou Cemig",
      createdAt: "2026-11-02T12:00:00.000Z",
      entityType: "otherAccount",
      entityId: bill.id,
      undo: {
        kind: "restoreFinance",
        otherAccounts: [],
        otherAccountCategories: defaultCategories,
      },
      redo: {
        kind: "restoreFinance",
        otherAccounts: [bill],
        otherAccountCategories: categoriesWithCustom,
      },
    };
    const state: FinanceState = {
      ...createEmptyFinanceState(),
      otherAccounts: [bill],
      otherAccountCategories: categoriesWithCustom,
      auditLog: [entry],
    };
    const undone = reducer(state, { type: "undoAudit", auditId: entry.id });
    expect(undone.otherAccounts).toEqual([]);
    expect(undone.otherAccountCategories).toEqual(defaultCategories);
    const redone = reducer(undone, { type: "redoAudit", auditId: entry.id });
    expect(redone.otherAccounts).toEqual([bill]);
    expect(redone.otherAccountCategories).toEqual(categoriesWithCustom);
  });
});
