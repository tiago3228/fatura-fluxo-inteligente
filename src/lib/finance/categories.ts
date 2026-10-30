export const PURCHASE_CATEGORIES = [
  "Alimentação",
  "Academia",
  "Barbeiro",
  "Casa",
  "Compras pessoais",
  "Educação",
  "Empréstimos",
  "Gasolina",
  "Lazer",
  "Manutenção Veículo",
  "PETS",
  "Reforma/Construção",
  "Recorrência",
  "Roupas e Calçados",
  "Saúde",
  "Salão",
  "Serviços e assinaturas",
  "Transporte",
  "Viagem",
  "Outros",
] as const;

export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

export type CategoryRule = {
  merchant: string;
  category: string;
};

/** Remove detalhes variáveis da fatura, como número da parcela e identificadores numéricos. */
export const normalizeMerchant = (description: string): string =>
  description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\d+\s*\/\s*\d+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { merchant: "PETZ DIGITAL", category: "PETS" },
  { merchant: "ABC ATACADO CT RE", category: "Alimentação" },
  { merchant: "SUP EPA QUAT-CT", category: "Alimentação" },
  { merchant: "SUPERMERCADO-CT", category: "Alimentação" },
  { merchant: "SUP EPA DEZE-CT", category: "Alimentação" },
  { merchant: "SUP EPA", category: "Alimentação" },
  { merchant: "ClubeWPrePago", category: "Alimentação" },
  { merchant: "nuuvem *Nuuve", category: "Lazer" },
  { merchant: "GOWD", category: "Lazer" },
  { merchant: "PAG*Steam", category: "Lazer" },
  { merchant: "PB*InstantGaming", category: "Lazer" },
  { merchant: "ENVIO MENS.AUTOMATICA", category: "Recorrência" },
  { merchant: "TOTALPASS", category: "Academia" },
].map((rule) => ({ ...rule, merchant: normalizeMerchant(rule.merchant) }));

export const learnCategoryRule = (
  rules: CategoryRule[],
  description: string,
  category: string | undefined,
): CategoryRule[] => {
  const merchant = normalizeMerchant(description);
  if (!merchant || !category) return rules;
  const existingIndex = rules.findIndex((rule) => normalizeMerchant(rule.merchant) === merchant);
  if (existingIndex < 0) return [...rules, { merchant, category }];
  return rules.map((rule, index) => (index === existingIndex ? { merchant, category } : rule));
};

export const mergeCategoryRules = (...ruleSets: CategoryRule[][]): CategoryRule[] => {
  const merged = new Map<string, CategoryRule>();
  for (const rules of ruleSets) {
    for (const rule of rules) {
      const merchant = normalizeMerchant(rule.merchant);
      if (merchant) merged.set(merchant, { merchant, category: rule.category });
    }
  }
  return Array.from(merged.values());
};

type CompiledRule = { merchant: string; category: string; tokens: Set<string> };
type CompiledRules = {
  exact: Map<string, string>;
  byToken: Map<string, CompiledRule[]>;
};

const compiledRulesCache = new WeakMap<CategoryRule[], CompiledRules>();

const compileRules = (rules: CategoryRule[]): CompiledRules => {
  const cached = compiledRulesCache.get(rules);
  if (cached) return cached;
  const exact = new Map<string, string>();
  const byToken = new Map<string, CompiledRule[]>();
  for (const rule of rules) {
    const merchant = normalizeMerchant(rule.merchant);
    const compiled: CompiledRule = {
      merchant,
      category: rule.category,
      tokens: new Set(merchant.split(" ").filter(Boolean)),
    };
    exact.set(merchant, rule.category);
    for (const token of compiled.tokens) {
      const matches = byToken.get(token) ?? [];
      matches.push(compiled);
      byToken.set(token, matches);
    }
  }
  const result = { exact, byToken };
  compiledRulesCache.set(rules, result);
  return result;
};

export const categoryForMerchant = (
  description: string,
  rules: CategoryRule[],
): string | undefined => {
  const merchant = normalizeMerchant(description);
  if (!merchant) return undefined;
  const compiled = compileRules(rules);
  const exact = compiled.exact.get(merchant);
  if (exact) return exact;

  let bestScore = 0;
  let bestCategory: string | undefined;
  let tied = false;
  const queryTokens = new Set(merchant.split(" ").filter(Boolean));
  const sharedCounts = new Map<CompiledRule, number>();
  for (const token of queryTokens) {
    for (const rule of compiled.byToken.get(token) ?? []) {
      sharedCounts.set(rule, (sharedCounts.get(rule) ?? 0) + 1);
    }
  }
  for (const [rule, shared] of sharedCounts) {
    if (shared < 2) continue;
    const union = queryTokens.size + rule.tokens.size - shared;
    const score = union ? shared / union : 0;
    if (score < 0.6) continue;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
      tied = false;
    } else if (score === bestScore && bestCategory !== rule.category) {
      tied = true;
    }
  }
  return tied ? undefined : bestCategory;
};

export const categoryLabel = (category: string | undefined) => category || "Sem categoria";
