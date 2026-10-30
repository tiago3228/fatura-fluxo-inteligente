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

const similarity = (left: string, right: string) => {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return { score: union ? shared / union : 0, shared };
};

export const categoryForMerchant = (
  description: string,
  rules: CategoryRule[],
): string | undefined => {
  const merchant = normalizeMerchant(description);
  if (!merchant) return undefined;
  const exact = rules.find((rule) => normalizeMerchant(rule.merchant) === merchant);
  if (exact) return exact.category;

  let bestScore = 0;
  let bestCategory: string | undefined;
  let tied = false;
  for (const rule of rules) {
    const candidate = normalizeMerchant(rule.merchant);
    const { score, shared } = similarity(merchant, candidate);
    if (shared < 2 || score < 0.6) continue;
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
