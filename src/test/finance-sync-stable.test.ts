import { describe, expect, it } from "vitest";
import { stableJsonStringify } from "@/lib/finance/sync";
import { mergeConcurrentStates } from "@/lib/finance/syncMerge";

describe("comparação estável do estado em nuvem", () => {
  it("considera iguais objetos com as mesmas chaves em ordens diferentes", () => {
    const local = {
      settings: { month: "2026-11", persist: true },
      transactions: [{ id: "tx-1", amount: 100 }],
    };
    const fromJsonb = {
      transactions: [{ amount: 100, id: "tx-1" }],
      settings: { persist: true, month: "2026-11" },
    };

    expect(stableJsonStringify(local)).toBe(stableJsonStringify(fromJsonb));
  });

  it("preserva a ordem dos arrays porque ela pode ser significativa", () => {
    expect(stableJsonStringify({ items: ["a", "b"] })).not.toBe(
      stableJsonStringify({ items: ["b", "a"] }),
    );
  });

  it("mescla atualizações de entidades e campos independentes", () => {
    const base = {
      transactions: [
        { id: "tx-1", category: "Casa", allocations: [] },
        { id: "tx-2", category: "Alimentação", allocations: [] },
      ],
    };
    const local = {
      transactions: [
        { id: "tx-1", category: "Casa", allocations: [{ personId: "p-1", amount: 40 }] },
        { id: "tx-2", category: "Alimentação", allocations: [] },
      ],
    };
    const remote = {
      transactions: [
        { id: "tx-1", category: "Delivery", allocations: [] },
        { id: "tx-2", category: "Alimentação", allocations: [{ personId: "p-2", amount: 25 }] },
      ],
    };

    expect(mergeConcurrentStates(base, local, remote)).toEqual({
      ok: true,
      value: {
        transactions: [
          { id: "tx-1", category: "Delivery", allocations: [{ personId: "p-1", amount: 40 }] },
          { id: "tx-2", category: "Alimentação", allocations: [{ personId: "p-2", amount: 25 }] },
        ],
      },
    });
  });

  it("sinaliza conflito quando os dois usuários mudam o mesmo campo de uma compra", () => {
    const base = { transactions: [{ id: "tx-1", category: "Casa" }] };
    const local = { transactions: [{ id: "tx-1", category: "Delivery" }] };
    const remote = { transactions: [{ id: "tx-1", category: "Estorno" }] };

    expect(mergeConcurrentStates(base, local, remote)).toEqual({ ok: false });
  });

  it("combina regras aprendidas para estabelecimentos diferentes", () => {
    const base = { categoryRules: [{ merchant: "mercado a", category: "Alimentação" }] };
    const local = {
      categoryRules: [...base.categoryRules, { merchant: "loja b", category: "Delivery" }],
    };
    const remote = {
      categoryRules: [...base.categoryRules, { merchant: "loja c", category: "Supermercado" }],
    };

    expect(mergeConcurrentStates(base, local, remote)).toEqual({
      ok: true,
      value: {
        categoryRules: [
          { merchant: "mercado a", category: "Alimentação" },
          { merchant: "loja c", category: "Supermercado" },
          { merchant: "loja b", category: "Delivery" },
        ],
      },
    });
  });
});
