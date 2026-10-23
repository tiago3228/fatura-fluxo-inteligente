import { useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { availableMonths, addMonths, dateInMonth } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, parseBRL, round2, uid } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./common";
import { cn } from "@/lib/utils";

type FieldKey = "date" | "description" | "amount" | "person" | "card";
const FIELDS: { key: FieldKey; label: string; required: boolean; guess: RegExp }[] = [
  { key: "date", label: "Data", required: true, guess: /data|date|dia/i },
  { key: "description", label: "Descrição", required: true, guess: /desc|estabelec|hist|compra|loja/i },
  { key: "amount", label: "Valor", required: true, guess: /valor|amount|preço|preco|r\$/i },
  { key: "person", label: "Pessoa responsável", required: false, guess: /pessoa|quem|respons|nome/i },
  { key: "card", label: "Cartão (final)", required: false, guess: /cart|final/i },
];
const NONE = "__none";

const SAMPLE: unknown[][] = [
  ["Data", "Estabelecimento", "Valor (R$)", "Quem", "Final"],
  ["05/08/2026", "Padaria Real", "32,50", "Tiago", "7432"],
  ["07/08/2026", "Posto Shell", "200,00", "Pedro", "1058"],
  ["10/08/2026", "Farmácia São João", "", "Mariana", "7432"],
  ["12/08/2026", "Cinemark", "120,00", "Pedro", "1058"],
  ["12/08/2026", "Cinemark", "120,00", "Pedro", "1058"],
  ["15/08/2026", "Livraria Cultura", "89,90", "Joana", "7432"],
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

export function ExcelImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, dispatch } = useFinance();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<Record<FieldKey, number | null>>({ date: null, description: null, amount: null, person: null, card: null });
  const [cardId, setCardId] = useState(state.cards[0]?.id ?? "");
  const [month, setMonth] = useState(addMonths(availableMonths(state).at(-1) ?? state.settings.month, -1));
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setFileName(null); setRows(null); setError(null); setStep(1); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const load = (data: unknown[][], name: string) => {
    const clean = data.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    if (clean.length < 2 || !clean[0]) { setError("A planilha não tem linhas de dados."); return; }
    const headers = clean[0].map((h) => String(h ?? ""));
    const guess = {} as Record<FieldKey, number | null>;
    FIELDS.forEach((f) => { const i = headers.findIndex((h) => f.guess.test(h)); guess[f.key] = i >= 0 ? i : null; });
    setMap(guess); setRows(clean); setFileName(name); setError(null); setStep(2);
  };

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) { setError("Formato não suportado. Use .xlsx ou .csv"); return; }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("planilha vazia");
      const ws = wb.Sheets[firstSheet];
      if (!ws) throw new Error("planilha vazia");
      load(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" }) as unknown[][], f.name);
    } catch {
      setError("Não foi possível ler o arquivo. Verifique se ele não está corrompido.");
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
    const person = personName ? state.people.find((p) => p.name.toLowerCase().startsWith(personName.toLowerCase()) || p.name.toLowerCase() === personName.toLowerCase()) : undefined;
    const issues: string[] = [];
    if (!date) issues.push("data inválida ou ausente");
    if (amount === null) issues.push("valor ausente");
    if (!description) issues.push("descrição ausente");
    if (personName && !person) issues.push(`pessoa "${personName}" não cadastrada — ficará pendente`);
    return { idx: idx + 2, date, amount, description, person, personName, issues, dup: false as boolean };
  });
  // Duplicidades: dentro do arquivo e contra lançamentos existentes
  analyzed.forEach((a, i) => {
    if (!a.date || a.amount === null) return;
    const inFile = analyzed.slice(0, i).some((b) => b.date === a.date && b.amount === a.amount && b.description.toLowerCase() === a.description.toLowerCase());
    const inApp = state.transactions.some((t) => t.date === a.date && t.amount === a.amount && t.description.toLowerCase() === a.description.toLowerCase());
    if (state.settings.duplicateCheck && (inFile || inApp)) a.dup = true;
  });
  const blocking = analyzed.filter((a) => !a.date || a.amount === null || !a.description);
  const importable = analyzed.filter((a) => !blocking.includes(a));
  const total = round2(importable.reduce((s, a) => s + (a.amount ?? 0), 0));
  const card = state.cards.find((c) => c.id === cardId);

  const confirm = () => {
    if (!card) return;
    const invoiceId = uid("inv_pl");
    const txs: Transaction[] = importable.map((a) => ({
      id: uid("tx"), invoiceId, date: a.date!, description: a.description, amount: a.amount!, type: a.amount! < 0 ? "credito" : "compra",
      allocations: a.person ? [{ personId: a.person.id, amount: a.amount! }] : [],
    }));
    dispatch({
      type: "importInvoice",
      invoice: { id: invoiceId, cardId: card.id, month, dueDate: dateInMonth(month, card.dueDay), officialTotal: total, status: "em_revisao", source: "planilha" },
      transactions: txs,
    });
    toast.success("Importação demonstrativa da planilha concluída", { description: `${txs.length} lançamento(s) adicionados em ${card.name} · ${fmtMonthLong(month)}. ${blocking.length} linha(s) com erro não foram importadas e continuam listadas na planilha original.` });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", step === 1 ? "sm:max-w-lg" : "sm:max-w-4xl")}>
        <DialogHeader>
          <DialogTitle>Importar planilha Excel</DialogTitle>
          <DialogDescription>A planilha é lida no seu navegador. Os dados ficam apenas nesta demonstração local.</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <>
            <div
              role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
              className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center hover:bg-muted/50", error && "border-danger")}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="font-semibold">Selecione um arquivo .xlsx ou .csv</p>
              <p className="text-xs text-muted-foreground">A primeira linha deve conter os nomes das colunas</p>
              <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Arquivo da planilha" />
            </div>
            {error && <p className="text-sm font-medium text-danger">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => load(SAMPLE, "planilha-exemplo.xlsx (fictícia)")}>Usar planilha de exemplo</Button>
              <Button variant="outline" onClick={close}>Cancelar</Button>
            </DialogFooter>
          </>
        )}

        {step >= 2 && rows && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm"><FileSpreadsheet className="size-4 text-primary" /><b>{fileName}</b><span className="text-muted-foreground">· {body.length} linha(s) · {headers.length} coluna(s)</span></div>

            {step === 2 && (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold">Prévia das linhas</p>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60"><tr>{headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                      <tbody className="divide-y">{body.slice(0, 6).map((r, i) => <tr key={i}>{headers.map((_, j) => <td key={j} className="px-3 py-1.5">{String(r[j] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Associe as colunas aos campos do aplicativo</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {FIELDS.map((f) => (
                      <Field key={f.key} label={f.label} required={f.required} error={f.required && map[f.key] === null ? "Campo obrigatório" : undefined}>
                        <Select value={map[f.key] === null ? NONE : String(map[f.key])} onValueChange={(v) => setMap((m) => ({ ...m, [f.key]: v === NONE ? null : Number(v) }))}>
                          <SelectTrigger aria-label={f.label}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Não importar —</SelectItem>
                            {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                    <Field label="Cartão de destino" required>
                      <Select value={cardId} onValueChange={setCardId}>
                        <SelectTrigger aria-label="Cartão de destino"><SelectValue /></SelectTrigger>
                        <SelectContent>{state.cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} •••• {c.last4}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Mês da fatura" required>
                      <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger aria-label="Mês da fatura"><SelectValue /></SelectTrigger>
                        <SelectContent>{Array.from({ length: 12 }, (_, i) => addMonths(state.settings.month, -i)).map((m) => <SelectItem key={m} value={m}>{fmtMonthLong(m)}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={reset}>Voltar</Button>
                  <Button disabled={missingMap.length > 0} onClick={() => setStep(3)}>Conferir registros</Button>
                </DialogFooter>
              </>
            )}

            {step === 3 && (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-muted px-3 py-2"><p className="text-xs text-muted-foreground">Serão importados</p><p className="num font-bold">{importable.length}</p></div>
                  <div className="rounded-lg bg-muted px-3 py-2"><p className="text-xs text-muted-foreground">Total</p><p className="num font-bold">{fmtBRL(total)}</p></div>
                  <div className="rounded-lg bg-warning-soft px-3 py-2 text-warning"><p className="text-xs">Possíveis duplicidades</p><p className="num font-bold">{analyzed.filter((a) => a.dup).length}</p></div>
                  <div className="rounded-lg bg-danger-soft px-3 py-2 text-danger"><p className="text-xs">Com erro (não importadas)</p><p className="num font-bold">{blocking.length}</p></div>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr className="[&_th]:px-3 [&_th]:py-2"><th>Linha</th><th>Data</th><th>Descrição</th><th className="text-right">Valor</th><th>Pessoa</th><th>Avisos</th></tr></thead>
                    <tbody className="divide-y">
                      {analyzed.map((a) => (
                        <tr key={a.idx} className={cn("[&_td]:px-3 [&_td]:py-1.5", blocking.includes(a) ? "bg-danger-soft/50" : (a.dup || a.issues.length) && "bg-warning-soft/50")}>
                          <td className="num text-muted-foreground">{a.idx}</td>
                          <td className="num">{a.date ? fmtDate(a.date) : "—"}</td>
                          <td>{a.description || "—"}</td>
                          <td className="num text-right">{a.amount !== null ? fmtBRL(a.amount) : "—"}</td>
                          <td>{a.person?.name ?? (a.personName ? <span className="text-muted-foreground">{a.personName}</span> : "—")}</td>
                          <td className="text-xs">
                            {a.dup && <p className="text-warning">Possível duplicidade — revise</p>}
                            {a.issues.map((i) => <p key={i} className={blocking.includes(a) ? "text-danger" : "text-warning"}>{i}</p>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analyzed.some((a) => a.dup) && (
                  <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"><AlertTriangle className="size-4 shrink-0" /> Linhas suspeitas de duplicidade serão importadas para que você revise. Exclua-as manualmente se forem repetidas.</p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
                  <Button onClick={confirm} disabled={importable.length === 0}>Confirmar importação demonstrativa</Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
