import { createFileRoute } from "@tanstack/react-router";
import { Calculator, CalendarDays, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { addMonths } from "@/lib/finance/calc";
import { fmtBRL, fmtMonthLong, parseBRL, round2 } from "@/lib/finance/format";
import { useFinance } from "@/lib/finance/store";
import { Panel, PageHeader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloatingCalculator } from "@/components/app/FloatingCalculator";

export const Route = createFileRoute("/_authenticated/calculadora")({
  head: () => ({
    meta: [
      { title: "Calculadora — Fatura em Dia" },
      { name: "description", content: "Simule compras parceladas e divida os valores entre pessoas sem alterar suas faturas." },
    ],
  }),
  component: Calculadora,
});

function Calculadora() {
  const { state } = useFinance();
  const [totalText, setTotalText] = useState("1.000,00");
  const [installments, setInstallments] = useState("3");
  const [firstMonth, setFirstMonth] = useState(state.settings.month);
  const [cardId, setCardId] = useState("none");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [quickCalculatorOpen, setQuickCalculatorOpen] = useState(false);

  const total = parseBRL(totalText) ?? 0;
  const count = Math.min(48, Math.max(1, Number(installments) || 1));
  const parts = useMemo(() => {
    if (!total) return [];
    const base = round2(total / count);
    const remainder = round2(total - base * count);
    return Array.from({ length: count }, (_, index) => round2(base + (index === 0 ? remainder : 0)));
  }, [total, count]);
  const splitAmount = selectedPeople.length ? round2(total / selectedPeople.length) : 0;
  const selectedCard = state.cards.find((card) => card.id === cardId);

  const reset = () => {
    setTotalText("");
    setInstallments("1");
    setFirstMonth(state.settings.month);
    setCardId("none");
    setSelectedPeople([]);
  };

  return (
    <>
      <PageHeader
        title="Calculadora"
        description="Simule uma compra antes de lançá-la. Nada nesta tela altera suas faturas ou atribuições."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setQuickCalculatorOpen(true)}>
              <Calculator className="size-4" /> Calculadora rápida
            </Button>
            <Button variant="outline" onClick={reset}><RotateCcw className="size-4" /> Limpar</Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <Panel title="Dados da simulação" description="Informe o valor total e a quantidade de parcelas.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">
              Valor total da compra (R$)
              <Input className="num mt-1.5 text-lg" inputMode="decimal" placeholder="1.000,00" value={totalText} onChange={(event) => setTotalText(event.target.value)} />
            </label>
            <label className="text-sm font-medium">
              Número de parcelas
              <Input className="num mt-1.5" type="number" min={1} max={48} value={installments} onChange={(event) => setInstallments(event.target.value)} />
            </label>
            <label className="text-sm font-medium">
              Primeira fatura
              <Input className="mt-1.5" type="month" value={firstMonth} onChange={(event) => setFirstMonth(event.target.value)} />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Cartão (opcional)
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Nenhum cartão selecionado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum cartão selecionado</SelectItem>
                  {state.cards.map((card) => <SelectItem key={card.id} value={card.id}>{card.name} •••• {card.last4}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>

          {selectedCard?.creditLimit !== undefined && total > selectedCard.creditLimit && (
            <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              O valor da compra é maior que o limite cadastrado de {fmtBRL(selectedCard.creditLimit)}. A calculadora não bloqueia a simulação.
            </p>
          )}

          <div className="mt-6 border-t pt-5">
            <h3 className="font-semibold">Dividir entre pessoas</h3>
            <p className="mt-1 text-sm text-muted-foreground">Selecione quem participará da compra. A divisão será igualitária.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {state.people.filter((person) => person.active).map((person) => (
                <label key={person.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                  <Checkbox checked={selectedPeople.includes(person.id)} onCheckedChange={(checked) => setSelectedPeople((current) => checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />
                  <span className="flex-1">{person.name}</span>
                  {selectedPeople.includes(person.id) && <span className="num text-muted-foreground">{fmtBRL(splitAmount)}</span>}
                </label>
              ))}
            </div>
            {state.people.filter((person) => person.active).length === 0 && <p className="mt-3 text-sm text-muted-foreground">Cadastre uma pessoa para simular uma divisão.</p>}
          </div>
        </Panel>

        <Panel title="Resultado" description="Previsão das parcelas da compra simulada.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Total</p><p className="num mt-1 text-xl font-bold">{fmtBRL(total)}</p></div>
            <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Cada parcela</p><p className="num mt-1 text-xl font-bold">{parts.length ? fmtBRL(parts[0] ?? 0) : "—"}</p></div>
          </div>

          <div className="mt-5 space-y-2">
            {parts.length === 0 && <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground"><Calculator className="size-8" /><p>Informe um valor para começar a simulação.</p></div>}
            {parts.map((amount, index) => {
              const month = addMonths(firstMonth, index);
              return <div key={`${month}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"><span className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /> {index + 1}ª parcela <span className="text-muted-foreground">· {fmtMonthLong(month)}</span></span><span className="num font-semibold">{fmtBRL(amount)}</span></div>;
            })}
          </div>

          {selectedPeople.length > 0 && <div className="mt-5 rounded-lg bg-accent p-3 text-sm"><p className="font-semibold">Divisão igualitária</p><p className="mt-1 text-muted-foreground">{selectedPeople.length} {selectedPeople.length === 1 ? "pessoa" : "pessoas"} · {fmtBRL(splitAmount)} por pessoa no total · {fmtBRL(round2(splitAmount / count))} por parcela</p></div>}
        </Panel>
      </div>
      {quickCalculatorOpen && <FloatingCalculator onClose={() => setQuickCalculatorOpen(false)} />}
    </>
  );
}
