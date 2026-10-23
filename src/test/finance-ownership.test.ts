import { describe, expect, it } from "vitest";

import { createDemoState } from "@/lib/finance/mock";
import { monthTxs, personMonthTotal, txCard } from "@/lib/finance/calc";
import { reducer } from "@/lib/finance/store";

describe("separação inicial da fatura por titular", () => {
  it("atribui cada compra ao titular do cartão e calcula os totais", () => {
    const state = createDemoState();
    const monthTransactions = monthTxs(state, "2026-10");

    expect(monthTransactions.length).toBeGreaterThan(0);
    expect(monthTransactions.every((transaction) => transaction.allocations.length === 1)).toBe(true);
    expect(monthTransactions.every((transaction) => {
      const card = txCard(state, transaction);
      const allocation = transaction.allocations[0];
      return card !== undefined && allocation !== undefined && state.people.find((person) => person.id === allocation.personId)?.cardIds.includes(card.id);
    })).toBe(true);

    const tiagoTotal = personMonthTotal(state, "p_tiago", "2026-10");
    const atenaTotal = personMonthTotal(state, "p_atena", "2026-10");
    expect(tiagoTotal).toBeGreaterThan(0);
    expect(atenaTotal).toBeGreaterThan(0);
    expect(tiagoTotal + atenaTotal).toBeCloseTo(monthTransactions.reduce((sum, transaction) => sum + transaction.amount, 0), 2);
  });

  it("recupera o cartão 0548 quando a base local antiga não o possuía", () => {
    const original = createDemoState();
    const oldState = {
      ...original,
      cards: original.cards.filter((card) => card.id !== "c_0548"),
      invoices: original.invoices.filter((invoice) => invoice.cardId !== "c_0548"),
      transactions: original.transactions.filter((transaction) => !transaction.id.startsWith("tx_0548_")),
      people: original.people.map((person) => person.id === "p_tiago" ? { ...person, cardIds: person.cardIds.filter((cardId) => cardId !== "c_0548") } : person),
    };

    const migrated = reducer(oldState, { type: "hydrate", state: oldState });
    expect(migrated.cards.some((card) => card.id === "c_0548")).toBe(true);
    expect(migrated.invoices.some((invoice) => invoice.cardId === "c_0548")).toBe(true);
    expect(migrated.transactions.some((transaction) => transaction.id.startsWith("tx_0548_"))).toBe(true);
    expect(migrated.people.find((person) => person.id === "p_tiago")?.cardIds).toContain("c_0548");
  });

  it("aplica uma atribuição da planilha a uma compra existente", () => {
    const original = createDemoState();
    const arlete = { id: "p_arlete", name: "Arlete", limit: 5000, active: true, cardIds: [] };
    const source = original.transactions.find((transaction) => transaction.description === "CENTRO ODONTOLOGIC12/12")!;
    const state = { ...original, people: [...original.people, arlete] };
    const migrated = reducer(state, { type: "hydrate", state });
    expect(migrated.transactions.find((transaction) => transaction.id === source.id)?.allocations).toEqual([
      { personId: "p_arlete", amount: 208.37 },
    ]);
  });
});
