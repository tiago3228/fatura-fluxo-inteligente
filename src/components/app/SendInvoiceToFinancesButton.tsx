import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSendToFinances } from "@/components/app/useSendToFinances";
import type { CreditCard, Invoice } from "@/lib/finance/types";

interface SendInvoiceToFinancesButtonProps {
  invoice: Invoice;
  card?: CreditCard;
  compact?: boolean;
}

export function SendInvoiceToFinancesButton({
  invoice,
  card,
  compact = false,
}: SendInvoiceToFinancesButtonProps) {
  const { loading, sendToFinances } = useSendToFinances();
  const label = "Enviar saída para Finanças";
  const disabled =
    loading || !card || !Number.isFinite(invoice.officialTotal) || invoice.officialTotal <= 0;

  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon" : "default"}
      onClick={() =>
        card &&
        void sendToFinances(
          {
            id: `fatura-em-dia:${invoice.id}`,
            description: `Fatura ${card.name} ${invoice.month.slice(5, 7)}/${invoice.month.slice(0, 4)}`,
            amount: invoice.officialTotal,
            date: invoice.dueDate.slice(0, 10),
          },
          "Fatura",
        )
      }
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Send className="size-4" aria-hidden="true" />
      )}
      {compact ? <span className="sr-only">{label}</span> : loading ? "Preparando envio…" : label}
    </Button>
  );
}
