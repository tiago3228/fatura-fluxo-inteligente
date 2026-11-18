import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { FinanceState, PersonPayment } from "@/lib/finance/types";

describe("remoção de recebimentos de pessoas", () => {
  it("remove todas as partes do recebimento selecionado sem alterar outros pagamentos", () => {
    const receiptPartOne: PersonPayment = {
      id: "payment_receipt_one_part_one",
      personId: "p_tiago",
      amount: 80,
      paidAt: "2026-11-15",
      month: "2026-09",
      receiptId: "receipt_one",
      receiptMonth: "2026-11",
    };
    const receiptPartTwo: PersonPayment = {
      ...receiptPartOne,
      id: "payment_receipt_one_part_two",
      amount: 20,
      month: "2026-10",
    };
    const otherReceipt: PersonPayment = {
      ...receiptPartOne,
      id: "payment_receipt_two",
      amount: 15,
      receiptId: "receipt_two",
    };
    const otherPersonPayment: PersonPayment = {
      ...receiptPartOne,
      id: "payment_other_person",
      personId: "p_arlete",
      amount: 25,
      receiptId: "receipt_other_person",
    };
    const initial: FinanceState = {
      ...createDemoState(),
      payments: [receiptPartOne, receiptPartTwo, otherReceipt, otherPersonPayment],
    };

    const result = reducer(initial, {
      type: "removePersonPaymentBatch",
      paymentIds: [receiptPartOne.id, receiptPartTwo.id],
    });

    expect(result.payments).toEqual([otherReceipt, otherPersonPayment]);
  });
});
