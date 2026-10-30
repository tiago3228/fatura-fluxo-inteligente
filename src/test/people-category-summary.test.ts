import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { personCategorySummary } from "@/lib/finance/reports";

describe("relatório de gastos por categoria por pessoa", () => {
  it("soma a parte atribuída à pessoa por categoria no mês selecionado", () => {
    const base = createDemoState();
    const person = base.people[0];
    const invoice = base.invoices.find((item) => item.month === base.settings.month);
    const template = base.transactions[0];
    expect(person).toBeDefined();
    expect(invoice).toBeDefined();
    expect(template).toBeDefined();
    if (!person || !invoice || !template) return;

    const state = {
      ...base,
      transactions: [
        {
          ...template,
          id: "health-share",
          invoiceId: invoice.id,
          amount: 1000,
          category: "Saúde",
          type: "compra" as const,
          allocations: [{ personId: person.id, amount: 150 }],
        },
        {
          ...template,
          id: "fuel",
          invoiceId: invoice.id,
          amount: 300,
          category: "Gasolina",
          type: "compra" as const,
          allocations: [{ personId: person.id, amount: 300 }],
        },
        {
          ...template,
          id: "uncategorized",
          invoiceId: invoice.id,
          amount: 40,
          category: undefined,
          type: "compra" as const,
          allocations: [{ personId: person.id, amount: 40 }],
        },
        {
          ...template,
          id: "payment",
          invoiceId: invoice.id,
          amount: 200,
          category: "Pagamento",
          type: "pagamento" as const,
          allocations: [{ personId: person.id, amount: 200 }],
        },
      ],
    };

    expect(personCategorySummary(state, person.id, invoice.month)).toEqual([
      { category: "Gasolina", total: 300 },
      { category: "Saúde", total: 150 },
      { category: "Sem categoria", total: 40 },
    ]);
  });
});
