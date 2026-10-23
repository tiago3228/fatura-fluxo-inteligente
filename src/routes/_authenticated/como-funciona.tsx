import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  CreditCard,
  FileDown,
  FileUp,
  Filter,
  HelpCircle,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  PieChart,
  RefreshCw,
  Smartphone,
  Split,
  Users,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/app/common";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/como-funciona")({
  head: () => ({
    meta: [
      { title: "Como Funciona — Fatura em Dia" },
      { name: "description", content: "Tutoriais para importar faturas, organizar cartões e dividir compras no Fatura em Dia." },
      { property: "og:title", content: "Como Funciona — Fatura em Dia" },
      { property: "og:description", content: "Aprenda a organizar suas faturas e dividir compras entre pessoas." },
    ],
  }),
  component: ComoFunciona,
});

type TutorialProps = {
  icon: ReactNode;
  title: string;
  children: ReactNode;
};

function Tutorial({ icon, title, children }: TutorialProps) {
  return (
    <article className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0">
          <h2 className="font-bold">{title}</h2>
          <div className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">{children}</div>
        </div>
      </div>
    </article>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function ComoFunciona() {
  return (
    <>
      <PageHeader
        title="Como Funciona"
        description="Tutoriais rápidos para organizar faturas, direcionar compras e acompanhar os valores de cada pessoa."
        actions={<Button asChild variant="outline"><Link to="/"><LayoutDashboard className="size-4" /> Ir para visão geral</Link></Button>}
      />

      <Panel className="mb-6 overflow-hidden">
        <div className="bg-primary p-6 text-primary-foreground md:p-8">
          <div className="flex max-w-3xl items-start gap-4">
            <BookOpen className="mt-1 size-8 shrink-0" />
            <div>
              <h2 className="text-xl font-bold">O fluxo recomendado</h2>
              <p className="mt-2 text-sm leading-6 opacity-90">Importe a fatura, confira os cartões, direcione cada compra para a pessoa responsável e use os filtros para revisar o que falta. Os totais são recalculados a cada alteração.</p>
            </div>
          </div>
          <ol className="mt-6 grid gap-3 text-sm md:grid-cols-4">
            <Step n={1}>Importe ou confira a fatura</Step>
            <Step n={2}>Confirme cartões e pessoas</Step>
            <Step n={3}>Direcione ou divida compras</Step>
            <Step n={4}>Confira totais e relatórios</Step>
          </ol>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tutorial icon={<FileUp className="size-5" />} title="1. Como importar uma fatura">
          <p>Abra <Link to="/faturas" className="font-semibold text-primary hover:underline">Faturas</Link> e clique em <b>Importar fatura PDF</b>.</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>Selecione o PDF no computador ou celular.</li>
            <li>Confira o cartão, mês, total e lançamentos encontrados.</li>
            <li>Confirme somente depois de revisar os dados.</li>
          </ol>
          <p>O PDF é lido localmente no navegador. PDFs escaneados podem precisar de conferência manual.</p>
        </Tutorial>

        <Tutorial icon={<CreditCard className="size-5" />} title="2. Como cadastrar cartões">
          <p>Em <Link to="/cartoes" className="font-semibold text-primary hover:underline">Cartões</Link>, cadastre o emissor, bandeira, final, fechamento e vencimento.</p>
          <p>O sistema usa apenas os quatro últimos dígitos; nunca informe o número completo ou o código de segurança.</p>
          <p>O cartão final <b>0548</b>, por exemplo, fica associado ao titular cadastrado e pode ser filtrado nas compras.</p>
        </Tutorial>

        <Tutorial icon={<Users className="size-5" />} title="3. Como cadastrar pessoas">
          <p>Em <Link to="/pessoas" className="font-semibold text-primary hover:underline">Pessoas</Link>, cadastre você, sua irmã ou qualquer pessoa que participe das compras.</p>
          <p>Também é possível criar uma pessoa durante o direcionamento: abra o menu de três pontos da compra, escolha <b>Direcionar para pessoa</b> e clique em <b>Criar nova pessoa</b>.</p>
          <p>Depois de salvar, a nova pessoa já fica selecionada para receber aquela compra.</p>
        </Tutorial>

        <Tutorial icon={<Split className="size-5" />} title="4. Como dividir uma compra">
          <p>Na tela <Link to="/compras" className="font-semibold text-primary hover:underline">Compras</Link>, use o menu de três pontos e escolha <b>Dividir compra</b>.</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>O responsável atual é preservado como primeira pessoa.</li>
            <li>Escolha a segunda pessoa ou adicione outra.</li>
            <li>Informe valores em reais ou percentuais.</li>
            <li>Use <b>50% para cada</b> ou <b>Dividir igualmente</b> para agilizar.</li>
          </ol>
          <p>A soma precisa fechar com o valor da compra. Se houver diferença real, registre o motivo como ajuste identificado.</p>
        </Tutorial>

        <Tutorial icon={<Filter className="size-5" />} title="5. Como encontrar o que falta">
          <p>Na tela Compras, combine os filtros de período, pessoa, cartão, final do cartão, status e tipo.</p>
          <p>Escolha <b>Pendentes de direcionamento</b> para ver somente compras que ainda não têm responsável.</p>
          <p>O filtro <b>Final do cartão</b> permite localizar rapidamente compras do 0548, 7432, 4494 ou qualquer outro cartão cadastrado.</p>
        </Tutorial>

        <Tutorial icon={<PieChart className="size-5" />} title="6. Como conferir os totais">
          <p>A tela Compras mostra o total exibido, pendências, compras divididas e o total atribuído a cada pessoa.</p>
          <p>Em <Link to="/pessoas" className="font-semibold text-primary hover:underline">Pessoas</Link>, veja o total atribuído no mês, limite e saldo restante de cada pessoa.</p>
          <p>Use <Link to="/relatorios" className="font-semibold text-primary hover:underline">Relatórios</Link> para consultar, exportar CSV/PDF e revisar históricos.</p>
        </Tutorial>

        <Tutorial icon={<RefreshCw className="size-5" />} title="7. O que acontece na próxima fatura">
          <p>Ao importar uma nova fatura do mesmo cartão, o sistema tenta reconhecer compras repetidas e manter o direcionamento e os dados de parcelamento.</p>
          <p>Parcelamentos encerrados são removidos da previsão quando a última parcela já passou. Compras novas ficam disponíveis para revisão.</p>
          <p>Sempre confira a lista importada antes de considerar o mês fechado.</p>
        </Tutorial>

        <Tutorial icon={<Calculator className="size-5" />} title="8. Como usar a calculadora">
          <p>A <Link to="/calculadora" className="font-semibold text-primary hover:underline">Calculadora</Link> serve para simular uma compra parcelada antes de registrá-la.</p>
          <p>Informe valor, número de parcelas, juros e pessoa. A simulação não altera a fatura nem cria uma compra automaticamente.</p>
        </Tutorial>
      </div>

      <Panel title="PWA, dados e segurança" description="O que funciona hoje e quais cuidados observar" className="mt-6">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-primary" /> Instalar no celular</div>
            <p className="mt-2 text-sm text-muted-foreground">O aplicativo possui manifesto, ícones e service worker. No navegador, use “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center gap-2 font-semibold"><LockKeyhole className="size-4 text-primary" /> Dados locais</div>
            <p className="mt-2 text-sm text-muted-foreground">Enquanto o Supabase não estiver conectado, os dados ficam no localStorage deste navegador e não são compartilhados entre computadores.</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-primary" /> Uso offline</div>
            <p className="mt-2 text-sm text-muted-foreground">O shell público pode ser carregado pelo cache. A sincronização entre dispositivos e o backup remoto ainda dependem da integração com o Supabase.</p>
          </div>
        </div>
      </Panel>

      <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><HelpCircle className="size-4" /> Dica: use o menu lateral para voltar a qualquer área do aplicativo.</p>
    </>
  );
}
