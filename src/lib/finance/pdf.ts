import type { TxType } from "./types";
import { parseBRL, round2 } from "./format";
import type { FinanceState } from "./types";
import {
  installmentReferenceFromDescription,
  planAmountAt,
  planNumberAt,
  recurringChargeAppliesAt,
} from "./calc";

export type ExtractedPdfRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TxType;
  installmentNumber?: number;
  installmentTotal?: number;
  cardLast4?: string;
  review?: string;
};

export type ExtractedPdfInvoice = {
  rows: ExtractedPdfRow[];
  officialTotal: number | null;
  dueDate: string | null;
  rawText: string;
  warnings: string[];
};

export type PdfComparisonStatus =
  | "possible_duplicate"
  | "already_imported"
  | "expected_installment"
  | "expected_recurring"
  | "new_purchase"
  | "unexpected_installment"
  | "other";

export type PdfInvoiceComparison = {
  rows: { rowId: string; status: PdfComparisonStatus }[];
  missingInstallments: { description: string; amount: number }[];
};

const comparisonDescription = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const comparisonKey = (description: string, amount: number) =>
  `${comparisonDescription(description)}|${round2(amount).toFixed(2)}`;

/** Sinaliza linhas para revisão; nenhuma duplicidade é removida automaticamente. */
export function compareInvoiceRows(
  state: FinanceState,
  cardId: string,
  month: string,
  rows: ExtractedPdfRow[],
): PdfInvoiceComparison {
  const sameMonthInvoice = state.invoices.find(
    (invoice) => invoice.cardId === cardId && invoice.month === month,
  );
  const forecastInvoice =
    sameMonthInvoice?.source === "planilha" && sameMonthInvoice.id.includes("_next_");
  const expected: {
    id: string;
    description: string;
    amount: number;
    planId?: string;
    recurringChargeId?: string;
  }[] =
    forecastInvoice && sameMonthInvoice
      ? state.transactions
          .filter(
            (transaction) =>
              transaction.invoiceId === sameMonthInvoice.id &&
              (transaction.planId || transaction.recurringChargeId),
          )
          .map((transaction) => ({
            id: transaction.id,
            description: transaction.description,
            amount: transaction.amount,
            ...(transaction.planId ? { planId: transaction.planId } : {}),
            ...(transaction.recurringChargeId
              ? { recurringChargeId: transaction.recurringChargeId }
              : {}),
          }))
      : [];
  if (!expected.length) {
    for (const plan of state.plans.filter((item) => item.cardId === cardId)) {
      const amount = planAmountAt(plan, month);
      if (!amount) continue;
      const number = planNumberAt(plan, month);
      expected.push({
        id: plan.id,
        description: `${plan.description} ${number}/${plan.amounts.length}`,
        amount,
        planId: plan.id,
      });
    }
    for (const charge of state.recurringCharges.filter(
      (item) => item.cardId === cardId && recurringChargeAppliesAt(item, month),
    )) {
      expected.push({
        id: charge.id,
        description: charge.description,
        amount: charge.amount,
        recurringChargeId: charge.id,
      });
    }
  }

  const actualInvoice =
    sameMonthInvoice && !forecastInvoice
      ? state.transactions.filter((transaction) => transaction.invoiceId === sameMonthInvoice.id)
      : [];
  const usedExpected = new Set<string>();
  const usedActual = new Set<string>();
  const seenRows = new Set<string>();
  const comparisons = rows.map((row) => {
    const key = comparisonKey(row.description, row.amount);
    const duplicateKey = `${key}|${row.date}`;
    if (state.settings.duplicateCheck && seenRows.has(duplicateKey)) {
      return { rowId: row.id, status: "possible_duplicate" as const };
    }
    seenRows.add(duplicateKey);

    const actualMatch = actualInvoice.find(
      (transaction) =>
        !usedActual.has(transaction.id) &&
        comparisonKey(transaction.description, transaction.amount) === key,
    );
    if (actualMatch) {
      usedActual.add(actualMatch.id);
      return { rowId: row.id, status: "already_imported" as const };
    }

    const expectedMatch = expected.find(
      (transaction) =>
        !usedExpected.has(transaction.id) &&
        comparisonKey(transaction.description, transaction.amount) === key,
    );
    if (expectedMatch) {
      usedExpected.add(expectedMatch.id);
      return {
        rowId: row.id,
        status: expectedMatch.planId
          ? ("expected_installment" as const)
          : ("expected_recurring" as const),
      };
    }
    if (row.type === "parcela") return { rowId: row.id, status: "unexpected_installment" as const };
    if (row.type === "compra") return { rowId: row.id, status: "new_purchase" as const };
    return { rowId: row.id, status: "other" as const };
  });

  return {
    rows: comparisons,
    missingInstallments: expected
      .filter((item) => item.planId && !usedExpected.has(item.id))
      .map((item) => ({ description: item.description, amount: item.amount })),
  };
}

/** Compara PDF consolidado com todos os cartões da competência; não altera nem remove lançamentos. */
export function compareInvoiceRowsAcrossCards(
  state: FinanceState,
  month: string,
  rows: ExtractedPdfRow[],
): PdfInvoiceComparison {
  const invoiceIds = new Set(
    state.invoices
      .filter(
        (invoice) =>
          invoice.month === month &&
          !(invoice.source === "planilha" && invoice.id.includes("_next_")),
      )
      .map((invoice) => invoice.id),
  );
  const actual = state.transactions.filter((transaction) => invoiceIds.has(transaction.invoiceId));
  const expectedInstallments = state.plans.flatMap((plan) => {
    const amount = planAmountAt(plan, month);
    if (!amount) return [];
    const number = planNumberAt(plan, month);
    return [{ description: `${plan.description} ${number}/${plan.amounts.length}`, amount }];
  });
  const expectedRecurring = state.recurringCharges
    .filter((charge) => recurringChargeAppliesAt(charge, month))
    .map((charge) => ({ description: charge.description, amount: charge.amount }));
  const usedActual = new Set<string>();
  const usedExpected = new Set<string>();
  const seenRows = new Set<string>();
  const comparisons = rows.map((row) => {
    const key = comparisonKey(row.description, row.amount);
    const duplicateKey = `${key}|${row.date}`;
    if (state.settings.duplicateCheck && seenRows.has(duplicateKey)) {
      return { rowId: row.id, status: "possible_duplicate" as const };
    }
    seenRows.add(duplicateKey);

    const existing = actual.find(
      (transaction) =>
        !usedActual.has(transaction.id) &&
        comparisonKey(transaction.description, transaction.amount) === key,
    );
    if (existing) {
      usedActual.add(existing.id);
      return { rowId: row.id, status: "already_imported" as const };
    }

    const installmentIndex = expectedInstallments.findIndex(
      (item, index) =>
        !usedExpected.has(`p${index}`) && comparisonKey(item.description, item.amount) === key,
    );
    if (installmentIndex >= 0) {
      usedExpected.add(`p${installmentIndex}`);
      return { rowId: row.id, status: "expected_installment" as const };
    }
    const recurringIndex = expectedRecurring.findIndex(
      (item, index) =>
        !usedExpected.has(`r${index}`) && comparisonKey(item.description, item.amount) === key,
    );
    if (recurringIndex >= 0) {
      usedExpected.add(`r${recurringIndex}`);
      return { rowId: row.id, status: "expected_recurring" as const };
    }
    if (row.type === "parcela") return { rowId: row.id, status: "unexpected_installment" as const };
    if (row.type === "compra") return { rowId: row.id, status: "new_purchase" as const };
    return { rowId: row.id, status: "other" as const };
  });

  return {
    rows: comparisons,
    missingInstallments: expectedInstallments
      .filter(
        (item) =>
          !rows.some(
            (row) =>
              comparisonKey(row.description, row.amount) ===
              comparisonKey(item.description, item.amount),
          ),
      )
      .map((item) => ({ description: item.description, amount: item.amount })),
  };
}

function isoDate(value: string, fallbackMonth: string) {
  const parts = value.split(/[\x2f.-]/).map(Number);
  if (parts.length < 2 || parts.some((x) => !Number.isFinite(x))) return null;
  const d = parts[0] ?? NaN;
  const m = parts[1] ?? NaN;
  const y = parts[2];
  const year = y && y > 2000 ? y : Number(fallbackMonth.slice(0, 4));
  const month = m || Number(fallbackMonth.slice(5, 7));
  if (!(d >= 1 && d <= 31) || !(month >= 1 && month <= 12)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function amountAtEnd(line: string) {
  const matches = line.match(/(?:R\$\s*)?-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+)[,.]\d{2}-?/g);
  const value = matches?.at(-1);
  if (!value) return null;
  const amount = parseBRL(value.replace(/R\$|\s|-/g, ""));
  return amount === null ? null : /-/.test(value) ? -Math.abs(amount) : Math.abs(amount);
}

function normalizeDescription(line: string, date: string) {
  return line
    .replace(new RegExp(`^${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "")
    .replace(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+[.,]\d{2}\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseInvoiceText(rawText: string, fallbackMonth: string): ExtractedPdfInvoice {
  const warnings: string[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const datePattern = /\b\d{2}[\x2f.-]\d{2}(?:[\x2f.-]\d{2,4})?\b/;
  const transactionDatePattern = /^\d{1,2}[\x2f.-]\d{2}(?:[\x2f.-]\d{2,4})?\b/;
  const rows: ExtractedPdfRow[] = [];
  const inTransactionSection = [false, false];
  const cardLast4ByColumn: (string | undefined)[] = [undefined, undefined];
  lines.forEach((rawLine, index) => {
    const columnMatch = rawLine.match(/^\[\[COL:([01])\]\]\s?(.*)$/);
    const column = Number(columnMatch?.[1] ?? 0);
    const line = columnMatch?.[2] ?? rawLine;
    const cardMatch = line.match(/\bfinal\s*(\d{4})\b/i) ?? line.match(/\bTitular\s*(\d{4})\b/i);
    if (cardMatch) cardLast4ByColumn[column] = cardMatch[1];
    if (/compras parceladas\s*[-–]\s*próximas faturas/i.test(line)) {
      inTransactionSection[column] = false;
      return;
    }
    if (/lançamentos:\s*(?:compras e saques|produtos e serviços)/i.test(line)) {
      inTransactionSection[column] = true;
      return;
    }
    if (/total para próximas faturas/i.test(line)) {
      inTransactionSection[column] = false;
      return;
    }
    if (!inTransactionSection[column]) return;
    const dateMatch = line.match(transactionDatePattern);
    const amount = amountAtEnd(line);
    if (!dateMatch && amount !== null && /^Repasse de IOF em R\$/i.test(line)) {
      rows.push({
        id: `pdf_${index}_${fallbackMonth}-01`,
        date: `${fallbackMonth}-01`,
        description: "Repasse de IOF",
        amount: round2(amount),
        type: "tarifa",
        ...(cardLast4ByColumn[column] ? { cardLast4: cardLast4ByColumn[column] } : {}),
      });
      return;
    }
    if (!dateMatch || amount === null || Math.abs(amount) > 10000000) return;
    const date = isoDate(dateMatch[0], fallbackMonth);
    if (!date) return;
    const description = normalizeDescription(line, dateMatch[0]);
    if (
      !description ||
      /^(?:total\s+(?:desta fatura|da fatura|para próximas faturas|lançamentos?|transações?)|vencimento|pagamento mínimo|limite disponível)/i.test(
        description,
      )
    )
      return;
    const negative = amount < 0 || /estorno|crédito|credito|devolução|devolucao/i.test(description);
    const installment = installmentReferenceFromDescription(description);
    const type: TxType = negative
      ? amount < 0
        ? "estorno"
        : "credito"
      : /tarifa|encargo|iof|juros/i.test(description)
        ? "tarifa"
        : installment
          ? "parcela"
          : "compra";
    rows.push({
      id: `pdf_${index}_${date}`,
      date,
      description,
      amount: round2(amount),
      type,
      ...(cardLast4ByColumn[column] ? { cardLast4: cardLast4ByColumn[column] } : {}),
      ...(installment
        ? {
            installmentNumber: installment.number,
            installmentTotal: installment.total,
          }
        : {}),
      ...(description.length < 3 ? { review: "Descrição curta — confira" } : {}),
    });
  });
  const preferredTotal = lines
    .filter((line) =>
      /total desta fatura|total da sua fatura|total da fatura(?! anterior)/i.test(line),
    )
    .map(amountAtEnd)
    .find((value): value is number => value !== null);
  const totalCandidates = lines
    .filter((line) => /total da fatura|total fatura|valor total|total a pagar/i.test(line))
    .map(amountAtEnd)
    .filter((value): value is number => value !== null);
  const dueLine = lines.find((l) => /vencimento|vence em/i.test(l));
  const dueDate = dueLine?.match(datePattern)?.[0]
    ? isoDate(dueLine.match(datePattern)![0], fallbackMonth)
    : null;
  if (rows.length === 0)
    warnings.push(
      "Não foi encontrado texto tabular com data e valor. Este PDF pode ser escaneado ou ter um layout não reconhecido.",
    );
  if (rows.length > 0 && !totalCandidates.length)
    warnings.push(
      "O total oficial não foi identificado; confira-o manualmente antes de confirmar.",
    );
  if (rows.length > 0 && rows.length < 3)
    warnings.push("Poucos lançamentos foram reconhecidos; revise o PDF completo.");
  return {
    rows,
    officialTotal: preferredTotal ?? totalCandidates.at(-1) ?? null,
    dueDate,
    rawText,
    warnings,
  };
}

export async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const left = page.view[0] ?? 0;
    const width = (page.view[2] ?? left) - left;
    const groups: { y: number; column: number; items: { x: number; text: string }[] }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      // A fatura Itaú pode trazer dois cartões em colunas lado a lado. A coluna
      // de valores da esquerda cruza o meio geométrico; use a lacuna entre
      // esse valor e a data da coluna direita para separar os lançamentos.
      const column = pageNumber === 1 || x < left + width * 0.57 ? 0 : 1;
      let group = groups.find(
        (candidate) => candidate.column === column && Math.abs(candidate.y - y) < 2.2,
      );
      if (!group) {
        group = { y, column, items: [] };
        groups.push(group);
      }
      group.items.push({ x, text: item.str });
    }
    pages.push(
      groups
        .sort((a, b) => b.y - a.y || a.column - b.column)
        .map(
          (group) =>
            `[[COL:${group.column}]] ${group.items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(" ")}`,
        )
        .join("\n"),
    );
  }
  return pages.join("\n");
}
