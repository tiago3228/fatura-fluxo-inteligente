import type { CreditCard, Person } from "./types";

export type SpreadsheetFieldKey =
  "date" | "description" | "amount" | "person" | "card" | "category";

export const SPREADSHEET_FIELDS: {
  key: SpreadsheetFieldKey;
  label: string;
  required: boolean;
  guess: RegExp;
}[] = [
  { key: "date", label: "Data", required: true, guess: /data|date|dia/i },
  { key: "description", label: "Descrição", required: true, guess: /desc|estabelec|hist|loja/i },
  { key: "amount", label: "Valor", required: true, guess: /valor|amount|preço|preco|r\$/i },
  {
    key: "person",
    label: "Pessoa responsável",
    required: false,
    guess: /pessoa|quem|respons|nome/i,
  },
  { key: "card", label: "Cartão (final)", required: false, guess: /cart|final/i },
  { key: "category", label: "Categoria", required: false, guess: /categ|categoria|category/i },
];

export function guessSpreadsheetColumns(headers: string[]) {
  return Object.fromEntries(
    SPREADSHEET_FIELDS.map(({ key, guess }) => {
      const index = headers.findIndex((header) => guess.test(header));
      return [key, index < 0 ? null : index];
    }),
  ) as Record<SpreadsheetFieldKey, number | null>;
}

export function matchSpreadsheetPeople(value: string, people: Person[]) {
  const names = value
    .split(/\s*(?:,|;|\+|&|\be\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  const matched = names
    .map((name) =>
      people.find(
        (person) =>
          person.name.toLocaleLowerCase().startsWith(name.toLocaleLowerCase()) ||
          person.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ),
    )
    .filter((person): person is Person => Boolean(person));
  const unmatched = names.filter(
    (name) =>
      !people.some(
        (person) =>
          person.name.toLocaleLowerCase().startsWith(name.toLocaleLowerCase()) ||
          person.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ),
  );
  return { matched, unmatched };
}

export function resolveSpreadsheetCard(
  value: unknown,
  cards: CreditCard[],
  fallbackCardId: string,
) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return { card: cards.find((item) => item.id === fallbackCardId), error: "" };
  const last4 = digits.slice(-4).padStart(4, "0");
  const card = cards.find(
    (item) => item.last4.replace(/\D/g, "").slice(-4).padStart(4, "0") === last4,
  );
  return card
    ? { card, error: "" }
    : { card: undefined, error: `Cartão final ${last4} não cadastrado no aplicativo` };
}

export function splitAmountAcrossPeople(amount: number, peopleCount: number) {
  if (peopleCount <= 0) return [];
  const totalCents = Math.round(amount * 100);
  const baseCents = Math.trunc(totalCents / peopleCount);
  const remainder = totalCents - baseCents * peopleCount;
  return Array.from(
    { length: peopleCount },
    (_, index) => (baseCents + (index < Math.abs(remainder) ? Math.sign(remainder) : 0)) / 100,
  );
}
