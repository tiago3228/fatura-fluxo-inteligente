import { useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { parseBRL } from "@/lib/finance/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./common";

const formatLimitInput = (value: number | undefined) =>
  value === undefined ? "" : value.toFixed(2).replace(".", ",");

export function CardLimitDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const initialCard = state.cards.find((card) => card.active) ?? state.cards[0];
  const [cardId, setCardId] = useState(initialCard?.id ?? "");
  const [value, setValue] = useState(formatLimitInput(initialCard?.creditLimit));
  const [touched, setTouched] = useState(false);
  const selectedCard = state.cards.find((card) => card.id === cardId);
  const parsedLimit = value.trim() ? parseBRL(value) : null;
  const error =
    !value.trim() || parsedLimit === null || parsedLimit <= 0
      ? "Informe um limite maior que zero."
      : undefined;

  const save = () => {
    setTouched(true);
    if (!selectedCard || error || parsedLimit === null) return;
    dispatch({
      type: "upsertCard",
      card: { ...selectedCard, creditLimit: parsedLimit },
    });
    toast.success("Limite do cartão atualizado", {
      description: `${selectedCard.name} •••• ${selectedCard.last4}`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Definir limite do cartão</DialogTitle>
          <DialogDescription>
            Informe o limite manual em reais. Esta alteração não muda o titular do cartão nem as atribuições das compras.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <Field label="Cartão" htmlFor="overview-card-limit-card" required>
            <Select
              value={cardId}
              onValueChange={(nextCardId) => {
                const nextCard = state.cards.find((card) => card.id === nextCardId);
                setCardId(nextCardId);
                setValue(formatLimitInput(nextCard?.creditLimit));
                setTouched(false);
              }}
            >
              <SelectTrigger id="overview-card-limit-card" aria-label="Cartão">
                <SelectValue placeholder="Selecione um cartão" />
              </SelectTrigger>
              <SelectContent>
                {state.cards.map((card) => (
                  <SelectItem key={card.id} value={card.id}>
                    {card.name} •••• {card.last4}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Limite de crédito (R$)"
            htmlFor="overview-card-credit-limit"
            required
            error={touched ? error : undefined}
            hint="Exemplo: 10.000,00"
          >
            <Input
              id="overview-card-credit-limit"
              className="num"
              inputMode="decimal"
              placeholder="0,00"
              value={value}
              aria-invalid={Boolean(touched && error)}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar limite</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
