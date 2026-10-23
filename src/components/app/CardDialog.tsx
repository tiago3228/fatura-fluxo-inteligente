import { useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { parseBRL, uid } from "@/lib/finance/format";
import type { CreditCard } from "@/lib/finance/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "./common";

export function CardDialog({ card, onClose }: { card?: CreditCard; onClose: () => void }) {
  const { dispatch } = useFinance();
  const [v, setV] = useState({
    name: card?.name ?? "", issuer: card?.issuer ?? "", brand: card?.brand ?? "", last4: card?.last4 ?? "",
    creditLimit: card?.creditLimit === undefined ? "" : card.creditLimit.toFixed(2).replace(".", ","), closingDay: String(card?.closingDay ?? ""), dueDay: String(card?.dueDay ?? ""), active: card?.active ?? true,
  });
  const [touched, setTouched] = useState(false);
  const day = (s: string) => /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 31;
  const creditLimit = parseBRL(v.creditLimit);
  const errors = {
    name: v.name.trim() ? undefined : "Informe um nome identificador",
    issuer: v.issuer.trim() ? undefined : "Informe o banco ou emissor",
    last4: /^\d{4}$/.test(v.last4) ? undefined : "Informe exatamente os 4 últimos dígitos",
    creditLimit: !v.creditLimit.trim() || (creditLimit !== null && creditLimit > 0) ? undefined : "Informe um limite válido",
    closingDay: day(v.closingDay) ? undefined : "Dia entre 1 e 31",
    dueDay: day(v.dueDay) ? (v.dueDay === v.closingDay ? "Vencimento deve ser diferente do fechamento" : undefined) : "Dia entre 1 e 31",
  };
  const valid = Object.values(errors).every((e) => !e);
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const save = () => {
    setTouched(true);
    if (!valid) return;
    dispatch({ type: "upsertCard", card: { id: card?.id ?? uid("c"), name: v.name.trim(), issuer: v.issuer.trim(), ...(v.brand.trim() ? { brand: v.brand.trim() } : {}), last4: v.last4, ...(v.creditLimit.trim() ? { creditLimit: creditLimit! } : {}), closingDay: Number(v.closingDay), dueDay: Number(v.dueDay), active: v.active } });
    toast.success(card ? "Cartão atualizado" : "Cartão cadastrado", { description: `${v.name} •••• ${v.last4}` });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{card ? "Editar cartão" : "Cadastrar cartão"}</DialogTitle>
          <DialogDescription>Nunca informe o número completo, código de segurança ou senha.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-4" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
          <div className="col-span-2"><Field label="Nome identificador" htmlFor="c-name" required error={e("name")}><Input id="c-name" value={v.name} onChange={(x) => setV({ ...v, name: x.target.value })} placeholder="Ex.: Nubank Roxinho" /></Field></div>
          <Field label="Banco ou emissor" htmlFor="c-iss" required error={e("issuer")}><Input id="c-iss" value={v.issuer} onChange={(x) => setV({ ...v, issuer: x.target.value })} /></Field>
          <Field label="Bandeira" htmlFor="c-brand"><Input id="c-brand" value={v.brand} onChange={(x) => setV({ ...v, brand: x.target.value })} placeholder="Opcional" /></Field>
          <Field label="Últimos 4 dígitos" htmlFor="c-l4" required error={e("last4")}><Input id="c-l4" className="num" inputMode="numeric" maxLength={4} value={v.last4} onChange={(x) => setV({ ...v, last4: x.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Limite de crédito (R$)" htmlFor="c-limit" error={e("creditLimit")} hint="Opcional"><Input id="c-limit" className="num" inputMode="decimal" placeholder="Ex.: 10.000,00" value={v.creditLimit} onChange={(x) => setV({ ...v, creditLimit: x.target.value })} /></Field>
          <Field label="Dia de fechamento" htmlFor="c-close" required error={e("closingDay")} hint="Em meses curtos, usa o último dia"><Input id="c-close" inputMode="numeric" value={v.closingDay} onChange={(x) => setV({ ...v, closingDay: x.target.value })} /></Field>
          <Field label="Dia de vencimento" htmlFor="c-due" required error={e("dueDay")}><Input id="c-due" inputMode="numeric" value={v.dueDay} onChange={(x) => setV({ ...v, dueDay: x.target.value })} /></Field>
          <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-sm"><b>Cartão ativo</b><Switch checked={v.active} onCheckedChange={(a) => setV({ ...v, active: a })} /></label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
