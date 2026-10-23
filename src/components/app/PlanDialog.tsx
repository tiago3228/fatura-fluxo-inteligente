import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { addMonths, splitEqually } from "@/lib/finance/calc";
import { fmtBRL, parseBRL, round2, uid } from "@/lib/finance/format";
import type { InstallmentPlan, PlanShare } from "@/lib/finance/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./common";

export function PlanDialog({ plan, onClose }: { plan?: InstallmentPlan; onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const ref = state.settings.month;
  const [desc, setDesc] = useState(plan?.description ?? "");
  const [total, setTotal] = useState(plan ? plan.total.toFixed(2).replace(".", ",") : "");
  const [date, setDate] = useState(plan?.purchaseDate ?? `${ref}-01`);
  const [count, setCount] = useState(String(plan?.amounts.length ?? 3));
  const [current, setCurrent] = useState(String(plan ? Math.max(1, Math.min(plan.amounts.length, (Number(ref.slice(0, 4)) - Number(plan.firstMonth.slice(0, 4))) * 12 + Number(ref.slice(5)) - Number(plan.firstMonth.slice(5)) + 1)) : 1));
  const [amounts, setAmounts] = useState<string[]>(plan?.amounts.map((a) => a.toFixed(2).replace(".", ",")) ?? []);
  const [cardId, setCardId] = useState(plan?.cardId ?? state.cards[0]?.id ?? "");
  const [shares, setShares] = useState<PlanShare[]>(plan?.shares ?? [{ personId: state.people[0]?.id ?? "", pct: 100 }]);
  const [touched, setTouched] = useState(false);

  const n = Number(count);
  const cur = Number(current);
  const tot = parseBRL(total);
  const fill = () => tot !== null && n > 0 && setAmounts(splitEqually(tot, n).map((a) => a.toFixed(2).replace(".", ",")));
  const parsedAmts = amounts.length === n ? amounts.map((a) => parseBRL(a)) : tot !== null && n > 0 ? splitEqually(tot, n) : [];
  const amtSum = round2(parsedAmts.reduce<number>((s, a) => s + (a ?? 0), 0));
  const shareSum = shares.reduce((s, x) => s + x.pct, 0);

  const errors = {
    desc: desc.trim() ? undefined : "Informe a descrição",
    total: tot !== null && tot > 0 ? undefined : "Valor total inválido",
    count: Number.isInteger(n) && n >= 1 && n <= 48 ? undefined : "Entre 1 e 48",
    current: Number.isInteger(cur) && cur >= 1 && cur <= n ? undefined : `Entre 1 e ${n || "?"}`,
    amounts: parsedAmts.some((a) => a === null) ? "Há parcelas com valor inválido" : tot !== null && amtSum !== tot ? `Soma das parcelas (${fmtBRL(amtSum)}) difere do total` : undefined,
    shares: shareSum === 100 && shares.every((s) => s.personId) ? undefined : `Divisão deve somar 100% (atual ${shareSum}%)`,
  };
  const valid = Object.values(errors).every((e) => !e);
  const er = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const save = () => {
    setTouched(true);
    if (!valid) return;
    dispatch({
      type: "upsertPlan",
      plan: { id: plan?.id ?? uid("pl"), description: desc.trim(), cardId, purchaseDate: date, total: tot!, amounts: parsedAmts as number[], firstMonth: addMonths(ref, -(cur - 1)), shares },
    });
    toast.success(plan ? "Parcelamento atualizado" : "Parcelamento registrado", { description: `${n - cur} parcela(s) restantes após ${ref.slice(5)}/${ref.slice(0, 4)}` });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar parcelamento" : "Registrar parcelamento"}</DialogTitle>
          <DialogDescription>A parcela atual é relativa ao mês de referência selecionado.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="col-span-2"><Field label="Descrição" htmlFor="pl-d" required error={er("desc")}><Input id="pl-d" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>
          <Field label="Valor total (R$)" htmlFor="pl-t" required error={er("total")}><Input id="pl-t" className="num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
          <Field label="Data da compra" htmlFor="pl-dt"><Input id="pl-dt" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Quantidade de parcelas" htmlFor="pl-n" required error={er("count")}><Input id="pl-n" inputMode="numeric" value={count} onChange={(e) => { setCount(e.target.value); setAmounts([]); }} /></Field>
          <Field label="Parcela atual" htmlFor="pl-c" required error={er("current")} hint={n && cur ? `Restam ${Math.max(0, n - cur)} após este mês` : undefined}><Input id="pl-c" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <div className="col-span-2">
            <Field label="Cartão" required>
              <Select value={cardId} onValueChange={setCardId}><SelectTrigger aria-label="Cartão"><SelectValue /></SelectTrigger>
                <SelectContent>{state.cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} •••• {c.last4}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          <div className="col-span-2 space-y-2">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Valor de cada parcela</span>
              <Button type="button" size="sm" variant="ghost" onClick={fill} disabled={tot === null || !n}>{amounts.length ? "Recalcular iguais" : "Informar valores individuais"}</Button></div>
            {amounts.length === n && n > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {amounts.map((a, i) => <Input key={i} aria-label={`Parcela ${i + 1}`} className="num h-8 text-right" value={a} onChange={(e) => setAmounts((as) => as.map((x, j) => (j === i ? e.target.value : x)))} />)}
              </div>
            ) : <p className="text-xs text-muted-foreground">{tot !== null && n > 0 ? `${n}x de aprox. ${fmtBRL(tot / n)} (centavos de arredondamento na 1ª parcela)` : "Informe total e quantidade."}</p>}
            {er("amounts") && <p className="text-xs font-medium text-danger">{er("amounts")}</p>}
          </div>
          <div className="col-span-2 space-y-2">
            <span className="text-sm font-medium">Responsáveis</span>
            {shares.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Select value={s.personId} onValueChange={(v) => setShares((ss) => ss.map((x, j) => (j === i ? { ...x, personId: v } : x)))}>
                  <SelectTrigger className="flex-1" aria-label="Pessoa"><SelectValue placeholder="Pessoa" /></SelectTrigger>
                  <SelectContent>{state.people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label="Percentual" className="num w-20 text-right" inputMode="numeric" value={s.pct} onChange={(e) => setShares((ss) => ss.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)))} />
                <span className="self-center text-sm">%</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover" disabled={shares.length === 1} onClick={() => setShares((ss) => ss.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setShares((ss) => [...ss, { personId: "", pct: 0 }])}><Plus className="size-4" /> Dividir com outra pessoa</Button>
            {er("shares") && <p className="text-xs font-medium text-danger">{er("shares")}</p>}
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
