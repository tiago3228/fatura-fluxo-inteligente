import { useState } from "react";
import { FileDown, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportCSV, exportPDF, exportXLSX, type ExportTable } from "@/lib/finance/export";
import { useFinance } from "@/lib/finance/store";
import { Button } from "@/components/ui/button";

export function ExportButtons({ table, filename }: { table: () => ExportTable; filename: string }) {
  const { state } = useFinance();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (kind: "csv" | "xlsx" | "pdf") => {
    setBusy(kind);
    try {
      const t = table();
      if (t.rows.length === 0) { toast.error("Não há dados para exportar com os filtros atuais"); return; }
      const name = `${filename}.${kind}`;
      if (kind === "csv") exportCSV(t, name, state.settings.csvSeparator);
      if (kind === "xlsx") await exportXLSX(t, name);
      if (kind === "pdf") await exportPDF(t, name);
      toast.success(`Arquivo ${name} gerado`, { description: "Baixado pelo navegador com os dados locais atuais." });
    } catch (e) {
      toast.error("Não foi possível gerar o arquivo", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };
  const icon = (k: string, I: typeof FileDown) => (busy === k ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run("csv")}>{icon("csv", FileDown)} Exportar CSV</Button>
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run("xlsx")}>{icon("xlsx", FileSpreadsheet)} Exportar Excel</Button>
      <Button size="sm" disabled={!!busy} onClick={() => run("pdf")}>{icon("pdf", FileText)} Gerar PDF</Button>
    </div>
  );
}
