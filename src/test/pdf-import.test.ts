import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import {
  compareInvoiceRows,
  compareInvoiceRowsAcrossCards,
  parseInvoiceText,
} from "@/lib/finance/pdf";

describe("leitura local de fatura", () => {
  it("reconhece n/total colado ao nome do estabelecimento", () => {
    const parsed = parseInvoiceText(
      [
        "Lançamentos: compras e saques",
        "07/10 GOL LINHAS A*EWQKW01/04 329,88",
      ].join("\n"),
      "2026-10",
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      description: "GOL LINHAS A*EWQKW01/04",
      type: "parcela",
      installmentNumber: 1,
      installmentTotal: 4,
      amount: 329.88,
    });
  });

  it("reconhece lançamentos em colunas lado a lado e seleciona o total atual", () => {
    const parsed = parseInvoiceText(
      [
        "Total da fatura anterior 15.163,45",
        "Total desta fatura 15.928,73",
        "Vencimento: 23/10/2026",
        "Lançamentos: compras e saques",
        "24/10 CENTRO ODONTOLOGIC 12/12 208,37",
        "23/05 GOWD 05/05 20,98",
      ].join("\n"),
      "2026-10",
    );

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((row) => row.amount)).toEqual([208.37, 20.98]);
    expect(parsed.rows[0]?.installmentNumber).toBe(12);
    expect(parsed.rows[0]?.installmentTotal).toBe(12);
    expect(parsed.officialTotal).toBe(15928.73);
    expect(parsed.dueDate).toBe("2026-10-23");
  });

  it("mantém o estado separado por coluna, inclui TOTALPASS/IOF e encerra na seção futura", () => {
    const parsed = parseInvoiceText(
      [
        "[[COL:0]] Titular 7432",
        "[[COL:1]] Titular 4494",
        "[[COL:0]] Lançamentos: compras e saques",
        "[[COL:1]] Lançamentos: compras e saques",
        "[[COL:0]] 06/10 TOTALPASS 119,90",
        "[[COL:1]] 24/10 CENTRO ODONTOLOGIC12/12 208,37",
        "[[COL:0]] Repasse de IOF em R$ 1,52",
        "[[COL:1]] Compras parceladas - próximas faturas",
        "[[COL:1]] 12/11 COMPRA FUTURA 01/03 100,00",
        "[[COL:0]] 16/10 ESTORNO DE ANUIDADE DIF - 52,50",
      ].join("\n"),
      "2026-10",
    );

    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.map((row) => row.amount)).toEqual([119.9, 208.37, 1.52, -52.5]);
    expect(parsed.rows.map((row) => row.cardLast4)).toEqual(["7432", "4494", "7432", "7432"]);
    expect(parsed.rows[1]).toMatchObject({
      type: "parcela",
      installmentNumber: 12,
      installmentTotal: 12,
    });
    expect(parsed.rows.some((row) => row.description.includes("COMPRA FUTURA"))).toBe(false);
  });

  it("compara parcela prevista, compra nova e duplicidade suspeita sem remover linhas", () => {
    const state = createDemoState();
    const cardId = state.cards[0]!.id;
    state.plans.push({
      id: "plan_pdf_test",
      description: "NOTEBOOK DE TESTE",
      cardId,
      purchaseDate: "2026-08-10",
      total: 240,
      amounts: [120, 120],
      firstMonth: "2026-09",
      shares: [],
    });
    const rows = [
      {
        id: "installment",
        date: "2026-10-10",
        description: "NOTEBOOK DE TESTE 02/02",
        amount: 120,
        type: "parcela" as const,
      },
      {
        id: "new",
        date: "2026-10-11",
        description: "CAFETERIA NOVA",
        amount: 10,
        type: "compra" as const,
      },
      {
        id: "duplicate",
        date: "2026-10-11",
        description: "CAFETERIA NOVA",
        amount: 10,
        type: "compra" as const,
      },
    ];

    const result = compareInvoiceRows(state, cardId, "2026-10", rows);

    expect(result.rows.map((row) => row.status)).toEqual([
      "expected_installment",
      "new_purchase",
      "possible_duplicate",
    ]);
    expect(result.missingInstallments).toEqual([]);
    expect(rows).toHaveLength(3);
  });

  it("compara uma fatura consolidada com lançamentos já existentes em vários cartões", () => {
    const state = createDemoState();
    const first = state.transactions[0]!;
    const last = state.transactions.at(-1)!;
    const rows = [
      {
        id: "existing-a",
        date: first.date,
        description: first.description,
        amount: first.amount,
        type: first.type,
      },
      {
        id: "existing-b",
        date: last.date,
        description: last.description,
        amount: last.amount,
        type: last.type,
      },
    ];

    const result = compareInvoiceRowsAcrossCards(state, "2026-10", rows);

    expect(result.rows.map((row) => row.status)).toEqual(["already_imported", "already_imported"]);
  });
});
