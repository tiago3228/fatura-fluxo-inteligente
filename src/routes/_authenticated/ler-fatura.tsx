import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { analyzeBill } from "@/lib/bill-ai.functions";
import { fmtBRL, fmtDate } from "@/lib/finance/format";

export const Route = createFileRoute("/_authenticated/ler-fatura")({
  head: () => ({
    meta: [
      { title: "Ler fatura com IA — Fatura em Dia" },
      { name: "description", content: "Cole os dados de uma fatura e a IA identifica fornecedor, valor e vencimento." },
      { property: "og:title", content: "Ler fatura com IA — Fatura em Dia" },
      { property: "og:description", content: "Resumo automático do que precisa ser pago." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LerFatura,
});

type Result = { supplier: string | null; amount: number | null; dueDate: string | null; summary: string };

function LerFatura() {
  const run = useServerFn(analyzeBill);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await run({ data: { text } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao analisar a fatura.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Ler fatura com IA</h1>
      <p className="text-sm text-muted-foreground">
        Cole o texto da fatura ou boleto (ou digite os dados). A IA identifica o fornecedor, o valor e o vencimento.
      </p>
      <Textarea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ex.: Enel — Conta de energia. Total a pagar R$ 152,37. Vencimento 10/11/2026..."
      />
      <Button onClick={submit} disabled={loading || text.trim().length < 5}>
        {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
        {loading ? "Analisando…" : "Analisar fatura"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>O que precisa ser pago</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Fornecedor" value={result.supplier ?? "Não identificado"} />
              <Info label="Valor" value={result.amount != null ? fmtBRL(result.amount) : "Não identificado"} />
              <Info label="Vencimento" value={result.dueDate ? fmtDate(result.dueDate) : "Não identificado"} />
            </div>
            <p className="text-sm">{result.summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
