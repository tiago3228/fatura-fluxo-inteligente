# SSO entre Fatura em Dia e CEU Finanças

O fluxo usa o usuário autenticado no Fatura em Dia para solicitar ao endpoint SSO do CEU Finanças um link temporário. A senha e a chave administrativa do Supabase nunca são enviadas entre os aplicativos.

## Configuração server-side do Fatura em Dia

Configure somente no ambiente do servidor:

```env
CEU_SSO_SHARED_SECRET=mesmo-segredo-configurado-no-ceu
```

O valor deve ser exatamente o mesmo segredo compartilhado salvo de forma privada no CEU Finanças. Nunca use `VITE_*`, nunca coloque o valor no navegador e nunca o commite no repositório.

## Endpoint usado

```text
POST https://ceu-financas.lovable.app/api/public/sso/link
```

A requisição envia:

- `Content-Type: application/json`;
- `X-CEU-Timestamp`: Unix time em segundos;
- `X-CEU-Nonce`: valor único por requisição;
- `X-CEU-Signature`: HMAC-SHA256 em hexadecimal de `timestamp.nonce.corpoBruto`;
- corpo JSON com o e-mail autenticado.

O endpoint aceita somente requisições recentes, rejeita nonce reutilizado e confirma se a conta existe no CEU. O Fatura em Dia valida que a URL retornada pertence ao domínio oficial do CEU antes de abri-la.

## Configuração do Supabase do CEU Finanças

A URL de callback já é coberta pela regra publicada do CEU:

```text
https://ceu-financas.lovable.app/**
```

As contas do Tiago e da Atena devem existir no CEU usando os mesmos e-mails das contas do Fatura em Dia.

## Fluxo

1. O usuário clica em **CEU Finanças** no menu.
2. O Fatura em Dia valida a sessão atual no servidor.
3. O servidor assina a requisição com timestamp, nonce e segredo HMAC.
4. O CEU valida a assinatura e devolve um link temporário de uso único.
5. O link abre o callback `/auth/sso` e conclui a sessão local.
6. O CEU redireciona o usuário para o Dashboard.
