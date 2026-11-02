import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFinance } from "@/lib/finance/store";
import { fmtBRL, parseBRL } from "@/lib/finance/format";
import { splitEvenlyInCents } from "@/lib/finance/otherAccounts";
import type { OtherAccount, OtherAccountResponsibility } from "@/lib/finance/types";

export function OtherAccountPeopleDialog({
  account,
  mode,
  onClose,
}: {
  account: OtherAccount;
  mode: "associate" | "split";
  onClose: () => void;
}) {
  const { state, dispatch } = useFinance();
  const people = useMemo(() => {
    const existingIds = new Set(account.responsibilities.map((item) => item.personId));
    const current = state.people
      .filter((person) => person.active || existingIds.has(person.id))
      .map((person) => ({ id: person.id, name: person.name, active: person.active }));
    const currentIds = new Set(current.map((person) => person.id));
    const removed = account.responsibilities
      .filter((item) => !currentIds.has(item.personId))
      .map((item) => ({ id: item.personId, name: item.personName, active: false }));
    return [...current, ...removed];
  }, [account.responsibilities, state.people]);
  const initialIds = account.responsibilities.map((item) => item.personId);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [amounts, setAmounts] = useState<Record<string, number | null | undefined>>(() => {
    const hasShares = account.responsibilities.some((item) => item.amountCents !== undefined);
    const initial = hasShares
      ? account.responsibilities.map((item) => ({
          personId: item.personId,
          amountCents: item.amountCents ?? 0,
        }))
      : splitEvenlyInCents(
          account.amountCents,
          people.map((person) => ({ id: person.id, name: person.name })),
        );
    return Object.fromEntries(initial.map((item) => [item.personId, item.amountCents]));
  });
  const selected = selectedIds
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is (typeof people)[number] => Boolean(person));
  const shareValues = selected.map((person) => amounts[person.id]);
  const hasInvalidAmount = shareValues.some(
    (value) => value === null || value === undefined || !Number.isSafeInteger(value) || value < 0,
  );
  const sharesTotal = shareValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const validSplit =
    selected.length > 0 && !hasInvalidAmount && sharesTotal === account.amountCents;

  const toggle = (id: string, checked: boolean) => {
    const nextIds = checked ? [...selectedIds, id] : selectedIds.filter((item) => item !== id);
    setSelectedIds(nextIds);
    if (mode === "split") {
      const nextPeople = nextIds
        .map((personId) => people.find((person) => person.id === personId))
        .filter((person): person is (typeof people)[number] => Boolean(person));
      setAmounts((current) => ({
        ...current,
        ...Object.fromEntries(
          splitEvenlyInCents(account.amountCents, nextPeople).map((item) => [
            item.personId,
            item.amountCents,
          ]),
        ),
      }));
    }
  };

  const divideEqually = () => {
    setAmounts((current) => ({
      ...current,
      ...Object.fromEntries(
        splitEvenlyInCents(
          account.amountCents,
          selected.map((person) => ({ id: person.id, name: person.name })),
        ).map((item) => [item.personId, item.amountCents]),
      ),
    }));
  };

  const save = () => {
    if (mode === "split" && !validSplit) return;
    const responsibilities: OtherAccountResponsibility[] = selected.map((person) => ({
      personId: person.id,
      personName: person.name,
      ...(mode === "split" ? { amountCents: amounts[person.id]! } : {}),
    }));
    dispatch({
      type: "upsertOtherAccount",
      account: { ...account, responsibilities },
    });
    toast.success(mode === "split" ? "Divisão salva" : "Pessoas associadas", {
      description:
        mode === "split"
          ? `O total de ${fmtBRL(account.amountCents / 100)} foi distribuído sem diferença.`
          : `${selected.length} ${selected.length === 1 ? "pessoa associada" : "pessoas associadas"} a ${account.description}.`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "split" ? "Dividir conta entre pessoas" : "Associar pessoas à conta"}
          </DialogTitle>
          <DialogDescription>
            {mode === "split"
              ? `Valor total: ${fmtBRL(account.amountCents / 100)}. A soma das quotas precisa ser igual ao total.`
              : `Escolha quem está relacionado a “${account.description}”. Essa associação não registra pagamento nem altera faturas de cartão.`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cadastre pessoas antes de associá-las a uma conta.
            </p>
          ) : (
            people.map((person) => (
              <label
                key={person.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(person.id)}
                  onChange={(event) => toggle(person.id, event.target.checked)}
                  className="size-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {person.name}
                  {!person.active && (
                    <span className="ml-2 text-xs text-muted-foreground">(inativa)</span>
                  )}
                </span>
                {mode === "split" && selectedIds.includes(person.id) && (
                  <span className="w-32">
                    <Input
                      inputMode="decimal"
                      aria-label={`Quota de ${person.name}`}
                      value={
                        amounts[person.id] === null || amounts[person.id] === undefined
                          ? ""
                          : (amounts[person.id]! / 100).toFixed(2).replace(".", ",")
                      }
                      onChange={(event) => {
                        const parsed = parseBRL(event.target.value);
                        setAmounts((current) => ({
                          ...current,
                          [person.id]: parsed === null ? null : Math.round(parsed * 100),
                        }));
                      }}
                      className="h-9 text-right"
                    />
                  </span>
                )}
              </label>
            ))
          )}
        </div>
        {mode === "split" && (
          <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span>Total das quotas</span>
              <strong className="num">{fmtBRL(sharesTotal / 100)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Diferença para o total</span>
              <strong
                className={sharesTotal === account.amountCents ? "text-success" : "text-danger"}
              >
                {fmtBRL((account.amountCents - sharesTotal) / 100)}
              </strong>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={divideEqually}
              disabled={selected.length === 0}
            >
              Dividir igualmente
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={mode === "split" ? !validSplit : false}>
            {mode === "split" ? "Salvar divisão" : "Salvar responsáveis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
