# Fatura Flow Studio

vamos criar um Saas de Fatura.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fatura-flow-studio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/91737aca-7a25-437a-a5d6-f3b43558a298).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Estado da persistência

O aplicativo usa autenticação e Supabase. No código atual, as contas autenticadas chamam `join_family_workspace` e compartilham o estado financeiro do workspace familiar; o estado principal é um documento JSONB em `workspace_state`. A configuração real de autenticação, as migrations aplicadas e as políticas do projeto implantado precisam ser verificadas no ambiente antes de presumir que correspondem a este repositório.

O estado local do navegador é uma cópia/cache separado. A sincronização remota e a persistência local devem ser tratadas como requisitos distintos; consulte a implementação atual antes de alterar a preferência “Guardar dados”. A definição de `workspace_state` e da associação familiar está nas migrations versionadas em `drizzle/migrations/`, além do schema base em `supabase/schema.sql`; aplicar somente o schema base não configura necessariamente todo o backend esperado pelo app.

## PWA

O projeto possui `public/manifest.webmanifest`, ícones em `public/icons/`, `public/sw.js` e `public/manus-routes.json`. O service worker usa cache apenas para o shell público da aplicação e não armazena respostas privadas, APIs ou dados financeiros. Operações financeiras ainda exigem confirmação do armazenamento configurado.
