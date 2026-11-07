# Plano de ação — Migração do Supabase para o Appwrite (DividePass)

> Status: plano pronto para execução. Nenhuma mudança foi aplicada em produção.
> Data: 03/11/2026.

---

## 0. A regra de ouro (e o critério de sucesso)

**O usuário da v1 nunca percebe a migração.** Nenhum acesso perdido, nenhuma tela
quebrada, nenhuma queda de pagamento.

Consequência prática: a v1 (Supabase) **continua funcionando exatamente como está**
durante toda a migração. Toda mudança de risco acontece na v2, isolada.

Critério de sucesso do projeto: **trocar o banco por trás do `/` sem trocar o
código das telas**. Isso é possível porque o app inteiro fala com o banco por
**um único arquivo** (`src/lib/supabase.js`), importado por **85 arquivos**.

---

## 1. Onde estamos hoje (medido, não estimado)

| Item | Quantidade | Onde |
|---|---|---|
| Tabelas no schema `public` | **54** | `database/*.sql` (165 arquivos) |
| Policies de RLS | **351** | `database/*.sql` |
| Tabelas com RLS ligado | **90** (o grep pega o mesmo arquivo 2x) | `database/*.sql` |
| Triggers | **89** | `database/*.sql` |
| Funções/triggers Postgres (RPCs + triggers) | **48** | `database/*.sql` |
| Edge Functions (Deno) | **52** | `supabase/functions/` |
| Arquivos do front acoplados ao `supabase-js` | **85** | `src/**` |
| Buckets de Storage | `avatars`, `group-covers`, `support-images` | `src/**` |
| Cron | `pg_cron` → `pg_net` → Edge Function | `supabase/config.toml` |
| Realtime | chat do grupo + painel de notificações do admin | `src/components/GroupChat.jsx`, `src/pages/admin/AdminNotifications.jsx` |

**O que o app usa do Supabase:** Auth (login/senha/reset), Postgres (dados +
RLS + 48 funções), Storage (imagens), Realtime (2 telas), Edge Functions (52) e
pg_cron. Ou seja: **o Supabase inteiro**, e não só o banco.

**Motivo da migração:** Supabase free tier com custo de egress e de logs subindo.
A VPS já é sua, e o Appwrite **já roda nela** (instância `servidor-appwrite-…`
em `DotMidias/deploy/docker-compose.yml`).

---

## 2. Você já fez isso uma vez — e o resultado está no seu disco

O **ByeFIT** concluiu exatamente esta migração: 177 tabelas, 288 RPCs, 178
tabelas no Appwrite, 33 usuários, sem Supabase e sem Postgres
(`ByeFIT/docs/09-appwrite.md`).

A DividePass é **1/3 do tamanho** do ByeFIT (54 tabelas e 48 funções contra 177
e 288). E a toolchain existe, está testada e é reusável:

| Script do ByeFIT | O que faz | Reusar na DividePass |
|---|---|---|
| `appwrite-transpile-schema.mjs` | Postgres → schema do TablesDB (tipos, `jsonb`→`text`, `text[]`) | sim, gera as 54 tabelas |
| `appwrite-gen-rls.mjs` | Policies do Postgres → `appwrite-rls.json` (traduz `auth.uid()`, `EXISTS`, `role`) | sim, gera as 351 policies |
| `appwrite-gen-schema-map.mjs` | mapa de colunas json/array e FKs | sim |
| `appwrite-gen-rpc-args.mjs` | argumentos nomeados ↔ posicionais | sim |
| `appwrite-classify-rpcs.mjs` | classifica as 48 funções por módulo | sim |
| `appwrite-migrate-data.mjs` | migra linhas preservando `$id` = uuid | sim |
| `appwrite-migrate-storage.mjs` / `-files.mjs` | migra buckets e arquivos | sim (prioridade: custo) |
| `appwrite-migrate-auth.mjs` | migra usuários + hashes de senha | sim, com adaptação |
| `appwrite-parity.mjs` | **harness de paridade**: compara a resposta do Postgres com a do Appwrite | sim — é o judge |
| `appwrite-apply-schema.mjs` / `-sync-schema.mjs` | aplica/ sincroniza o schema no Appwrite | sim |
| `appwrite-deploy-function.mjs` | deploya a Function Deno | sim |
| `qa-appwrite.mjs` | QA (inclusive vazamento da API key) | sim |

Artefatos de runtime a portar (Deno, dentro da Function):

- `appwrite/functions/byefit-rpc/src/lib/db.ts` — acesso às rows (list/fetch/count/
  insert/update/upsert/delete + `aggregate`, `groupBy`, `joinByFk` + filtros
  `eq/neq/gt/inArr/or/and/…`). **O TablesDB 2.5 não tem agregação nem JOIN** —
  tudo é calculado em JS.
- `lib/schema.ts` (json↔text), `lib/args.ts`, `lib/output.ts` (`sanearSaida`),
  `lib/errors.ts` (`PGRST116`, `23505`, `23503`, `42501`), `lib/auth.ts`.

E no servidor (a "porta"):

- `ByeFIT/api/appwrite.js` — **porta única** com as ações `db | rpc | auth |
  auth-legacy | storage` (+ `palm-webhook` no caso do ByeFIT).
- `api/_shared/appwrite-policy.js` — emulação do RLS no servidor (as 351
  policies avaliadas por request).
- `api/_shared/appwrite-auth.js` — login/cadastro/me/logout/senha/recuperação.
- `src/lib/appwrite-adapter.js` (703 linhas) — **o substituto do `supabase-js`
  no navegador**: implementa `from()`, `rpc()`, `auth`, `storage`, `functions` com
  a mesma superfície, para que as telas não mudem.

---

## 3. Arquitetura alvo

```
                      dividepass.com            (mesmo domínio, duas rotas)
                      ┌───────────┬────────────┐
                      │    /      │   /v2/     │
                      │  v1 (hoje)│  v2 (nova) │
                      └─────┬─────┴─────┬─────┘
                            │           │
                  VITE_DATA_BACKEND=supabase  |  =appwrite
                            │           │
                   Supabase (MASTER)   │     Appwrite (TablesDB + Auth + Storage)
                            │           │           ▲
                            │           │           │
                            └─── réplica (outbox) ──┘  (Fase 5)
                                        │
                          Appwrite Function `dividepass-rpc` (Deno)
                          + workers de pagamento na VPS
```

Três decisões de arquitetura que valem a pena explicitar:

**3.1 — Um único `supabase.js` com seletor de backend.**
O ByeFIT já faz isso (`VITE_DATA_BACKEND=supabase|appwrite`). A v1 e a v2 são
**o mesmo build**, com flag diferente. Isso significa: nenhuma tela precisa ser
escrita duas vezes, e o corte final é uma troca de flag.

**3.2 — O browser não fala direto com o TablesDB.**
As tabelas ficam sem permissão de leitura para o cliente (o RLS do Postgres
protegia as linhas, e o Appwrite 2.5 não tem RLS por linha). Então tudo passa
por `POST /api/appwrite?acao=db|rpc|auth|storage` no servidor, que aplica a
emulação de RLS. **A API key do Appwrite nunca entra no bundle** — é o mesmo
princípio da `anon key` do Supabase, e é o que o `qa-appwrite.mjs` verifica.

**3.3 — Master único + réplica (não dois masters).**
Enquanto a v2 existir, **o Supabase é a única fonte de verdade**. O Appwrite
recebe cópia. Detalhe em 5.2.

---

## 4. Fases

### Fase 0 — Terreno e decisões (1–2 dias)
- [ ] Dumps de segurança: `pg_dump` completo do Postgres + dump de `auth.users`
      + dump dos buckets. Guardar fora do repo.
- [ ] Snapshot do schema real (o grep em `database/*.sql` pode estar
      defasado): `information_schema.columns`, `pg_policies`, `pg_proc`.
- [ ] Contagem de linhas por tabela e **volume de dados** (define o tempo do
      backfill). Script: `scripts/probe-schema.mjs` (já existe) estendido.
- [ ] **Descobrir de onde vem o egress.** Medir por origem (Storage / Realtime /
      REST / Edge Functions) antes de migrar — pode revelar que 70% do custo é
      imagem servida pelo Supabase.
- [ ] Criar o projeto **`dividepass`** no Appwrite (isolado de `byefit` e
      `dotmidias-live`).
- [ ] Domínio + TLS para o Appwrite (`appwrite.dividepass.com`). Hoje a
      instância responde em `sslip.io` — o browser exige HTTPS.
- [ ] **Teste decisivo de senha** (ver 6.1): `POST /v1/users/bcrypt` existe na
      sua versão? Se sim, import direto. Se não, shim `legacy_password_hashes`.
- [ ] Decidir onde roda a porta `api/appwrite.js` (ver 8).

### Fase 1 — Schema, RLS e dados no Appwrite (3–4 dias)
- [ ] `appwrite-transpile-schema.mjs` (adaptado) → 54 tabelas; `apply` e
      `sync-schema`.
- [ ] `appwrite-gen-rls.mjs` → `appwrite-rls.json` com as 351 policies
      traduzidas. **Auditoria manual das policies**: a tradução é automática,
      mas regra desconhecida tem que **falhar fechada** (como no ByeFIT).
- [ ] `appwrite-migrate-data.mjs` → carga inicial, `$id` = uuid do Postgres
      (as FKs continuam válidas sem tabela de tradução).
- [ ] `appwrite-migrate-storage.mjs` → buckets e arquivos. **Fazer primeiro
      aqui**: é o item que mais alivia o egress e o mais fácil de reverter.
- [ ] Harness de paridade verde em uma tabela de referência.

### Fase 2 — Auth sem perder acesso (3–4 dias) ⚠️ item crítico
- [ ] `appwrite-migrate-auth.mjs` (adaptado): `$id` = uuid, email, telefone,
      nome, status de confirmação.
- [ ] Senha: import direto (`/users/bcrypt`) **ou** shim `legacy_password_hashes`
      + `?acao=auth-legacy` (código pronto no ByeFIT).
- [ ] Truque da senha curta: o app aceita **6 caracteres**, o Appwrite exige
      **8**. O ByeFIT resolve com `senha#sha256(senha)[0..10]` e o login tenta
      a senha como digitada e depois a transformada. **Precisa vir junto.**
- [ ] `api/_shared/appwrite-auth.js` portado: login, cadastro, me, logout,
      troca de senha, recuperação.
- [ ] Teste de paridade de login: **as mesmas credenciais que funcionam hoje na
      v1 têm que funcionar na v2.** Sem reset de senha para o usuário.

### Fase 3 — As 48 funções (5–7 dias)
- [ ] `appwrite-classify-rpcs.mjs` → agrupar por módulo (grupos, assinaturas,
      pagamentos, admin, onboarding).
- [ ] Portar cada handler para `appwrite/functions/dividepass-rpc/src/handlers/`,
      preservando **o nome exato da função** (é o que o app chama em
      `supabase.rpc('nome')`) e o **formato de saída** (jsonb→objeto,
      TABLE→array, void→null/'').
- [ ] `auth.uid()` → `caller.userId`; `IF auth.uid() IS NULL THEN RETURN` →
      devolve vazio.
- [ ] **Os 89 triggers do Postgres não têm trigger no Appwrite.** Cada trigger
      precisa virar: (a) evento do Appwrite (`users.*.create`), (b) hook dentro
      do handler da RPC correspondente, ou (c) worker. Os mais críticos:
      `handle_new_user`, `trg_credit_wallet_on_payment`, `auto_assign_credential`.
- [ ] pg_cron → **schedule** da Function (Appwrite 2.x tem cron nativo, de 1 em
      1 minuto).

### Fase 4 — As 52 edge functions (8–12 dias) ⚠️ o item mais pesado
- [ ] Classificar: webhooks de pagamento (IoPay, MercadoPago, Stripe, Pagar.me,
      Woovi, Asaas), e-mails, crons, utilitários.
- [ ] **Os webhooks de pagamento não podem mudar de URL sem aviso.** O provedor
      aponta para `*.supabase.co/functions/v1/<fn>`. Trocar isso no corte é o
      passo mais arriscado do projeto: um webhook perdido = uma assinatura
      perdida. Estratégia: rodar o worker novo na **mesma rota** (proxy do
      domínio) e só trocar a URL no painel do gateway, gateway por gateway,
      validando assinatura em cada troca.
- [ ] Portar para Appwrite Functions (Deno) ou para workers na VPS, conforme a
      dependência (SDK de gateway, bibliotecas de e-mail).
- [ ] E-mail: manter o provedor atual (Brevo/Resend) — não é o problema.

### Fase 5 — v2 em paralelo + réplica (3–5 dias)
- [ ] `src/lib/supabase.js` → seletor `VITE_DATA_BACKEND` (padrão do ByeFIT).
- [ ] `src/lib/appwrite-adapter.js` portado (703 linhas → adapte os nomes das
      tabelas e as assinaturas das 48 RPCs).
- [ ] Publicar `dividepass.com/v2` (mesma SPA, flag diferente).
- [ ] Réplica contínua Supabase → Appwrite (ver 5.2).
- [ ] **Cadastro espelhado** (o que você propôs): o cadastro da v1 grava nos
      dois. Como é um usuário por vez, é barato e é a garantia de que quem nasce
      na v1 entra na v2.
- [ ] **Reset e troca de senha** também precisam ser espelhados (ver 5.3).

### Fase 6 — Corte (1–2 dias)
- [ ] Congelar escrita (15–30 min): a landing e o app continuam no ar em
      somente-leitura; o appwrite **não** precisa cair.
- [ ] Aplicar o delta final da réplica e validar contagem por tabela.
- [ ] Trocar as URLs de webhook, gateway por gateway.
- [ ] Apontar `/` para a v2 (a flag `VITE_DATA_BACKEND` vira `appwrite`).
- [ ] Manter o Supabase como rollback por 30 dias — **mas** reduzir o custo
      já na Fase 1 (Storage fora + functions fora) para o Supabase não voltar a
      custar dinheiro parado.
- [ ] Rodar `qa-appwrite.mjs` + harness de paridade + os testes de pagamento
      (`scripts/qa-fluxo-pagamento.mjs` já existe).

---

## 5. A sua ideia da v2 paralela — o que muda nela

Você propôs: v2 em `/v2`, v1 rodando, e **quando alguém se cadastra na v1,
cadastrar também no novo banco**. A ideia está certa no espírito. Vamos
precisar em três pontos para ela não virar uma bomba-relógio.

### 5.1 — Isso já é o que a toolchain do ByeFIT faz
`VITE_DATA_BACKEND=supabase|appwrite` + `/v2` na mesma SPA. O corte final é
trocar a flag, não reescrever o site. Você não precisa inventar a v2: ela já
existe como padrão.

### 5.2 — "Escrever nos dois" com dois mestres diverge. Escreva de um lado só.
Se o Supabase e o Appwrite forem ambos mestres, o sistema tem dois estados
possíveis para cada linha, e o Appwrite não tem transação nem trigger de
reconciliação. Os 89 triggers do Postgres complicam: um pagamento dispara
`trg_credit_wallet_on_payment` e grava em 3 tabelas; se metade disso espelhar e
a outra metade não, a carteira diverge do pagamento.

**Regra:** durante a v2, o **Supabase é o único mestre**. O Appwrite recebe
**réplica** (ver 5.4). Assim:
- se o Appwrite cair, **nada acontece na produção** (a v1 nem sabe que ele
  existe);
- a v2 sempre lê dados recentes;
- no corte, aplica-se o delta final e a v2 assume a mestria.

### 5.3 — Cadastro é fácil. Senha não é.
- **Cadastro novo**: espelhar para o Appwrite é uma escrita só — e precisa
  respeitar a senha de 6 caracteres (ver Fase 2).
- **Troca de senha na v1**: o hash novo precisa ir para o Appwrite, senão a
  pessoa troca a senha na v1 e não consegue entrar na v2. Solução: gatilho em
  `auth.users` (update de `encrypted_password`) → réplica para o Appwrite.
- **Reset de senha**: o token é emitido pelo Supabase; na v2, o fluxo tem que
  ser o do Appwrite. Fazer a ponte (ou aceitar que a v2 só aceite login por
  senha durante a janela).

### 5.4 — Como fazer a réplica sem reescrever o app
Três opções, em ordem de custo/benefício:

| Opção | Como | Custo | Risco |
|---|---|---|---|
| **A — delta por job** (recomendado para começar) | Job a cada 5 min lê as tabelas alteradas desde o último cursor e replica | baixo | atraso de minutos na v2 — irrelevante para teste |
| **B — outbox no Postgres** | Trigger por tabela grava变更 numa fila; a fila é consumida por um worker | médio | o mais fiel; mais plumbing |
| **C — CDC nativo (logical replication)** | Postgres → consumer → Appwrite | alto | melhor latência; mais setup |

Comece na **A**. A B só quando o lag atrapalhar o teste de uma tela.

---

## 6. Riscos e armadilhas (o que já doi em outros projetos)

| # | Risco | Como tratar |
|---|---|---|
| 6.1 | **Senha bcrypt importável?** O Appwrite 2.5 **não** aceita hash bcrypt (foi por isso que o ByeFIT criou `legacy_password_hashes` + shim). A doc atual (2.6.x) **tem** `POST /v1/users/bcrypt`, com rehash para Argon2 no primeiro login. | **Testar na sua instância na Fase 0.** Se tiver: import direto (muito mais simples). Se não: reusar o shim do ByeFIT, que já tem teste (`scripts/_test-auth-legacy.mjs`, 10/10). |
| 6.2 | Senha < 8 caracteres (app aceita 6, Appwrite exige 8) | Truque `senha#sha256[0..10]` do ByeFIT |
| 6.3 | **Login no browser não funciona** (medido no ByeFIT: sem a API key, `POST /account/sessions/email` devolve `secret` vazio) | Login/cadastro **vão para o servidor** (`?acao=auth`). O browser nunca vê a API key. |
| 6.4 | TablesDB 2.5 **sem agregação e sem JOIN** (`Invalid query method: count/sum/groupBy/leftJoin`) | Calcular em JS (`aggregate`, `groupBy`, `joinByFk` do runtime). Telas de admin com volume grande podem ficar lentas — medir. |
| 6.5 | `jsonb` não existe → `text` com JSON serializado; `text[]` → text | Conversão automática no runtime (`lib/schema.ts`) |
| 6.6 | RLS não existe no Appwrite → emulação no servidor | 351 policies traduzidas + auditoria. **Regra desconhecida falha fechada.** |
| 6.7 | **Realtime**: o Appwrite não tem `postgres_changes` | Reescrever o `GroupChat.jsx` (subscribe em row/coluna) e o `AdminNotifications.jsx` sobre o Realtime do Appwrite. |
| 6.8 | Route de senha é **PATCH** (`PUT` devolve 404) | Usar PATCH |
| 6.9 | `GET /users` pagina em 25; `limit`/`offset` soltos são ignorados | Usar `queries[]` |
| 6.10 | Filtro por `attribute:'id'` → "Attribute not found" | Usar `'$id'` (só 3 tabelas têm coluna `id` física) |
| 6.11 | Execução de Function em `processing` → corpo vazio (cold start) | Aguardar `GET /executions/{id}` (o `appwrite-session.js` do ByeFIT já faz isso) |
| 6.12 | Header `x-appwrite-*` no spec da Function → 400 "Keys can't start with x-appwrite" | Usar o header interno do projeto (`x-byefit-*` → `x-dividepass-*`) |
| 6.13 | **Endpoint precisa terminar em `/v1`**; header é `X-Appwrite-Project` | Configurar com cuidado no `.env` |
| 6.14 | API key com prefixo `VITE_` entra no bundle | `APPWRITE_API_KEY` só no servidor; `qa-appwrite.mjs` varre `src/` e `dist/` |
| 6.15 | Webhook de pagamento com URL errada = assinatura perdida | Trocar gateway por gateway, validando assinatura (Fase 4) |
| 6.16 | Limite da Vercel: **12 Serverless Functions** no plano Hobby | A porta `api/appwrite.js` é **uma** function só; mas 52 edge functions do Supabase viram Functions do Appwrite ou workers na VPS — **não** Serverless Functions na Vercel |
| 6.17 | Sessão do Appwrite é token opaco em `session.secret`; `Authorization: Bearer` não vale | `X-Appwrite-Session` |
| 6.18 | `deno check` é o gate de sintaxe das Functions (não `node --check`) | Já existe `scripts/deno-check-funcoes.mjs` no projeto |

---

## 7. Esforço estimado

| Fase | Peso |
|---|---|
| 0 — Terreno e decisões | 1–2 dias |
| 1 — Schema, RLS, dados, storage | 3–4 dias |
| 2 — Auth sem perder acesso | 3–4 dias |
| 3 — 48 funções | 5–7 dias |
| 4 — 52 edge functions | 8–12 dias |
| 5 — v2 paralela + réplica | 3–5 dias |
| 6 — Corte | 1–2 dias |
| **Total** | **~25–35 dias de trabalho focado** |

Maior risco de cronograma: **Fase 4** (as 52 edge functions, em especial os 6
gateways de pagamento). Se o tempo apertar, dá para adiar a Fase 4: a v2 pode
rodar com os webhooks ainda no Supabase, desde que a **v1 continue como mestre**
— que é exatamente a regra de 5.2.

---

## 8. Decisões que preciso de você

1. **Onde roda a porta `api/appwrite.js`?** (recomendo a **VPS/Dokploy**, não a
   Vercel: o plano Hobby limita a 12 functions e o objetivo é cortar custo)
2. **Appwrite:** criar um projeto novo `dividepass` na instância que já existe
   na VPS, ou uma instância dedicada?
3. **Domínio do Appwrite:** pode ser `appwrite.dividepass.com` com TLS
   (certbot no Dokploy)? Hoje está em `sslip.io`.
4. **URL do webhook:** cada gateway (IoPay, MercadoPago, Stripe, Pagar.me, Woovi,
   Asaas) aceita trocar a URL de callback sem preclude a produção?

## 9. Cortar o custo do Supabase antes da migração (independente das fases)

Duas ações que derrubarão a conta **sem** risco para a v1:

1. **Mover os buckets de Storage para a VPS.** Imagem é o principal gerador de
   egress. É a parte mais fácil de migrar e a mais reversível (copia e troca o
   base URL).
2. **Mover as edge functions para a VPS.** Corta o custo de execução e de log
   das Functions.

E uma medição que vale antes de qualquer coisa: **abrir o uso do projeto no
   painel do Supabase e ver o egress por origem.** Se 70% é Storage, a Fase 1
   já resolve o problema e o resto da migração vira decisão de arquitetura, não
   de urgência.

---

## 10. Próximo passo imediato

Fase 0, em ordem:

1. `pg_dump` completo + dump de `auth.users` + inventário de buckets → arquivo
   de backup fora do repo.
2. Inventário real do schema (colunas, policies, triggers) e contagem de linhas
   por tabela.
3. Medição de egress por origem no painel do Supabase.
4. Teste do `POST /v1/users/bcrypt` na sua instância (decide 6.1).
5. Criar o projeto `dividepass` no Appwrite.

Com isso em mãos, a Fase 1 fica com escopo fechado e começa.
