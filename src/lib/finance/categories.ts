export const PURCHASE_CATEGORIES = [
  "Alimentação",
  "Casa",
  "Compras pessoais",
  "Educação",
  "Lazer",
  "Saúde",
  "Serviços e assinaturas",
  "Transporte",
  "Viagem",
  "Outros",
] as const;

export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

export const categoryLabel = (category: string | undefined) => category || "Sem categoria";
