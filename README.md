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

O aplicativo usa o Lovable Cloud (banco de dados + contas). O acesso exige login com e-mail e senha: cada conta tem o próprio workspace e os dados (faturas, cartões, pessoas, lançamentos, parcelamentos e preferências) ficam salvos na nuvem, sincronizados entre dispositivos. Uma cópia local no navegador serve de cache offline; desligar « Guardar dados » em Configurações desativa o cache. O schema inicial validado está em `supabase/schema.sql` (aplicado ao banco) e o estado do aplicativo é salvo por workspace em `workspace_state`.

## PWA

O projeto possui `public/manifest.webmanifest`, ícones em `public/icons/`, `public/sw.js` e `public/manus-routes.json`. O service worker usa cache apenas para o shell público da aplicação e não armazena respostas privadas, APIs ou dados financeiros. Operações financeiras ainda exigem confirmação do armazenamento configurado.
