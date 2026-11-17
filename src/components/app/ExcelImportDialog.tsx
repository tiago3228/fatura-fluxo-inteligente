import { useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import {
  availableMonths,
  addMonths,
  dateInMonth,
  installmentReferenceFromDescription,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, parseBRL, round2, uid } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "./common";
import { cn } from "@/lib/utils";
import { PURCHASE_CATEGORIES } from "@/lib/finance/categories";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  guessSpreadsheetColumns,
  matchSpreadsheetPeople,
  resolveSpreadsheetCard,
  SPREADSHEET_FIELDS,
  splitAmountAcrossPeople,
  type SpreadsheetFieldKey,
} from "@/lib/finance/spreadsheet-import";

type FieldKey = SpreadsheetFieldKey;
const FIELDS = SPREADSHEET_FIELDS;
const NONE = "__none";
type DuplicateSpreadsheetPrompt = {
  rows: unknown[][];
  fileName: string;
  sha256: string;
  previousImportedAt: string;
};
type SpreadsheetAllocationOverride = { personIds: string[]; split: boolean };

const SAMPLE: unknown[][] = [
  ["Data", "Estabelecimento", "Valor (R$)", "Quem", "Final"],
  ["05/08/2026", "Padaria Real", "32,50", "Tiago", ""],
  ["07/08/2026", "Posto Shell", "200,00", "Pedro", ""],
  ["10/08/2026", "Farmácia São João", "", "Mariana", ""],
  ["12/08/2026", "Cinemark", "120,00", "Pedro", ""],
  ["12/08/2026", "Cinemark", "120,00", "Pedro", ""],
  ["15/08/2026", "Livraria Cultura", "89,90", "Joana", ""],
  ["31/02/2026", "Data inválida", "10,00", "", ""],
];

const parseDate = (v: unknown): string | null => {
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export function ExcelImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, dispatch } = useFinance();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicateSpreadsheetPrompt | null>(null);
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedDuplicateRows, setConfirmedDuplicateRows] = useState<Set<number>>(
    () => new Set(),
  );
  const [allocationOverrides, setAllocationOverrides] = useState<
    Record<number, SpreadsheetAllocationOverride>
  >({});
  const [map, setMap] = useState<Record<FieldKey, number | null>>({
    date: null,
    description: null,
    amount: null,
    person: null,
    card: null,
    category: null,
  });
  const [cardId, setCardId] = useState(state.cards[0]?.id ?? "");
  const [month, setMonth] = useState(
    addMonths(availableMonths(state).at(-1) ?? state.settings.month, -1),
  );
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFileName(null);
    setFileHash(null);
    setDuplicatePrompt(null);
    setRows(null);
    setError(null);
    setConfirmedDuplicateRows(new Set());
    setAllocationOverrides({});
    setStep(1);
  };
  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const load = (data: unknown[][], name: string, sha256: string | null = null) => {
    const clean = data.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    if (clean.length < 2 || !clean[0]) {
      setError("A planilha não tem linhas de dados.");
      return;
    }
    const headers = clean[0].map((h) => String(h ?? ""));
    const guess = guessSpreadsheetColumns(headers);
    setMap(guess);
    setConfirmedDuplicateRows(new Set());
    setAllocationOverrides({});
    setRows(clean);
    setFileName(name);
    setFileHash(sha256);
    setError(null);
    setStep(2);
  };

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      setError("Formato não suportado. Use .xlsx ou .csv");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const fileData = await f.arrayBuffer();
      if (!globalThis.crypto?.subtle) {
        throw new Error("Este navegador não permite verificar se a planilha já foi importada.");
      }
      const digest = await globalThis.crypto.subtle.digest("SHA-256", fileData);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const wb = XLSX.read(fileData, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("planilha vazia");
      const ws = wb.Sheets[firstSheet];
      if (!ws) throw new Error("planilha vazia");
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
        defval: "",
      }) as unknown[][];
      const previousImport = state.invoices
        .flatMap((invoice) => invoice.spreadsheetImportHistory ?? [])
        .find((record) => record.sha256 === sha256);
      if (previousImport) {
        setDuplicatePrompt({
          rows: data,
          fileName: f.name,
          sha256,
          previousImportedAt: previousImport.importedAt,
        });
        return;
      }
      load(data, f.name, sha256);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes("não permite verificar")
          ? cause.message
          : "Não foi possível ler o arquivo. Verifique se ele não está corrompido.",
      );
    }
  };

  const headers = rows?.[0]?.map((h, i) => String(h || `Coluna ${i + 1}`)) ?? [];
  const body = rows?.slice(1) ?? [];
  const get = (r: unknown[], k: FieldKey) => (map[k] === null ? "" : r[map[k]!]);
  const missingMap = FIELDS.filter((f) => f.required && map[f.key] === null);

  const analyzed = body.map((r, idx) => {
    const date = parseDate(get(r, "date"));
    const rawAmt = get(r, "amount");
    const amount = typeof rawAmt === "number" ? rawAmt : parseBRL(String(rawAmt ?? ""));
    const description = String(get(r, "description") ?? "").trim();
    const personName = String(get(r, "person") ?? "").trim();
    const peopleMatch = matchSpreadsheetPeople(personName, state.people);
    const allocationOverride = allocationOverrides[idx + 2];
    const people = allocationOverride
      ? allocationOverride.personIds
          .map((personId) => state.people.find((person) => person.id === personId))
          .filter((person): person is (typeof state.people)[number] => Boolean(person))
      : peopleMatch.unmatched.length === 0
        ? peopleMatch.matched
        : [];
    const isSplit = allocationOverride?.split ?? people.length > 1;
    const resolvedCard = resolveSpreadsheetCard(get(r, "card"), state.cards, cardId);
    const categoryName = String(get(r, "category") ?? "").trim();
    const category = categoryName
      ? PURCHASE_CATEGORIES.find((item) => item.toLowerCase() === categoryName.toLowerCase())
      : undefined;
    const issues: string[] = [];
    if (!date) issues.push("data inválida ou ausente");
    if (amount === null) issues.push("valor ausente");
    if (!description) issues.push("descrição ausente");
    if (!allocationOverride && peopleMatch.unmatched.length)
      issues.push(
        `pessoa(s) "${peopleMatch.unmatched.join(", ")}" não cadastrada(s) — ficará(ão) pendente(s)`,
      );
    if (isSplit && people.length < 2)
      issues.push("Compra dividida: associe pelo menos duas pessoas pelo botão direito");
    if (resolvedCard.error) issues.push(resolvedCard.error);
    if (!resolvedCard.card) issues.push("selecione um cartão de destino");
    if (categoryName && !category)
      issues.push(`categoria "${categoryName}" não reconhecida — ficará sem categoria`);
    return {
      idx: idx + 2,
      date,
      amount,
      description,
      people,
      isSplit,
      personName,
      card: resolvedCard.card,
      cardLast4: resolvedCard.card?.last4 ?? "",
      category,
      categoryName,
      issues,
      reviewedDuplicate: confirmedDuplicateRows.has(idx + 2),
      dup: false as boolean,
    };
  });
  // Duplicidades: dentro do arquivo e contra lançamentos existentes
  analyzed.forEach((a, i) => {
    if (!a.date || a.amount === null) return;
    const inFile = analyzed
      .slice(0, i)
      .some(
        (b) =>
          b.date === a.date &&
          b.amount === a.amount &&
          b.description.toLowerCase() === a.description.toLowerCase() &&
          b.card?.id === a.card?.id,
      );
    const inApp = state.transactions.some(
      (t) =>
        t.date === a.date &&
        t.amount === a.amount &&
        t.description.toLowerCase() === a.description.toLowerCase() &&
        state.invoices.find((invoice) => invoice.id === t.invoiceId)?.cardId === a.card?.id,
    );
    if (state.settings.duplicateCheck && !a.reviewedDuplicate && (inFile || inApp)) a.dup = true;
  });
  const blocking = analyzed.filter(
    (a) =>
      !a.date ||
      a.amount === null ||
      !a.description ||
      !a.card ||
      (a.isSplit && a.people.length < 2),
  );
  const importable = analyzed.filter((a) => !blocking.includes(a));
  const total = round2(importable.reduce((s, a) => s + (a.amount ?? 0), 0));

  const confirm = () => {
    if (importable.length === 0) {
      setError("Não há linhas válidas para importar. Confira os avisos na tabela.");
      return;
    }
    const rowsByCard = new Map<string, typeof importable>();
    for (const row of importable) {
      if (!row.card) continue;
      rowsByCard.set(row.card.id, [...(rowsByCard.get(row.card.id) ?? []), row]);
    }
    if (rowsByCard.size === 0) {
      setError("Não foi possível associar as linhas aos cartões cadastrados.");
      return;
    }
    const importedAt = new Date().toISOString();
    try {
      for (const [groupCardId, groupRows] of rowsByCard) {
        const groupCard = state.cards.find((item) => item.id === groupCardId);
        if (!groupCard) continue;
        const invoiceId = uid("inv_pl");
        const txs: Transaction[] = groupRows.map((a) => {
          const installment = installmentReferenceFromDescription(a.description);
          const allocations = splitAmountAcrossPeople(a.amount!, a.people.length).map(
            (share, index) => ({ personId: a.people[index]!.id, amount: share }),
          );
          return {
            id: uid("tx"),
            invoiceId,
            date: a.date!,
            description: a.description,
            ...(a.category ? { category: a.category } : {}),
            amount: a.amount!,
            type: a.amount! < 0 ? "credito" : installment ? "parcela" : "compra",
            ...(installment
              ? {
                  installmentNumber: installment.number,
                  installmentTotal: installment.total,
                }
              : {}),
            allocations,
          };
        });
        dispatch({
          type: "importInvoice",
          invoice: {
            id: invoiceId,
            cardId: groupCard.id,
            month,
            dueDate: dateInMonth(month, groupCard.dueDay),
            officialTotal: round2(groupRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)),
            status: "em_revisao",
            source: "planilha",
            ...(fileHash && fileName
              ? {
                  spreadsheetImportHistory: [{ sha256: fileHash, fileName, importedAt }],
                }
              : {}),
          },
          transactions: txs,
        });
      }
      toast.success("Importação da planilha concluída", {
        description: `${importable.length} lançamento(s) distribuídos em ${rowsByCard.size} cartão(ões) · ${fmtMonthLong(month)}. ${blocking.length} linha(s) com erro não foram importadas.`,
      });
      close();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Erro inesperado na importação.";
      setError(`Não foi possível concluir a importação: ${message}`);
      toast.error("A importação não foi concluída", { description: message });
    }
  };

  const setDuplicateReview = (rowIndex: number, reviewed: boolean) => {
    setConfirmedDuplicateRows((current) => {
      const next = new Set(current);
      if (reviewed) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };
  const setRowSplit = (rowIndex: number, split: boolean) => {
    const row = analyzed.find((item) => item.idx === rowIndex);
    if (!row) return;
    setAllocationOverrides((current) => {
      const previous = current[rowIndex] ?? {
        personIds: row.people.map((person) => person.id),
        split: row.isSplit,
      };
      return {
        ...current,
        [rowIndex]: {
          personIds: split ? previous.personIds : previous.personIds.slice(0, 1),
          split,
        },
      };
    });
  };
  const setRowPerson = (rowIndex: number, personId: string, selected: boolean) => {
    const row = analyzed.find((item) => item.idx === rowIndex);
    if (!row) return;
    setAllocationOverrides((current) => {
      const previous = current[rowIndex] ?? {
        personIds: row.people.map((person) => person.id),
        split: row.isSplit,
      };
      const personIds = selected
        ? [...new Set([...previous.personIds, personId])]
        : previous.personIds.filter((id) => id !== personId);
      return {
        ...current,
        [rowIndex]: {
          personIds,
          split: personIds.length > 1 ? true : personIds.length === 0 ? false : previous.split,
        },
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent
        className={cn("max-h-[92vh] overflow-y-auto", step === 1 ? "sm:max-w-lg" : "sm:max-w-4xl")}
      >
        <DialogHeader>
          <DialogTitle>Importar planilha Excel</DialogTitle>
          <DialogDescription>
            A planilha é lida localmente. Se houver uma coluna de final do cartão, cada linha será
            importada para o cartão correspondente; caso contrário, será usado o cartão padrão.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(e.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center hover:bg-muted/50",
                error && "border-danger",
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="font-semibold">Selecione um arquivo .xlsx ou .csv</p>
              <p className="text-xs text-muted-foreground">
                A primeira linha deve conter os nomes das colunas
              </p>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.currentTarget.value = "";
                  void pick(selected);
                }}
                aria-label="Arquivo da planilha"
              />
            </div>
            {error && <p className="text-sm font-medium text-danger">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => load(SAMPLE, "planilha-exemplo.xlsx (fictícia)")}
              >
                Usar planilha de exemplo
              </Button>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
            </DialogFooter>
          </>
        )}

        {step >= 2 && rows && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-primary" />
              <b>{fileName}</b>
              <span className="text-muted-foreground">
                · {body.length} linha(s) · {headers.length} coluna(s)
              </span>
            </div>

            {step === 2 && (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold">Prévia das linhas</p>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {body.slice(0, 6).map((r, i) => (
                          <tr key={i}>
                            {headers.map((_, j) => (
                              <td key={j} className="px-3 py-1.5">
                                {String(r[j] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">
                    Associe as colunas aos campos do aplicativo
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {FIELDS.map((f) => (
                      <Field
                        key={f.key}
                        label={f.label}
                        required={f.required}
                        error={f.required && map[f.key] === null ? "Campo obrigatório" : undefined}
                      >
                        <Select
                          value={map[f.key] === null ? NONE : String(map[f.key])}
                          onValueChange={(v) =>
                            setMap((m) => ({ ...m, [f.key]: v === NONE ? null : Number(v) }))
                          }
                        >
                          <SelectTrigger aria-label={f.label}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Não importar —</SelectItem>
                            {headers.map((h, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                    <Field label="Cartão padrão para linhas sem final" required>
                      <Select value={cardId} onValueChange={setCardId}>
                        <SelectTrigger aria-label="Cartão de destino">
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
                    </Field>
                    <Field label="Mês da fatura" required>
                      <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger aria-label="Mês da fatura">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) =>
                            addMonths(state.settings.month, -i),
                          ).map((m) => (
                            <SelectItem key={m} value={m}>
                              {fmtMonthLong(m)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={reset}>
                    Voltar
                  </Button>
                  <Button disabled={missingMap.length > 0} onClick={() => setStep(3)}>
                    Conferir registros
                  </Button>
                </DialogFooter>
              </>
            )}

            {step === 3 && (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">Serão importados</p>
                    <p className="num font-bold">{importable.length}</p>
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="num font-bold">{fmtBRL(total)}</p>
                  </div>
                  <div className="rounded-lg bg-warning-soft px-3 py-2 text-warning">
                    <p className="text-xs">Possíveis duplicidades</p>
                    <p className="num font-bold">{analyzed.filter((a) => a.dup).length}</p>
                  </div>
                  <div className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
                    <p className="text-xs">Com erro (não importadas)</p>
                    <p className="num font-bold">{blocking.length}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Clique com o botão direito em uma linha para marcar compra dividida, associar
                  pessoas ou resolver um aviso de duplicidade.
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                      <tr className="[&_th]:px-3 [&_th]:py-2">
                        <th>Linha</th>
                        <th>Data</th>
                        <th>Cartão</th>
                        <th>Descrição</th>
                        <th>Categoria</th>
                        <th className="text-right">Valor</th>
                        <th>Pessoa</th>
                        <th>Avisos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {analyzed.map((a) => (
                        <ContextMenu key={a.idx}>
                          <ContextMenuTrigger asChild>
                            <tr
                              className={cn(
                                "[&_td]:px-3 [&_td]:py-1.5",
                                blocking.includes(a)
                                  ? "bg-danger-soft/50"
                                  : (a.dup || a.issues.length) && "bg-warning-soft/50",
                              )}
                            >
                              <td className="num text-muted-foreground">{a.idx}</td>
                              <td className="num">{a.date ? fmtDate(a.date) : "—"}</td>
                              <td>{a.card ? `•••• ${a.card.last4}` : "—"}</td>
                              <td>{a.description || "—"}</td>
                              <td>{a.category ?? (a.categoryName ? "Sem categoria" : "—")}</td>
                              <td className="num text-right">
                                {a.amount !== null ? fmtBRL(a.amount) : "—"}
                              </td>
                              <td>
                                {a.people.length ? (
                                  a.people.map((person) => person.name).join(", ")
                                ) : a.personName ? (
                                  <span className="text-muted-foreground">{a.personName}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="text-xs">
                                {a.dup && (
                                  <p className="text-warning">Possível duplicidade — revise</p>
                                )}
                                {a.dup && (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-xs"
                                    onClick={() => setDuplicateReview(a.idx, true)}
                                  >
                                    Confirmar que são distintas
                                  </Button>
                                )}
                                {a.reviewedDuplicate && (
                                  <p className="text-success">Revisada: compra diferente</p>
                                )}
                                {a.issues.map((i) => (
                                  <p
                                    key={i}
                                    className={
                                      blocking.includes(a) ? "text-danger" : "text-warning"
                                    }
                                  >
                                    {i}
                                  </p>
                                ))}
                              </td>
                            </tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuCheckboxItem
                              checked={a.isSplit}
                              onCheckedChange={(checked) => setRowSplit(a.idx, checked === true)}
                            >
                              Marcar como compra dividida
                            </ContextMenuCheckboxItem>
                            <ContextMenuSeparator />
                            <ContextMenuLabel>Associar pessoas</ContextMenuLabel>
                            {state.people.map((person) => (
                              <ContextMenuCheckboxItem
                                key={person.id}
                                checked={a.people.some((item) => item.id === person.id)}
                                onCheckedChange={(checked) =>
                                  setRowPerson(a.idx, person.id, checked === true)
                                }
                              >
                                {person.name}
                              </ContextMenuCheckboxItem>
                            ))}
                            <ContextMenuSeparator />
                            {a.dup ? (
                              <ContextMenuItem onSelect={() => setDuplicateReview(a.idx, true)}>
                                Marcar como não duplicidade
                              </ContextMenuItem>
                            ) : a.reviewedDuplicate ? (
                              <ContextMenuItem onSelect={() => setDuplicateReview(a.idx, false)}>
                                Restaurar aviso de duplicidade
                              </ContextMenuItem>
                            ) : (
                              <ContextMenuItem disabled>
                                Sem aviso de duplicidade nesta linha
                              </ContextMenuItem>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analyzed.some((a) => a.dup) && (
                  <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                    <AlertTriangle className="size-4 shrink-0" /> Se confirmar que alguma linha é
                    uma compra diferente, use “Confirmar que são distintas” nessa linha. Linhas não
                    revistas ainda serão importadas com o aviso.
                  </p>
                )}
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep(2)}>
                    Voltar
                  </Button>
                  <Button onClick={confirm} disabled={importable.length === 0}>
                    Confirmar importação da planilha
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
        <Dialog
          open={duplicatePrompt !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDuplicatePrompt(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Esta planilha já foi importada</DialogTitle>
              <DialogDescription>
                {duplicatePrompt && (
                  <>
                    O arquivo “{duplicatePrompt.fileName}” já foi importado em{" "}
                    {new Date(duplicatePrompt.previousImportedAt).toLocaleString("pt-BR")}. Deseja
                    importar novamente? Se continuar, os lançamentos poderão ficar duplicados.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDuplicatePrompt(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (duplicatePrompt) {
                    load(duplicatePrompt.rows, duplicatePrompt.fileName, duplicatePrompt.sha256);
                  }
                  setDuplicatePrompt(null);
                }}
              >
                Sim, importar novamente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
