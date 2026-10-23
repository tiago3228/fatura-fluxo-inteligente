export interface ExportTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
}

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function exportCSV(t: ExportTable, filename: string, sep: ";" | "," = ";") {
  const esc = (v: string | number) => {
    const s = typeof v === "number" ? v.toFixed(2).replace(".", sep === ";" ? "," : ".") : v;
    return /["\n;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.headers, ...t.rows, ...(t.footer ? [t.footer] : [])].map((r) => r.map(esc).join(sep));
  download(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), filename);
}

export async function exportXLSX(t: ExportTable, filename: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([[t.title], ...(t.subtitle ? [[t.subtitle]] : []), [], t.headers, ...t.rows, ...(t.footer ? [t.footer] : [])]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export async function createPDFBlob(t: ExportTable) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF();
  doc.setFontSize(15);
  doc.text(t.title, 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(110);
  if (t.subtitle) doc.text(t.subtitle, 14, 25);
  doc.text("Gerado localmente no navegador a partir dos dados atuais", 14, t.subtitle ? 30 : 25);
  const fmt = (v: string | number) =>
    typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : v;
  autoTable(doc, {
    startY: 36,
    head: [t.headers],
    body: t.rows.map((r) => r.map(fmt)),
    foot: t.footer ? [t.footer.map(fmt)] : undefined,
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [31, 76, 70] },
    footStyles: { fillColor: [235, 240, 238], textColor: 20 },
  });
  return doc.output("blob");
}

export async function exportPDF(t: ExportTable, filename: string) {
  download(await createPDFBlob(t), filename);
}
