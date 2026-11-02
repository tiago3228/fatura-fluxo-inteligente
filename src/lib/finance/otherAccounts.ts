import type { OtherAccount, OtherAccountCategory, OtherAccountResponsibility } from "./types";

export const DEFAULT_OTHER_ACCOUNT_CATEGORIES: ReadonlyArray<OtherAccountCategory> = [
  { id: "energy", name: "Energia", builtIn: true },
  { id: "water", name: "Água", builtIn: true },
  { id: "internet", name: "Internet", builtIn: true },
  { id: "gas-bottle", name: "Botijão de gás", builtIn: true },
  { id: "condominium", name: "Condomínio", builtIn: true },
  { id: "iptu", name: "IPTU", builtIn: true },
  { id: "ipva", name: "IPVA", builtIn: true },
];

export function createDefaultOtherAccountCategories(): OtherAccountCategory[] {
  return DEFAULT_OTHER_ACCOUNT_CATEGORIES.map((category) => ({ ...category }));
}

/** Adiciona categorias padrão a estados antigos, preservando categorias personalizadas válidas. */
export function withDefaultOtherAccountCategories(
  saved: OtherAccountCategory[] | undefined,
): OtherAccountCategory[] {
  const builtInIds = new Set(DEFAULT_OTHER_ACCOUNT_CATEGORIES.map((category) => category.id));
  const seenIds = new Set(builtInIds);
  const seenNames = new Set(
    DEFAULT_OTHER_ACCOUNT_CATEGORIES.map((category) => category.name.toLocaleLowerCase("pt-BR")),
  );
  const custom = (Array.isArray(saved) ? saved : []).filter((category) => {
    if (
      !category ||
      typeof category.id !== "string" ||
      !category.id.trim() ||
      typeof category.name !== "string" ||
      !category.name.trim() ||
      builtInIds.has(category.id) ||
      seenIds.has(category.id)
    ) {
      return false;
    }
    const normalizedName = category.name.trim().toLocaleLowerCase("pt-BR");
    if (seenNames.has(normalizedName)) return false;
    seenIds.add(category.id);
    seenNames.add(normalizedName);
    return true;
  });
  return [
    ...createDefaultOtherAccountCategories(),
    ...custom.map((item) => ({ ...item, builtIn: false })),
  ];
}

/** Distribui centavos igualmente e entrega qualquer resto, um centavo por vez, na ordem informada. */
export function splitEvenlyInCents(
  amountCents: number,
  people: ReadonlyArray<{ id: string; name: string }>,
): OtherAccountResponsibility[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || people.length === 0) return [];
  const uniquePeople = people.filter(
    (person, index) => people.findIndex((candidate) => candidate.id === person.id) === index,
  );
  if (uniquePeople.length === 0 || uniquePeople.some((person) => !person.id || !person.name.trim()))
    return [];
  const base = Math.floor(amountCents / uniquePeople.length);
  const remainder = amountCents % uniquePeople.length;
  return uniquePeople.map((person, index) => ({
    personId: person.id,
    personName: person.name.trim(),
    amountCents: base + (index < remainder ? 1 : 0),
  }));
}

/** Cria responsáveis simples ou quotas iguais para usar no formulário de cadastro da conta. */
export function buildOtherAccountResponsibilities(
  people: ReadonlyArray<{ id: string; name: string }>,
  amountCents: number,
  divideEqually: boolean,
): OtherAccountResponsibility[] {
  const uniquePeople = people.filter(
    (person, index) => people.findIndex((candidate) => candidate.id === person.id) === index,
  );
  if (
    uniquePeople.length === 0 ||
    uniquePeople.some((person) => !person.id.trim() || !person.name.trim())
  )
    return [];
  if (divideEqually) return splitEvenlyInCents(amountCents, uniquePeople);
  return uniquePeople.map((person) => ({
    personId: person.id,
    personName: person.name.trim(),
  }));
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidOtherAccount(
  value: unknown,
  categories: ReadonlyArray<OtherAccountCategory>,
): value is OtherAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  const id = account["id"];
  const categoryId = account["categoryId"];
  const description = account["description"];
  const amountCents = account["amountCents"];
  const dueDate = account["dueDate"];
  const status = account["status"];
  const rawResponsibilities = account["responsibilities"];
  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof categoryId !== "string" ||
    !categories.some((category) => category.id === categoryId) ||
    typeof description !== "string" ||
    !description.trim() ||
    !Number.isSafeInteger(amountCents) ||
    (amountCents as number) <= 0 ||
    typeof dueDate !== "string" ||
    !isValidIsoDate(dueDate) ||
    (status !== "pending" && status !== "paid") ||
    !Array.isArray(rawResponsibilities) ||
    (account["paidAt"] !== undefined && typeof account["paidAt"] !== "string") ||
    (account["notes"] !== undefined && typeof account["notes"] !== "string")
  ) {
    return false;
  }

  const responsibilities: OtherAccountResponsibility[] = [];
  const seenPeople = new Set<string>();
  for (const rawResponsibility of rawResponsibilities as unknown[]) {
    if (
      !rawResponsibility ||
      typeof rawResponsibility !== "object" ||
      Array.isArray(rawResponsibility)
    )
      return false;
    const person = rawResponsibility as Record<string, unknown>;
    const personId = person["personId"];
    const personName = person["personName"];
    const share = person["amountCents"];
    if (
      typeof personId !== "string" ||
      !personId.trim() ||
      typeof personName !== "string" ||
      !personName.trim() ||
      seenPeople.has(personId) ||
      (share !== undefined && (!Number.isSafeInteger(share) || (share as number) < 0))
    ) {
      return false;
    }
    seenPeople.add(personId);
    responsibilities.push({
      personId,
      personName,
      ...(share !== undefined ? { amountCents: share as number } : {}),
    });
  }

  const hasShares = responsibilities.some((item) => item.amountCents !== undefined);
  if (!hasShares) return true;
  if (responsibilities.some((item) => item.amountCents === undefined)) return false;
  return (
    responsibilities.reduce((sum, item) => sum + (item.amountCents ?? 0), 0) ===
    (amountCents as number)
  );
}
