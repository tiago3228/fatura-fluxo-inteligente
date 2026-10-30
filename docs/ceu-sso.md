# SSO entre Fatura em Dia e CEU Finanças

O fluxo usa o usuário autenticado no Fatura em Dia para solicitar ao projeto Supabase do CEU Finanças um magic link temporário. A senha nunca é enviada entre os aplicativos.

## Variáveis server-side do Fatura em Dia

Configure somente no ambiente do servidor:

- `CEU_SUPABASE_URL`: URL do projeto Supabase usado pelo CEU Finanças (`nqvfuzxbcwpyfieiyjsg`).
- `CEU_SUPABASE_SERVICE_ROLE_KEY`: service role key do projeto do CEU Finanças.

Nunca coloque a service role key em variáveis `VITE_*`, no código do navegador ou no repositório.

## Configuração do Supabase do CEU Finanças

No painel do projeto do CEU, adicione à lista de URLs permitidas para autenticação:

- `https://ceu-financas.lovable.app/auth/sso`
- A URL equivalente de preview/desenvolvimento, quando necessário.

As contas do Tiago e da Atena devem existir no projeto do CEU usando os mesmos e-mails das contas do Fatura em Dia. O `generateLink` é usado somente para usuários autorizados pelo fluxo autenticado; confirme as contas antes de ativar em produção.

## Fluxo

1. O usuário clica em **CEU Finanças** no menu.
2. O Fatura em Dia valida a sessão atual no servidor.
3. O servidor gera um magic link de uso temporário no projeto do CEU.
4. O CEU troca o código por uma sessão local e redireciona para o dashboard.
5. Se o link expirar ou as variáveis não estiverem configuradas, nenhuma senha é exposta e o usuário recebe uma mensagem para tentar novamente.
