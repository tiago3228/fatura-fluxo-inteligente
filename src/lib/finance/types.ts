export type TxType =
  "compra" | "parcela" | "pagamento" | "credito" | "estorno" | "tarifa" | "ajuste";

export interface Person {
  id: string;
  name: string;
  limit: number;
  notes?: string | undefined;
  active: boolean;
  cardIds: string[];
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  brand?: string | undefined;
  last4: string;
  creditLimit?: number | undefined;
  closingDay: number;
  dueDay: number;
  active: boolean;
}

export type InvoiceStatus = "conferida" | "em_revisao" | "inconsistente" | "paga";

export interface PersonPayment {
  id: string;
  personId: string;
  amount: number;
  paidAt: string;
  month: string;
  transactionId?: string;
}

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
  paidAt?: string | undefined;
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
  planId?: string | undefined;
  recurringChargeId?: string | undefined;
  installmentNumber?: number | undefined;
  installmentTotal?: number | undefined;
  /** ID da compra original que gerou este lançamento previsto. */
  projectionSourceId?: string | undefined;
  /** Indica que a linha foi criada pelo sistema e ainda não veio de uma fatura importada. */
  isProjected?: boolean | undefined;
  allocations: Allocation[];
  adjustmentNote?: string | undefined;
  note?: string | undefined;
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

export interface RecurringCharge {
  id: string;
  description: string;
  cardId: string;
  amount: number;
  /** YYYY-MM da primeira projeção */
  startMonth: string;
  /** YYYY-MM em que a projeção deve cessar; meses anteriores permanecem no histórico */
  cancelledFromMonth?: string | undefined;
  shares: PlanShare[];
  sourceTransactionId?: string | undefined;
}

export interface Settings {
  month: string;
  warnPct: number;
  compact: boolean;
  csvSeparator: ";" | ",";
  duplicateCheck: boolean;
  persist: boolean;
  cardLimitTotal?: number | undefined;
}

export interface SpreadsheetArchive {
  id: string;
  fileName: string;
  month: string;
  uploadedAt: string;
  /** Arquivos enviados pelo usuário ficam em base64 para sincronização no workspace. */
  dataUrl?: string;
  /** Arquivos distribuídos com o aplicativo podem usar um caminho público. */
  publicPath?: string;
}

export interface FinanceState {
  people: Person[];
  cards: CreditCard[];
  invoices: Invoice[];
  transactions: Transaction[];
  plans: InstallmentPlan[];
  recurringCharges: RecurringCharge[];
  settings: Settings;
  spreadsheets?: SpreadsheetArchive[];
  payments?: PersonPayment[];
  /** Controle interno das importações automáticas de atribuições. */
  spreadsheetAssignmentVersion?: number;
  /** Cadeias de parcelas previstas removidas explicitamente pelo usuário. */
  suppressedProjectionSources?: string[];
}
