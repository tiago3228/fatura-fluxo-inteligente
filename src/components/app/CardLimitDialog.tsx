import { useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { totalCardLimit } from "@/lib/finance/calc";
import { parseBRL } from "@/lib/finance/format";
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
import { Field } from "./common";

const formatLimitInput = (value: number | undefined) =>
  value === undefined ? "" : value.toFixed(2).replace(".", ",");

export function CardLimitDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useFinance();
  const [value, setValue] = useState(formatLimitInput(totalCardLimit(state) ?? undefined));
  const [touched, setTouched] = useState(false);
  const parsedLimit = value.trim() ? parseBRL(value) : null;
  const error =
    !value.trim() || parsedLimit === null || parsedLimit <= 0
      ? "Informe um limite maior que zero."
      : undefined;

  const save = () => {
    setTouched(true);
    if (error || parsedLimit === null) return;
    dispatch({ type: "updateSettings", patch: { cardLimitTotal: parsedLimit } });
    toast.success("Limite total dos cartões atualizado", {
      description: "Valor compartilhado entre todos os cartões cadastrados.",
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Definir limite total dos cartões</DialogTitle>
          <DialogDescription>
            Informe um único limite compartilhado por todos os cartões. O disponível considera
            faturas em aberto e parcelas futuras conhecidas; compras já pagas não são descontadas
            novamente.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field
            label="Limite total (R$)"
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
            <Button type="submit">Salvar limite total</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
