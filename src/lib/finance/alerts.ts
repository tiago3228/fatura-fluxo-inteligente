import { useFinance } from "./store";
import {
  invoiceDiff,
  limitMessage,
  limitStatus,
  monthInvoices,
  monthTxs,
  personMonthRemaining,
  personMonthTotal,
  planRemainingCount,
  planStatusAt,
  txStatus,
} from "./calc";
import { fmtBRL, fmtDate, fmtMonth } from "./format";

export interface AppAlert {
  id: string;
  tone: "danger" | "warning" | "info";
  text: string;
  to: "/compras" | "/pessoas" | "/faturas" | "/parcelamentos";
}

export function useAlerts(): AppAlert[] {
  const { state } = useFinance();
  const m = state.settings.month;
  const out: AppAlert[] = [];
  const pending = monthTxs(state, m).filter((t) => txStatus(t) === "pendente");
  if (pending.length)
    out.push({
      id: "pend",
      tone: "warning",
      to: "/compras",
      text: `${pending.length} compra(s) sem responsável em ${fmtMonth(m)}.`,
    });
  state.people
    .filter((p) => p.active)
    .forEach((p) => {
      const total = personMonthTotal(state, p.id, m);
      const st = limitStatus(total, p.limit, state.settings.warnPct);
      const msg = limitMessage(p.name, total, p.limit, state.settings.warnPct);
      if (msg)
        out.push({
          id: `lim_${p.id}`,
          tone: st === "atencao" ? "warning" : "danger",
          to: "/pessoas",
          text: msg,
        });
      const remaining = personMonthRemaining(state, p.id, m);
      if (total > 0 && remaining > 0)
        out.push({
          id: `pay_${p.id}`,
          tone: "warning",
          to: "/pessoas",
          text: `${p.name} ainda tem ${fmtBRL(remaining)} pendente de pagamento em ${fmtMonth(m)}.`,
        });
    });
  monthInvoices(state, m).forEach((inv) => {
    const d = invoiceDiff(state, inv);
    if (d !== 0) {
      const c = state.cards.find((x) => x.id === inv.cardId);
      out.push({
        id: `inv_${inv.id}`,
        tone: "danger",
        to: "/faturas",
        text: `Fatura ${c?.name} (${fmtMonth(inv.month)}) tem diferença de ${fmtBRL(d)} entre o total oficial e os lançamentos.`,
      });
    }
    if (inv.status !== "paga" && inv.dueDate < new Date().toISOString().slice(0, 10))
      out.push({
        id: `due_${inv.id}`,
        tone: "danger",
        to: "/faturas",
        text: `Fatura ${c?.name ?? "do cartão"} venceu em ${fmtDate(inv.dueDate)} e continua em aberto.`,
      });
  });
  state.plans.forEach((p) => {
    if (planStatusAt(p, m) === "ativo" && planRemainingCount(p, m) <= 1)
      out.push({
        id: `pl_${p.id}`,
        tone: "info",
        to: "/parcelamentos",
        text: `${p.description}: ${planRemainingCount(p, m) === 0 ? "última parcela neste mês" : "falta apenas 1 parcela"}.`,
      });
  });
  return out;
}
