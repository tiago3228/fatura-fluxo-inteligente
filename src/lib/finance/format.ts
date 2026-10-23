const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const fmtBRL = (v: number) => brl.format(Math.round(v * 100) / 100);

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]}/${y}`;
};
export const fmtMonthLong = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_FULL[m - 1]} de ${y}`;
};

export const fmtPct = (v: number) => `${Math.round(v)}%`;

export const round2 = (v: number) => Math.round(v * 100) / 100;

export const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

/** Converte "1.250,50" ou "1250.50" em número */
export const parseBRL = (s: string): number | null => {
  const clean = String(s).replace(/[R$\s]/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};
