import { useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { parseBRL, uid } from "@/lib/finance/format";
import type { Person } from "@/lib/finance/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "./common";

export function PersonDialog({ person, onClose, onSaved }: { person?: Person; onClose: () => void; onSaved?: (person: Person) => void }) {
  const { state, dispatch } = useFinance();
  const [name, setName] = useState(person?.name ?? "");
  const [limit, setLimit] = useState(person ? person.limit.toFixed(2).replace(".", ",") : "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [active, setActive] = useState(person?.active ?? true);
  const [cardIds, setCardIds] = useState<string[]>(person?.cardIds ?? []);
  const [touched, setTouched] = useState(false);

  const lim = parseBRL(limit);
  const errors = {
    name: name.trim().length < 2 ? "Informe o nome completo" : undefined,
    limit: lim === null || lim < 0 ? "Informe um limite válido (ex.: 1.500,00)" : undefined,
  };
  const valid = !errors.name && !errors.limit;

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const savedPerson: Person = { id: person?.id ?? uid("p"), name: name.trim(), limit: lim!, notes: notes.trim() || undefined, active, cardIds };
    dispatch({ type: "upsertPerson", person: savedPerson });
    toast.success(person ? "Pessoa atualizada" : "Pessoa adicionada", { description: name.trim() });
    onSaved?.(savedPerson);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{person ? "Editar pessoa" : "Adicionar pessoa"}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Nome completo" htmlFor="p-name" required error={touched ? errors.name : undefined}>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Limite mensal de gastos (R$)" htmlFor="p-limit" required error={touched ? errors.limit : undefined}>
            <Input id="p-limit" inputMode="decimal" placeholder="1.500,00" value={limit} onChange={(e) => setLimit(e.target.value)} className="num" />
          </Field>
          <Field label="Cartões que utiliza">
            <div className="space-y-2 rounded-lg border p-3">
              {state.cards.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={cardIds.includes(c.id)} onCheckedChange={(v) => setCardIds((ids) => (v ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                  {c.name} <span className="num text-muted-foreground">•••• {c.last4}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Observações" htmlFor="p-notes">
            <Textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span><b>Ativa</b><span className="block text-xs text-muted-foreground">Pessoas inativas não aparecem para novas atribuições</span></span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
