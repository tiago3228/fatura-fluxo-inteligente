import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import {
  limitMessage, limitPct, limitStatus, personMonthTotal, splitEqually, txMonth,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, parseBRL, round2, uid } from "@/lib/finance/format";
import type { Allocation, Person, Transaction } from "@/lib/finance/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LimitBadge } from "./badges";
import { PersonDialog } from "./PersonDialog";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface TxActionsCtx {
  openAssign: (txIds: string[]) => void;
  openSplit: (txId: string) => void;
  openEdit: (txId: string) => void;
  openCreate: () => void;
  deleteTx: (txId: string) => void;
  unassign: (txIds: string[]) => void;
}
const Ctx = createContext<TxActionsCtx | null>(null);
export const useTxActions = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("TxActionsProvider ausente");
  return v;
};

export function TxActionsProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useFinance();
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const api = useMemo<TxActionsCtx>(
    () => ({
      openAssign: (ids) => setAssignIds(ids),
      openSplit: (id) => setSplitId(id),
      openEdit: (id) => setEditId(id),
      openCreate: () => setCreateOpen(true),
      deleteTx: (id) => setDeleteId(id),
      unassign: (ids) => {
        const before = state.transactions.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, allocations: t.allocations, note: t.adjustmentNote }));
        dispatch({ type: "unassign", txIds: ids });
        toast("Atribuição removida", {
          description: `${ids.length} lançamento(s) voltaram para pendências.`,
          action: {
            label: "Desfazer",
            onClick: () => before.forEach((b) => dispatch({ type: "split", txId: b.id, allocations: b.allocations, adjustmentNote: b.note })),
          },
        });
      },
    }),
    [state.transactions, dispatch],
  );

  const assignTxs = state.transactions.filter((t) => assignIds?.includes(t.id));
  const splitTx = state.transactions.find((t) => t.id === splitId);

  return (
    <Ctx.Provider value={api}>
      {children}
      {assignIds && <AssignDialog txs={assignTxs} onClose={() => setAssignIds(null)} />}
      {splitTx && <SplitDialog tx={splitTx} onClose={() => setSplitId(null)} />}
      {editId && <EditTransactionDialog tx={state.transactions.find((t) => t.id === editId)} onClose={() => setEditId(null)} />}
      {createOpen && <EditTransactionDialog onClose={() => setCreateOpen(false)} />}
      <DeleteTransactionDialog tx={state.transactions.find((t) => t.id === deleteId)} onClose={() => setDeleteId(null)} />
    </Ctx.Provider>
  );
}

function EditTransactionDialog({ tx, onClose }: { tx?: Transaction | undefined; onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const [description, setDescription] = useState(tx?.description ?? "");
  const [date, setDate] = useState(tx?.date ?? `${state.settings.month}-01`);
  const [amount, setAmount] = useState(tx ? tx.amount.toFixed(2).replace(".", ",") : "");
  const [installmentNumber, setInstallmentNumber] = useState(tx?.installmentNumber?.toString() ?? "");
  const [installmentTotal, setInstallmentTotal] = useState(tx?.installmentTotal?.toString() ?? "");
  const [invoiceId, setInvoiceId] = useState(tx?.invoiceId ?? state.invoices.find((invoice) => invoice.month === state.settings.month)?.id ?? state.invoices[0]?.id ?? "");
  const value = parseBRL(amount);
  const number = installmentNumber.trim() ? Number(installmentNumber) : null;
  const total = installmentTotal.trim() ? Number(installmentTotal) : null;
  const validInstallments = (number === null && total === null) || (number !== null && total !== null && Number.isInteger(number) && Number.isInteger(total) && number > 0 && total > 0 && number <= total);
  const canSave = description.trim().length > 1 && !!date && value !== null && Number.isFinite(value) && value !== 0 && (tx || !!invoiceId) && validInstallments;

  const save = () => {
    if (!canSave || value === null) return;
    if (tx) {
      dispatch({ type: "updateTransaction", txId: tx.id, patch: { description: description.trim(), date, amount: value, installmentNumber: number, installmentTotal: total } });
      toast.success("Compra atualizada", { description: "Parcela, valor e demais informações foram corrigidos." });
    } else {
      dispatch({ type: "addTransaction", transaction: { id: uid("tx"), invoiceId, date, description: description.trim(), amount: value, type: "compra", ...(typeof number === "number" ? { installmentNumber: number } : {}), ...(typeof total === "number" ? { installmentTotal: total } : {}), allocations: [] } });
      toast.success("Nova compra adicionada", { description: "Ela ficou pendente até ser direcionada para uma pessoa." });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tx ? "Editar compra" : "Adicionar nova compra"}</DialogTitle>
          <DialogDescription>{tx ? "Corrija a descrição, o valor ou a parcela que veio incorreta da fatura." : "Cadastre uma compra manualmente na fatura selecionada."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!tx && <label className="text-sm font-medium">Fatura<select className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}><option value="">Selecione a fatura</option>{[...state.invoices].sort((a, b) => b.month.localeCompare(a.month)).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.month} · {state.cards.find((card) => card.id === invoice.cardId)?.name ?? "Cartão"} •••• {state.cards.find((card) => card.id === invoice.cardId)?.last4}</option>)}</select></label>}
          <label className="text-sm font-medium">Descrição<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: TV Samsung" /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Data<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="text-sm font-medium">Valor<Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Parcela atual (opcional)<Input inputMode="numeric" value={installmentNumber} onChange={(event) => setInstallmentNumber(event.target.value)} placeholder="Ex.: 5" /></label><label className="text-sm font-medium">Total de parcelas<Input inputMode="numeric" value={installmentTotal} onChange={(event) => setInstallmentTotal(event.target.value)} placeholder="Ex.: 21" /></label></div>
          {!validInstallments && <p className="text-sm text-danger">Informe a parcela atual e o total corretamente, por exemplo 5 de 21.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={!canSave}>{tx ? "Salvar alterações" : "Adicionar compra"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTransactionDialog({ tx, onClose }: { tx?: Transaction; onClose: () => void }) {
  const { dispatch } = useFinance();
  return (
    <AlertDialog open={!!tx} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Excluir esta compra?</AlertDialogTitle><AlertDialogDescription>“{tx?.description}” será removida da fatura e dos totais. Essa ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (tx) { dispatch({ type: "deleteTransaction", txId: tx.id }); toast.success("Compra excluída"); } onClose(); }}>Excluir compra</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AssignDialog({ txs, onClose }: { txs: Transaction[]; onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(txs.length === 1 && txs[0]?.allocations.length === 1 ? txs[0]?.allocations[0]?.personId ?? null : null);
  const [createPerson, setCreatePerson] = useState(false);
  const valid = txs.filter((t) => t.type !== "pagamento");
  const total = round2(valid.reduce((s, t) => s + t.amount, 0));
  const month = valid[0] ? txMonth(state, valid[0]) : state.settings.month;
  const people = state.people.filter((p) => p.active && p.name.toLowerCase().includes(q.toLowerCase()));

  const confirm = () => {
    if (!sel) return;
    const person = state.people.find((p) => p.id === sel)!;
    const before = valid.map((t) => ({ id: t.id, allocations: t.allocations, note: t.adjustmentNote }));
    // Desconta o que já era desta pessoa nesses lançamentos para não contar em dobro
    const current = personMonthTotal(state, sel, month);
    const already = valid.reduce((s, t) => s + t.allocations.filter((a) => a.personId === sel).reduce((x, a) => x + a.amount, 0), 0);
    const after = round2(current - already + total);
    dispatch({ type: "allocate", txIds: valid.map((t) => t.id), personId: sel });
    const msg = limitMessage(person.name, after, person.limit, state.settings.warnPct);
    toast.success(`${valid.length} lançamento(s) direcionado(s) para ${person.name}`, {
      description: msg ?? `Total do mês: ${fmtBRL(after)} de ${fmtBRL(person.limit)}.`,
      action: { label: "Desfazer", onClick: () => before.forEach((b) => dispatch({ type: "split", txId: b.id, allocations: b.allocations, adjustmentNote: b.note })) },
    });
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Direcionar para pessoa</DialogTitle>
          <DialogDescription>
            {valid.length === 1 ? (
              <>
                {valid[0]?.description} · {fmtDate(valid[0]?.date ?? "")}
              </>
            ) : (
              <>{valid.length} lançamentos selecionados</>
            )}
            {txs.length !== valid.length && " · pagamentos foram ignorados"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Valor a atribuir</span>
          <span className="num font-bold">{fmtBRL(total)}</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Buscar pessoa…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pessoa" />
        </div>

        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setCreatePerson(true)}>
          <Plus className="size-4" /> Criar nova pessoa
        </Button>

        <div className="max-h-72 space-y-1.5 overflow-y-auto" role="listbox" aria-label="Pessoas">
          {people.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma pessoa ativa encontrada.</p>}
          {people.map((p) => {
            const cur = personMonthTotal(state, p.id, month);
            const already = valid.reduce((s, t) => s + t.allocations.filter((a) => a.personId === p.id).reduce((x, a) => x + a.amount, 0), 0);
            const after = round2(cur - already + total);
            const st = limitStatus(after, p.limit, state.settings.warnPct);
            const active = sel === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSel(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent",
                  active && "border-primary bg-accent ring-1 ring-primary",
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="num block text-xs text-muted-foreground">
                    {fmtBRL(cur)} de {fmtBRL(p.limit)} · {Math.round(limitPct(cur, p.limit))}% usado
                  </span>
                  <span className="num block text-xs text-muted-foreground">
                    Após atribuir: <b className="text-foreground">{Math.round(limitPct(after, p.limit))}%</b>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {st !== "normal" && <LimitBadge status={st} />}
                  {active && <Check className="size-4 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>

        {sel && (() => {
          const p = state.people.find((x) => x.id === sel)!;
          const cur = personMonthTotal(state, p.id, month);
          const already = valid.reduce((s, t) => s + t.allocations.filter((a) => a.personId === p.id).reduce((x, a) => x + a.amount, 0), 0);
          const msg = limitMessage(p.name, round2(cur - already + total), p.limit, state.settings.warnPct);
          return msg ? (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{msg} Você pode confirmar mesmo assim.</span>
            </p>
          ) : null;
        })()}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={!sel || valid.length === 0}>Confirmar atribuição</Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
      {createPerson && (
        <PersonDialog
          onClose={() => setCreatePerson(false)}
          onSaved={(person: Person) => {
            setSel(person.id);
            setQ("");
          }}
        />
      )}
    </>
  );
}

interface SplitRow {
  personId: string;
  value: string;
}

function SplitDialog({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const active = state.people.filter((p) => p.active);
  const [mode, setMode] = useState<"valor" | "pct">("valor");
  const [rows, setRows] = useState<SplitRow[]>(() => {
    if (tx.allocations.length > 1) return tx.allocations.map((a) => ({ personId: a.personId, value: a.amount.toFixed(2).replace(".", ",") }));
    const currentId = tx.allocations[0]?.personId;
    const ids = [
      ...(currentId ? [currentId] : []),
      ...active.filter((p) => p.id !== currentId).map((p) => p.id),
    ].slice(0, 2);
    const parts = splitEqually(tx.amount, ids.length || 1);
    return ids.map((id, i) => ({ personId: id, value: (parts[i] ?? 0).toFixed(2).replace(".", ",") }));
  });
  const [isAdjust, setIsAdjust] = useState(!!tx.adjustmentNote);
  const [note, setNote] = useState(tx.adjustmentNote ?? "");

  const amounts = rows.map((r) => {
    const n = parseBRL(r.value) ?? NaN;
    return mode === "valor" ? n : round2((tx.amount * n) / 100);
  });
  const distributed = round2(amounts.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0));
  const diff = round2(tx.amount - distributed);
  const ids = rows.map((r) => r.personId);
  const errors: string[] = [];
  if (rows.length < 2) errors.push("Selecione pelo menos duas pessoas.");
  if (ids.some((id) => !id)) errors.push("Escolha a pessoa de cada parte.");
  if (new Set(ids).size !== ids.length) errors.push("A mesma pessoa aparece mais de uma vez.");
  if (amounts.some((n) => !Number.isFinite(n))) errors.push("Informe valores válidos.");
  const sumOk = diff === 0;
  const canConfirm = errors.length === 0 && (sumOk || (isAdjust && note.trim().length > 2));

  const switchMode = (m: "valor" | "pct") => {
    if (!m || m === mode) return;
    setRows((rs) =>
      rs.map((r, i) => ({
        ...r,
        value: m === "pct" ? round2(((amounts[i] ?? 0) / tx.amount) * 100).toString().replace(".", ",") : (amounts[i] ?? 0).toFixed(2).replace(".", ","),
      })),
    );
    setMode(m);
  };

  const equal = () => {
    const parts = splitEqually(mode === "valor" ? tx.amount : 100, rows.length);
    setRows((rs) => rs.map((r, i) => ({ ...r, value: (parts[i] ?? 0).toFixed(2).replace(".", ",") })));
  };

  const confirm = () => {
    const allocations: Allocation[] = rows.map((r, i) => ({ personId: r.personId, amount: amounts[i] ?? 0 }));
    dispatch({ type: "split", txId: tx.id, allocations, adjustmentNote: sumOk ? undefined : note.trim() });
    toast.success("Compra dividida", { description: `${rows.length} pessoas · ${fmtBRL(distributed)} distribuídos.` });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Dividir compra</DialogTitle>
          <DialogDescription>
            {tx.description} · {fmtDate(tx.date)} · <span className="num font-semibold text-foreground">{fmtBRL(tx.amount)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup type="single" value={mode} onValueChange={(v) => switchMode(v as "valor" | "pct")} variant="outline" size="sm">
            <ToggleGroupItem value="valor">Valor (R$)</ToggleGroupItem>
            <ToggleGroupItem value="pct">Percentual (%)</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="ghost" size="sm" onClick={equal}>Dividir igualmente</Button>
          {active.length === 2 && <Button variant="ghost" size="sm" onClick={equal}>50% para cada</Button>}
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={r.personId} onValueChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, personId: v } : x)))}>
                <SelectTrigger className="flex-1" aria-label={`Pessoa da parte ${i + 1}`}>
                  <SelectValue placeholder="Selecione a pessoa" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-36">
                <Input
                  className="num pr-8 text-right"
                  inputMode="decimal"
                  value={r.value}
                  aria-label={`Valor da parte ${i + 1}`}
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{mode === "valor" ? "R$" : "%"}</span>
              </div>
              {mode === "pct" && <span className="num w-24 text-right text-xs text-muted-foreground">{Number.isFinite(amounts[i]) ? fmtBRL(amounts[i] ?? 0) : "—"}</span>}
              <Button variant="ghost" size="icon" aria-label="Remover parte" disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length >= active.length}
            onClick={() => setRows((rs) => [...rs, { personId: active.find((p) => !rs.some((r) => r.personId === p.id))?.id ?? "", value: "0" }])}
          >
            <Plus className="size-4" /> Adicionar pessoa
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Valor da compra</p><p className="num font-bold">{fmtBRL(tx.amount)}</p></div>
          <div><p className="text-xs text-muted-foreground">Distribuído</p><p className="num font-bold">{fmtBRL(distributed)}</p></div>
          <div><p className="text-xs text-muted-foreground">Diferença</p><p className={cn("num font-bold", sumOk ? "text-success" : "text-danger")}>{fmtBRL(diff)}</p></div>
        </div>

        {errors.length > 0 && <ul className="list-inside list-disc text-sm text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {!sumOk && errors.length === 0 && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
            <p className="font-medium text-warning">A soma das partes não corresponde ao valor da compra.</p>
            <label className="flex items-center gap-2">
              <Checkbox checked={isAdjust} onCheckedChange={(v) => setIsAdjust(!!v)} />
              Registrar como ajuste identificado
            </label>
            {isAdjust && <Input placeholder="Motivo do ajuste (obrigatório)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Motivo do ajuste" />}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={!canConfirm}>Confirmar divisão</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
