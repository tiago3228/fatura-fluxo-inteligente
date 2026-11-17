import { describe, expect, it } from "vitest";
import { createDemoState } from "@/lib/finance/mock";
import { reducer } from "@/lib/finance/store";
import type { Transaction } from "@/lib/finance/types";
import {
  compareInvoiceRows,
  compareInvoiceRowsAcrossCards,
  extractInvoiceFileText,
  parseInvoiceText,
  shouldImportPdfRow,
} from "@/lib/finance/pdf";

const uint16 = (value: number) => [value & 255, (value >>> 8) & 255];
const uint32 = (value: number) => [
  value & 255,
  (value >>> 8) & 255,
  (value >>> 16) & 255,
  (value >>> 24) & 255,
];
const concatBytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const storedZipFile = (name: string, content: string) => {
  const encoder = new TextEncoder();
  const nameBytes = [...encoder.encode(name)];
  const contentBytes = [...encoder.encode(content)];
  const localHeader = concatBytes(
    uint32(0x04034b50),
    uint16(20),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(contentBytes.length),
    uint32(contentBytes.length),
    uint16(nameBytes.length),
    uint16(0),
    nameBytes,
    contentBytes,
  );
  const directory = concatBytes(
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(contentBytes.length),
    uint32(contentBytes.length),
    uint16(nameBytes.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(0),
    nameBytes,
  );
  const end = concatBytes(
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(1),
    uint16(1),
    uint32(directory.length),
    uint32(localHeader.length),
    uint16(0),
  );
  const bytes = concatBytes([...localHeader], [...directory], [...end]);
  return { name: "fatura.docx", arrayBuffer: async () => bytes.slice().buffer } as File;
};

describe("leitura local de fatura", () => {
  it("reconhece n/total colado ao nome do estabelecimento", () => {
    const parsed = parseInvoiceText(
      ["Lançamentos: compras e saques", "07/10 GOL LINHAS A*EWQKW01/04 329,88"].join("\n"),
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

  it("reconhece data de um dígito sem confundi-la com a referência n/total", () => {
    const parsed = parseInvoiceText(
      ["Lançamentos: compras e saques", "6/04 SHEIN *SHEIN.COM 06/06 71,02"].join("\n"),
      "2026-04",
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      date: "2026-04-06",
      description: "SHEIN *SHEIN.COM 06/06",
      type: "parcela",
      installmentNumber: 6,
      installmentTotal: 6,
      amount: 71.02,
    });
  });

  it("lê TXT tabular mesmo sem os títulos de seção do PDF", async () => {
    const file = {
      name: "fatura.txt",
      text: async () => "Vencimento: 23/11/2026\n10/11 MERCADO DO BAIRRO 42,50",
    } as File;
    const parsed = parseInvoiceText(await extractInvoiceFileText(file), "2026-11");

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ description: "MERCADO DO BAIRRO", amount: 42.5 });
  });

  it("extrai parágrafos e linhas de tabela de um documento Word DOCX", async () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Vencimento: 23/11/2026</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>10/11</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>MERCADO DO BAIRRO</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42,50</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const text = await extractInvoiceFileText(storedZipFile("word/document.xml", documentXml));
    const parsed = parseInvoiceText(text, "2026-11");

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ description: "MERCADO DO BAIRRO", amount: 42.5 });
  });

  it("recalcula datas sem ano quando a competência inferida muda de ano", () => {
    const text = [
      "Vencimento: 23/11/2027",
      "Lançamentos: compras e saques",
      "16/11 COMPRA DE TESTE 10,00",
    ].join("\n");
    const initial = parseInvoiceText(text, "2026-10");
    const corrected = parseInvoiceText(text, initial.dueDate!.slice(0, 7));

    expect(initial.rows[0]?.date).toBe("2026-11-16");
    expect(corrected.rows[0]?.date).toBe("2027-11-16");
  });

  it("atribui o ano anterior a uma compra de dezembro em fatura de janeiro", () => {
    const parsed = parseInvoiceText(
      [
        "Vencimento: 23/01/2027",
        "Lançamentos: compras e saques",
        "16/12 COMPRA DE DEZEMBRO 10,00",
      ].join("\n"),
      "2027-01",
    );

    expect(parsed.rows[0]?.date).toBe("2026-12-16");
    expect(parsed.dueDate).toBe("2027-01-23");
  });

  it("não projeta para depois do vencimento datas sem ano em uma fatura de novembro", () => {
    const parsed = parseInvoiceText(
      [
        "Vencimento: 23/11/2026",
        "Lançamentos: compras e saques",
        "25/01 COMPRA DE JANEIRO 10,00",
        "22/12 COMPRA DE DEZEMBRO 20,00",
      ].join("\n"),
      "2026-11",
    );

    expect(parsed.rows.map((row) => row.date)).toEqual(["2026-01-25", "2025-12-22"]);
  });

  it("reconhece lançamentos em colunas lado a lado e seleciona o total atual", () => {
    const parsed = parseInvoiceText(
      [
        "Total da sua fatura anterior 15.163,45",
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

  it("atualiza o total oficial exibido para o valor do PDF ao reimportar a competência", () => {
    const base = createDemoState();
    const sourceInvoice = base.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-10",
    );
    if (!sourceInvoice) throw new Error("A fixture precisa da fatura de outubro do cartão 7432");
    const initial = {
      ...base,
      invoices: [{ ...sourceInvoice, officialTotal: 12345.67, source: "pdf" as const }],
      transactions: [],
      plans: [],
      recurringCharges: [],
      payments: [],
    };

    const imported = reducer(initial, {
      type: "importInvoice",
      invoice: {
        id: "invoice_reimport_total",
        cardId: "c_7432",
        month: "2026-10",
        dueDate: sourceInvoice.dueDate,
        officialTotal: 15928.73,
        status: "em_revisao",
        source: "pdf",
      },
      transactions: [],
    });

    expect(
      imported.invoices.find(
        (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-10",
      )?.officialTotal,
    ).toBe(15928.73);
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

  it("extrai totais oficiais separados por final de cartão", () => {
    const parsed = parseInvoiceText(
      [
        "[[COL:0]] Titular 7432",
        "[[COL:1]] Titular 4494",
        "[[COL:0]] Lançamentos: compras e saques",
        "[[COL:1]] Lançamentos: compras e saques",
        "[[COL:0]] 06/10 TOTALPASS 119,90",
        "[[COL:1]] 24/10 CENTRO ODONTOLOGIC 208,37",
        "[[COL:0]] Lançamentos no cartão (final 7432): 119,90",
        "[[COL:1]] Lançamentos no cartão (final 4494): 208,37",
        "Total desta fatura 328,27",
      ].join("\n"),
      "2026-10",
    );

    expect(parsed.cardOfficialTotals).toEqual({ "7432": 119.9, "4494": 208.37 });
    expect(parsed.rows.map((row) => row.cardLast4)).toEqual(["7432", "4494"]);
  });

  it("não importa novamente uma linha reconhecida como já cadastrada", () => {
    expect(shouldImportPdfRow(true, "already_imported")).toBe(false);
    expect(shouldImportPdfRow(false, "new_purchase")).toBe(false);
    expect(shouldImportPdfRow(true, "possible_duplicate")).toBe(true);
  });

  it("importa 12/12 preservando a pessoa e não projeta uma parcela 13/12", () => {
    const base = createDemoState();
    const october = base.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-10",
    );
    if (!october) throw new Error("A fixture precisa da fatura de outubro do cartão 7432");
    const personId = "p_tiago";
    const previousInvoice = { ...october, id: "invoice_previous_pdf", source: "pdf" as const };
    const previousTransaction: Transaction = {
      id: "transaction_installment_11_of_12",
      invoiceId: previousInvoice.id,
      date: "2026-10-16",
      description: "MERCADOLIVRE*MERCA11/12",
      amount: 274.77,
      type: "parcela",
      installmentNumber: 11,
      installmentTotal: 12,
      allocations: [{ personId, amount: 274.77 }],
    };
    const initial = {
      ...base,
      invoices: [previousInvoice],
      transactions: [previousTransaction],
      plans: [],
      recurringCharges: [],
      payments: [],
    };
    const imported = reducer(initial, {
      type: "importInvoice",
      invoice: {
        id: "invoice_november_pdf",
        cardId: "c_7432",
        month: "2026-11",
        dueDate: "2026-11-23",
        officialTotal: 274.77,
        status: "em_revisao",
        source: "pdf",
      },
      transactions: [
        {
          id: "transaction_installment_12_of_12",
          invoiceId: "invoice_november_pdf",
          date: "2026-10-16",
          description: "MERCADOLIVRE*MERCA12/12",
          amount: 274.77,
          type: "parcela",
          installmentNumber: 12,
          installmentTotal: 12,
          allocations: [],
        },
      ],
    });

    expect(
      imported.transactions.find(
        (transaction) => transaction.id === "transaction_installment_12_of_12",
      ),
    ).toMatchObject({
      installmentNumber: 12,
      installmentTotal: 12,
      amount: 274.77,
      allocations: [{ personId, amount: 274.77 }],
    });
    expect(
      imported.transactions.some(
        (transaction) =>
          transaction.description.startsWith("MERCADOLIVRE*MERCA") &&
          transaction.installmentNumber === 13,
      ),
    ).toBe(false);
  });

  it("mantém compra nova e parcela de valor divergente sem atribuição automática", () => {
    const base = createDemoState();
    const newPurchaseInvoice = {
      id: "invoice_new_purchase_pdf",
      cardId: "c_7432",
      month: "2026-11",
      dueDate: "2026-11-23",
      officialTotal: 20,
      status: "em_revisao" as const,
      source: "pdf" as const,
    };
    const newPurchaseState = reducer(
      {
        ...base,
        invoices: [],
        transactions: [],
        plans: [],
        recurringCharges: [],
        payments: [],
      },
      {
        type: "importInvoice",
        invoice: newPurchaseInvoice,
        transactions: [
          {
            id: "transaction_new_purchase",
            invoiceId: newPurchaseInvoice.id,
            date: "2026-11-05",
            description: "COMPRA NOVA DO CLIENTE",
            amount: 20,
            type: "compra",
            allocations: [],
          },
        ],
      },
    );
    expect(
      newPurchaseState.transactions.find(
        (transaction) => transaction.id === "transaction_new_purchase",
      )?.allocations,
    ).toEqual([]);

    const october = base.invoices.find(
      (invoice) => invoice.cardId === "c_7432" && invoice.month === "2026-10",
    );
    if (!october) throw new Error("A fixture precisa da fatura de outubro do cartão 7432");
    const previousInvoice = { ...october, id: "invoice_previous_amount", source: "pdf" as const };
    const previousTransaction: Transaction = {
      id: "transaction_previous_amount",
      invoiceId: previousInvoice.id,
      date: "2026-10-16",
      description: "LOJA EXEMPLO 11/12",
      amount: 10,
      type: "parcela",
      installmentNumber: 11,
      installmentTotal: 12,
      allocations: [{ personId: "p_tiago", amount: 10 }],
    };
    const mismatchedAmount = reducer(
      {
        ...base,
        invoices: [previousInvoice],
        transactions: [previousTransaction],
        plans: [],
        recurringCharges: [],
        payments: [],
      },
      {
        type: "importInvoice",
        invoice: { ...newPurchaseInvoice, id: "invoice_amount_mismatch" },
        transactions: [
          {
            id: "transaction_amount_mismatch",
            invoiceId: "invoice_amount_mismatch",
            date: "2026-10-16",
            description: "LOJA EXEMPLO 12/12",
            amount: 11,
            type: "parcela",
            installmentNumber: 12,
            installmentTotal: 12,
            allocations: [],
          },
        ],
      },
    );
    expect(
      mismatchedAmount.transactions.find(
        (transaction) => transaction.id === "transaction_amount_mismatch",
      )?.allocations,
    ).toEqual([]);
  });
});
