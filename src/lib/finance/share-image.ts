import { fmtBRL, fmtDate, fmtMonthLong } from "./format";
import type { Person, Transaction } from "./types";

export type ShareAccountRow = {
  transaction: Transaction;
  amount: number;
};

const loadFont = (ctx: CanvasRenderingContext2D, size: number, weight = 400) => {
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
};

export async function createPersonAccountJpeg({
  person,
  month,
  rows,
  total,
  paid,
}: {
  person: Person;
  month: string;
  rows: ShareAccountRow[];
  total: number;
  paid: number;
}): Promise<Blob> {
  const width = 1200;
  const rowHeight = 48;
  const height = Math.min(18000, 270 + rows.length * rowHeight);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#f8faf9";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1f4c46";
  ctx.fillRect(0, 0, width, 142);
  ctx.fillStyle = "#ffffff";
  loadFont(ctx, 34, 700);
  ctx.fillText("Fatura em Dia", 54, 55);
  loadFont(ctx, 22, 400);
  ctx.fillText(`Conta de ${person.name}`, 54, 95);
  ctx.fillStyle = "rgba(255,255,255,.78)";
  loadFont(ctx, 18);
  ctx.fillText(fmtMonthLong(month), 54, 123);

  ctx.fillStyle = "#172522";
  loadFont(ctx, 24, 700);
  ctx.fillText("Compras vinculadas", 54, 188);
  ctx.fillStyle = "#61706d";
  loadFont(ctx, 17);
  ctx.fillText(`${rows.length} lançamento(s)`, 54, 216);

  let y = 252;
  ctx.fillStyle = "#dfe9e6";
  ctx.fillRect(42, y - 27, width - 84, 34);
  ctx.fillStyle = "#49605b";
  loadFont(ctx, 15, 700);
  ctx.fillText("DATA", 58, y - 5);
  ctx.fillText("COMPRA", 218, y - 5);
  ctx.textAlign = "right";
  ctx.fillText("VALOR", width - 58, y - 5);
  ctx.textAlign = "left";
  y += 34;

  rows.forEach(({ transaction, amount }, index) => {
    if (y > height - 120) return;
    ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f0f5f3";
    ctx.fillRect(42, y - 25, width - 84, rowHeight);
    ctx.fillStyle = "#52635f";
    loadFont(ctx, 16);
    ctx.fillText(fmtDate(transaction.date), 58, y + 5);
    ctx.fillStyle = "#1c2d29";
    loadFont(ctx, 17, 600);
    const label =
      transaction.description.length > 52
        ? `${transaction.description.slice(0, 49)}…`
        : transaction.description;
    ctx.fillText(label, 218, y + 5);
    ctx.fillStyle = "#1f4c46";
    loadFont(ctx, 17, 700);
    ctx.textAlign = "right";
    ctx.fillText(fmtBRL(amount), width - 58, y + 5);
    ctx.textAlign = "left";
    y += rowHeight;
  });

  const summaryY = Math.min(height - 105, y + 28);
  ctx.fillStyle = "#1f4c46";
  ctx.fillRect(42, summaryY, width - 84, 78);
  ctx.fillStyle = "#ffffff";
  loadFont(ctx, 18, 400);
  ctx.fillText("TOTAL A PAGAR", 64, summaryY + 31);
  loadFont(ctx, 28, 700);
  ctx.textAlign = "right";
  ctx.fillText(fmtBRL(Math.max(0, total - paid)), width - 64, summaryY + 34);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,.78)";
  loadFont(ctx, 14);
  ctx.fillText(
    paid > 0
      ? `Total: ${fmtBRL(total)} · Já pago: ${fmtBRL(paid)}`
      : `Total da competência: ${fmtBRL(total)}`,
    64,
    summaryY + 58,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível gerar o JPEG."))),
      "image/jpeg",
      0.92,
    );
  });
}
