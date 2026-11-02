import { useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import {
  compareInvoiceRows,
  compareInvoiceRowsAcrossCards,
  extractPdfText,
  parseInvoiceText,
  shouldImportPdfRow,
  type ExtractedPdfRow,
  type PdfComparisonStatus,
} from "@/lib/finance/pdf";
import { TX_TYPE_LABEL } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, parseBRL, round2, uid } from "@/lib/finance/format";
import type { Transaction, TxType } from "@/lib/finance/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Step = "select" | "processing" | "review";
const STAGES = ["Arquivo selecionado", "Leitura local", "Conferência", "Conclusão"];
type Row = ExtractedPdfRow & {
  amountStr: string;
  assignedCardId: string;
  included: boolean;
  personChoice: string;
  previousPersonIds: string[];
  ignoreReason: string;
};
const normalizedMatchDescription = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const COMPARISON_LABELS: Record<PdfComparisonStatus, string> = {
  possible_duplicate: "Possível duplicidade — confira",
  already_imported: "Já presente nesta fatura",
  expected_installment: "Parcela prevista",
  expected_recurring: "Recorrência prevista",
  new_purchase: "Compra nova",
  unexpected_installment: "Parcela sem previsão",
  other: "Outro lançamento",
};

export function PdfImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useFinance();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("select");
  const [stage, setStage] = useState(0);
  const [drag, setDrag] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [official, setOfficial] = useState("");
  const [cardOfficialTotals, setCardOfficialTotals] = useState<Record<string, number>>({});
  const [manualCardTotals, setManualCardTotals] = useState<Record<string, string>>({});
  const [acceptedDiscrepancySignature, setAcceptedDiscrepancySignature] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [cardId, setCardId] = useState(state.cards[0]?.id ?? "");
  const input = useRef<HTMLInputElement>(null);
  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      setFile(null);
      setError(null);
      setWarning([]);
      setStep("select");
      setStage(0);
      setRows([]);
      setOfficial("");
      setCardOfficialTotals({});
      setManualCardTotals({});
      setAcceptedDiscrepancySignature("");
      setDueDate("");
    }, 200);
  };
  const pick = (next?: File | null) => {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".pdf")) {
      setError("Selecione um arquivo com extensão .pdf");
      return;
    }
    if (next.size > 20 * 1024 * 1024) {
      setError("O PDF deve ter no máximo 20 MB");
      return;
    }
    setError(null);
    setFile(next);
  };
  const process = async () => {
    if (!file) {
      setError("Nenhum arquivo selecionado.");
      return;
    }
    setStep("processing");
    setStage(1);
    try {
      const text = await extractPdfText(file);
      const month = state.settings.month;
      const parsed = parseInvoiceText(text, month);
      const detectedCards = [...new Set(parsed.rows.map((row) => row.cardLast4).filter(Boolean))];
      const matchingCard =
        detectedCards.length === 1
          ? state.cards.find((item) => item.last4 === detectedCards[0])
          : undefined;
      if (detectedCards.length === 1) {
        if (matchingCard) setCardId(matchingCard.id);
      }
      const defaultCardId = matchingCard?.id ?? cardId;
      setRows(
        parsed.rows.map((row) => {
          const assignedCardId = row.cardLast4
            ? (state.cards.find((item) => item.last4 === row.cardLast4)?.id ?? "")
            : detectedCards.length <= 1
              ? defaultCardId
              : "";
          const previous = assignedCardId
            ? state.transactions.find((transaction) => {
                const invoice = state.invoices.find((item) => item.id === transaction.invoiceId);
                return (
                  invoice?.cardId === assignedCardId &&
                  invoice.month <= month &&
                  Math.abs(transaction.amount - row.amount) < 0.01 &&
                  normalizedMatchDescription(transaction.description) ===
                    normalizedMatchDescription(row.description)
                );
              })
            : undefined;
          return {
            ...row,
            amountStr: row.amount.toFixed(2).replace(".", ","),
            assignedCardId,
            included: true,
            personChoice: "auto",
            previousPersonIds: previous?.allocations.map((item) => item.personId) ?? [],
            ignoreReason: "Ignorada na revisão pelo usuário",
          };
        }),
      );
      setCardOfficialTotals(parsed.cardOfficialTotals ?? {});
      setManualCardTotals({});
      setAcceptedDiscrepancySignature("");
      setOfficial(
        parsed.officialTotal === null ? "" : parsed.officialTotal.toFixed(2).replace(".", ","),
      );
      setDueDate(parsed.dueDate ?? "");
      setWarning(parsed.warnings);
      setStage(3);
      setStep("review");
    } catch (e) {
      setStep("select");
      setError(
        e instanceof Error
          ? `Não foi possível ler este PDF: ${e.message}`
          : "Não foi possível ler este PDF.",
      );
    }
  };
  const parsed = rows.map((row) => ({ ...row, value: parseBRL(row.amountStr) }));
  const sum = round2(parsed.reduce((total, row) => total + (row.value ?? 0), 0));
  const officialValue = parseBRL(official);
  const selectedRows = parsed.filter((row) => row.included);
  const month = (dueDate || state.settings.month).slice(0, 7);
  const diff = officialValue === null ? null : round2(officialValue - sum);
  const cardLast4s = [...new Set(parsed.map((row) => row.cardLast4).filter(Boolean))];
  const multiCardStatement = cardLast4s.length > 1;
  const cardGroups = [...new Set(parsed.map((row) => row.assignedCardId).filter(Boolean))];
  const consolidated = multiCardStatement || cardGroups.length > 1;
  const unassignedRows = parsed.filter(
    (row) =>
      !row.assignedCardId || !state.cards.some((cardItem) => cardItem.id === row.assignedCardId),
  );
  const officialForCard = (id: string) => {
    if (Object.hasOwn(manualCardTotals, id)) return parseBRL(manualCardTotals[id] ?? "");
    if (!consolidated && cardGroups.length === 1 && officialValue !== null) return officialValue;
    const cardItem = state.cards.find((item) => item.id === id);
    const extracted = cardItem ? cardOfficialTotals[cardItem.last4] : undefined;
    if (extracted !== undefined) return extracted;
    return !consolidated && cardGroups.length === 1 ? officialValue : null;
  };
  const perCardComparisons = cardGroups.map((id) => ({
    id,
    result: compareInvoiceRows(
      state,
      id,
      month,
      parsed
        .filter((row) => row.assignedCardId === id)
        .map((row) => ({ ...row, amount: row.value ?? row.amount })),
    ),
  }));
  const unassignedComparison = unassignedRows.length
    ? compareInvoiceRowsAcrossCards(
        state,
        month,
        unassignedRows.map((row) => ({ ...row, amount: row.value ?? row.amount })),
      )
    : null;
  const comparisonRows = [
    ...perCardComparisons.flatMap((item) => item.result.rows),
    ...(unassignedComparison?.rows ?? []),
  ];
  const comparisonStatus = new Map(comparisonRows.map((row) => [row.rowId, row.status]));
  const missingInstallments = perCardComparisons.flatMap((item) =>
    item.result.missingInstallments.map((missing) => ({ ...missing, cardId: item.id })),
  );
  const includedRows = parsed.filter(
    (row) => shouldImportPdfRow(row.included, comparisonStatus.get(row.id)),
  );
  const invalid = includedRows.filter((row) => row.value === null || !row.description.trim());
  const comparisonCount = (status: PdfComparisonStatus) =>
    comparisonRows.filter((row) => row.status === status).length;
  const missingCardTotals = cardGroups.filter((id) => officialForCard(id) === null);
  const cardDiffs = cardGroups.map((id) => {
    const total = officialForCard(id);
    const included = round2(
      parsed
        .filter(
          (row) =>
            row.assignedCardId === id &&
            (row.included || comparisonStatus.get(row.id) === "already_imported"),
        )
        .reduce((value, row) => value + (row.value ?? 0), 0),
    );
    return { id, total, included, diff: total === null ? null : round2(total - included) };
  });
  const hasCardDiscrepancies = cardDiffs.some((item) => item.diff !== null && item.diff !== 0);
  const discrepancySignature = JSON.stringify({
    rows: parsed.map((row) => [row.id, row.assignedCardId, row.included, row.value]),
    totals: cardGroups.map((id) => [id, officialForCard(id)]),
  });
  const discrepancyAccepted = acceptedDiscrepancySignature === discrepancySignature;
  const canConfirm =
    parsed.length > 0 &&
    invalid.length === 0 &&
    unassignedRows.length === 0 &&
    cardGroups.length > 0 &&
    missingCardTotals.length === 0 &&
    (!hasCardDiscrepancies || discrepancyAccepted);

  const resolvedPersonIds = (row: Row) => {
    if (row.personChoice === "none") return [];
    if (row.personChoice !== "auto") return [row.personChoice];
    if (row.previousPersonIds.length) return row.previousPersonIds;
    const holder = state.people.find(
      (person) => person.active && person.cardIds.includes(row.assignedCardId),
    );
    return holder ? [holder.id] : [];
  };

  const confirm = () => {
    if (!canConfirm || !file) return;
    const importBatchId = uid("import");
    const importedAt = new Date().toISOString();
    let includedCount = 0;
    let ignoredCount = 0;
    for (const groupCardId of cardGroups) {
      const groupRows = parsed.filter((row) => row.assignedCardId === groupCardId);
      const groupIncluded = groupRows.filter(
        (row) => shouldImportPdfRow(row.included, comparisonStatus.get(row.id)),
      );
      const groupIgnored = groupRows.filter(
        (row) => !shouldImportPdfRow(row.included, comparisonStatus.get(row.id)),
      );
      const cardItem = state.cards.find((item) => item.id === groupCardId);
      if (!cardItem) continue;
      const invoiceId = uid("invoice");
      const personOverrides: Record<string, { personId: string; amount: number }[]> = {};
      const sourceToTransactionId = new Map<string, string>();
      const txs: Transaction[] = groupIncluded.map((row) => {
        const transactionId = uid("tx");
        const amount = row.value!;
        sourceToTransactionId.set(row.id, transactionId);
        if (row.personChoice !== "auto") {
          personOverrides[transactionId] =
            row.personChoice === "none" ? [] : [{ personId: row.personChoice, amount }];
        }
        return {
          id: transactionId,
          invoiceId,
          date: row.date,
          description: row.description.trim(),
          amount,
          type: row.type,
          ...(row.installmentNumber !== undefined
            ? { installmentNumber: row.installmentNumber }
            : {}),
          ...(row.installmentTotal !== undefined ? { installmentTotal: row.installmentTotal } : {}),
          allocations:
            row.personChoice !== "auto" && row.personChoice !== "none"
              ? [{ personId: row.personChoice, amount }]
              : [],
        };
      });
      includedCount += groupIncluded.length;
      ignoredCount += groupIgnored.length;
      const officialForGroup = officialForCard(groupCardId)!;
      const existingInvoice = state.invoices.find(
        (item) => item.cardId === groupCardId && item.month === month,
      );
      const preservedActualTotal = round2(
        existingInvoice
          ? state.transactions
              .filter((item) => item.invoiceId === existingInvoice.id && !item.isProjected)
              .reduce((total, item) => total + item.amount, 0)
          : 0,
      );
      const newIncludedTotal = round2(
        groupIncluded
          .filter((row) => comparisonStatus.get(row.id) !== "already_imported")
          .reduce((total, row) => total + (row.value ?? 0), 0),
      );
      const resultingTotal = round2(preservedActualTotal + newIncludedTotal);
      const rowsAudit = groupRows.map((row) => ({
        sourceRowId: row.id,
        date: row.date,
        description: row.description.trim(),
        amount: row.value ?? row.amount,
        cardId: groupCardId,
        ...(row.cardLast4 ? { cardLast4: row.cardLast4 } : {}),
        included: groupIncluded.some((item) => item.id === row.id),
        comparisonStatus: comparisonStatus.get(row.id) ?? ("other" as const),
        ...(!groupIncluded.some((item) => item.id === row.id)
          ? {
              reason:
                comparisonStatus.get(row.id) === "already_imported"
                  ? "Já presente nesta fatura; não foi inserida novamente"
                  : row.ignoreReason.trim() || "Ignorada na revisão",
            }
          : {}),
        personIds: resolvedPersonIds(row),
        ...(sourceToTransactionId.has(row.id)
          ? { transactionId: sourceToTransactionId.get(row.id) }
          : {}),
      }));
      dispatch({
        type: "importInvoice",
        invoice: {
          id: invoiceId,
          cardId: cardItem.id,
          month,
          dueDate: dueDate || `${month}-${String(cardItem.dueDay).padStart(2, "0")}`,
          officialTotal: officialForGroup,
          status: resultingTotal === officialForGroup ? "em_revisao" : "inconsistente",
          source: "pdf",
          importHistory: [
            {
              id: importBatchId,
              fileName: file.name,
              importedAt,
              statementTotal: officialForGroup,
              includedCount: groupIncluded.length,
              ignoredCount: groupIgnored.length,
              rows: rowsAudit,
            },
          ],
        },
        transactions: txs,
        personOverrides,
      });
    }
    toast.success("Faturas separadas por cartão para conferência", {
      description: `${cardGroups.length} cartão(ões), ${includedCount} linha(s) incluída(s), ${ignoredCount} ignorada(s). Atribuições compatíveis foram reaproveitadas; histórico por linha registrado.`,
    });
    close();
  };
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent
        className={cn(
          "max-h-[92vh] overflow-y-auto",
          step === "review" ? "sm:max-w-5xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>Importar fatura PDF</DialogTitle>
          <DialogDescription>
            O PDF é lido localmente no navegador. Os lançamentos reconhecidos sempre passam por
            revisão antes de serem adicionados.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {STAGES.map((label, i) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-1.5",
                i <= stage ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[10px]",
                  i < stage && "border-primary bg-primary text-primary-foreground",
                  i === stage && "border-primary",
                )}
              >
                {i < stage ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
        {step === "select" && (
          <>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center hover:bg-muted/50",
                drag && "border-primary bg-accent",
                error && "border-danger",
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="font-semibold">Arraste o PDF aqui ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground">
                PDF com texto selecionável · até 20 MB
              </p>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0])}
                aria-label="Arquivo PDF da fatura"
              />
            </div>
            {file && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                <FileText className="size-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                  Trocar
                </Button>
              </div>
            )}
            {error && <p className="text-sm font-medium text-danger">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button onClick={process} disabled={!file}>
                Ler PDF
              </Button>
            </DialogFooter>
          </>
        )}
        {step === "processing" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-semibold">Extraindo texto localmente…</p>
            <p className="text-sm text-muted-foreground">
              O arquivo não é enviado para um servidor.
            </p>
          </div>
        )}
        {step === "review" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {!consolidated ? (
                <label className="text-sm">
                  Cartão
                  <Select value={cardId} onValueChange={setCardId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {state.cards.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} •••• {c.last4}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <p className="self-end text-sm text-muted-foreground">
                  Atribuição do cartão é revisada em cada linha abaixo.
                </p>
              )}
              <label className="text-sm">
                Mês
                <Input
                  type="month"
                  value={month}
                  onChange={(e) => setDueDate(`${e.target.value}-01`)}
                />
              </label>
              <label className="text-sm">
                Vencimento
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label className="text-sm">
                Total oficial
                <Input
                  inputMode="decimal"
                  value={official}
                  onChange={(e) => setOfficial(e.target.value)}
                />
              </label>
            </div>
            {warning.map((w) => (
              <p key={w} className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                {w}
              </p>
            ))}
            {consolidated && (
              <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                PDF consolidado ({cardLast4s.map((last4) => `•••• ${last4}`).join(", ")}). Cada
                linha será revisada e gravada na fatura do cartão escolhido; totais oficiais por
                cartão precisam ser conferidos antes da confirmação.
              </p>
            )}
            {unassignedRows.length > 0 && (
              <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                {unassignedRows.length} linha(s) ainda não têm cartão atribuído. Selecione um cartão
                na própria linha; nenhuma delas será importada silenciosamente.
              </p>
            )}
            {consolidated && (
              <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
                {cardGroups.map((groupId) => {
                  const cardItem = state.cards.find((item) => item.id === groupId);
                  if (!cardItem) return null;
                  const extracted = cardOfficialTotals[cardItem.last4];
                  const shownTotal =
                    manualCardTotals[groupId] ??
                    (extracted === undefined ? "" : extracted.toFixed(2).replace(".", ","));
                  const recognized = round2(
                    parsed
                      .filter((row) => row.assignedCardId === groupId)
                      .reduce((total, row) => total + (row.value ?? 0), 0),
                  );
                  const cardDiff = cardDiffs.find((item) => item.id === groupId)?.diff;
                  return (
                    <label key={groupId} className="space-y-1 text-sm">
                      <span className="font-medium">Total oficial — {cardItem.name}</span>
                      <Input
                        inputMode="decimal"
                        value={shownTotal}
                        onChange={(event) =>
                          setManualCardTotals((current) => ({
                            ...current,
                            [groupId]: event.target.value,
                          }))
                        }
                        aria-label={`Total oficial do cartão ${cardItem.last4}`}
                      />
                      <span className="block text-xs text-muted-foreground">
                        Reconhecido neste cartão: {fmtBRL(recognized)}
                        {extracted === undefined
                          ? " · informe o total do PDF"
                          : " · extraído do resumo do cartão"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Soma considerada para comparação (inclui linhas já cadastradas): {fmtBRL(
                          cardDiffs.find((item) => item.id === groupId)?.included ?? 0,
                        )}
                      </span>
                      {cardDiff !== null && cardDiff !== undefined && cardDiff !== 0 && (
                        <span className="block text-xs font-medium text-danger">
                          Diferença para a soma considerada: {fmtBRL(cardDiff)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {hasCardDiscrepancies && (
              <label className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <input
                  type="checkbox"
                  checked={discrepancyAccepted}
                  onChange={(event) =>
                    setAcceptedDiscrepancySignature(
                      event.target.checked ? discrepancySignature : "",
                    )
                  }
                />
                <span>
                  Confirmo importar apesar das diferenças entre os totais oficiais e as linhas
                  selecionadas. As faturas afetadas ficarão marcadas como inconsistentes; nenhum
                  valor será ajustado automaticamente.
                </span>
              </label>
            )}
            {diff !== null && diff !== 0 && (
              <p className="flex gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
                <AlertTriangle className="size-4 shrink-0" />A soma reconhecida ({fmtBRL(sum)})
                difere do total informado ({fmtBRL(officialValue!)}). A diferença ficará para
                conferência.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {parsed.length} lançamento(s) reconhecido(s); {selectedRows.length} selecionado(s),{" "}
              {includedRows.length} novo(s) será(ão) gravado(s) e {parsed.length - includedRows.length}{" "}
              ignorado(s) ou já presente(s). Linhas sem gravação ficam no histórico da importação.
            </p>
            <p className="rounded-lg border p-3 text-sm">
              Comparação: {comparisonCount("already_imported")} já cadastrada(s),{" "}
              {comparisonCount("expected_installment")} parcela(s) prevista(s),{" "}
              {comparisonCount("expected_recurring")} recorrência(s) prevista(s),{" "}
              {comparisonCount("new_purchase")} compra(s) nova(s),{" "}
              {comparisonCount("possible_duplicate")} possível(is) duplicidade(s) e{" "}
              {comparisonCount("unexpected_installment")} parcela(s) sem previsão. Duplicidades são
              apenas sinalizadas, nunca removidas automaticamente.
            </p>
            {missingInstallments.length > 0 && (
              <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
                Parcelas previstas não encontradas:{" "}
                {missingInstallments
                  .map(
                    (item) =>
                      `${state.cards.find((cardItem) => cardItem.id === item.cardId)?.last4 ?? "cartão"}: ${item.description} (${fmtBRL(item.amount)})`,
                  )
                  .join("; ")}
                .
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[1250px] text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr className="[&_th]:px-3 [&_th]:py-2">
                    <th>Data</th>
                    <th>Cartão</th>
                    <th>Descrição</th>
                    <th>Responsável</th>
                    <th>Decisão</th>
                    <th>Tipo</th>
                    <th className="text-right">Valor</th>
                    <th>Conferência</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "[&_td]:px-3 [&_td]:py-2",
                        r.included && r.value === null && "bg-danger-soft",
                        !r.included && "opacity-70",
                      )}
                    >
                      <td className="num whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td>
                        <Select
                          value={r.assignedCardId || "unassigned"}
                          onValueChange={(value) =>
                            setRows((all) =>
                              all.map((item) =>
                                item.id === r.id
                                  ? { ...item, assignedCardId: value === "unassigned" ? "" : value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            className="w-48"
                            aria-label={`Cartão da linha ${r.description}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Selecionar cartão</SelectItem>
                            {state.cards.map((cardItem) => (
                              <SelectItem key={cardItem.id} value={cardItem.id}>
                                {cardItem.name} •••• {cardItem.last4}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        <Input
                          value={r.description}
                          onChange={(e) =>
                            setRows((all) =>
                              all.map((x) =>
                                x.id === r.id ? { ...x, description: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Select
                          value={r.personChoice}
                          onValueChange={(value) =>
                            setRows((all) =>
                              all.map((item) =>
                                item.id === r.id ? { ...item, personChoice: value } : item,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            className="w-56"
                            aria-label={`Responsável pela linha ${r.description}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              {r.previousPersonIds.length
                                ? `Preservar: ${state.people
                                    .filter((person) => r.previousPersonIds.includes(person.id))
                                    .map((person) => person.name)
                                    .join(", ")}`
                                : "Reaproveitar se houver correspondência"}
                            </SelectItem>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {state.people
                              .filter((person) => person.active)
                              .map((person) => (
                                <SelectItem key={person.id} value={person.id}>
                                  {person.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="min-w-44">
                        <label className="flex items-center gap-2 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={
                              r.included && comparisonStatus.get(r.id) !== "already_imported"
                            }
                            disabled={comparisonStatus.get(r.id) === "already_imported"}
                            onChange={(event) =>
                              setRows((all) =>
                                all.map((item) =>
                                  item.id === r.id
                                    ? { ...item, included: event.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />
                          {comparisonStatus.get(r.id) === "already_imported"
                            ? "Já cadastrada — não duplicar"
                            : r.included
                              ? "Incluir"
                              : "Ignorar"}
                        </label>
                        {!r.included && (
                          <Input
                            className="mt-1"
                            value={r.ignoreReason}
                            aria-label={`Motivo para ignorar ${r.description}`}
                            onChange={(event) =>
                              setRows((all) =>
                                all.map((item) =>
                                  item.id === r.id
                                    ? { ...item, ignoreReason: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        )}
                      </td>
                      <td>
                        <Select
                          value={r.type}
                          onValueChange={(value) =>
                            setRows((all) =>
                              all.map((x) => (x.id === r.id ? { ...x, type: value as TxType } : x)),
                            )
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TX_TYPE_LABEL) as TxType[]).map((type) => (
                              <SelectItem key={type} value={type}>
                                {TX_TYPE_LABEL[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        <Input
                          className="num w-32 text-right"
                          value={r.amountStr}
                          onChange={(e) =>
                            setRows((all) =>
                              all.map((x) =>
                                x.id === r.id ? { ...x, amountStr: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="text-xs">
                        {COMPARISON_LABELS[comparisonStatus.get(r.id) ?? "other"]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("select")}>
                Voltar
              </Button>
              <Button onClick={confirm} disabled={!canConfirm}>
                Confirmar importação para revisão
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
