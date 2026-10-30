import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import {
  categoryForMerchant,
  learnCategoryRule,
  normalizeMerchant,
} from "@/lib/finance/categories";

describe("categorias aprendidas por estabelecimento", () => {
  it("ignora variações do número de parcela e identificadores numéricos", () => {
    expect(normalizeMerchant("Petz Digital 3/3")).toBe("petz digital");
    expect(normalizeMerchant("ClubeWPrePago 611303/12 4/12")).toBe("clubewprepago");
  });

  it("reaplica a categoria para uma compra futura do mesmo estabelecimento", () => {
    const rules = learnCategoryRule([], "PAG*Steam 2/3", "Lazer");
    expect(categoryForMerchant("PAG*Steam 3/3", rules)).toBe("Lazer");
  });

  it("aprende correspondências semelhantes sem confundir estabelecimentos sem tokens comuns", () => {
    const rules = learnCategoryRule([], "SUP EPA QUAT-CT 2/2", "Alimentação");
    expect(categoryForMerchant("SUP EPA DEZE-CT 3/3", rules)).toBe("Alimentação");
    expect(categoryForMerchant("PAG Steam 2/3", rules)).toBeUndefined();
  });

  it("atualiza a regra já existente para aquele estabelecimento", () => {
    const rules = learnCategoryRule(
      learnCategoryRule([], "TOTALPASS", "Academia"),
      "TOTALPASS 2/12",
      "Saúde",
    );
    expect(rules).toHaveLength(1);
    expect(categoryForMerchant("TOTALPASS 3/12", rules)).toBe("Saúde");
  });

  it("propaga uma categoria recém-aprendida a compras semelhantes sem categoria", () => {
    const base = createDemoState();
    const sample = base.transactions[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    const state = {
      ...base,
      categoryRules: [],
      transactions: [
        {
          ...sample,
          id: "learned-merchant",
          description: "Mercado Central Loja A",
          category: undefined,
        },
        {
          ...sample,
          id: "similar-merchant",
          description: "Mercado Central Loja B",
          category: undefined,
        },
      ],
    };

    const categorized = reducer(state, {
      type: "setTransactionCategory",
      txIds: ["learned-merchant"],
      category: "Alimentação",
    });

    expect(categorized.transactions.map((transaction) => transaction.category)).toEqual([
      "Alimentação",
      "Alimentação",
    ]);
    expect(categorized.categoryRules).toContainEqual({
      merchant: "mercado central loja a",
      category: "Alimentação",
    });
  });
});
