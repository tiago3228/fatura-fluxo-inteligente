<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Decisions d'architecture

- Authentification : e-mail/mot de passe via Cloud Auth, confirmation e-mail désactivée (auto-confirm à l'inscription) ; toutes les routes applicatives sont sous `src/routes/_authenticated/` (portail `ssr: false` → `/auth`), seules `/auth` et `/reset-password` sont publiques. Pourquoi : usage familial privé, entrée immédiate après inscription.
- Données : l'état complet de l'app (FinanceState) est stocké en un document JSONB par compte dans `public.workspace_state` (RLS via `app.is_workspace_member`) ; le store local écrit avec un délai groupé (~600 ms) et lit au login. Pourquoi : les identifiants de l'app sont des chaînes (ex. `c_0548`), la synchronisation documentaire évite un mapping complet vers les tables normalisées du schema.sql.
- Rôles : `public.user_roles` + `public.has_role` (jamais de rôle dans un profil) ; le rôle `master` est attribué automatiquement à l'inscription de tiago3228@yahoo.com.br par le trigger `trg_assign_master_on_signup`. Pourquoi : base saine pour de futures fonctions d'administration.
- tsconfig : `exactOptionalPropertyTypes: false` (le code du projet passe des `undefined` explicites aux props optionnelles) ; `noUncheckedIndexedAccess` et `noPropertyAccessFromIndexSignature` restent actifs et le code les respecte. Pourquoi : garder les garde-fous utiles sans réécrire toute l'interface.
