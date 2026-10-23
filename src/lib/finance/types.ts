export type TxType = "compra" | "parcela" | "pagamento" | "credito" | "estorno" | "tarifa" | "ajuste";

export interface Person {
  id: string;
  name: string;
  limit: number;
  notes?: string;
  active: boolean;
  cardIds: string[];
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  brand?: string;
  last4: string;
  creditLimit?: number;
  closingDay: number;
  dueDay: number;
  active: boolean;
}

export type InvoiceStatus = "conferida" | "em_revisao" | "inconsistente";

export interface Invoice {
  id: string;
  cardId: string;
  /** YYYY-MM */
  month: string;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Valor oficial informado na fatura */
  officialTotal: number;
  status: InvoiceStatus;
  payments?: InvoicePayment[];
  source: "demo" | "pdf" | "pdf_demo" | "planilha";
}

export interface InvoicePayment {
  personId: string;
  amount: number;
  /** YYYY-MM-DD */
  paidAt: string;
}

export interface Allocation {
  personId: string;
  amount: number;
}

export interface Transaction {
  id: string;
  invoiceId: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** Valor original. Créditos/estornos/pagamentos são negativos. */
  amount: number;
  type: TxType;
  planId?: string;
  installmentNumber?: number;
  installmentTotal?: number;
  allocations: Allocation[];
  adjustmentNote?: string;
}

export interface PlanShare {
  personId: string;
  /** 0-100 */
  pct: number;
}

export interface InstallmentPlan {
  id: string;
  description: string;
  cardId: string;
  purchaseDate: string;
  total: number;
  /** Valores efetivos de cada parcela, preservados como informados */
  amounts: number[];
  /** YYYY-MM da 1ª parcela */
  firstMonth: string;
  shares: PlanShare[];
}

export interface Settings {
  month: string;
  warnPct: number;
  compact: boolean;
  csvSeparator: ";" | ",";
  duplicateCheck: boolean;
  persist: boolean;
}

export interface FinanceState {
  people: Person[];
  cards: CreditCard[];
  invoices: Invoice[];
  transactions: Transaction[];
  plans: InstallmentPlan[];
  settings: Settings;
}
