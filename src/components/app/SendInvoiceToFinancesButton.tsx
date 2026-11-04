import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createCeuSsoLink } from "@/lib/ceu-sso.functions";
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
  const createLink = useServerFn(createCeuSsoLink);
  const [loading, setLoading] = useState(false);
  const label = "Enviar saída para Finanças";
  const disabled =
    loading || !card || !Number.isFinite(invoice.officialTotal) || invoice.officialTotal <= 0;

  const sendToFinances = async () => {
    if (disabled || !card) return;

    setLoading(true);
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
      const referrerPolicy = popup.document.createElement("meta");
      referrerPolicy.name = "referrer";
      referrerPolicy.content = "no-referrer";
      popup.document.head.append(referrerPolicy);
      popup.document.title = "Preparando saída no CEU Finanças";
      popup.document.body.textContent = "Conectando ao CEU Finanças…";
    }

    try {
      const { url, bill } = await createLink({
        data: {
          bill: {
            id: `fatura-em-dia:${invoice.id}`,
            description: `Fatura ${card.name} ${invoice.month.slice(5, 7)}/${invoice.month.slice(0, 4)}`,
            amount: invoice.officialTotal,
            date: invoice.dueDate.slice(0, 10),
          },
        },
      });
      if (bill === "duplicate") toast.info("Essa fatura já estava em Finanças.");
      else if (bill === "created") toast.success("Fatura enviada para Finanças.");
      const target = new URL(url);

      if (popup) popup.location.replace(target.toString());
      else window.location.assign(target.toString());
    } catch (error) {
      popup?.close();
      const message = error instanceof Error && !error.message.startsWith("[") ? error.message : "";
      toast.error("Não foi possível enviar a fatura para Finanças", {
        description: message || "Verifique sua conexão e tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon" : "default"}
      onClick={() => void sendToFinances()}
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
