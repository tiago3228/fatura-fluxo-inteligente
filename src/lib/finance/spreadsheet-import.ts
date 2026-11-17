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

const MONTH_NUMBER_BY_NAME: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

export function detectSpreadsheetInvoiceMonth(sheets: unknown[][][]) {
  for (const sheet of sheets) {
    for (const row of sheet) {
      const text = row
        .map((cell) => String(cell ?? ""))
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      if (!/\b(?:fatura|competencia)\b/.test(text)) continue;

      const namedMonth = text.match(
        /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b\s*(?:de\s*)?(?:[/-]\s*)?(20\d{2})\b/,
      );
      if (namedMonth) {
        const month = MONTH_NUMBER_BY_NAME[namedMonth[1]!];
        if (month) return `${namedMonth[2]}-${String(month).padStart(2, "0")}`;
      }

      const yearMonth = text.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])\b/);
      if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}`;

      const monthYear = text.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/);
      if (monthYear) return `${monthYear[2]}-${monthYear[1]!.padStart(2, "0")}`;
    }
  }
  return null;
}
