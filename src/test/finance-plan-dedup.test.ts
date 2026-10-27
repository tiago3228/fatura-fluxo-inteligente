import { describe, expect, it } from "vitest";
import { committedMonthTotal, totalFutureCommitted } from "@/lib/finance/calc";
import { createDemoState } from "@/lib/finance/mock";
import type { FinanceState, InstallmentPlan, Transaction } from "@/lib/finance/types";

const cardId = "c_7432";
const personId = "p_tiago";

function stateWithPlanAndImportedInstallments(extraMatchingTransaction = false): FinanceState {
  const base = createDemoState();
  const sourceInvoice = base.invoices.find((invoice) => invoice.cardId === cardId);
  if (!sourceInvoice) throw new Error("A fixture precisa do cartão escolhido");

  const invoice = {
    ...sourceInvoice,
    id: "invoice_plan_dedup_november",
    cardId,
    month: "2026-11",
    officialTotal: extraMatchingTransaction ? 100 : 50,
    status: "em_revisao" as const,
  };
  const plan: InstallmentPlan = {
    id: "plan_notebook",
    description: "Notebook",
    cardId,
    purchaseDate: "2026-10-10",
    total: 100,
    amounts: [50, 50],
    firstMonth: "2026-11",
    shares: [{ personId, pct: 100 }],
  };
  const transaction: Transaction = {
    id: "imported_notebook_installment_1",
    invoiceId: invoice.id,
    date: "2026-11-10",
    description: "Notebook 1/2",
    amount: 50,
    type: "parcela",
    installmentNumber: 1,
    installmentTotal: 2,
    allocations: [{ personId, amount: 50 }],
  };
  const transactions = [transaction];
  if (extraMatchingTransaction) {
    transactions.push({ ...transaction, id: "second_notebook_purchase" });
  }

  return {
    ...base,
    invoices: [invoice],
    transactions,
    plans: [plan],
    recurringCharges: [],
    payments: [],
  };
}

describe("deduplicação conservadora entre planos e parcelas importadas", () => {
  it("não soma duas vezes o mesmo compromisso no mês atual nem no futuro", () => {
    const state = stateWithPlanAndImportedInstallments();

    expect(committedMonthTotal(state, "2026-11")).toBe(50);
    expect(totalFutureCommitted(state, "2026-10")).toBe(100);
  });

  it("mantém uma segunda compra idêntica como compromisso independente", () => {
    const state = stateWithPlanAndImportedInstallments(true);

    expect(committedMonthTotal(state, "2026-11")).toBe(100);
    expect(totalFutureCommitted(state, "2026-10")).toBe(150);
  });

  it("não associa parcelas com valor diferente ao plano cadastrado", () => {
    const state = stateWithPlanAndImportedInstallments();
    const transaction = state.transactions[0];
    if (!transaction) throw new Error("A fixture precisa da parcela importada");
    const mismatched: FinanceState = {
      ...state,
      transactions: [{ ...transaction, amount: 49 }],
    };

    expect(committedMonthTotal(mismatched, "2026-11")).toBe(99);
    expect(totalFutureCommitted(mismatched, "2026-10")).toBe(149);
  });
});
