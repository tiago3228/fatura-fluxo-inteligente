import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import {
  CATEGORY_DESCRIPTION_SUGGESTIONS,
  categoryDescriptionSuggestion,
  categoryForMerchant,
  learnCategoryRule,
  normalizeMerchant,
  PURCHASE_CATEGORIES,
} from "@/lib/finance/categories";

describe("categorias aprendidas por estabelecimento", () => {
  it("inclui as categorias adicionais disponíveis ao editar uma compra", () => {
    expect(PURCHASE_CATEGORIES).toEqual(
      expect.arrayContaining([
        "Delivery",
        "Remédio",
        "Presente",
        "Assinaturas",
        "Estorno",
        "Formatação",
        "Supermercado",
        "Shopee/Shein",
      ]),
    );
  });

  it("mantém as opções em ordem alfabética", () => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    expect([...PURCHASE_CATEGORIES].sort(collator.compare)).toEqual(PURCHASE_CATEGORIES);
  });

  it("oferece uma descrição breve para cada categoria", () => {
    expect(Object.keys(CATEGORY_DESCRIPTION_SUGGESTIONS).sort()).toEqual(
      [...PURCHASE_CATEGORIES].sort(),
    );
    expect(categoryDescriptionSuggestion("Formatação")).toBe(
      "Formatação de computadores e notebooks.",
    );
    expect(categoryDescriptionSuggestion(undefined)).toBe("");
  });

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

  it("atualiza as compras de nomenclatura idêntica ao escolher categoria em Editar compra", () => {
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
          id: "clubew-selected",
          description: "ClubeWPrePago 611303/12 4/12",
          category: undefined,
        },
        {
          ...sample,
          id: "clubew-sibling",
          description: "ClubeWPrePago 611304/12",
          category: "Alimentação",
        },
      ],
    };

    const categorized = reducer(state, {
      type: "updateTransaction",
      txId: "clubew-selected",
      patch: {
        description: "ClubeWPrePago 611303/12 4/12",
        category: "Delivery",
        note: "Entrega de refeição no fim de semana.",
        date: sample.date,
        amount: sample.amount,
        installmentNumber: null,
        installmentTotal: null,
      },
    });

    expect(
      categorized.transactions
        .filter((transaction) => transaction.id.startsWith("clubew-"))
        .map((transaction) => transaction.category),
    ).toEqual(["Delivery", "Delivery"]);
    expect(
      categorized.transactions.find((transaction) => transaction.id === "clubew-selected")?.note,
    ).toBe("Entrega de refeição no fim de semana.");
  });
});
