import { useState } from "react";
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
import { uid } from "@/lib/finance/format";

export function OtherAccountCategoryDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (categoryId: string) => void;
}) {
  const { state, dispatch } = useFinance();
  const [name, setName] = useState("");
  const duplicate = (state.otherAccountCategories ?? []).some(
    (category) =>
      category.name.trim().toLocaleLowerCase("pt-BR") === name.trim().toLocaleLowerCase("pt-BR"),
  );
  const valid = name.trim().length > 0 && !duplicate;
  const categoryId = uid("other_category");

  const save = () => {
    if (!valid) return;
    const category = { id: categoryId, name: name.trim(), builtIn: false };
    dispatch({ type: "upsertOtherAccountCategory", category });
    toast.success(`Tipo “${category.name}” adicionado`);
    onSaved(category.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo tipo de conta</DialogTitle>
          <DialogDescription>
            Adicione outra categoria além de Energia, Água, Internet, Condomínio, IPTU e IPVA.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5 text-sm font-medium">
          Nome do tipo
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            placeholder="Ex.: Gás, escola, seguro…"
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
        </label>
        {duplicate && (
          <p className="text-sm text-danger">Já existe um tipo de conta com esse nome.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!valid}>
            Adicionar tipo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
