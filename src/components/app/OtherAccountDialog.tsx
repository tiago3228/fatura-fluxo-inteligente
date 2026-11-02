import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import type { OtherAccount, Person } from "@/lib/finance/types";
import { fmtBRL, parseBRL, uid } from "@/lib/finance/format";
import { buildOtherAccountResponsibilities } from "@/lib/finance/otherAccounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function OtherAccountDialog({
  account,
  categoryId,
  onClose,
}: {
  account?: OtherAccount;
  categoryId?: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useFinance();
  const categories = state.otherAccountCategories ?? [];
  const availableCategory =
    categories.find((category) => category.id === categoryId)?.id ?? categories[0]?.id ?? "";
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    account?.categoryId ?? availableCategory,
  );
  const [description, setDescription] = useState(account?.description ?? "");
  const [amountInput, setAmountInput] = useState(
    account ? (account.amountCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [dueDate, setDueDate] = useState(account?.dueDate ?? localDateString());
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [divideEquallyAtCreation, setDivideEquallyAtCreation] = useState(false);
  const parsedAmount = parseBRL(amountInput);
  const amountCents = parsedAmount === null ? null : Math.round(parsedAmount * 100);
  const activePeople = state.people.filter((person) => person.active);
  const selectedPeople = useMemo(() => {
    const peopleById = new Map(state.people.map((person) => [person.id, person]));
    return selectedPersonIds
      .map((personId) => peopleById.get(personId))
      .filter((person): person is Person => Boolean(person?.active));
  }, [selectedPersonIds, state.people]);
  const valid = Boolean(
    selectedCategoryId &&
    categories.some((category) => category.id === selectedCategoryId) &&
    description.trim() &&
    amountCents !== null &&
    Number.isSafeInteger(amountCents) &&
    amountCents > 0 &&
    dueDate,
  );
  const oldSplitSum = useMemo(
    () => (account?.responsibilities ?? []).reduce((sum, item) => sum + (item.amountCents ?? 0), 0),
    [account],
  );
  const save = () => {
    if (!valid || amountCents === null) return;
    const responsibilities = account
      ? account.responsibilities.map((person) => {
          if (person.amountCents === undefined || amountCents === oldSplitSum) return person;
          return { personId: person.personId, personName: person.personName };
        })
      : buildOtherAccountResponsibilities(selectedPeople, amountCents, divideEquallyAtCreation);
    const next: OtherAccount = {
      id: account?.id ?? uid("other_account"),
      categoryId: selectedCategoryId,
      description: description.trim(),
      amountCents,
      dueDate,
      status: account?.status ?? "pending",
      responsibilities,
      ...(account?.paidAt ? { paidAt: account.paidAt } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    dispatch({ type: "upsertOtherAccount", account: next });
    toast.success(account ? "Conta atualizada" : "Conta adicionada", {
      description: `${next.description} · ${fmtBRL(next.amountCents / 100)}`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? "Editar conta" : "Adicionar conta"}</DialogTitle>
          <DialogDescription>
            Registre uma conta fora da fatura de cartão. O vencimento e o pagamento ficam separados
            das cobranças do cartão.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">
            Tipo da conta
            <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
              <SelectTrigger aria-label="Tipo da conta">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Fornecedor / identificação
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: Cemig, Copasa, condomínio…"
              maxLength={120}
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Valor (R$)
            <Input
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0,00"
              aria-label="Valor da conta em reais"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Vencimento
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              aria-label="Data de vencimento"
            />
          </label>
        </div>
        <label className="space-y-1.5 text-sm font-medium">
          Observações (opcional)
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Referência, instalação, código de barras (sem dados sensíveis)…"
          />
        </label>
        {!account && (
          <fieldset className="space-y-3 rounded-xl border p-3">
            <legend className="px-1 text-sm font-semibold">Associar pessoas (opcional)</legend>
            <p className="text-xs text-muted-foreground">
              Escolha responsáveis agora ou deixe para associá-los depois.
            </p>
            {activePeople.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cadastre pessoas na aba Pessoas para associá-las a esta conta.
              </p>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {activePeople.map((person) => (
                  <label
                    key={person.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPersonIds.includes(person.id)}
                      onChange={(event) =>
                        setSelectedPersonIds((current) =>
                          event.target.checked
                            ? current.includes(person.id)
                              ? current
                              : [...current, person.id]
                            : current.filter((id) => id !== person.id),
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    <span>{person.name}</span>
                  </label>
                ))}
              </div>
            )}
            <label className="flex cursor-pointer items-start gap-2 border-t pt-3 text-sm">
              <input
                type="checkbox"
                checked={divideEquallyAtCreation}
                disabled={selectedPeople.length === 0}
                onChange={(event) => setDivideEquallyAtCreation(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <strong>Dividir igualmente agora</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {selectedPeople.length > 0 && amountCents !== null && amountCents > 0
                    ? `As quotas somarão ${fmtBRL(amountCents / 100)}; os centavos restantes serão distribuídos para fechar o total.`
                    : "Selecione uma ou mais pessoas e informe o valor para habilitar."}
                </span>
              </span>
            </label>
            {divideEquallyAtCreation &&
              selectedPeople.length > 0 &&
              amountCents !== null &&
              amountCents > 0 && (
                <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
                  {buildOtherAccountResponsibilities(selectedPeople, amountCents, true).map(
                    (share) => (
                      <p key={share.personId} className="flex justify-between gap-3">
                        <span>{share.personName}</span>
                        <strong className="num">{fmtBRL((share.amountCents ?? 0) / 100)}</strong>
                      </p>
                    ),
                  )}
                </div>
              )}
          </fieldset>
        )}
        {account?.responsibilities.some((item) => item.amountCents !== undefined) && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            As quotas atuais somam {fmtBRL(oldSplitSum / 100)}. Se mudar o total, as pessoas
            continuarão associadas, mas o rateio será limpo para evitar valores inconsistentes.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!valid}>
            {account ? "Salvar alterações" : "Adicionar conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
