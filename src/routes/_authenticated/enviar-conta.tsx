import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { availableMonths, monthTxs, personMonthPaid, personMonthTotal } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong } from "@/lib/finance/format";
import { createPersonAccountJpeg, type ShareAccountRow } from "@/lib/finance/share-image";
import { PageHeader, Panel, EmptyState } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/enviar-conta")({
  head: () => ({
    meta: [
      { title: "Enviar conta — Fatura em Dia" },
      {
        name: "description",
        content: "Gere uma imagem da conta de cada pessoa para salvar ou enviar pelo WhatsApp.",
      },
    ],
  }),
  component: EnviarConta,
});

function EnviarConta() {
  const { state } = useFinance();
  const [month, setMonth] = useState(state.settings.month);
  const [expanded, setExpanded] = useState<string[]>([]);
  const months = availableMonths(state);

  const toggle = (personId: string) => {
    setExpanded((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  };

  return (
    <>
      <PageHeader
        title="Enviar conta"
        description="Gere uma imagem pronta para salvar ou enviar para cada pessoa."
        actions={
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48" aria-label="Mês da conta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((item) => (
                <SelectItem key={item} value={item}>
                  {fmtMonthLong(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <Panel>
        {state.people.length === 0 ? (
          <EmptyState
            title="Nenhuma pessoa cadastrada"
            description="Cadastre uma pessoa antes de gerar uma conta."
          />
        ) : (
          <div className="divide-y">
            {state.people.map((person) => {
              const rows = rowsForPerson(state, person.id, month);
              const total = personMonthTotal(state, person.id, month);
              const paid = personMonthPaid(state, person.id, month);
              const isExpanded = expanded.includes(person.id);
              return (
                <PersonAccountCard
                  key={person.id}
                  person={person}
                  month={month}
                  rows={rows}
                  total={total}
                  paid={paid}
                  expanded={isExpanded}
                  onToggle={() => toggle(person.id)}
                />
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}

function rowsForPerson(
  state: ReturnType<typeof useFinance>["state"],
  personId: string,
  month: string,
): ShareAccountRow[] {
  return monthTxs(state, month)
    .filter(
      (transaction) =>
        transaction.type !== "pagamento" &&
        transaction.allocations.some((allocation) => allocation.personId === personId),
    )
    .map((transaction) => ({
      transaction,
      amount: transaction.allocations
        .filter((allocation) => allocation.personId === personId)
        .reduce((sum, allocation) => sum + allocation.amount, 0),
    }))
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
}

function PersonAccountCard({
  person,
  month,
  rows,
  total,
  paid,
  expanded,
  onToggle,
}: {
  person: { id: string; name: string };
  month: string;
  rows: ShareAccountRow[];
  total: number;
  paid: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const remaining = Math.max(0, total - paid);

  const createImage = async () => createPersonAccountJpeg({ person, month, rows, total, paid });
  const filename = `conta-${person.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-${month}.jpg`;

  const download = async () => {
    if (!rows.length) return;
    setBusy("download");
    try {
      const blob = await createImage();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Imagem gerada", { description: `${filename} foi baixado.` });
    } catch (error) {
      toast.error("Não foi possível gerar a imagem", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!rows.length) return;
    setBusy("share");
    try {
      const blob = await createImage();
      const file = new File([blob], filename, { type: "image/jpeg" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: `Conta de ${person.name}`,
          text: `Conta de ${person.name} · ${fmtMonthLong(month)} · ${fmtBRL(remaining)}`,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.open(
          `https://wa.me/?text=${encodeURIComponent(`Conta de ${person.name} · ${fmtMonthLong(month)} · ${fmtBRL(remaining)}\nA imagem foi salva para anexar no WhatsApp.`)}`,
          "_blank",
          "noopener,noreferrer",
        );
        toast.success("Imagem salva e WhatsApp aberto", {
          description: "Anexe o JPEG baixado à conversa.",
        });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error("Não foi possível compartilhar a conta");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={cn("p-4", expanded && "bg-muted/20")}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">
            {person.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{person.name}</span>
            <span className="text-xs text-muted-foreground">
              {rows.length} compra(s) · {fmtMonthLong(month)}
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="ml-auto size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="ml-auto size-4 text-muted-foreground" />
          )}
        </button>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Valor a pagar</p>
          <p className="num text-lg font-bold text-primary">{fmtBRL(remaining)}</p>
          {paid > 0 && <p className="text-xs text-success">{fmtBRL(paid)} pago</p>}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length || !!busy}
            onClick={download}
            title="Salvar conta como JPEG"
          >
            <Download className="size-4" /> JPEG
          </Button>
          <Button
            size="sm"
            disabled={!rows.length || !!busy}
            onClick={share}
            title="Enviar conta pelo WhatsApp"
          >
            <MessageCircle className="size-4" /> WhatsApp
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-4 overflow-x-auto rounded-lg border bg-background">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Compra</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ transaction, amount }) => (
                <tr key={transaction.id}>
                  <td className="num px-3 py-2 text-muted-foreground">
                    {fmtDate(transaction.date)}
                  </td>
                  <td className="px-3 py-2 font-medium">{transaction.description}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {transaction.category ?? "Sem categoria"}
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{fmtBRL(amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-bold">
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  Total
                </td>
                <td className="num px-3 py-2 text-right">{fmtBRL(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </article>
  );
}
