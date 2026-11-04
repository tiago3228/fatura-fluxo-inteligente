import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createCeuSsoLink } from "@/lib/ceu-sso.functions";

export interface FinancesBill {
  id: string;
  description: string;
  amount: number;
  date: string;
}

export function useSendToFinances() {
  const createLink = useServerFn(createCeuSsoLink);
  const [loading, setLoading] = useState(false);

  const sendToFinances = async (bill: FinancesBill, label: "Fatura" | "Conta" = "Fatura") => {
    if (loading || !Number.isFinite(bill.amount) || bill.amount <= 0) return;

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
      const result = await createLink({ data: { bill } });
      if (result.bill === "duplicate") {
        toast.info(`Essa ${label.toLowerCase()} já estava em Finanças.`);
      } else if (result.bill === "created") {
        toast.success(`${label} enviada para Finanças.`);
      }
      const target = new URL(result.url);
      if (popup) popup.location.replace(target.toString());
      else window.location.assign(target.toString());
    } catch (error) {
      popup?.close();
      const message = error instanceof Error && !error.message.startsWith("[") ? error.message : "";
      const article = label === "Fatura" ? "a fatura" : "a conta";
      toast.error(`Não foi possível enviar ${article} para Finanças`, {
        description: message || "Verifique sua conexão e tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  };

  return { loading, sendToFinances };
}
