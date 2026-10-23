import type { TxType } from "./types";
import { parseBRL, round2 } from "./format";

export type ExtractedPdfRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TxType;
  installmentNumber?: number;
  installmentTotal?: number;
  review?: string;
};

export type ExtractedPdfInvoice = {
  rows: ExtractedPdfRow[];
  officialTotal: number | null;
  dueDate: string | null;
  rawText: string;
  warnings: string[];
};

function isoDate(value: string, fallbackMonth: string) {
  const parts = value.split(/[\/.-]/).map(Number);
  if (parts.length < 2 || parts.some((x) => !Number.isFinite(x))) return null;
  const [d, m, y] = parts;
  const year = y && y > 2000 ? y : Number(fallbackMonth.slice(0, 4));
  const month = m || Number(fallbackMonth.slice(5, 7));
  if (d < 1 || d > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function amountAtEnd(line: string) {
  const matches = line.match(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+[.,]\d{2}/g);
  const value = matches?.at(-1);
  return value ? parseBRL(value) : null;
}

function normalizeDescription(line: string, date: string) {
  return line.replace(new RegExp(`^${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*`), "").replace(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+[.,]\d{2}\s*$/, "").replace(/\s{2,}/g, " ").trim();
}

export function parseInvoiceText(rawText: string, fallbackMonth: string): ExtractedPdfInvoice {
  const warnings: string[] = [];
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const datePattern = /\b\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?\b/;
  const rows: ExtractedPdfRow[] = [];
  lines.forEach((line, index) => {
    const dateMatch = line.match(datePattern);
    const amount = amountAtEnd(line);
    if (!dateMatch || amount === null || Math.abs(amount) > 10000000) return;
    const date = isoDate(dateMatch[0], fallbackMonth);
    if (!date) return;
    const description = normalizeDescription(line, dateMatch[0]);
    if (!description || /total|vencimento|pagamento mínimo|limite disponível/i.test(description)) return;
    const negative = amount < 0 || /estorno|crédito|credito|devolução|devolucao/i.test(description);
    const type: TxType = negative ? (amount < 0 ? "estorno" : "credito") : /tarifa|encargo|iof|juros/i.test(description) ? "tarifa" : /\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(description) ? "parcela" : "compra";
    const installment = description.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
    rows.push({ id: `pdf_${index}_${date}`, date, description, amount: round2(amount), type, ...(installment ? { installmentNumber: Number(installment[1]), installmentTotal: Number(installment[2]) } : {}), ...(description.length < 3 ? { review: "Descrição curta — confira" } : {}) });
  });
  const totalCandidates = lines.filter((l) => /total da fatura|total fatura|valor total|total a pagar/i.test(l)).map(amountAtEnd).filter((v): v is number => v !== null);
  const dueLine = lines.find((l) => /vencimento|vence em/i.test(l));
  const dueDate = dueLine?.match(datePattern)?.[0] ? isoDate(dueLine.match(datePattern)![0], fallbackMonth) : null;
  if (rows.length === 0) warnings.push("Não foi encontrado texto tabular com data e valor. Este PDF pode ser escaneado ou ter um layout não reconhecido.");
  if (rows.length > 0 && !totalCandidates.length) warnings.push("O total oficial não foi identificado; confira-o manualmente antes de confirmar.");
  if (rows.length > 0 && rows.length < 3) warnings.push("Poucos lançamentos foram reconhecidos; revise o PDF completo.");
  return { rows, officialTotal: totalCandidates.at(-1) ?? null, dueDate, rawText, warnings };
}

export async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n");
}
