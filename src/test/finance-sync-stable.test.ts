import { describe, expect, it } from "vitest";
import { stableJsonStringify } from "@/lib/finance/sync";

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
});
