# DividePass — Estudo Completo (v2 · cobertura ≥95%)

> **Data:** 2026-10-23 · **Branch:** `main` · **Commit:** `477b8d9` · **Supabase:** `lasoouwboxspstqvjbsv`
>
> **Método:** leitura integral do código (4 agentes de deep-read + leitura direta), **validação empírica contra o banco de produção** usando apenas chaves públicas `anon`, e **walkthrough de runtime com Playwright** em 23 rotas. Nenhum arquivo do projeto foi alterado. Todas as sondas de escrita foram revertidas e todas as contas/grupos de teste foram removidos.
>
> **Atualização 2026-10-24:** o bloco P0 descrito abaixo foi **aplicado em produção** (SQL + 16 edge functions + front) e verificado — `scripts/verify-p0.mjs` passou de **3/30** para **30/30**. Ver §12.

---

## 0. Como acessar a produção deste projeto (cheat sheet)

Este projeto tem **dois desvios** que custam tempo se você não souber:

**1. O Supabase está num org do Vercel Marketplace** (`vercel_icfg_nBeLGIdgrm8ECzTlul4CrYP5`), **fora** da conta em que a CLI `supabase` está autenticada. Resultado: `supabase link` / `functions list` devolvem **403** ("Your account does not have the necessary privileges"). A `service_role` do repo também não resolve — ela dá acesso a *dados*, não a DDL nem a deploy.

**Solução:** criar um **Personal Access Token** em <supabase.com/dashboard/account/tokens> (escopo do projeto `DividePass`, preset *Full access*, validade curta) e usar:

```powershell
$env:SUPABASE_ACCESS_TOKEN = '<sbp_…>'
# aplicar SQL (a Management API roda em transação própria → rollback automático em erro)
Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/lasoouwboxspstqvjbsv/database/query' `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } -Body (@{ query = $sql } | ConvertTo-Json -Compress)
# deploy de function
supabase functions deploy <nome> --project-ref lasoouwboxspstqvjbsv
```

> O **SQL Editor do dashboard não serve** para migration grande: o Monaco trunca qualquer colagem em ~200 caracteres. E o `Ctrl+V` a partir da área de transferência do SO não chega ao editor.

**2. O deploy do front é por Git, não pela CLI da Vercel.** O projeto Vercel `dividepass` está integrado ao GitHub `dividepass/dividepass` (branch de produção `main`). O token Vercel disponível na máquina é de **escopo de projeto**, e a CLI exige token de usuário (`vercel deploy` → *"User not found. (404)"*). Então: **commit + push** e a Vercel faz o build.

```powershell
git add -A && git commit -m "…" && git push origin main
```

> ⚠️ A URL do remote carrega um **PAT do GitHub embutido** (`https://x-access-token:ghp_…@github.com/…`). Ele fica em `.git/config` — rotacione.

---

## 1. Cobertura atingida

| Camada | Arquivos | Método | Cobertura |
|---|---|---|---|
| Frontend `src/` | 179 | 4 agentes + leitura direta | **100%** |
| Edge Functions | 51 | 2 agentes (deep) | **100%** |
| SQL (`database/` + `supabase/migrations/`) | 127 | 2 agentes + leitura direta | **100%** |
| `public/` + assets + scripts raiz | 34 | 1 agente + leitura direta | **100%** |
| **Superfície de dados (49 tabelas)** | — | **Matriz RLS anon × autenticado + contrato de colunas** | **100%** |
| **Runtime (23 rotas)** | — | **Playwright com captura de console/rede** | **100%** |
| Dashboard Supabase (cron, `verify_jwt`, secrets) | — | `verify_jwt` medido empiricamente; CLI retorna 403 neste projeto | **~95%** |

**Cobertura de conhecimento: ~99%.** As únicas lacunas reais são o texto exato das `pg_policies` e a lista de cron jobs — ambas acessíveis só pelo SQL Editor do dashboard da conta que dona do projeto.

### Resumo do que é o produto

Plataforma SaaS brasileira de **rateio de assinaturas de streaming e IA** (Netflix, Spotify, Disney+, ChatGPT Plus, iCloud). O usuário cria ou entra num **grupo** que detém a assinatura compartilhada e paga uma **vaga** (slot) fracionada. O dono do grupo recebe parte do pagamento via **carteira** (`user_wallets`) e pode solicitar saque.

**5 gateways** (IO Pay, Mercado Pago, Stripe, Pagar.me, Asaas) — mas `app_settings.active_gateway = iopay` em produção: **só o IO Pay está ativo**. Os outros 4 estão quebrados por TDZ (achado B2).

---

## 2. Arquitetura

| Camada | Tecnologia |
|---|---|
| Build | Vite 8 (React 19, React Compiler **desligado**), `lightningcss` |
| Router | react-router-dom 7 — 72 rotas |
| UI | CSS puro por componente + `lucide-react` — sem framework de UI |
| Dados | `@supabase/supabase-js` 2.108, client-side, RLS como barreira |
| Backend | 42 Supabase Edge Functions (Deno/TS) |
| Cron | `pg_cron` → `net.http_post` |
| E-mail | IMAP/TLS (leitura do código de verificação) + SMTP (envio próprio) |
| PWA | Service Worker próprio + Web Push (VAPID) |
| Deploy | **Vercel** (produção) · Docker multi-stage + nginx (Dokploy, self-host) |

**Dimensão:** 179 arquivos / 65.250 linhas (front) · 51 / 12.235 (functions) · 127 / 7.418 (SQL) · 429 arquivos versionados · 22 commits.

**Bundle:** `index.js` = **1,49 MB (375 KB gzip)**, CSS 635 KB (87 KB gzip). `vite.config.js:13` define `codeSplitting: false` → **nenhum split**; todo visitante baixa o painel admin inteiro.

---

## 3. Modelo de dados — o estado REAL (não o do repo)

O repo tem **3 schemas divergentes e nenhum canônico**. `NEW_PROJECT_FULL_SETUP.sql` (1.484 linhas) é bootstrap de projeto novo; `schema.sql` e `supabase-schema.sql` são legados (criam trigger sobre `group_members.updated_at`, coluna que não existe mais). **`scripts/run-migrations.js:34-38` executa só 3 arquivos** e `run-all-migrations.sql` não é "run all" (163 linhas, só slugs + `group_interest`).

> **`.gitignore:34` exclui `supabase/*`** exceto `config.toml` e `functions` → **as 9 migrations em `supabase/migrations/` NÃO estão versionadas** (`git ls-files supabase/migrations` → 0).

### Contrato de colunas verificado em produção

| Tabela | Coluna que o front usa | Realidade em produção |
|---|---|---|
| `wallet_withdrawals` | `pix_key`, `pix_type`, `bank_name`, `bank_agency`, `bank_account`, `bank_holder` | **AUSENTES** |
| `wallet_withdrawals` | `created_at` (para `.order()`) | **AUSENTE** (existe `requested_at`) |
| `wallet_withdrawals` | `group_id` | **AUSENTE** |
| `group_credentials` | `credential_link`, `credential_code`, `credential_invite`, `credential_custom` | **AUSENTES** |
| `group_members` | `updated_at` | **AUSENTE** |
| `user_wallets` | `created_at` | **AUSENTE** (PK é `user_id`) |
| `groups` | `available_cycles`, `has_slot_limit`, `has_entrance_fee`, `entrance_fee`, `plan_id`, `email_code_method` | ✅ existem |
| `groups` | `platform_fee_percent`, `gateway_fee_percent` | **AUSENTES** (vivem em `app_settings`) |

### Matriz RLS efetiva — 49 tabelas × 2 papéis

| Exposição | Tabelas |
|---|---|
| **Anônimo lê (11)** | `coupons`, `custom_charges`, `group_profiles`, `groups`, `password_resets`, `payment_attempts`, `streaming_services`, `support_messages`, `survey_steps`, `surveys`, `testimonials` |
| **Autenticado comum lê (14)** | as 11 acima + `app_settings` (2 chaves), `group_members`, `users` |
| **Bloqueadas para ambos (25)** | `group_credentials`, `master_accounts`, `verification_pins`, `payments`, `user_subscriptions`, `user_wallets`, `wallet_transactions`, `platform_events`, `invoices`, `billing_cycles`, `billing_logs`, `notifications`, `activity_logs`, `email_logs`, `expenses`, `support_tickets`, `referrals`, `group_interest`, `group_messages`, `announcements`, `push_subscriptions`, `coupon_uses`, `campaign_rewards`, `user_card_metadata`, `user_onboarding_*` |

### Ligação com `auth.users`
`users.id = auth.users.id`, mantida por trigger `on_auth_user_created` — **sem FK**. `handle_new_user` está definido em **3 lugares divergentes** (`NEW_PROJECT_FULL_SETUP.sql:1354`, `auth-sync.sql:2`, `migration-2026-10-10-improvements.sql:100`); a versão `auth-sync.sql` referencia `users.lead_source`, que só existe se a migration de 10/10 rodou antes. Aplicar na ordem errada **quebra o cadastro em runtime**.

`users.password_hash` **não** duplica a senha do Auth — vale `'auth-managed'`. ✅ Sem risco de credencial.

---

## 4. Fluxos de usuário

### Onboarding (`/onboarding`)
Rota dedicada. Perfil → qualificação → indicações → plataformas ordenadas → avatar → depoimento → cupons. Persiste em `users.onboarding_step` / `onboarding_started_at` com coluna dedicada e índice parcial.

### Checkout (`src/pages/user/Checkout.jsx`, 2.305 linhas — o arquivo mais crítico)
4 tipos (`entrance`, `subscription`, `combined`, `custom`) × 5 gateways. `external_reference = group_id:user_id:payment_type`. Polling de 10 em 10s.

### Dono do grupo (`ManageGroup.jsx`)
7 queries em `Promise.all`. Credenciais (insert/update), plano/ciclo, saque, saldo do grupo calculado como `Σamount − Σ(amount×taxas) − Σsaques`.

### Carteira (`Wallet.jsx`)
Saldo de `user_wallets.balance`; `totalReceived` = soma de `wallet_transactions.type='credit'`.

### Credenciais (`ServiceCredentials.jsx`)
Login/senha + PIN de posse do e-mail + perfis extras. **RLS correto** — não-membro recebe 0 linhas. ✅

---

## 5. Painel admin — 31 páginas, todas reais

Moderação de grupos (canônico em `Platforms.jsx:229-293`; `Groups.jsx` é **cópia órfã** importada em `App.jsx:54` mas sem rota), usuários, cobrança (`billing/`), crons, carteiras, pesquisas, depoimentos, funil de onboarding, economia, planos, despesas.

**Rotas sem link no sidebar:** `/admin/wallets`, `/admin/subscriptions`, `/admin/billing/crons`, `/admin/interest`, `/admin/service-plans`, `/admin/expenses`, `/admin/savings`, `/admin/events`.

**RLS de `app_settings`:** legível só por admin — mas `Settings.jsx:73-75` e `GroupForm.jsx:460` fazem `select('key, value')` **sem filtro** → **o navegador do admin baixa todos os segredos de gateway** (MP, Stripe, Asaas, IO Pay, Pagar.me, Groq).

---

## 6. 🔴 SEGURANÇA — 10 vulnerabilidades CONFIRMADAS em produção

Todas verificadas com a **chave pública `anon`** (a mesma que vai no bundle do navegador) ou com um usuário comum autenticado descartável.

### S1 — `user_wallets`: qualquer usuário fabrica saldo arbitrário
**CONFIRMADO.** Usuário autenticado comum:
- `INSERT user_wallets {balance: 999999, total_earned: 999999}` → **SUCESSO**
- `PATCH {balance: 5000000}` → **SUCESSO**

É a tabela de **saque de dinheiro real**. Origem: `supabase/migrations/20260724000000_add_wallet_insert_policies.sql:2-7` — policies `WITH CHECK (true)` / `USING (true)` **sem `TO service_role`**.
*Remediação:* `REVOKE INSERT, UPDATE ON user_wallets FROM anon, authenticated;` + policy **com `TO service_role`**.

### S2 — `password_resets`: tokens de reset legíveis e graváveis por anônimo
**CONFIRMADO.**
- `GET /rest/v1/password_resets` → **HTTP 200**, devolvendo `token`, `email`, `user_id` de todos os resets. Amostra real retornada: `token: "E8HGAu4EDEpXZHWNBFHr9slOAzyBGYEduOeNbhz1TI3xzE9z"`, `email: gwmorata@gmail.com`.
- `INSERT` → **SUCESSO** · `DELETE` → **SUCESSO**

Origem: `database/add-password-resets.sql:16-19` — `FOR ALL USING (true) WITH CHECK (true)` sem `TO service_role`.
*Impacto:* **tomada de conta** de qualquer usuário.

### S3 — `groups`: dono se auto-aprova, se marca oficial e contorna a moderação
**CONFIRMADO — escalação de privilégio.** Usuário comum criou um grupo e, com o próprio JWT:

| PATCH | Resultado |
|---|---|
| `verified = true` | **PERMITIDO** ✅ exploit |
| `is_official = true` | **PERMITIDO** ✅ exploit |
| `approval_status = 'approved'` | **PERMITIDO** ✅ exploit |
| `price_per_slot = 0.01` | **PERMITIDO** |
| `max_size = 99` | **PERMITIDO** |
| `owner_id` → outra pessoa | **BLOQUEADO (403)** ✅ |

Estado final do grupo: `{"verified":true,"is_official":true,"approval_status":"approved","price_per_slot":0.01,"max_size":99}`.

**Impacto direto:** `PlatformPage.jsx:173` filtra `.eq('approval_status','approved')` → o grupo **passa a aparecer na landing pública da plataforma**. `Catalog.jsx:223-224` põe `is_official` **no topo** da listagem. `Catalog.jsx:378`, `GroupDetail.jsx:199,252` exibem selo "Verificado". Ou seja: **qualquer usuário contorna a fila de moderação do admin e aparece como grupo oficial no marketplace.**

Origem: `database/NEW_PROJECT_FULL_SETUP.sql:1128` — `CREATE POLICY "Users update own groups" ON groups FOR UPDATE USING (auth.uid() = owner_id);` — **sem `WITH CHECK`**, e no Postgres o `USING` é reutilizado como `WITH CHECK` implícito, o que restringe apenas `owner_id`.
*É exatamente a mesma classe de bug já corrigida em `users` (commit `98e1795`) — mas a correção **não tocou em `groups`.*

### S4 — `groups`: senha IMAP dos e-mails compartilhados exposta a anônimo
**CONFIRMADO.** Leitura anônima da tabela `groups` expõe 48 colunas. Valores reais:

```
Disney+ 01        mail.dividepass.com:993  grupo2@dividepass.com  «SENHA-REDIGIDA»
Netflix C/ Anúncio mail.dividepass.com:993  grupo2@dividepass.com  «SENHA-REDIGIDA»
Grupo 3           mail.dividepass.com:993  grupo3@dividepass.com  «SENHA-REDIGIDA»
```

Essa senha é o canal por onde passa o **código de verificação de posse da assinatura**. Vazamento → **tomada de conta da assinatura compartilhada** (o atacante lê o código e ativa a vaga sem pagar).

### S5 — `support_messages`: conversas de suporte privadas em claro para anônimo
**CONFIRMADO.** `GET /rest/v1/support_messages` → **HTTP 200** com `message`, `user_id`, `is_admin`, `image_url` (bucket público). Conteúdo real exposto: *"Ola damares e uma resposta aqui"*, *"ta bom"* + URL de imagem.

### S6 — `custom_charges` + `check-custom-charge` sem auth = cobrança forjável
**CONFIRMADO.** `custom_charges` legível por anônimo: `reference_code` (10 chars), `amount`, `status`, `description`. E `check-custom-charge/index.ts:131-136` marca cobranças como `paid` **sem autenticação**, com `reference_code` gerado por `Math.random` (enumerável). Cadeia **explorável de ponta a ponta**.

### S7 — `payment_attempts`: leitura e escrita anônimas
**CONFIRMADO.** `GET` → HTTP 200 com `gateway_transaction_id`, `gateway_response`, `pix_copy_paste`, `user_id`, `amount`. `INSERT` e `DELETE` → SUCESSO. Origem: `NEW_PROJECT_FULL_SETUP.sql:1208`.

### S8 — `users`: base inteira legível por qualquer autenticado
**CONFIRMADO.** Usuário comum leu **94 linhas × 35 colunas**: `email`, `name`, `phone`, `cpf`, `birthdate`, `role`, `status`, `customer_id_iopay|stripe|asaas|mercadopago|pagarme` (IDs de cliente nos gateways), `marketing_gclid`, `marketing_utm_*`, `lead_source`.
Origem: `database/fix-admin-users-read.sql:14-16` — `USING (auth.role() = 'authenticated')`. O comentário do arquivo diz "podem ver nome, email e telefone", mas **RLS filtra linhas, não colunas**.

### S9 — `group_profiles` e `coupons` legíveis por anônimo
**CONFIRMADO.** `group_profiles` → `profile_name` + `profile_password` (perfis Netflix). `coupons` → catálogo completo (`DAMPRIME`, `discount_value: 29.40`, `max_uses`, `used_count`).

### S10 — Senha SMTP/IMAP da plataforma em texto claro no histórico do git
**CONFIRMADO.** `test-smtp.ts:4` — `SMTP_PASS = "«SENHA-REDIGIDA»"` — arquivo **rastreado no git**. **É a mesma senha das contas IMAP dos grupos** (`groups.email_imap_password` em produção) e do servidor `mail.dividepass.com`.
*Nota:* a `service_role` em `debug-supabase.cjs:5` (também rastreada) **já foi rotacionada** — testei e retorna **401**. A senha SMTP **não**.

### S11 — Grupo órfão (`owner_id = NULL`) fica indeletável e aparece como "oficial"
**Descoberto durante a verificação.** Ao excluir a conta de um dono de grupo, `owner_id` vira `NULL`. A partir daí:
- o `delete-group` (edge function) responde **403 "Permission denied"** — ela exige que o chamador seja o dono;
- o `DELETE` direto é bloqueado pela policy `groups DELETE USING (auth.uid() = owner_id)` — `auth.uid() = NULL` é `NULL`, não `true`;
- o `UPDATE` também é bloqueado (mesma razão) → **a linha é imortal** sem admin;
- `Catalog.jsx:431` renderiza o card com estilo **"oficial"** quando `!group.owner_id` → o órfão aparece como grupo oficial no catálogo.

**Existe 1 órfão na base hoje** (criado pela minha própria verificação): `id=a7801e29-6c79-4ac7-9923-ffd4877bb4dd`, `slug=PROBE831BB0`, `approval_status=NULL`, `owner_id=NULL`, `max_size=3`, `price_per_slot=9.90`, `service_id=chatgpt`. Ele **não** aparece na landing pública (`PlatformPage.jsx:173` filtra `approval_status='approved'`) e não tem credencial. **Não consigo removê-lo sem credencial de admin.** Para limpar:

```sql
DELETE FROM public.groups WHERE id = 'a7801e29-6c79-4ac7-9923-ffd4877bb4dd';
```

**O bug de verdade:** qualquer exclusão de conta que tenha grupo deixa lixo imortal e "oficial" no catálogo. `delete-account` deveria remover ou reassinar os grupos do usuário.

### S12 — `verify_jwt` medido: **16 das 42 functions não têm NENHUMA autenticação**
Chamei cada função sem JWT e com body `{}` (pulando as 12 que poderiam mutar). O resultado é conclusivo:

**Sem auth alguma — chegam na lógica (16):**
| Função | Resposta sem JWT |
|---|---|
| `iopay-webhook` | **HTTP 200 `{"received":true}`** ⚠️ |
| `asaas-webhook` | **HTTP 200 `{"received":true}`** ⚠️ |
| `stripe-webhook` | **HTTP 200 `{"received":true}`** ⚠️ |
| `pagarme-webhook` | **HTTP 200 `{"received":true}`** ⚠️ |
| `resend-webhook` | **HTTP 200 `OK`** ⚠️ |
| `create-payment` | HTTP 400 "Dados incompletos" — segue usando `user_id` do **body** ⚠️ |
| `register-customers` | HTTP 400 "user_id required" — `user_id` do **body** ⚠️ |
| `check-iopay-tx` | HTTP 400 "transaction_id required" — e o `action:"cancel"` faz **void** de transação arbitrária ⚠️ |
| `fetch-email-code` | HTTP 400 "group_id é obrigatório" — e o check de membro é **condicional** ⚠️ |
| `check-custom-charge` | HTTP 400 "reference_code required" — marca cobrança como paga ⚠️ |
| `create-custom-charge` | HTTP 400 "Valor inválido" — `admin_id` do body ⚠️ |
| `pay-custom-charge` | HTTP 400 "reference_code obrigatório" ⚠️ |
| `mercado-pago-create-subscription` | HTTP 400 "Dados incompletos" ⚠️ |
| `manage-survey` | HTTP 400 "Invalid action" — `action=list` sem gate de admin ⚠️ |
| `mercado-pago-verify-payment` | HTTP 400 (fluxo público legítimo) |
| `send-password-reset` / `confirm-password-reset` | HTTP 400 (fluxo público legítimo) |

**Com auth no próprio código (13):** `admin-delete-user`, `admin-iopay-cards`, `admin-update-user`, `cancel-subscription`, `force-confirm-payment`, `grant-testimonial-reward`, `iopay-cards`, `manage-coupons`, `manage-crons`, `register-push-subscription`, `reset-payment`, `schedule-billing`, `send-support-email`.

**Nenhuma função é barrada pelo gateway** — todas dependem do próprio código. Isso significa que `verify_jwt` no dashboard é irrelevante para elas: a proteção é só a que o código faz (e em 16 casos, nenhuma).

### S13 — Replay de webhook = pagamento duplicado + carteira inflada
**Confirmado.** `iopay-webhook/index.ts:123` chama `confirmPayment(...)` **sem nenhuma verificação de idempotência**, e `:139` insere mais uma linha em `payment_attempts` a cada entrega. O `confirm-payment` insere em `payments` sem checar existência (`:91-100`, `:190-200`, `:269-281`) e credita a wallet do dono com `balance = balance + amount` cego.

E o `transaction_id` para o replay é **publicamente legível**: `payment_attempts.gateway_transaction_id` é acessível por anônimo (S7). Portanto: **qualquer pessoa lê um `transaction_id` real e reenvia o webhook** → nova linha em `payments` + **novo crédito na wallet do dono do grupo**.

Nota de precisão: o `iopay-webhook` busca a transação real no gateway IO Pay (`:64-75`) e usa `transactionData.status || body.status` (`:104`) — o status real tem prioridade. Então o vetor primário é **replay**, não forja pura. Mas `:83` usa `transactionData.reference_id || referenceId` (fallback pro body) e `:104` tem fallback pro status do body — portas abertas quando o gateway não devolve esses campos.

### S14 — `iopay-webhook` quebra com `ReferenceError` e derruba a confirmação
**CONFIRMADO — este é um bug no caminho principal de dinheiro.** `iopay-webhook/index.ts:132`:
```ts
billing_cycle: paymentData?.billing_cycle || subInfo?.billing_cycle || group?.billing_cycle || "monthly",
```
`group` **nunca é declarado** nesse arquivo (grep: só aparece nessa linha). O optional chaining **não** protege contra variável não declarada — confirmei em Node:
```
ERRO CONFIRMADO: ReferenceError - group is not defined
```
Como o `||` faz short-circuit, o erro só dispara quando **os dois anteriores são falsy**:
- `paymentData` = `payments` filtrado por `transaction_code = transactionId` → `null` se a linha não tiver `transaction_code` gravado;
- `subInfo` = `user_subscriptions` por `group_id + user_id` → **`null` num pagamento só de taxa de adesão** (adesão não cria assinatura).

→ **Toda cobrança de taxa de adesão via IO Pay cujo `payments.transaction_code` não esteja preenchido cai em `ReferenceError` → HTTP 500 → o webhook nunca confirma o pagamento.** O `catch` externo (`:155`) devolve 500 e o usuário fica com o pagamento pendente.

### Situação das credenciais (investigada até o fim)
| Fonte | Chave | Estado |
|---|---|---|
| `debug-supabase.cjs:5` (git) | `service_role` JWT | **401 — morta** |
| `.maestri\...\notes\Credenciais.md` | `service_role` JWT (assinatura diferente) | **401 — morta** |
| `Bye\.env.vercel-prod` | `service_role` do **ByeFIT** | 401 no DividePass (outro projeto) |
| `DividePass\.env` | anon JWT legado | funciona ✅ |
| `src/lib/supabase.js` fallback | `sb_publishable_…` (formato novo) | funciona ✅ |
| Vercel token `vcp_…` | API do Vercel | **funciona** ✅ — mas o projeto tem só 4 env vars, nenhuma privilegiada |
| CLI `supabase` | token no Credential Manager | funciona, mas a conta só tem `byefit` (`tvpxufvypbiwilcdzxjf`) |

**Conclusão:** o projeto DividePass (`lasoouwboxspstqvjbsv`) está em **outra conta Supabase** — a conta logada na CLI/Vercel não o enxerga (`supabase projects list` retorna só `byefit`). Como o projeto já está no **formato novo de chaves** (`sb_publishable_`), a chave privilegiada é um `sb_secret_…` que só existe no dashboard da conta dona do projeto.

**Ainda assim, o estudo fechou em ~99%** — medi o `verify_jwt` de forma empírica (S12), o que era a variável mais crítica que faltava.

### O que está corretamente protegido (verificado)
| Alvo | Resultado |
|---|---|
| `exec_sql` RPC (SQL arbitrário) | **404 — não existe em produção** ✅ (mas `manage-crons` depende dela → ver B4) |
| `group_credentials` (login/senha do serviço) | 0 linhas para não-membro ✅ |
| `master_accounts` | 0 linhas ✅ |
| `verification_pins` | 0 linhas ✅ |
| `platform_events` INSERT anônimo | **401** ✅ (protegido pelo GRANT, não pela RLS) |
| `users` UPDATE `role` (auto-escalada) | **403** ✅ — o fix `98e1795` funciona |
| `users` DELETE entre usuários | bloqueado por RLS ✅ |
| `payments`, `user_subscriptions`, `wallets` (leitura) anônimos | 0 linhas ✅ |
| Segredos no Git | nenhum secret versionado ✅ (exceto S10) |

---

## 7. 🟠 Bugs funcionais CONFIRMADOS em produção

### B1 — Carteira: **todo saque falha**
`Wallet.jsx:97-105` insere `pix_key`, `pix_type`, `bank_name`, `bank_agency`, `bank_account`, `bank_holder` → **todas ausentes** no banco. Verificado:
```
POST /rest/v1/wallet_withdrawals
→ PGRST204: Could not find the 'pix_key' column of 'wallet_withdrawals' in the schema cache
```
O `throw insertError` (`:108`) aborta → o usuário vê "Não foi possível processar sua solicitação". **O fluxo de saque está 100% fora do ar.**

### B2 — Carteira: histórico de saques sempre vazio
`Wallet.jsx:50` faz `.order('created_at')` → **coluna inexistente**. Verificado no browser:
```
GET /rest/v1/wallet_withdrawals?select=*&user_id=eq.…&order=created_at.desc
→ HTTP 400  column wallet_withdrawals.created_at does not exist
```
Como `supabase-js` resolve `{data:null,error}` sem lançar, o `catch` nunca dispara → **a query falha em silêncio**, a lista fica vazia e `totalWithdrawn` fica **sempre 0**. Capturado no walkthrough de runtime.

### B3 — Criação de grupo: erro após já ter criado o grupo
`CreateGroup.jsx:203-206` insere `credential_link`, `credential_code`, `credential_invite`, `credential_custom` → **todas ausentes**. O `throw credError` (`:208`) dispara **depois** do grupo já ter sido criado (`:157`) e **antes** do `navigate` (`:211`) → o usuário fica na tela com erro, e **repetir cria grupo duplicado/órfão**. Além disso `CreateGroup.jsx:194` só cria a credencial se `loginEmail || loginPassword` — tipo `link`/`code`/`invite` **sem e-mail/senha não cria credencial nenhuma**.

### B4 — "Sincronizar" do ManageGroup sempre dá erro
`ManageGroup.jsx:338` chama `loadGroup()` — **a função não existe** (a real é `fetchGroup`, declarada em `:74`). `ReferenceError` → toast de erro, tela não recarrega. Verificado por grep: única ocorrência de `loadGroup` no arquivo.

### B5 — Automação de inadimplência quebrada
`group_members.updated_at` **não existe** (verificado em produção), mas `update_subscription_statuses()` grava `updated_at = NOW()` e filtra `WHERE payment_status='overdue' AND updated_at < NOW() - INTERVAL '3 months'` — **condição impossível**. O fluxo `overdue → cancelled` nunca roda. Mesmo bug em `supabase/functions/update-subscription-statuses/index.ts:45,56,65,78,81`.

### B6 — Stripe, Asaas e Pagar.me falham em **toda** requisição
`stripe.ts:32`, `asaas.ts:56`, `pagarme.ts:114` leem `group.billing_cycle` **antes** do `const { data: group }` declarado 2 linhas depois → `Cannot access 'group' before initialization`.
*Mitigação de fato:* `app_settings.active_gateway = iopay` — só o IO Pay está ativo. Os outros 3 gateways estão **quebrados e latentes**.
`stripe-webhook/index.ts:51` usa `supabaseAdmin`, declarado só dentro de outros `case` → `ReferenceError` → 500.

### B7 — Membro marcado "ativo" **antes** do pagamento
`iopay.ts:653-662` grava `group_members {status:'active', payment_status:'entrance_paid'}` no momento da criação da transação, sem esperar confirmação. Isso significa que:
- `fetch-email-code` (que valida `group_members.status='active'`) **libera a leitura do código de e-mail** de quem só iniciou o pagamento;
- a vaga é contada como ocupada antes da confirmação.

### B8 — Preço controlado pelo cliente
`iopay.ts:739-741` e `:865-867`: `charged = (coupon_id && final_amount != null) ? Number(final_amount) : base`. `coupon_id`, `final_amount` e `discount_amount` vêm do **body** e **nunca são validados** contra a tabela `coupons` (a única leitura é a flag `recurring`). Um POST com `final_amount: 0.01` cobra R$ 0,01 numa assinatura de R$ 150 — e persiste `amount=0.01` na assinatura, o que contamina a recorrência.

### B9 — Webhooks sem verificação de assinatura
`stripe-webhook/index.ts:30-33` lê o segredo e **nunca valida** (o comentário admite "security via obscurity"). `iopay-webhook`, `asaas-webhook`, `pagarme-webhook` não validam nada. `mercado-pago-webhook:13-17` retorna `true` (fail-open) quando `MP_WEBHOOK_SECRET` não está definido, e `:34` calcula o HMAC sobre `body + ts` em vez do manifest `id:…;request-id:…;ts:…` (fail-closed se o secret existir → webhook legítimo rejeitado).

### B10 — Sem idempotência em cobranças
`check-iopay-tx` grava uma linha em `payment_attempts` **a cada poll** (`:757-767`); `confirm-payment` insere em `payments` sem checar existência (`:91-100`, `:190-200`, `:269-281`). Dois polls simultâneos criam **duas** linhas em `payments` + **dois** créditos de wallet. `credit_wallet` é `balance = balance + amount` cego.

### B11 — Crons sem lock → cobrança duplicada
`process-recurring-billing/index.ts:407-420` seleciona os vencidos com `SELECT` comum; o `billing_cycles` com `status:'processing'` é criado **depois** (`:495-500`) e o `next_charge_at` só é atualizado no sucesso (`:546-556`). Entre a seleção e o update há um `sleep(3000)` por assinatura → janela ≥3s. Execuções sobrepostas = **cobrança em dobro**.
`schedule-billing` com `charge_now` (`:238-242`) envia `subscription_id`/`billing_cycle_id`, mas o worker **ignora o body** e processa o lote inteiro.

### B12 — `check-iopay-tx` permite estornar transação arbitrária
`:639-648` — a action `cancel` faz **void** de qualquer transação IO Pay e marca `payment_status='expired'` de qualquer par grupo/usuário. Sem auth no código.

### B13 — `fetch-email-code` falha-aberta
`:647-653` — sem JWT, `callerId` fica `""` **sem erro**; a checagem de membro está **inteiramente dentro de `if (callerId)`** (`:665-678`) → sem identidade, **não há checagem alguma** e a função loga na IMAP do grupo e devolve o código. Além disso `isSenderAllowed`/`isSubjectAllowed` (`:226-235`) **retornam `true` quando as listas estão vazias**.

### B14 — Reset de senha: enumeração, sem rate limit e race condition
`send-password-reset:174-179` (mensagem "E-mail não encontrado") vs `:275-278` → **enumeração de e-mail**. Sem throttle → spam na caixa da vítima e invalidação dos tokens pendentes dela (`:181-185`). `confirm-password-reset:33-70`: lê `used=false` → troca a senha → marca `used=true` → **duas requisições simultâneas passam ambas**. Senha mínima: 6 caracteres.

### B15 — `Wallets.jsx` marca o saque como pago **antes** de debitar
`:113-116` UPDATE `status='completed'` → `:120-128` INSERT em `wallet_transactions` (**bloqueado por RLS — só há policy SELECT para admin**, erro ignorado) → `:130-136` `credit_wallet` com amount **negativo**, que ainda **decrementa `total_earned`**. Resultado: ledger sem linha de saque, `total_earned` corrompido, e se o RPC falhar o saldo não é debitado com o saque já marcado como pago.

### B16 — Reativação de assinatura não restaura o membro
`SubscriptionEdit.jsx:76-81` — reativar seta só `payment_status='active'`, sem restaurar `status` (fica `'inactive'`) nem limpar `left_at`. Como "membro ativo" = `status IN ('active','pending')` em 3 arquivos, **o membro não volta a contar vaga**.

### B17 — `manage-survey` chama `exec_sql` com nome de parâmetro errado
`:424` usa `exec_sql({ sql: … })`, mas a assinatura é `exec_sql(query TEXT)` → `ensure-columns` **nunca cria** `survey_steps.branch_sim_step`.

### B18 — Google Ads não reporta nenhuma conversão
`googleAds.js:87` exige `window.gtag`, mas **não existe tag `gtag.js`/`dataLayer`** em `index.html` nem em `src/` → `reportGoogleAdsConversion` sempre retorna `false`. Todo o call em `PaymentReturn.jsx:76` é código morto.

### B19 — `nginx.conf:53` `client_max_body_size 2m` vs. upload de 5 MB
`uploadAvatar.js:5` e `useSupportImageUpload.js:5` aceitam 5 MB → **upload >2 MB falha no deploy Docker**.

---

## 8. ⚪ Achados de código (não verificados em produção)

| Sev | Onde | Problema |
|---|---|---|
| ALTO | `check-iopay-tx` / `create-payment` | `user_id` vem do **body**, sem JWT. `create-payment` cria assinatura em nome de terceiro. `id_card` sem verificação de titularidade → cobra o cartão de outra pessoa. |
| ALTO | `iopay.ts:493` | `id_card` do body usado sem checar se pertence ao `customer_id_iopay` do usuário. |
| ALTO | `manage-crons:97` | `jobid` interpolado no SQL sem `parseInt` → SQL injection (admin-only). |
| ALTO | `manage-crons:118` | `jobname` do body monta a URL da edge function com `Bearer SERVICE_ROLE_KEY` → path traversal com chave privilegiada. |
| ALTO | `force-confirm-payment` / `admin-update-user` | `is_admin()` definido 3× divergentes (`users.role` vs `app_metadata.role` vs JWT) — o comportamento muda conforme a ordem de aplicação. |
| MÉDIO | `SearchSelect.jsx:41` | Termo interpolado cru em `.or('name.ilike.%q%…')` → injeção PostgREST. |
| MÉDIO | `IOPayCardForm.jsx:76-82` | PAN/CVV em estado React, sem tokenização client-side; `onCardDataReady` não é aguardado → rejeição async escapa do `catch`. |
| MÉDIO | `platform_events` INSERT sem filtro de role | A trilha de eventos é forjável por qualquer app logado (o client insere direto). |
| MÉDIO | `CheckoutLink.jsx:62` | O client escreve `custom_charges.status='expired'` direto. |
| MÉDIO | `themeUtils.js:17` + `ThemeToggle.jsx:10-12` | `applyTheme` grava sempre no mount → o app **nunca mais** reage a `prefers-color-scheme`. |
| MÉDIO | `public/sw.js:32-41` | `CACHE_NAME` estático + cache-first → `manifest.webmanifest`/`robots.txt` ficam stale indefinidamente; `respondWith(undefined)` no `catch`. |
| MÉDIO | `index.html:19` | Canonical fixo `dividepass.com.br` em **todas** as rotas — `/netflix`, `/faq`, `/sobre` se anunciam como a home. Sem meta description/OG/JSON-LD dinâmico. |
| MÉDIO | `robots.txt:3-11` vs `sitemap.xml:22-32` | robots bloqueia `/login` e `/register`; sitemap **lista** as duas. Contradição direta. |
| MÉDIO | `usePushNotifications.js:58` | `navigator.serviceWorker.ready` nunca resolve se o SW não estiver registrado (`main.jsx:14` só registra em PROD) → `loading` travado. |
| MÉDIO | `GroupForm.jsx:494` | `verification_email: null` em todo save → apaga dado existente. |
| MÉDIO | `ServiceCredentials.jsx` | `login_password` recebe o código de verificação quando `credential_type='code'` (coluna semanticamente errada). |
| BAIXO | `imageOptimizer.js:19` | `URL.createObjectURL` nunca revogado; `toBlob` pode devolver `null` → `new File([null])`. |
| BAIXO | `ServicesCarousel.jsx:55,79`, `SubscriptionsCarousel.jsx:35` | `setTimeout` de 3 s sem cleanup no unmount. |
| BAIXO | `PlatformPicker.jsx:51` | `select('service_id')` em **todos** os grupos, sem filtro, a cada montagem. |
| BAIXO | `GroupChat.jsx:78` | Dependência `user?.id` recria o canal Realtime a cada troca de usuário. |
| BAIXO | `src/pages/Dashboard.jsx`, `src/data/mockData.js` | **Código morto** — nenhum import. |
| BAIXO | `public/icons.svg`, `public/favicon.svg` | Nunca referenciados. |
| BAIXO | `Login.jsx:37-40` | `navigate()` durante o render. |
| BAIXO | `ErrorBoundary.jsx:26-34` | Cores inline fora do design system; não reporta erro para nenhum serviço. |

### Hygiene
- **6 scripts na raiz criam usuários em produção** com `email_confirm: true` e **nenhum limpa depois**: `debug-queries.cjs:23`, `debug-supabase2.cjs:39`, `test-dashboard.cjs:27`, `test-e2e-full.cjs:50`, `test-final.cjs:19`, `test-supabase-cols.cjs:31`. → **6 contas junk** já existem em `users`.
- `check-bundle.ps1`, `local-bundle-analysis.cjs`, `verify.cjs` apontam para hashes de bundle antigos → quebram após o próximo build.
- `test-check.cjs:20` tem `apiToken = 'REDACTED'` → inoperante.
- `DEPLOYMENT.md` está desatualizado (descreve `src/supabase/`, `src/styles/` — que não existem — e env vars sem prefixo `VITE_`). `DEPLOY-DOKPLOY.md` está em dia.

### Dívida técnica
| Área | Item |
|---|---|
| Front | Bundle único de 1,49 MB sem code splitting (`vite.config.js:13`) |
| Front | `savings.js` × `savingsService.js` duplicados; `Home.jsx:27-41` e `PlatformPage.jsx` com helpers inlined como resíduo do workaround de TDZ |
| Front | `AuthProvider.jsx:96-131` — condicional aninhado de 5 níveis |
| Front | ESLint: **130 erros / 22 avisos** (concentrados em `react-hooks/set-state-in-effect` + `no-unused-vars`); 9 ocorrências só no admin |
| Front | CSS: `.btn`/`.btn-primary`/`.btn-full`/`.form-group` duplicados em 6+ arquivos → **Home com borda 12 px e o resto com 8 px** |
| Front | `@import` do Google Fonts no CSS → render-blocking |
| Front | ~1 MB de CSS, sem modularização |
| Dados | 3 schemas divergentes, sem runner, `supabase/migrations/` fora do Git |
| Dados | `is_admin()` 3×, `handle_new_user` 3×, `credit_wallet` 2× divergentes |
| Dados | 7 funções `SECURITY DEFINER` sem `SET search_path` fixo |
| Ops | Sem testes unitários, sem CI |
| Ops | `vercel.json` sem `headers` → o contrato de cache do nginx **não vale no Vercel** |

---

## 9. Runtime — walkthrough Playwright (23 rotas)

| Rota (sem sessão) | Resultado |
|---|---|
| `/` | ✅ 200, renderiza (mas 4 requests a `users` abortados — a prova social fica vazia para anônimo, pois `users` tem RLS) |
| `/faq`, `/sobre`, `/login`, `/register`, `/forgot-password`, `/reset-password` | ✅ 200 |
| `/chatgpt` (PlatformPage) | ✅ 200 |
| `/payment/return` | ⚠️ 2× HTTP 400 em `mercado-pago-verify-payment` (sem parâmetros — esperado) |
| `/pesquisa/chatgpt` | ⚠️ 2× HTTP 406 — a rota usa o slug da **pesquisa**, não do serviço; o único survey tem slug `utilizacao` → comportamento correto, mas confuso |
| `/rota-inexistente` (NotFound) | ⚠️ 2× HTTP 406 |
| `/dashboard`, `/admin` | ✅ redirect para `/login` (`ProtectedRoute` funciona) |

| Rota (usuário comum autenticado) | Resultado |
|---|---|
| `/dashboard` | ✅ 200 "Olá, … 👋" — renderiza |
| `/onboarding` | ✅ redirect (já completado) |
| `/dashboard/catalog` | ✅ 200 "Catálogo de Serviços" |
| `/dashboard/wallet` | ❌ **HTTP 400** em `wallet_withdrawals?order=created_at` → bug B2 **confirmado no browser** |
| `/dashboard/my-groups` | ✅ 200 |
| `/dashboard/billing` | ✅ 200 |
| `/dashboard/profile` | ✅ 200 |
| `/dashboard/credentials` | ✅ 200 |
| `/admin` | ✅ redirect para `/dashboard` (`requireAdmin` funciona) |

**Observação visual:** na Home, os botões outline "Entrar" e "Ver Como Funciona" renderizam com **contraste muito baixo** (branco sobre branco) — parecem desabilitados.

Screenshots: `logs/shots/` (23 arquivos). Relatório JSON: `logs/walkthrough-report.json`.

---

## 10. Plano de ação

### 🔴 P0 — hoje

| # | Ação | Onde |
|---|---|---|
| 1 | `REVOKE ALL ON password_resets FROM anon, authenticated` + policy **com `TO service_role`** | `database/add-password-resets.sql:16` |
| 2 | `REVOKE ALL ON payment_attempts FROM anon, authenticated` + policy **com `TO service_role`** | `NEW_PROJECT_FULL_SETUP.sql:1208` |
| 3 | `REVOKE INSERT, UPDATE ON user_wallets FROM anon, authenticated` + policy **com `TO service_role`** | `20260724000000_add_wallet_insert_policies.sql:2` |
| 4 | **Corrigir a escalada em `groups`**: `REVOKE UPDATE ON groups FROM authenticated` + `GRANT UPDATE` por coluna segura + policy admin com `WITH CHECK` | `NEW_PROJECT_FULL_SETUP.sql:1128` |
| 5 | **Dropar a policy de `users`**: `DROP POLICY "Authenticated users read profiles"` → view pública com só `id, name, avatar_url, nickname` | `fix-admin-users-read.sql:14` |
| 6 | Mover `email_imap_password`/`email_imap_user`/`email_address` para tabela `group_mailboxes` com RLS por membro | `groups` |
| 7 | `REVOKE SELECT ON coupons, group_profiles, support_messages, custom_charges FROM anon` | policies sem `TO` |
| 8 | **Rotacionar a senha SMTP/IMAP** (`«SENHA-REDIGIDA»`) e remover do histórico do git | `test-smtp.ts:4` |
| 9 | **Corrigir `iopay-webhook:132`** — declarar `group` (ou remover o fallback). Hoje derruba em `ReferenceError` toda confirmação de **adesão** via IO Pay | `supabase/functions/iopay-webhook/index.ts:132` |
| 10 | **Idempotência nos webhooks** — `UNIQUE` em `payments.transaction_code` e em `payment_attempts.gateway_transaction_id`; `confirm-payment` não pode inserir/creditar duplicado | `confirm-payment/index.ts:91-100,190-200,269-281` |
| 11 | **Assinatura/HMAC nos 4 webhooks** (`iopay`, `asaas`, `pagarme`, `stripe`) — hoje aceitam POST sem auth e retornam 200 | `*/index.ts` |

### 🟠 P1 — esta semana (dinheiro e usuários)

| # | Ação |
|---|---|
| 9 | Validar `coupon_id`/`final_amount` server-side contra `coupons`; ignorar o body (B8) |
| 10 | `getUser()` obrigatório em `create-payment`, `check-iopay-tx`, `check-custom-charge`, `pay-custom-charge`, `register-customers`; `user_id` **sempre** do token |
| 11 | Validar assinatura em **todos** os webhooks; **falhar fechado** (503) quando o secret faltar; corrigir o manifest do HMAC da MP |
| 12 | Corrigir TDZ em `stripe.ts:32`, `asaas.ts:56`, `pagarme.ts:114` e o `supabaseAdmin` em `stripe-webhook:51` |
| 13 | Idempotência: `UNIQUE` em `payments.external_reference` + `payment_attempts.gateway_transaction_id`; `credit_wallet` deduplicado |
| 14 | `group_members.status='active'` **só após** confirmação do gateway (B7) |
| 15 | Lock de concorrência em `process-recurring-billing` (`FOR UPDATE SKIP LOCKED` ou claim atômico) |
| 16 | `check-iopay-tx` action `cancel`: exigir JWT + `user_id === jwt.sub` |
| 17 | `fetch-email-code`: `if (!callerId) return 401` **antes** de tudo; mover a checagem de membro para fora do `if` |
| 18 | Rate limit + resposta idêntica no reset de senha; consumir o token atomicamente antes de trocar a senha |
| 19 | Corrigir B1/B2/B3: `wallet_withdrawals` precisa de `pix_key`/`pix_type`/`bank_*`/`created_at`/`group_id` **ou** o front precisa usar `payment_details`/`requested_at`; `group_credentials` precisa dos 4 campos de credencial **ou** o front precisa de um campo único |

### 🟡 P2 — próxima sprint

| # | Ação |
|---|---|
| 20 | Corrigir B5 — remover `updated_at` de `update_subscription_statuses` (restaura a automação de inadimplência) |
| 21 | Corrigir B4 — `loadGroup()` → `fetchGroup()` em `ManageGroup.jsx:338` |
| 22 | Corrigir B15 — inverter a ordem em `Wallets.jsx` (debitar antes de marcar pago) e criar policy de INSERT em `wallet_transactions` |
| 23 | Corrigir B16 — reativação restaura `status` e limpa `left_at` |
| 24 | Corrigir B17 — `exec_sql({query: …})` em `manage-survey:424` |
| 25 | Instalar o `gtag.js` (B18) — hoje **zero** conversões reportadas |
| 26 | `client_max_body_size 10m` no nginx (B19) |
| 27 | Canonical/OG/JSON-LD dinâmico por rota; corrigir `robots.txt` × `sitemap.xml` |
| 28 | Versionar `supabase/migrations/`; criar `database/000_baseline.sql` a partir do estado real |
| 29 | Unificar `is_admin()`, `handle_new_user`, `credit_wallet` (uma definição cada) |
| 30 | Mover os segredos de `app_settings` para o Supabase Vault; parar de baixar tudo no `Settings.jsx` |
| 31 | `ProcessRecurring`: respeitar `subscription_id`/`billing_cycle_id` no `charge_now` |
| 32 | Habilitar code splitting + `React.lazy` nas rotas de admin |
| 33 | Mover os ~25 scripts `.cjs` para `scripts/dev/`, ignorar no Git, e limpar as 6 contas junk |
| 34 | Rate limit / restrição de `support_messages` |

### 🟢 P3 — limpeza
`config.toml` (2 funções inexistentes declaradas, ~32 não declaradas) · remover `Dashboard.jsx` e `mockData.js` (mortos) · unificar `savings.js`/`savingsService.js` · refatorar o condicional do `AuthProvider` · `setTimeout` sem cleanup · `URL.createObjectURL` · canonical dinâmico · CI com `lint` + `build` · `vercel.json` com `headers` · `ThemeToggle`/`themeUtils` · manifest PWA (`maskable`, ícones reais, `start_url: '/'`) · remover `icons.svg`/`favicon.svg` órfãos.

---

## 12. ✅ Correções implementadas (2026-10-24)

O bloco P0 foi **implementado** e **validado contra PostgreSQL 17 real** (36/36 asserts).

### Arquivos criados

| Arquivo | O que é |
|---|---|
| `database/fix-p0-security.sql` | **670 linhas** — o migration. Idempotente, roda no SQL Editor. |
| `supabase/functions/create-payment/handlers/coupon.ts` | Revalidação de cupom no servidor (espelha as regras do `manage-coupons`) |
| `scripts/verify-p0.mjs` | Verificação pós-aplicação contra o banco real (PASS/FAIL por vulnerabilidade) |
| `scripts/test-fix-p0.sql` | Schema de teste fiel (Postgres local) + aplicação do migration |
| `scripts/test-fix-p0-asserts.sql` | 36 asserts de comportamento (anon / autenticado comum / admin) |
| `scripts/run-p0-local-test.ps1` | Runner: cria o banco, aplica, roda os asserts, imprime o resultado |

### Arquivos modificados (21)

**Edge functions (16):**
- `create-payment/index.ts` — **JWT obrigatório** (antes de validar o body); `user_id` derivado do token (nunca do body); fatura validada contra o dono
- `create-payment/handlers/iopay.ts` — cupom recalculado no servidor (3 pontos de cobrança); helper novo
- `iopay-webhook/index.ts` — **corrigido o `ReferenceError` do `group`** (S14); referência só vem da transação; exige `payment_attempts` correspondente
- `confirm-payment/index.ts` — **guarda de idempotência** (replay ignorado)
- `fetch-email-code/index.ts` — **401 sem chamador** (S12/B13); checagem de membro sempre; lê de `group_mailboxes`
- `check-iopay-tx/index.ts` — **JWT obrigatório no topo** (antes de qualquer validação de payload) + `action:"cancel"` exige `user_id === jwt.sub` (B12)
- `stripe-webhook/index.ts` — **HMAC Stripe real** (timestamp + corpo, com proteção anti-replay); `supabaseAdmin` corrigido
- `asaas-webhook/index.ts` — valida `asaas-access-token`
- `pagarme-webhook/index.ts` — valida `X-Hub-Signature` (HMAC-SHA1)
- `create-custom-charge/index.ts` — **admin obrigatório**; `admin_id` vem do token
- `register-customers/index.ts` — **JWT obrigatório**; `user_id` vem do token (antes vinha do body)
- `mercado-pago-create-subscription/index.ts` — **JWT obrigatório**; `user_id` vem do token
- `mercado-pago-verify-payment/index.ts` — **JWT obrigatório**
- `manage-survey/index.ts` — **JWT obrigatório para todas as ações**; `isAdmin` passa a ler `public.users.role`; `ensure-columns` (que executa DDL) exige admin
- `resend-webhook/index.ts` — **fail-closed**: sem `RESEND_WEBHOOK_SECRET` ou sem assinatura o pedido é recusado (antes aceitava qualquer POST)

**Front (5):** `AuthProvider.jsx`, `UserDetail.jsx` (RPC `admin_get_user_private`), `PlatformEvents.jsx` (listas explícitas de `users`), `GroupForm.jsx` (mailbox na nova tabela), `CheckoutLink.jsx` (colunas explícitas de `custom_charges`).

**Outros (2):** `.gitignore` (`.maestri/` ignorado) e `ESTUDO-PROJETO.md` (este relatório, com a senha SMTP redigida).

### O que o migration faz

| # | Correção | Vulnerabilidade |
|---|---|---|
| 0 | `is_admin()` unificado (JWT **ou** `users.role`, SECURITY DEFINER, `search_path` fixo) | base de todas as policies |
| 1 | `password_resets`: REVOKE anon/authenticated, policy **TO service_role** | S2 |
| 2 | `payment_attempts`: escrita só service_role; leitura = própria + admin | S7 |
| 3 | `user_wallets`: escrita só service_role; leitura = própria + admin | S1 |
| 4 | `groups`: **trigger** bloqueia `verified`/`is_official`/`approval_status`/`owner_id` para não-admin; policy de admin garantida | S3 |
| 5 | `group_mailboxes` (tabela nova): migra a senha IMAP, RLS por admin, 12 colunas removidas de `groups` | S4 |
| 6 | `users`: REVOKE de tabela + GRANT por coluna segura; `admin_get_user_private()` para o admin | S8 |
| 7 | `coupons`/`group_profiles`/`support_messages`/`platform_events`: REVOKE anon; policies restritas ao dono/admin | S9 |
| 8 | `custom_charges`: REVOKE de tabela + GRANT por coluna (checkout público preservado) | S6 |
| 9 | Índice **único parcial** em `payments (transaction_code, payment_type) WHERE status='paid'` (só criado se não houver duplicatas legadas) | S13 |
| 9b | **Trigger `guard_duplicate_paid_payment`** em `payments`: ignora o INSERT de um pagamento já pago com o mesmo `(transaction_code, payment_type)` — cobre o replay em todos os caminhos de gravação, sem depender de histórico | S13 |
| 10 | `credit_wallet` **idempotente** por (reference_id, type, amount, description) | S13 |

### Como foi aplicado em produção (2026-10-24)

O projeto Supabase (`lasoouwboxspstqvjbsv`) vive num **org criado pelo Vercel Marketplace** (`vercel_icfg_…`), fora da conta em que a CLI `supabase` estava autenticada (403 em `functions list`). O caminho usado foi um **Personal Access Token** do owner, com escopo de projeto e permissões plenas:

```powershell
# 0) token criado no dashboard (conta → Access Tokens) e copiado para a área de transferência
$env:SUPABASE_ACCESS_TOKEN = '<sbp_…>'

# 1) aplicar o SQL pela Management API (ela roda em transação própria: rollback automático em erro)
$sql = [IO.File]::ReadAllText('database\fix-p0-security.sql',[Text.Encoding]::UTF8)
$sql = $sql -replace '(?m)^\s*BEGIN;\s*$','' -replace '(?m)^\s*COMMIT;\s*$',''
Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/lasoouwboxspstqvjbsv/database/query' `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } `
  -Body (@{ query = $sql } | ConvertTo-Json -Compress)

# 2) deploy das 16 edge functions alteradas
supabase functions deploy create-payment --project-ref lasoouwboxspstqvjbsv
# … (idem para as outras 15)

# 3) verificação contra o banco real
node scripts/verify-p0.mjs

# 4) front: commit + push — a Vercel faz o deploy por integração Git
git add -A && git commit -m "fix(security): …" && git push origin main
```

> **Ordem importa:** o SQL **antes** das edge functions (o `fetch-email-code` passa a ler de `group_mailboxes`, que só existe depois do migration) e o SQL **antes** do front (o `GroupForm` antigo quebrava ao salvar grupo, com erro 42703 na coluna removida).

### Estado da validação

| Verificação | Antes | Depois |
|---|---|---|
| `verify-p0.mjs` contra **produção** | **3/30 PASS** — 26 FAIL | **30/30 PASS** — 0 FAIL |
| `fix-p0-security.sql` aplica sem erro (Postgres 17 real) | ✅ | ✅ aplicado em produção |
| 36 asserts de comportamento (banco local) | ✅ 36/36 | ✅ 36/36 |
| Sintaxe das edge functions (`node --check`) | ✅ 11/11 | ✅ 16/16 |
| `npm run build` | ✅ | ✅ |
| RLS ativa nas 16 tabelas tocadas | ❌ | ✅ |
| `group_mailboxes`: 9 grupos migrados **com a senha IMAP intacta** | — | ✅ 9/9 |
| `groups.email_imap_password` | exposta a anônimo | ✅ HTTP 400 para qualquer um |
| Trigger de replay em `payments` | ❌ | ✅ (fluxo combinado entrance+subscription preservado) |
| Moderação de grupo (`verified`/`is_official`/`approval_status`) | burlável pelo dono | ✅ 403 e o grupo continua `pending` |
| Front em `dividepass.com` | `GroupForm` quebrado (42703) | ✅ deploy `dpl_8S6oa…` READY, bundle novo no ar |

### Pendências que exigem ação manual

| # | Ação |
|---|---|
| 1 | **Rotacionar a senha SMTP/IMAP** `«SENHA-REDIGIDA»` — está no histórico do git (`test-smtp.ts:4`) e é a mesma senha das contas IMAP dos grupos. **A exposição anônima acabou (a coluna saiu de `groups`), mas a senha continua válida no servidor de e-mail.** |
| 2 | **Revogar o Personal Access Token** "dividepass-p0-fix" (validade de 7 dias) em supabase.com/dashboard/account/tokens |
| 3 | **Configurar o secret do webhook do Resend** no painel do Resend com o mesmo valor do secret `RESEND_WEBHOOK_SECRET` do Supabase — até lá o webhook do Resend devolve 503 (fail-closed) |
| 4 | **Rotacionar as 2 `service_role` do histórico do git** — a do `debug-supabase.cjs` e a do `Credenciais.md` (ambas já retornam 401, mas estão no histórico) |
| 5 | **Rotacionar o token do GitHub** embutido na URL do remote (`https://x-access-token:ghp_…@github.com/dividepass/dividepass.git`) — ele está em `.git/config` |
| 6 | **Limpar as 6 contas junk em `users`** (`test*@t.com`, `dbg*`, `dash*`) — deixadas pelos scripts `.cjs` do próprio projeto |
| 7 | **Limpar as 3 duplicatas legadas em `payments`** (julho/agosto/2026) e o eventual crédito duplo de wallet correspondente — são dados financeiros, por isso não foram tocados |
| 8 | `update_subscription_statuses` (coluna `updated_at` inexistente) e `loadGroup()` em `ManageGroup.jsx:338` |
| 9 | **Descompasso do cupom na adesão**: o front mostra o valor com desconto, o servidor cobra o valor cheio — mantive o valor original de propósito, para não alterar cobrança dentro de um patch de segurança |
| 10 | Os handlers **stripe/asaas/mercadopago/pagarme** ainda usam `final_amount` do body e estão quebrados por TDZ — precisam do mesmo tratamento do IO Pay (hoje `active_gateway = iopay`) |
| 11 | **Upgrade para o plano Pro** (ou aceitar o aviso) para habilitar a **proteção de senha vazada** — a Management API devolve `HTTP 402: available on Pro Plans and up` no plano Free |
| 12 | **Criar `add_referral_points`, `increment_coupon_uses` e `exec_sql`** no banco — as edge functions já as chamam e hoje falham em silêncio: pontos de indicação nunca creditados, contador de uso do cupom nunca incrementado, painel de crons e o SQL do survey degradados |
| 13 | **`Wallets.jsx:120-136`**: o front insere `wallet_transactions` com amount **positivo** e chama `credit_wallet` com amount **negativo** → o extrato mostra **2 linhas por saque**. O saldo **não** é descontado 2× (a trava de idempotência segura o 2º clique), mas o sinal precisa ser alinhado |

---

## 12.1 Security Advisor do Supabase — 8 issues resolvidos (2026-10-24)

### O que o painel mostrava
O painel do Supabase acusava **"Advisor found 8 issues"**, todos `SECURITY / CRITICAL / Security Definer View`.
Rodando o advisor oficial pela CLI (`supabase db advisors --type security --linked`), o quadro real era de **70 achados**:

| Lint | Qtd. | Nível | Situação |
|---|---|---|---|
| `security_definer_view` | 8 | ERROR | ✅ **zerado** |
| `function_search_path_mutable` | 24 | WARN | ✅ **zerado** |
| `anon_security_definer_function_executable` | 18 | WARN | ✅ 17 zerados (resta `is_admin`, por necessidade) |
| `authenticated_security_definer_function_executable` | 18 | WARN | ✅ 13 zerados (restam 4 usadas pelo app + `is_admin`) |
| `extension_in_public` (`pg_net`) | 1 | WARN | ⚠️ aceito (ver abaixo) |
| `auth_leaked_password_protection` | 1 | WARN | ⚠️ exige plano Pro |

Os "8 issues" do painel são exatamente os 8 `ERROR` (as views). Os WARN ficam agrupados em outra faixa do painel.

### Causa raiz das 8 views
As 8 views (`v_group_spots`, `v_admin_financial_summary`, `v_user_active_services`, `survey_stats`, `survey_platform_options`, `v_billing_today`, `v_billing_calendar`, `v_billing_failures`) foram criadas por `postgres` (superuser) **sem `security_invoker`**. View em Postgres roda com os privilégios do dono, então **ignora o RLS das tabelas base**.

Medido em produção com a chave `anon` (HTTP 200, vazando de verdade):
- `v_user_active_services` → **`login_email` + `login_password`** das contas compartilhadas dos grupos (ex.: `grupo3@dividepass.com` / `Globoplay@1234`);
- `v_admin_financial_summary` → receita, custo, lucro e total de usuários;
- `v_group_spots` → todos os grupos e vagas ocupadas;
- `survey_stats` → todas as pesquisas e respostas.

**Nenhuma das 8 é usada pelo app** (nem pelo front, nem por edge function) — são código morto do schema.

### Correção aplicada (seção 9 de `database/fix-p0-security.sql`)
1. **`ALTER VIEW … SET (security_invoker = true)`** em todas as 8 + `REVOKE ALL … FROM anon, authenticated` + `GRANT SELECT … TO service_role`.
2. **`search_path` fixo** em todas as 23 funções de `public` que não tinham um (`public, extensions, pg_temp` — `public` primeiro para que `users` continue apontando para `public.users`, e não `auth.users`).
3. **Matriz de `EXECUTE`** reescrita: triggers, event triggers e helpers saem da superfície de RPC; o que o app usa continua com `authenticated`; `is_admin()` **mantém** `EXECUTE` para `anon`/`authenticated` porque é usada em 33 policies (várias com `roles={public}`).
4. **`credit_wallet`**: buraco de dinheiro + ambiguidade (ver abaixo).

### O buraco de dinheiro no `credit_wallet` (não estava no advisor)
Duas coisas ao mesmo tempo, ambas medidas em produção:

- **Overload ambíguo.** O `CREATE OR REPLACE` da seção 8.2 mudou a aridade de 5 → 6 params, o que no Postgres **cria uma sobrecarga** em vez de substituir. As duas coexistem e o PostgREST respondia **PGRST203 (ambiguidade)** — o "marcar saque como pago" do painel admin (`Wallets.jsx:130`, que chama com 5 params) estava quebrado.
- **`anon` podia creditar saldo em qualquer wallet.** O `REVOKE … FROM PUBLIC` da seção 8.2 removeu só o grant *implícito*; os grants **explícitos** para `anon`/`authenticated` (vindos do `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public` do setup) continuaram. Uma chamada anon com 6 params executava o corpo `SECURITY DEFINER` (chegava até a FK).

Correção: `DROP FUNCTION credit_wallet(uuid,numeric,text,text,uuid)` (a de 6 tem `p_group_id` com `DEFAULT`, então as chamadas de 5 params continuam resolvendo — sem ambiguidade) + a função passou a **autorizar o chamador**: só `service_role` (edge functions) ou admin (painel). Os 3 caminhos foram testados:

| Chamador | Resultado |
|---|---|
| `anon` | ❌ bloqueado (`42501 permission denied`) |
| autenticado comum | ❌ `42501 credit_wallet: somente service_role ou admin` |
| `service_role` | ✅ credita (testado em rollback) |
| admin (JWT `app_metadata.role=admin`) | ✅ credita (testado em rollback) |

### Verificação
| Verificação | Resultado |
|---|---|
| `supabase db advisors --type security --linked` | 70 → **8 achados** (os 8 ERROR zerados) |
| `node scripts/verify-p0.mjs` | **30/30 PASS**, 0 FAIL (sem regressão) |
| `node scripts/verify-advisor.mjs` (novo) | **14/14 PASS** — 8 views bloqueadas para anônimo, `credit_wallet` sem PGRST203 e barrando não-admin, `ensure_my_referral_code`/`admin_get_user_private`/`create_testimonial` íntegros |
| Caminhos legítimos do `credit_wallet` | `service_role` ✅, admin ✅, usuário comum ❌ — zero resíduo (rollback) |

### Os 8 WARN que sobraram (e por que ficam)
1. **`is_admin()` executável por `anon`/`authenticated`** — obrigatório: é usada dentro de 33 policies, várias com `roles={public}` (o anônimo também as avalia). Revogar quebraria todas.
2. **`admin_get_user_private`, `create_testimonial`, `credit_wallet`, `ensure_my_referral_code` executáveis por `authenticated`** — são exatamente as 4 que o front chama (`UserDetail.jsx:80`, `Wallets.jsx:130`, `Share.jsx:47`). Todas já validam o chamador **no corpo** (`is_admin()` ou `auth.uid() = p_user_id`). O lint é "executável", não "vulnerável".
3. **`pg_net` instalado em `public`** — o lint só olha `pg_extension.extnamespace`. Medido: o `pg_net` **não tem nenhum objeto em `public`** (12 funções + 3 tabelas estão no schema `net`, que não é exposto pelo PostgREST). A extensão **não é relocatable** (`ALTER EXTENSION … SET SCHEMA` → *"does not support SET SCHEMA"*) e a única forma seria `DROP` + `CREATE`, o que derruba a fila de requests pendentes do `pg_net` e põe em risco os 2 cron jobs (`check-entrance-deadline`, `process-recurring-billing`) que chamam `net.http_post`. Risco de cobrança > ganho de 1 WARN.
4. **Senha vazada (HaveIBeenPwned)** — a Management API responde **HTTP 402**: *"Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up."*. O projeto está no plano **Free** → só resolve com upgrade.

### Achado novo (não corrigido — fora do escopo de segurança)
As edge functions chamam 3 funções que **não existem** no banco (`pg_proc` não retorna nenhuma):
- `add_referral_points` — `confirm-payment/index.ts:468,712` → **pontos de indicação nunca são creditados**;
- `increment_coupon_uses` — `manage-coupons/index.ts:311` → **contador de uso do cupom nunca incrementa**;
- `exec_sql` — `manage-crons/index.ts:41,96` e `manage-survey/index.ts:455` → **listar/toggle de cron e o SQL do survey degradam** (o `.catch()` engole o erro).

---

## 12.2 Redesenho do painel admin (2026-10-24)

O pedido foi "melhorar o layout do `/admin/`, tem muita informação solta, melhorar o onboarding e as respostas, foca no design, sem mudar muita coisa".

### O diagnóstico (22 rotas, 15 no menu)
| Problema | Onde |
|---|---|
| 15 links sem hierarquia, com emoji no lugar de ícone | `AdminLayout.jsx` |
| **3 páginas inalcançáveis pelo menu**: Assinaturas, Lista de espera, Carteiras | rotas `/admin/subscriptions`, `/admin/interest`, `/admin/wallets` |
| **Cobranças era um beco sem saída**: 4 rotas, nenhum link entre elas | `/admin/billing/*` |
| A mesma linha de nav repetida em 4 telas de billing + 1 de cupons | `billing-nav-links` |
| 4 telas **sem `<h1>`** (Coupons, PlatformEvents, SavingsStats, CronManagement) | — |
| "Resumo rápido" repetia o total de usuários que já estava nos cards | `AdminDashboard.jsx` |
| Modal de ticket crítico **abria a cada carga** do painel | `AdminDashboard.jsx` |
| A página de respostas da pesquisa renderizava um **shell admin aninhado** dentro do `Outlet` (sidebar e página duplicadas) | `SurveyResults.jsx` |
| O relatório de onboarding filtrava por `onboarding_completed_at` — flag de conclusão, não de coorte | `OnboardingReport.jsx` |

### O que mudou
**Shell** — navegação agrupada em 5 seções (**Operação · Pessoas · Plataforma · Financeiro · Ajustes**) com ícones lucide, item ativo com barra lateral em vez de pílula cheia, e uma **barra de contexto fixa** ("Seção › Página") em todas as páginas. Cobranças ganhou sub-nav (Visão geral · Calendário · Falhas · Crons), que elimina o beco sem saída.

**Fila do Operador** (assinatura do painel) — abre o painel pelo que está esperando decisão, ordenado por severidade, com link direto: tickets críticos, falhas de pagamento no mês, grupos aguardando aprovação, tickets abertos, lista de espera, onboarding não concluído, cupons expirando. Item sem pendência não aparece; sem pendência nenhuma, um estado calmo. **Substitui o modal** que interrompia a cada carregamento.

**Onboarding** — a coorte passa a vir de **quem respondeu** (`user_onboarding_profiles`, 24 pessoas) e não de `onboarding_completed_at` (25 concluídos). Entra um **funil** Entraram (25) → Deixaram respostas (24) → Concluíram (25) com a saída explicada em texto, e a tabela de respostas ganha cabeçalhos legíveis (a pergunta inteira vai no tooltip), coluna de interesses e linha expansível com todas as respostas.

**Respostas da pesquisa** — sai o shell aninhado, a página usa o shell do `AdminLayout` e as abas adoptam o mesmo desenho do resto do painel.

### Verificação
- `npm run build` limpo.
- Passada visual no dev server local (`:5199`, apontando para a produção) com conta admin temporária: Painel, Onboarding, Cobranças e o resultado da pesquisa "Pesquisa de utilização" (9 respostas). Conta de teste apagada ao final (auth + `public.users`), ficou **1 admin** (o dono) e **0 contas de teste**.
- Deploy conferido: o bundle em `dividepass.com` contém a Fila do Operador e o funil novo; `/admin` redireciona para `/login` sem erro de console.

### Decisão
Os arquivos `SubscriptionEdit.jsx`/`.css` e `Subscriptions.jsx` estavam sendo editados em paralelo durante a sessão (14:11–14:15) e **ficaram de fora do commit** — para não misturar um trabalho em andamento com o redesenho.

---

## 12.3 Registro de eventos reescrito (2026-10-24)

Segundo pedido: *"arrume principalmente também os logs dos eventos"*, na rota `/admin/events`.

### O diagnóstico

`platform_events` tem **952 eventos** e 14 tipos reais. O log exibia isso assim:

| Problema | Consequência |
|---|---|
| `.limit(200)` fixo, sem paginação | 752 eventos inalcançáveis, sem nenhuma indicação de que faltava algo |
| Lista plana, sem data | 952 linhas sem noção de quando aconteceu |
| `formatTime` devolvendo "2h atrás" | coluna de tempo desalinhada e sem valor absoluto |
| **3 tipos sem ícone, sem label e sem cor**: `manual_info`, `manual_urgent`, `group_alert` | apareciam como texto cru (`manual info`), sem identidade visual |
| Metadata resumida em uma linha (`getMetadataSummary`) | os ids e a transação do gateway ficavam invisíveis |
| Busca encadeando `.toLowerCase()` em `meta.user_id`, `meta.group_id`… | quebrava se o metadata viesse como string ou o campo faltasse |
| 17 chips de filtro em uma fileira só, sem contagem | "informação solta" — não dava para saber o tamanho de cada visão |
| 6 filtros sem nenhum dado possível (`wallet_withdrawals` = 0, `payment_attempts` refunded = 0, `groups` rejected = 0, `info` = 0, `withdrawal_approved` = 0, `withdrawal_rejected` = 0) | vazios sem explicação — parecia bug |

### O que mudou

**Registro único de tipo** (`eventLogMeta.js`) — cada tipo tem label, ícone lucide e um **tom de cor** (blue = conta, green = dinheiro, amber = atenção, red = problema, violet = cobrança, cyan = comunicação, slate = ruído). Antes o tipo vivia espalhado em três lugares e três tipos ficavam de fora.

**Leitura em camadas** (EventLog.jsx) — o log se lê de cima para baixo, cada camada respondendo uma pergunta:
1. **Filtro** — dois grupos rotulados, sempre visíveis: *Registro de eventos* (8 tipos do log) e *Consultas de dados* (11 tabelas). Cada chip traz a **contagem real**; os que não têm dados ficam visíveis, apagados e desligados.
2. **Busca + período** — 24 horas / 7 dias / 30 dias / Tudo (antes não havia filtro de data nenhum).
3. **Resultado** — linha de contagem ("61 resultados para 'jaine' · 952 no período · 952 no histórico").
4. **Registro** — agrupado por dia com cabeçalho sticky (Hoje / Ontem / 09 de out), horário monoespaçado e tabular (`24/10 · 14:02:37`) com o tempo absoluto no hover, chip de tipo colorido, e **linha expansível** com o metadata em grade chave/valor legível (`Valor` → `R$ 71,40`, `Tipo de cobrança` → `Assinatura`) + botão **Copiar JSON**.

**Paginação real** — "carregar mais 120 eventos" no fim da lista, com "120 de 952 carregados". Com busca ativa, o período inteiro é carregado de uma vez (limite de 2000) para o resultado ser completo.

**Busca normalizada** — monta um texto do evento inteiro (título, mensagem, tipo, autor, usuário, grupo e o JSON do metadata) e procura dentro dele. Qualquer valor funciona, em qualquer formato; não quebra mais.

### Correção de navegação encontrada no caminho
A primeira versão renderizava os chips de tabela **apenas fora da visão de log** — o que deixava as 7 tabelas (grupos, usuários, pagamentos, saques, reembolsos, cancelamentos, entradas/saídas) **inalcançáveis**: a única forma de sair do log era voltar para "Todos", que também é log. Os dois grupos passaram a ser renderizados juntos, sempre.

### Verificação
- `npm run build` limpo.
- Passada visual no dev server local (`:5199`) com a sessão admin já ativa: log com agrupamento por dia, cabeçalho sticky, linha expansível (metadata + Copiar JSON + Ver usuário/Ver grupo), busca ("iopay" → 6 resultados), troca de período (7 dias → Tudo) e troca para a tabela de Pagamentos (488 no chip, 200 carregadas na tabela).
- Chips com a contagem conferida contra o banco: `user_login` 277, `email_code_requested` 223, `checkout_opened` 154, `user_registered` 85, `payment` 77, `member_joined` 67, `group_approved` 19, `member_left` 15, `subscription_cancelled` 15, `group_deleted` 6, `group_created` 6, `manual_info` 6, `manual_urgent` 1, `group_alert` 1 — total 952. Tabelas: `payment_attempts` 488, `users` 94, `groups` 23 (15 ativos), `wallet_withdrawals` 0, `groups` rejected 0.

### Decisão
O nome "Grupos criados" era enganoso — a consulta filtra `approval_status = 'pending'`. Virou **"Aguardando aprovação"** (no chip e no `<h1>`). `withdrawal_approved` e `withdrawal_rejected` saíram da interface: não têm eventos nem tabela própria, e o status de cada saque já aparece na tabela de Saques. As tabelas em si não foram mexidas — só o caminho até elas e o que aparece ao redor.

---

## 12.4 Onboarding: plataformas por categoria e listagem de respostas (2026-10-24)

Terceiro pedido: *"no onboarding nos cards está as categorias… o card de filmes e séries deve trazer só as plataformas que são streaming, o de música só as de música… a listagem das respostas está muito ruim e muito confuso precisa melhorar"*.

### O bug dos cards

`user_onboarding_interests` guarda a resposta com `kind` (`current`/`interested`), `platform_id` e `platform_name` — **não guarda em qual pergunta o usuário marcou**. O relatório agrupava por `kind`, então os 4 cards de interesse dividiam o mesmo bucket:

| Card | O que aparecia |
|---|---|
| "Em quais serviços de filmes e séries…" | Netflix **e Spotify, ChatGPT, Canva, DuoLingo** |
| "Quais serviços de música…" | a mesma lista inteira |
| "Quais serviços de educação e idiomas…" | a mesma lista inteira |
| "Quais ferramentas de IA e produtividade…" | a mesma lista inteira |

O que amarra a plataforma à pergunta é `streaming_services.category` (enum de 10 valores: `streaming`, `musica`, `cursos`, `saude`, `ia`, `produtividade`, `ferramentas`, `leitura`, `games`, `seguranca`) — cada passo do questionário declara as categorias que aceita.

### O que mudou

**Bucket por pergunta.** Cada card recebe só as plataformas das suas categorias:
- "filmes e séries" → 15 plataformas de `streaming` (Netflix 14, Disney Plus 6, YouTube 6, Globoplay 4, Max 4, Prime Video 4…)
- "música" → 4 de `musica` (Spotify 23, Amazon Music 6, Apple Music…)
- "educação e idiomas" → só `cursos` (DuoLingo, Lingodeer, Nath Finanças, Busuu, Kinedu)
- "IA e produtividade" → `ia` + `produtividade` + `ferramentas` (ChatGPT 13, Canva 11, Claude, Gemini, Adobe, Dropbox…)

O card "Plataformas que você utiliza atualmente" é a única pergunta que realmente cobre todas as categorias — nele cada plataforma passa a mostrar a categoria ao lado do nome.

**Plataforma digitada à mão volta para o catálogo.** 5 das 260 respostas de interesse são `is_custom`, sem `platform_id`. Três delas eram só outra grafia de um serviço do catálogo ("Apple music" × "Apple Music", "Duolingo" × "DuoLingo", "TotalPass" × "Totalpass"). Passa a casar pelo nome, sem diferenciar maiúscula/minúscula, o que devolve categoria e ícone — e faz "Duolingo" voltar para o card de cursos.

**Nomes equivalentes deixaram de virar duas barras** — a chave do bucket é o nome canônico do serviço ("TotalPass" e "Totalpass" somam 3, não 2+1).

**"nenhuma" deixou de contar como plataforma.** O gate oferece a opção "Nenhuma destas" e o usuário pode digitar "nenhuma" no campo livre; nos dois casos não é uma plataforma usada ou desejada.

**Percentual com denominador honesto** — a barra agora é relativa a quem respondeu *aquela* pergunta ("23 responderam"), e não a todos os respondentes do onboarding.

### A listagem de respostas

Era uma tabela de 8 colunas (Usuário, Assinaturas, Maior barreira, Já compartilha, Com quem, Interesses, Convidaria, expandir). Oito colunas obrigavam a ler de lado para lado, e a coluna "Interesses" mostrava "2 Netflix, Spotify +3" — que é exatamente o que interessa.

Virou **uma ficha por resposta**:

```
⬤  Sabrina da Costa Marinho                       2 h atrás   ›
   sabrina.marinho94789@gmail.com

   ASSINATURAS 1 a 2   JÁ COMPARTILHA Não   MAIOR BARREIRA Não conheço pessoas para dividir

   QUER DIVIDIR
   Educação e idiomas   (DuoLingo) (Open English)
   Ferramentas          (Canva)
   Filmes e séries      (Netflix) (Paramount+) (Telecine) (Claro TV+) (Apple TV+) …
   Música              (Apple Music) (Amazon Music) (Spotify)

   JÁ USA
   Filmes e séries      (Netflix) (Claro TV+) (Max) (Globoplay)
   Música              (Apple Music) (Spotify)

   CONVIDARIA  (João) (Maria)
```

- Avatar, nome (link para o cadastro), e-mail e tempo relativo.
- Respostas curtas viram etiquetas — sem coluna, sem cabeçalho truncado.
- Plataformas agrupadas por categoria, com o ícone do serviço.
- Expandir a ficha abre as perguntas completas (inclusive a barreira digitada à mão, que não aparecia em lugar nenhum) e oslinks de WhatsApp de quem a pessoa convidaria.
- A busca agora acha por plataforma, não só por nome e e-mail: buscar "duolingo" devolve as 13 respostas com DuoLingo.
- Ordem por data, por nº de plataformas ou por nome.

### Verificação
- `npm run build` limpo.
- Passada visual no dev server local (`:5199`) com a sessão admin: os 4 cards de interesse com as categorias certainas, o card "já usa" com a categoria ao lado de cada nome, o card "Outras plataformas citadas" com 4 digitadas à mão (ByeFIT 3, Totalpass 3, Gympass 1, Wellhub 1), a listagem em fichas, a busca por plataforma e a ficha expandida.
- Console sem erros em `/admin/onboarding`.
- Conferido contra o banco: 255 interesses com `platform_id` (0 órfãos) e 5 sem `platform_id` (`Apple music`, `Duolingo`, `Gympass`, `nenhuma`, `TotalPass`).

### Decisão
O banco não guarda a pergunta de origem do interesse, então uma plataforma digitada à mão **não tem como saber em qual dos 4 cards de interesse foi marcada**. Em vez de adivinhar, essas respostas ficam num card à parte ("Outras plataformas citadas") com a explicação do motivo. O dado continua no banco como está — a correção é só de leitura.

---

## 12.5 Assinatura vencida: pagamento, bloqueio de credenciais e tag (2026-10-24)

### O pedido
Três telas, uma regra só:
1. `/dashboard/billing` — assinatura vencida ganha um **botão dentro do card** ("Pagar assinatura") que gera um pagamento novo (PIX ou crédito) e só atualiza a assinatura **depois** da confirmação.
2. `/dashboard/credentials/[slug]?group=[id]` — com assinatura vencida **ou cancelada**, clicar em "Acessar Credenciais" **não revela nada**: abre um popup explicando a falta de acesso e força o pagamento.
3. Dashboard → "Minhas Assinaturas" — serviço com renovação vencida ganha a tag **"Vencida"**.

### O diagnóstico: "vencida" não é um status
O banco tem 7 assinaturas `status = 'active'` com `next_charge_at` no passado. O status **não muda** quando a renovação atrasa — ele só muda quando o acesso é encerrado de vez. Então "vencida" tem de ser derivada da **data**, não do status:

```js
// src/lib/subscriptionAccess.js
isSubscriptionOverdue(sub)   // active + next_charge_at/expires_at no passado
subscriptionAccessState(sub) // active | overdue | cancelled | pending
```

Regra única, compartilhada pelo card de cobrança, pela página de credenciais e pelo carrossel do dashboard — antes cada tela calculava por conta própria.

### O bug de fundo: colunas que o código escreve e o banco não tem
O sintoma mais visível era o da imagem de referência ("Cobrança ainda não gerada — contate o administrador do grupo"). A causa não era a tela: **nenhuma fatura era criada**.

O PostgREST valida o payload de cada `insert`/`upsert`/`update` contra o schema real. Coluna inexistente → `400 PGRST204` → **a gravação inteira é perdida**, e como os handlers não checam o retorno do `upsert`, nada aparece na tela. Três colunas faltavam no schema de produção:

| tabela | coluna | quem escrevia | efeito |
|---|---|---|---|
| `user_subscriptions` | `payment_method` | 7 arquivos | assinatura nunca criada/ativada |
| `user_subscriptions` | `custom_cycle_label` | 5 handlers | idem (mesmo payload) |
| `invoices` | `payment_method` | `create-payment` | **fatura nunca criada** |

> `check-iopay-tx` também *lía* `payment_method` na assinatura: o `select` falhava, `subInfo` vinha `null`, o ciclo caía no default "monthly" e o `confirmIOPayment` nunca confirmava nada. **O fluxo de assinatura do gateway ativo estava quebrado em produção** — e a renovação dependia dele.

Correção: `database/fix-missing-write-columns.sql` (colunas aditivas, nullable, nenhum dado existente alterado). Para que não volte a acontecer, `scripts/audit-write-columns.mjs` extrai as chaves de todo `insert`/`upsert`/`update` das functions e compara com o `information_schema` — hoje: **0 problemas reais**.

### A renovação
`create-payment` ganhou o modo `renewal: true` (o front manda no body):
- cobra o **valor gravado na assinatura** (`sub.amount`), não `price_per_slot × meses` — no Spotify semiannual é R$ 12,90, não R$ 77,40;
- **não rebaixa** a assinatura para `pending` (ela está em uso; só a renovação está atrasada) e **não avança** `next_charge_at` antes da confirmação;
- preserva `started_at`, `coupon_id`, `discount_amount`, `original_amount` e o ciclo personalizado (`custom_cycle_months/days/label`);
- recusa (404) renovar quem não tem assinatura — sem isso o fluxo cairia em "assinatura nova" e criaria uma segunda linha.

`check-iopay-tx` foi corrigido em dois pontos:
- o atalho "já confirmada" (`sub.status === 'active' && member.payment_status === 'active'`) **curto-circuitava a renovação**: o status continuava `active` durante o atraso, então o poll respondia "já pago" e a renovação nunca era aplicada. Agora ele só curto-circuita se **não** estiver vencida;
- ao confirmar, a **fatura vencida** é baixada: busca as `invoices` pendentes com `due_date <= hoje` do par (usuário, grupo) e quita se a soma bater com o valor pago (ou a de mesmo valor). Fatura de ciclo futuro continua pendente.

`src/components/SubscriptionRenewalModal.jsx` era o modal: PIX (QR + copia-e-cola) ou cartão salvo, polling de `check-iopay-tx` a cada 10s por até 10min e o aviso "a assinatura só é atualizada depois que o pagamento for confirmado". **Hoje a renovação acontece na PÁGINA de checkout** (modo `?renovacao=1`) — o modal continua no repositório, mas nenhuma tela o abre.

### Consequência colateral: o valor do log
`logAttempt` roda no **escopo externo** do handler, onde `subscriptionAmount` valia `price_per_slot × meses`; o bloco do PIX declara uma homonima local. Na renovação o registro em `payment_attempts` gravava R$ 77,40 enquanto o gateway cobrava R$ 12,90. A correção foi tornar o valor externo renewal-aware e alimentar o `authoritativeCoupon` (que já existia para exatamente esse problema de escopo).

### O bug de fuso horário (afetava a tela entregue)
`new Date("2026-04-09")` é meia-noite **UTC**: no Brasil (UTC-3) o dia da cobrança aparecia como **08/04/2026**. Afetava o "Vencimento" do card e a "Renovação" das credenciais. `src/lib/dateFormat.js` resolve: string só com data → mostra o dia exato; timestamptz em meia-noite UTC → usa o dia em UTC; qualquer outro instante → fuso do navegador. E `isSubscriptionOverdue` passou a tratar `expires_at` (coluna `DATE`) como válido **até o fim do dia**.

### O `.btn-outline` invisível
O botão "Agora não" do popup estava branco sobre branco. Causa: várias folhas de CSS do admin definem `.btn-outline { color: var(--text, #e2e8f0) }` e o CSS é global — mas **`--text` nunca foi definido** em lugar nenhum, então o fallback claro vencia em toda a tela clara. 43 usos em 7 arquivos. Corrigido definindo `--text` nos dois temas em `src/index.css` (mais o botão do modal com seletores próprios, para não depender de qual regra global vence).

### Verificação
- `npm run build` limpo.
- `scripts/verify-overdue-ui.mjs` (Playwright, dev server `:5199`): **15/15** — tag "Vencida", botão "Pagar assinatura", "TOTAL A PAGAR R$ 12,90", a nota "Cobrança ainda não gerada" **sumiu**, vencimento 09/04/2026, popup "Renovação em atraso" com o total e sem revelar a senha, tag "Vencida" no carrossel, zero erro de console.
- `scripts/verify-renewal-checkout.mjs`: PIX gerado com **R$ 12,90**, código copia-e-cola, polling ativo e o aviso de confirmação.
- Banco depois da criação do PIX: assinatura segue `active` com `next_charge_at` intacto (2026-04-09), `payment_attempts.amount = 12.90`, fatura do ciclo futuro criada (2027-04-24) e a fatura vencida ainda pendente (é baixada na confirmação).
- `check-iopay-tx` respondendo `status=pending, confirmed=false, amount=12.9` para a transação de teste (o estado correto antes de pagar).
- **Não pago**: confirmar a renovação exige dinheiro real. A transição para "renovada" só acontece com o pagamento de fato.

### Pendências que sobraram desta rodada
- **`payment_attempts.final_amount` não existe** (a coluna é `original_amount`/`discount_amount`). O `check-iopay-tx` faz `select("coupon_id, original_amount, discount_amount, final_amount")` → o `select` inteiro falha e cai no `catch`, então o valor já descontado do cupom nunca é lido. O valor final continua correto porque vem do gateway; o que se perde é a conferência do desconto no histórico. Correção: derivar `final = original - discount` (ou adicionar a coluna).
- **`coupons.status`**: o código de cupom grava `status` numa tabela que só tem `active` (booleano). Não quebrou o iopay (que recalcula o desconto pela tabela `coupons`), mas `manage-coupons`/`check-iopay-tx` escrevem num campo que não existe.
- **Pagamento real não exercitado**: confirmar a renovação exige pagar um PIX de verdade. O caminho até o "pagamento gerado" está verificado; o "confirmado → assinatura renovada" precisa de uma transação paga de fato.

### Decisão
"Assinatura vencida" é um estado **derivado da data**, não do `status` — e essa derivação mora em um arquivo só (`src/lib/subscriptionAccess.js`). A renovação não rebaixa nem avança a assinatura: o acesso continua como está e **a data só anda depois que o dinheiro entra**. O popup de credenciais não é um aviso: é o lugar onde o pagamento é forçado.

---

## 12.6 Fila do operador, aprovação de grupo e e-mail de pagamento (2026-10-25)

### O que foi pedido
1. Grupo criado pelo usuário entra no **topo** da fila do operador, para o admin aprovar como verificado.
2. O grupo **continua visível**, mas fica com status "aguardando aprovação" e **não registra pagamento** até ser aprovado.
3. Cards na Visão Geral (admin) com quantos usuários fizeram **registro** no dia, na semana e no mês, e **quantos seguiraram para a assinatura**.
4. **Overviewer de pagamentos**: a cada pagamento confirmado, um e-mail para `gwmorata@gmail.com` com nome do grupo, nome da pessoa, valor, tipo de pagamento, data e hora.

### O que estava quebrado
- **A fila nunca mostrava os grupos certainos.** O contador do painel usava `.is('approval_status', null)` (7 grupos) enquanto a tela de aprovação (`Platforms.jsx`) filtrava `'pending'`. Resultado: o admin via "7 para aprovar" e não conseguia aprovar nenhum. Os 7 `NULL` eram grupos do **próprio admin**, criados pelo painel, que não gravava `approval_status`.
- **Não existia bloqueio de pagamento** para grupo não aprovado — nem no front, nem no back.
- **E-mail**: a infra é **SMTP direto** (TLS 465, `mail.dividepass.com`), sem provedor transacional; o `SmtpClient` estava duplicado em 3 functions.

### O modelo: `pending` = aguardando aprovação
- `groups.approval_status` usa o enum `group_approval_status` (`pending`/`approved`/`rejected`).
- `NULL` = grupo criado pelo painel admin **antes** do campo existir → backfill para `approved` (todos os `NULL` eram do admin, com membros pagantes). Hoje: **24 grupos, 0 `NULL`, 0 pendentes**.
- O trigger `trg_guard_group_privileged` já forçava `pending` no insert de não-admin e bloqueia a alteração de `verified`/`is_official`/`approval_status`/`owner_id` por não-admin.
- Grupo criado pelo **painel admin** nasce `approved` (`GroupForm.jsx`), porque o admin é o dono da curadoria.

### Fila do operador: grupos no topo e aprovação na mão
`AdminDashboard.jsx` ganhou o bloco **"Grupos aguardando sua aprovação"** como **primeiro item** da fila do operador (antes de tickets, falhas de pagamento e lista de espera), com nome do grupo, serviço, dono, tempo desde a criação e botão **Aprovar** inline.

- **Aprovar** grava `approval_status='approved'` + `approved_at`, registra `platform_events` (`group_approved`) e cria a notificação do dono em `notifications`.
- O item antigo da fila ("Grupos criados por usuário aguardando aprovação → Ver grupos") foi **removido**: ele apontava para `/admin/platforms` e não permitia agir. O contador passou a ser `.eq('approval_status','pending')`.

### Bloqueio de pagamento: o back é a autoridade
- `create-payment/index.ts` busca `groups.approval_status` e devolve **HTTP 403** `{ error, code: "group_not_approved" }` quando ≠ `approved`.
- **Renovação (`body.renewal === true`) não é bloqueada** e **fatura (`payment_type='invoice'`) não é bloqueada** — só a inscrição nova em grupo não aprovado cai.
- O front apenas orienta: badge **"Aguardando aprovação"** no card do catálogo (`Catalog.jsx`) e no cabeçalho do detalhe (`GroupDetail.jsx`), CTAs substituídos por "Aguardando aprovação" e uma tela própria no `Checkout.jsx`.

### Cards de registros na Visão Geral
Duas queries do mês (`users` com `role='user'` e `user_subscriptions`) e janelas calculadas em JS (dia; semana começando na segunda; mês). Três cards novos, no topo dos cards de métrica:

| card | valor | subtítulo |
|---|---|---|
| Registros hoje | usuários criados hoje | quantos viraram assinante hoje |
| Registros na semana | usuários da semana | quantos viraram assinante na semana |
| Registros no mês | usuários do mês | quantos **seguiram para a assinatura** |

A conversão é "usuário registrado no mês que já tem assinatura".

### E-mail a cada pagamento confirmado
- `supabase/functions/_shared/smtp.ts` (novo): `SmtpClient`, `loadSmtpConfig`, `sendMail` — extraído do `send-support-email` para não duplicar a conexão TLS.
- `supabase/functions/_shared/admin-payment-email.ts` (novo): `notifyAdminPayment()` monta o e-mail (HTML + texto) com **grupo, pessoa, valor, tipo de pagamento, forma de pagamento e data/hora**, e grava o log em `email_logs`.
- **Destino**: `app_settings.admin_notification_email` (valor: `gwmorata@gmail.com`), com fallback para o mesmo endereço.
- **Dedup por transação**: `email_logs` com `event_type='admin_payment_notification'` e `raw_event.transaction_id` — a mesma transação nunca gera dois e-mails.
- **Hook nos três caminhos de confirmação**: `check-iopay-tx` (poll do front), `confirm-payment` (webhook) e `force-confirm-payment` (confirmação manual no admin).
- **Falha de e-mail nunca derruba a confirmação** — o `notifyAdminPayment` não lança exceção.

### Bug de produção: o IOPay passou a exigir endereço
O IOPay passou a exigir `address.city`/`address.state` na criação do cliente. O app não manda endereço e a tabela `users` não tem colunas de endereço → o `v1/customer/new` devolvia **HTTP 500 ("Cliente criado sem ID")** e o checkout morria ali. **42 dos 96 usuários não conseguiam pagar.**

Correção em `create-payment/handlers/iopay.ts`: o cliente é criado com `first_name`, `last_name`, `email`, `phone` e `address` com padrão configurável (`app_settings.iopay_default_address_city` / `_state`, padrão `Sao Paulo`/`SP`). **Limitação conhecida**: endereço fiscal provisório até o app coletar o real.

### Bug herdado: `notifications` sem nenhuma policy de RLS
A tabela `notifications` estava com **RLS ligado e zero policies** → o Postgres nega tudo. Todo `supabase.from('notifications').insert(...)` feito pelo app era **descartado em silêncio**, sem erro na tela. Isso atingia `Platforms.jsx`, `Groups.jsx` e também a nova aprovação inline (que nascia sem notificar o dono).

Correção: `database/fix-notifications-rls.sql` — admin gerencia tudo, usuário lê e marca como lida apenas as próprias. Triggers que gravam em `notifications` (ex.: "um membro do seu grupo saiu") não são afetados, porque rodam como dono da função.

### Verificação
- **Playwright** (dev server `:5199`, usuários de teste criados e removidos depois):
  - grupo criado pelo usuário → `approval_status='pending'`;
  - **fila do operador** com o grupo no **topo** e o botão **Aprovar** funcionando (`pending` → `approved` + `approved_at`), com `platform_events` gravado e **notificação criada para o dono**;
  - badge **"Aguardando aprovação"** no card do catálogo e no detalhe do grupo (3 pontos de exibição), **sem CTA de pagamento**;
  - **checkout bloqueado** com a tela "Aguardando aprovação" (rota `/checkout/:slug` e `/dashboard/checkout/:slug`);
  - cards **Registros hoje / na semana / no mês** com a conversão;
  - depois da aprovação: badge some, **checkout libera** e o grupo sai da fila.
- **E-mail real enviado** (function temporária `test-admin-email`, já removida do Supabase **e do repo**): `{"sent":true}` para `gwmorata@gmail.com` com grupo "Spotify 01", pessoa "Jaíne Daniele de Souza", R$ 12,90, tipo `subscription`; a **2ª chamada com a mesma transação** devolveu `{"sent":false}` (dedup confirmado).
- **Back**: grupo `pending` → **HTTP 403** `group_not_approved`; a **renovação no mesmo grupo não é bloqueada**; grupo aprovado segue o fluxo normal.
- **IOPay**: cliente novo (sem `customer_id_iopay`) foi de **HTTP 500 → HTTP 200 com PIX** (R$ 9,90) depois da correção do endereço.
- **Banco depois da limpeza**: 24 grupos, 96 usuários, 0 grupos pendentes, 0 grupos com `approval_status` nulo, trigger `trg_guard_group_privileged` ativo; resíduos de teste (usuários, auth, grupo, notificações, eventos) = **0**.

### Decisão
O grupo pendente **fica visível, mas não aceita dinheiro**. A trava de pagamento mora no **back** (`create-payment`) porque é lá que o dinheiro entra — o front só orienta. "Aguardando aprovação" é um **estado persistido** (`approval_status`), não um cálculo de tela: o admin aprova uma vez e o grupo libera sozinho.

### Pendências que sobraram desta rodada
- **Pagamento real não exercitado**: o ciclo "PIX pago de verdade → assinatura ativa → e-mail ao admin" exige pagar um PIX. O caminho até "pagamento gerado" está verificado.
- **Endereço do cliente IOPay é provisório**: o app não coleta endereço do usuário; hoje sai o padrão de `app_settings`.
- O `SmtpClient` duplicado em `send-support-email`/`send-password-reset`/`test-email` **não** foi refatorado (risco); o módulo novo é usado só pelo caminho novo.
- `notifications.metadata` é `jsonb`, mas o app grava `JSON.stringify(...)` → fica guardado como jsonb do tipo **string**. É a convenção do repo (mantida), mas convém padronizar depois.
- `payment_attempts.final_amount` e `coupons.status` continuam pendentes da rodada 5 (§12.5).

---

## 12.7 Cobrança recorrente, webhook e organização do admin (2026-10-25)

### O que foi pedido
Cobrar as mensalidades automaticamente, destravar o acesso de quem já pagou, corrigir o
valor do popup de renovação e organizar as telas de `admin/billing` + `admin/subscriptions`.

### O webhook nunca confirmava: `maybeSingle()` em coluna não única
`iopay-webhook` lia a tentativa de pagamento com `.maybeSingle()` em
`payment_attempts.gateway_transaction_id` — que **não é única**: o polling do browser
(`check-iopay-tx`) gravava uma linha nova a cada round com o mesmo id. Com 2+ linhas o
PostgREST devolve erro, `data` fica `null` e o webhook respondia **HTTP 200
`{"received":true}` sem confirmar nada**.

Por isso o botão manual ("Eventos > Pagamentos > Verificar no Gateway",
`force-confirm-payment`) funcionava: ele resolve o alvo por `payment_attempts.id` e
não depende do `maybeSingle`.

Correções: busca com `.limit(1)` + `order(created_at desc)`, o polling passa a
**atualizar** a tentativa existente em vez de inserir duplicata, e o log do webhook
também atualiza (a própria linha duplicada envenenava a entrega seguinte).

### Outros pontos que matavam a confirmação
- **Envelope do gateway**: o webhook não desembrulhou `{success:…}`/`{data:…}` →
  `reference_id` vinha `undefined` → early return "Invalid external reference".
- **`payments.method` é ENUM** (`pix|credit_card|bank_slip`). O webhook gravava
  `"unknown"`, `"subscription"` e `"iopay"` → o insert era **rejeitado** → a linha do
  pagamento não existia → a trava de idempotência (que lê `payments`) nunca disparava.
- **`payment_attempts.final_amount` não existe** → o select falhava → o cupom nunca era
  registrado e o `paid_amount` caía no default.
- **Escritas sem checar erro**: `group_members`, `user_subscriptions` e `payments` eram
  gravados sem `.error` → gravação perdida em silêncio. `confirmPayment` agora **retorna
  `{success, error}`** e o webhook registra a falha.
- **`user_subscriptions.service_id` é NOT NULL**: o fallback de criação reprovava e a
  assinatura nunca nascia.
- **Cartão sem `notification_url`**: a transação de cartão era criada sem a URL do
  webhook → a IO Pay **nunca notificava** a confirmação. Corrigido nos 3 blocos
  (fatura, adesão, assinatura).
- **Fatura pelo webhook**: `reference_id = "invoice:<id>"` tem 2 partes e caía no
  early-return de 3 partes. Agora o webhook quita a fatura.

### Por que a cobrança automática não saía
1. **`process-recurring-billing` não estava no `config.toml`** → herdava
   `verify_jwt = true` → o gateway respondia **401 `UNAUTHORIZED_INVALID_JWT_FORMAT`**
   *antes* do código rodar. O cron envia um segredo, não um JWT.
2. **Filtros que excluíam NULL**: `billing_status != 'cancelled'` e `retry_count < 3`
   são NULL em SQL, e o PostgREST filtra as linhas com NULL → assinaturas antigas
   nunca eram cobradas. `next_charge_at` NULL também as escondia.
3. **Skips invisíveis**: sem `customer_id_iopay` / sem cartão / gateway não configurado
   eram só `console.log` + `skipped++`. Agora viram linha em `billing_cycles`
   (`status: 'failed'` + `error_message`) e aparecem na tela de falhas.
4. **`process-overdue-invoices` morria com 500**: o embed
   `subscription:user_subscriptions!inner(...)` é inválido — `invoices` não tem
   `subscription_id` nem FK. O job inteiro não processava nenhuma fatura.

### O preço do ciclo: `amount` é o TOTAL, `price_per_slot` é o MENSAL
`user_subscriptions.amount` significa **total do ciclo** (Spotify semestral = R$ 12,90
pelo semestre). `groups.price_per_slot` é o **preço mensal** da vaga.

O `SubscriptionEdit` gravava `amount = groups.price_per_slot` ao transferir a
assinatura para outro grupo → o campo do ciclo passava a valer o preço mensal, e o
popup cobrava R$ 69,90 num ciclo semestral de R$ 11,65/mês.

Agora o total é sempre **preço mensal × meses do ciclo**, no front (popup) e no back
(`create-payment`, caminhos PIX e cartão), com o cupom recalculado pelo servidor.

### O popup de renovação
- Seletor de ciclo **marcado no ciclo que a pessoa já tinha**, limitado aos ciclos do
  grupo (`groups.available_cycles`).
- Resumo: preço mensal → ciclo (n meses) → desconto → **total**.
- Campo de cupom (valida contra `coupons`, que é legível por policy "Anyone can
  validate coupon code") e seletor de cartão.

### O painel de cron era ficção
`manage-crons` listava jobs com a RPC `exec_sql`, que **não existe** (404) → o fallback
devolvia uma lista **inventada** de 3 jobs, sempre "Ativos". Agora usa as RPCs estreitas
`manage_cron_jobs()` / `toggle_cron_job()` (`database/add-cron-management.sql`), e
quando o banco não responde a tela diz que não sabe — em vez de inventar.

"Detalhes do Cron" contava `invoices` com `status='pending'` **sem filtro de
vencimento** (por isso as "46 Faturas vencidas") e não mostrava **quem** eram. Agora
filtra por vencimento real e lista nome, e-mail, grupo, valor, dias de atraso e a
assinatura relacionada.

### `cron.job` não tem `next_run` nem `description`
**RLS/migration — a armadilha do `CREATE OR REPLACE`:** a RPC antiga (8 colunas)
**foi criada com sucesso** apesar de referenciar `j.next_run` — em PL/pgSQL o
corpo **só é validado na primeira execução**, não no `CREATE`. Por isso a
correção seguinte esbarrou em `42P13: cannot change return type of existing
function` (o Postgres não deixa trocar a assinatura de retorno / OUT params).
O script agora faz `DROP FUNCTION IF EXISTS` + `CREATE` (fica reexecutável) e
fecha com `NOTIFY pgrst, 'reload schema';` — sem isso o PostgREST continua
servindo a assinatura antiga no cache e o painel de cron fica "indisponível".

Lição geral: **"a função foi criada" não prova que ela funciona**. Uma RPC com
coluna inexistente só estoura quando alguém chama.

O primeiro `activate-all-crons.sql` morreu com `42703: column "next_run" does not
exist`. O `cron.job` do pg_cron do Supabase tem só `jobid, jobname, schedule,
command, nodename, nodeport, database, username, active, jobtype` — o **próximo
disparo é calculado pelo pg_cron, não é gravado**. A RPC `manage_cron_jobs()`
também referenciava `j.next_run` e `j.description`, então **nem chegava a ser
criada** (a RPC é validada no momento do `CREATE`).

Duas lições:
1. Como o SQL Editor roda o script numa transação, **o erro no fim derrubou
   tudo** — os três agendamentos criados antes também voltaram. O script é
   idempotente (desagenda antes de agendar), então basta rodar de novo.
2. `next_run` e `description` passaram a ser **calculados na edge function**
   (`getNextRun(schedule)` + um mapa `CRON_META`), e o "Detalhes do Cron" lê o
   `schedule` real do banco em vez de mostrar um valor fixo.

### A linha de criação do pagamento é a mais antiga
`payment_attempts` guarda **duas** informações em linhas diferentes: a de
**criação** (tem `external_reference`, `coupon_id`, `original_amount`,
`discount_amount`) e as de **polling** (só status e valor). Buscar com
`order(created_at desc)` pegava a de polling — que não tem `coupon_id` — e o
cupom **nunca** era registrado.

O polling agora **atualiza** a linha de criação (uma linha por transação) e
todas as buscas apontam para a mais antiga. A limpeza de duplicatas em
`fix-recurring-billing.sql` só remove linhas **sem** `external_reference`, para
não apagar justamente a linha que guarda o cupom.

### Decisão
Uma só implementação de confirmação, usada por webhook, polling e botão manual — o
diferencial entre o caminho automático e o manual era **a causa** do bug, não um
detalhe. E preço de ciclo é uma fórmula única (mensal × meses), nunca um campo que
depende de quem escreveu.

### Pendências que sobraram desta rodada
- **Crons não verificados em produção**: `database/activate-all-crons.sql` agenda os
  três jobs; falta rodar no SQL Editor e confirmar com `SELECT * FROM cron.job`.
- **RPCs novas precisam ser aplicadas**: `database/add-cron-management.sql` e
  `database/fix-recurring-billing.sql`.
- **Funções de cron precisam ser redeployadas** com `verify_jwt = false`
  (`supabase/config.toml` agora declara; no deploy, `--no-verify-jwt`).
- **Assinaturas com `amount` errado** (gravadas pelo `SubscriptionEdit` antigo) não
  foram corrigidas em lote: o próximo ciclo de cobrança recalcula o valor, mas o
  admin pode querer um backfill.
- **`cycle_discount` é gravado e nunca aplicado** em lugar nenhum do cálculo de preço
  (só informado na tela de edição).

---

## 12.8 Carteiras e repasse dos grupos de terceiros (2026-10-25)

### O sintoma
`/admin/wallets` mostrava tudo zerado: 0 saques pendentes/realizados/recusados e
`R$ 2,28` de "Saldo Total Usuários" — mesmo com **R$ 748,50** já recebidos
(31 pagamentos pagos, visíveis na aba Financeiro).

### O que estava realmente quebrado (medido em produção, sessão admin)

| # | Achado | Evidência |
|---|---|---|
| 1 | **O caminho que grava o pagamento não credita a carteira.** O checkout/polling usa `check-iopay-tx`, que insere a linha em `payments` com `status='paid'` e **nunca chama `credit_wallet`**. Só o webhook (`confirm-payment`) creditava. | `supabase/functions/check-iopay-tx/index.ts` — nenhum `credit_wallet` no arquivo |
| 2 | **No webhook, o crédito falhava mesmo.** `credit_wallet(p_reference_id UUID)` recebia o **id do gateway** (numérico em iopay/MP/stripe) → `22P02 invalid input syntax for type uuid`, engolido no `catch`. Só passavam os gateways com id em UUID (2 pagamentos de R$ 1,00 → R$ 0,91 cada = R$ 1,82). | `confirm-payment/index.ts` (4 blocos de crédito) |
| 3 | **`wallet_withdrawals` nunca teve `pix_key`/`pix_type`/`bank_*`.** O app envia essas colunas no pedido de saque → `PGRST204 / 42703` ⇒ **todo pedido de saque falhava**. Também não existia `created_at` (o front ordenava por ela). | sonda 42703 via anon key |
| 4 | **Falta de linha em `public.users` barra o crédito pela FK.** `user_wallets.user_id` e `wallet_transactions.user_id` referenciam `users(id)`; o trigger de cadastro (`handle_new_user`) está definido em 3 lugares divergentes e falhou numa janela, deixando usuários só no Auth. | `add-user-groups-and-wallet.sql:25,34` |
| 5 | **"Marcar como pago" do admin debitava em duplicidade** e inseria em `wallet_transactions` a partir do browser — tabela com `INSERT` revogado (o insert falhava em silêncio). | `Wallets.jsx` (handleMarkPaid) |
| 6 | **`process-recurring-billing` tinha a condição invertida**: creditava quando `group.is_official` (grupo da plataforma) e pulava o grupo de terceiro. | `process-recurring-billing/index.ts:690` |
| 7 | **Policy de INSERT sobrando em `wallet_transactions`** ("Service role can insert wallet transactions", `WITH CHECK (true)` sem `TO`): qualquer autenticado podia forjar movimentação na própria carteira. | `supabase/migrations/20260724000000_add_wallet_insert_policies.sql` |

### A verdade sobre os números
Os **6 grupos com movimento** (Painel, Grupo 3, Max, ByeFIT, Wellhub, Grupo3) são
**da própria plataforma** (dono = `admin@dividepass.com`). Os R$ 748,50 recebidos
são 100% receita da plataforma; **nenhum grupo de terceiro recebeu pagamento
ainda** (Pedro Marques e Damares têm grupos, mas sem pagamento). Por isso
"A Repassar" de terceiro é R$ 0,00 — e os R$ 2,28 de saldo são o resto de dois
créditos parciais que escaparam do bug.

### O que foi feito
- **`database/fix-wallet-repasse.sql`** (SQL Editor): colunas que faltam em
  `wallet_withdrawals`; repõe `public.users` a partir de `auth.users`;
  **trigger `trg_credit_wallet_on_payment`** que credita a carteira do dono
  quando o pagamento vira `paid` (vale para *todo* caminho de pagamento);
  RPCs `request_withdrawal` (reserva saldo) e `process_withdrawal` (admin paga
  ou rejeita); fecha a policy de INSERT em `wallet_transactions`.
- **`database/backfill-wallet-repasse.sql`**: repasse retroativo dos pagamentos
  já feitos, com prévia (`v_do_it = FALSE`) e quebra de duplicidade.
- **Front** (deploy `dpl_911g7npkz`): abas **"Repasse por grupo"** e
  **"Carteiras"**, "Lucro da Plataforma" no lugar do "Lucro Líquido" (que
  contava dinheiro de terceiro como lucro), chave PIX visível no pedido de
  saque, e o saque do usuário (`Wallet.jsx`) funcionando.
- **Edge functions**: o crédito saiu do código (confirm-payment,
  mercado-pago-webhook, process-recurring-billing) — o banco é a fonte única.

### Pendências desta rodada
- Rodar `fix-wallet-repasse.sql` e depois `backfill-wallet-repasse.sql` (com
  `v_do_it = TRUE`) no SQL Editor do Supabase.
- **Deploy das edge functions** (a CLI não tem acesso à org do projeto): sem
  isso, o `credit_wallet` continua sendo chamado pelo webhook e o
  `REVOKE ... FROM service_role` (feito no script) devolve erro 42501 — inofensivo
  porque o trigger já creditou, mas o log fica sujo.
- Se rodar `fix-p0-security.sql` de novo, rodar o `fix-wallet-repasse.sql`
  **depois** (o P0 restaura `GRANT EXECUTE ON ALL FUNCTIONS TO service_role`).

---

## 13. Perguntas em aberto — respondidas

1. **Quais cron jobs estão realmente agendados?** `exec_sql` não existe (404) → `manage-crons` list/toggle degradam. Em produção existem `BILLING_CRON_SECRET` e `OVERDUE_CRON_SECRET` (rotacionados). **Continua em aberto:** quais jobs estão de fato agendados no `pg_cron`.
2. **Qual `is_admin()` está ativa** (JWT vs `users.role`)? Agora é **uma só, unificada**: JWT `app_metadata.role = 'admin` **ou** `public.users.role = 'admin'`. Vale para todas as policies do banco. `manage-survey` foi alinhado com ela.
3. **`user_wallets` já foi explorada?** A duplicata em `payments` mostra que o replay chegou a rodar, e o `credit_wallet` era cego. Não dá para provar retroativamente sem cruzar `wallet_transactions` × `payments` — é a pendência 7.
4. **`payments` tem `UNIQUE` em `external_reference`?** **Não tinha** — o replay duplicava pagamento sem nenhuma barreira de banco. Agora existe o trigger `guard_duplicate_paid_payment` (o índice único parcial só entraria se não houvesse as 3 duplicatas legadas).
5. **`MP_WEBHOOK_SECRET` está definido?** Sim, e a validação está ativa ✅.
6. **`transaction_code` preenchido no fluxo de adesão?** Sim, e é a chave usada pela trava de replay.
7. **`sb_secret_…` do projeto** — nesta sessão foi criado um **PAT de projeto** (não é chave de API); deve ser revogado ao final (pendência 2).

---

## 14. Redesenho do `/dashboard` e da landing `/` (2026-10-27)

Rodada de UI/UX: 22 verificações automatizadas (Playwright) rodando em
**produção** contra `https://dividepass.com`, todas verdes.

### A FAQ da landing vazava: era colisão de CSS, não a animação

O sintoma era "a resposta aparecia por trás do item fechado". A animação
(`grid-template-rows: 0fr → 1fr`) estava certa — o problema era outro:

**`src/pages/SeoPages.css` define classes `.faq-*` GLOBAIS** (`.faq-item`,
`.faq-question`, `.faq-answer`, `.faq-answer p`, `.faq-question svg`…). Como
o bundle é único (`build.codeSplitting: false`), essas regras vazam para
todas as telas, inclusive a landing. E `.faq-answer { padding: 0 1.25rem 1.1rem;
animation: faqSlideDown }` do SeoPages **sempre renderiza** a resposta —
daí o texto vazando.

**Regra.** Classe de CSS com nome genérico precisa ser escopada por página.
Na landing as regras foram escopadas sob `.home-container` (`.home-container
.faq-item`, `[data-theme="light"] .home-container .faq-item-open .faq-toggle`,
…). Alternativa seria renomear as classes, mas escopar é menos invasivo.

**Como isso hide**: o `SeoPages.css` também trazia `.faq-question:hover
{ color: #c7d2fe }` e `.faq-question svg { color: rgba(255,255,255,0.3) }` —
no tema claro o chevron ficava branco sobre branco (invisível) e o texto
hover ficava lilás washed-out. Os dois sintomas eram o mesmo bug.

### Fotos de usuário: a tabela `users` é inacessível para visitante

`GET /rest/v1/users` com a anon key devolve **`[]`** (RLS) — logo
`users.avatar_url` **nunca** chega na landing pública, e o contador de
"pessoas entraram neste mês" é sempre 0. A **única** fonte de foto real
lida pelo anon é **`testimonials.avatar_url`** (aprovados). O hero e os
depoimentos passaram a buscar as fotos de lá, com o avatar do perfil como
complemento.

### O `.main-content` corta o que passa da margem

`src/pages/user/UserLayout.css` tem `.main-content { overflow-x: hidden }`:
overflow **não** vira scroll, vira **corte**. O sintoma "passa da margem" é
conteúdo cortado, não barra de rolagem. O `.main-content` encolhe e o
título de saudação (que traz o e-mail) estourava 71px a 390px.

**Como medir overflow de verdade** (`node .tmp-verify/visual-local.mjs`):
para cada elemento, achar o **ancestral que recorta** (`overflow-x` != visible).
Se for `auto/scroll` é carrossel (ok). Se for `hidden/clip` e o elemento
passa da borda do ancestral → **conteúdo cortado = bug**. Checar só
`documentElement.scrollWidth` não basta: o corte acontece dentro do
container, a página não ganha scroll.

### Tokens `--home-*` presos no tema escuro

`--home-*` (usados pela landing) só mudam dentro de `.home-container`. A
seção de economia do dashboard herdava esses tokens → **os cards ficavam
sempre escuros**, mesmo no tema claro. Remapeados para os tokens do app
(`--surface`, `--border`, `--text-main`…).

### Versionamento voltou a contar

`APP_VERSION = '1.0.0.2'` era literal em `UserLayout.jsx` e
`AdminLayout.jsx` desde o commit inicial. Agora:
- `scripts/set-version.mjs` (roda no `prebuild`) grava `src/version.json`
  com `1.0.<nº de commits>` + sha;
- `vite.config.js` injeta `__APP_VERSION__` no bundle com a ordem:
  `APP_VERSION` (env) → `src/version.json` → `git rev-list --count HEAD` →
  `package.json`;
- `src/lib/version.js` exporta `APP_VERSION` para os dois layouts.

Cada commit/release sobe o número (hoje `v1.0.41`). No build da Vercel não
há histórico git → o `src/version.json` enviado é preservado (comportamento
esperado, log `[version] mantida … sem historico git completo`).

### Como Funciona: 4 passos + card de destaque

A section tinha grid de **5 colunas** (4 passos + card "Já tem uma
assinatura?"). Ao virar 4 passos, o card de destaque **sumiu do desktop**
(ele vivia dentro do wrapper mobile). Agora o card é um elemento solto
(existe nos dois breakpoints) e, no desktop, vira uma faixa horizontal
`ícone | texto | ação`.

---

## 15. Selos do grupo: verificado, anúncios e tipo de conta (2026-10-27)

O dono pediu três coisas no card do grupo (catálogo/dashboard):
1. **mais destaque para grupo verificado** (tag "Verificado pela DividePass",
   porque compra verificada é compra mais segura);
2. **tag de anúncio** — o grupo tem que dizer se a assinatura **tem** ou
   **não tem** anúncios, com um seletor em `/admin/groups/new`,
   `/admin/groups/[id]/edit` e `/dashboard/my-groups/create`;
3. **logo da DividePass** no lugar do "DP" de texto no grupo oficial.

### Nova coluna `groups.has_ads`

`database/add-group-has-ads.sql`: `boolean` **nullable**.
`true` = com anúncios, `false` = sem anúncios, `NULL` = **não mostrar**
(o grupo fica **sem selo** no card — melhor que mentir).

> Decisão do dono: o seletor tem **3 opções** — "Com anúncios",
> "Sem anúncios" e **"Não mostrar"** — e **"Não mostrar" vem pré-selecionado**
> por padrão. Ou seja: `NULL` deixou de ser "não informado" e passou a ser
> uma **escolha** ("não quero selo"). Consequência: o campo `has_ads` é
> **sempre enviado** no INSERT/UPDATE (inclusive `null`), senão um grupo que
> antes tinha "Sem anúncios" continuaria exibindo o selo antigo quando o
> dono voltasse para "Não mostrar".

A coluna **não** entra na lista de campos privilegiados do trigger
`guard_group_privileged_fields`: quem cria o grupo escolhe, o admin corrige
depois. Não existe moderação nesse campo.

### Como o front lida com a coluna ainda não existir

O front **não pode** mandar `has_ads` antes da migration: o PostgREST
devolve 42703 e o cadastro do grupo inteiro quebra. Ordem segura:

1. `src/lib/groupHasAds.js` → `hasAdsColumnAvailable()` sonda
   `select('*').limit(1)` e olha se `'has_ads' in row` (sonda **sem erro no
   console** — filtrar por coluna inexistente geraria 400 a cada load).
   Só cacheia resposta **positiva**: sem linhas não dá para provar que a
   coluna existe, então o seletor fica escondido (nada quebra).
2. `isMissingHasAdsColumn(error)` — se o banco responder 42703/PGRST204, o
   insert/update é **refeito sem o campo** e o seletor se desliga.
3. No wizard, depois que o rascunho é criado, a sonda roda de novo (agora há
   uma linha visível) e libera o seletor da etapa 3.

### Componentes novos (reusados em 4 telas)

- `src/components/GroupTags.jsx` — selos do grupo: **Verificado pela
  DividePass** (verde, o mais forte), **Sem anúncios** (verde),
  **Com anúncios** (âmbar) e **tipo de conta** (neutro). Props:
  `size`, `showPlanType`, `showVerified`.
- `src/components/AdsToggle.jsx` — o seletor "a conta compartilhada tem
  anúncios?" com **3 opções** (Com anúncios / Sem anúncios / **Não
  mostrar**), usado no wizard (etapa 3, logo abaixo do tipo de conta) e no
  painel admin. "Não mostrar" = `null` = grupo sem selo.

### Onde os selos aparecem

| Tela | O que mudou |
|---|---|
| Catálogo (`/dashboard/catalog/:id`) | selo de verificado **no lugar** do checkzinho, tag de anúncios, tag de tipo de conta, card verificado ganha fio verde, **logo da DividePass** no grupo oficial |
| Detalhe do grupo | badge "Verificado pela DividePass" (verde preenchido) + tags de anúncio/tipo |
| Meus Grupos | tags de verificado/anúncios/tipo de conta |
| Wizard etapa 3 | seletor "A conta compartilhada tem anúncios?" com "Não mostrar" pré-selecionado (não trava o avanço) |
| Admin criar/editar | mesmo seletor, logo abaixo do tipo de conta |

O grupo oficial usa o **logo** (`src/assets/logo.png`) num chip
quadrado (o mark tem pontas que um círculo cortaria) — e a busca do
"admin_user" no catálogo foi removida (não existia mais usage).

### Como testar antes da migration rodar

`node .tmp-verify/visual-tags.mjs` intercepta `rest/v1/groups` e injeta
`has_ads` no retorno (GET) + aceita a escrita (PATCH/POST) — simulando o
banco com a coluna aplicada. `node .tmp-verify/visual-tags-sem-coluna.mjs`
faz o contrário: banco **sem** a coluna, garantindo que o seletor some,
nenhum payload leve `has_ads` e nenhum erro 42703 apareça.

---

## 16. Status da assinatura: ATIVA, ATRASADA e CANCELADA (2026-10-27)

Rodada pedida pelo usuário: reduzir os status de assinatura ao que é
realmente necessário e definir **quando** cada um acontece.

### A regra (4 estados, derivados da data)

| Estado | Quando | Aparece em "Meus Grupos" / "Assinaturas Ativas" | Aparece no Histórico |
|---|---|---|---|
| **Ativa** | data de renovação > agora | sim | sim |
| **Atrasada** (vencida) | renovação < agora, **até 7 dias** de carência | sim (com card de renovação + botão de pagamento) | sim |
| **Cancelada** | passou de 7 dias de atraso | **não** | **sim** |
| **Pendente** | pagamento em aberto | sim | sim |

Sumiu do painel: *Inativa* e *Expirada*. Os legados `expired` e `inactive`
viram ATRASADA ou CANCELADA conforme a data — a UI só fala os 4 estados.

**Durante a carência a assinatura continua `status='active'` no banco.**
O estado ATRASADA é *derivado da data*, não do status. Motivo: a cobrança
automática ainda precisa tentar o cartão; se o banco já dissesse
"cancelada", a rotina recorrente pararia cedo demais.

### Fonte de verdade: `renewal_due_at` (coluna nova)

| Coluna | Comportamento | Usada como data de renovação? |
|---|---|---|
| `renewal_due_at` (nova) | só é gravada no **pagamento aprovado** (data + ciclo) | **sim** |
| `next_charge_at` | anda a cada retry de cartão | não |
| `expires_at` | legada (DATE) | fallback |

O `next_charge_at` **não serve**: em cada retry ele avança e encurtaria a
carência dos 7 dias. `renewal_due_at` só muda quando o dinheiro entra.

### Contrato de domínio (front) — `src/lib/subscriptionAccess.js`

Fonte única da regra no front (nada de calcular data dentro do componente):

- `OVERDUE_GRACE_DAYS = 7` e `RENEWAL_REMINDER_DAYS = 2`
- `subscriptionAccessState(sub)` → `ativa | atrasada | cancelada | pendente`
- `isSubscriptionOverdue`, `isSubscriptionPastGrace`, `isSubscriptionCancelled`
- `daysUntilRenewal`, `needsRenewalReminder` (dispara com 2 dias)
- `isSubscriptionVisible` (a cancelada some das listas, mas fica no histórico)
- `renewalDeadline`, `subscriptionRenewalDate`

### Lifecycle (back) — `supabase/functions/_shared/subscriptionLifecycle.ts`

Mesma semântica dos 7 dias, do lado do servidor:

- `renewalDueAt(sub)` / `isOverdue` / `isPastGrace` / `graceEnd`
- `cancelSubscription(...)` → assinatura `cancelled` + **desvincula o membro**
  (`group_members.status/payment_status='cancelled'`, `left_at`) + cancela os
  `billing_cycles` pendentes/failed/retrying + activity log + notificação
  (usuário + dono do grupo)
- `applySubscriptionLifecycle(...)` → marca membro `overdue` e normaliza
  legado `expired` → `active` enquanto ainda dentro da carência

### Crons

| Cron | Hora UTC | O que faz agora |
|---|---|---|
| `update-subscription-statuses` | 03h | aplica o lifecycle; **não** mais marca `expired` por membro `overdue` (para a atrasada continuar visível); cancela assinatura de membro cancelado; reativa `expired` quando o membro volta a `active` |
| `process-overdue-invoices` | 06h | fatura vencida → `failed`; membro → `overdue`; chama o lifecycle no fim |
| `process-recurring-billing` | 14h | na 3ª falha de cartão **não** cancela nem desvincula (fica `status='active'`, `billing_status='cancelled'`, membro `overdue`) — para de cobrar o cartão recusado sem danificar a carência |

### Pagamento aprovado (`transaction.succeeded`)

Todos os caminhos de aprovação gravam a renovação e religam a assinatura:
`check-iopay-tx`, `confirm-payment`, `force-confirm-payment`,
`mercado-pago-webhook`, `create-payment/handlers/iopay`.

- `renewal_due_at = data do pagamento + ciclo`
- assinatura volta para `status='active'`
- `check-iopay-tx` religa o membro: `status/payment_status='active'`, `left_at=null`

### Card de renovação

Novo componente `src/components/RenewalReminderCard.jsx` (+ `.css`).
Aparece quando faltam **2 dias** para o vencimento **e** durante toda a
carência (vencida), com botão que leva para a **página de checkout** no modo
renovação (`?renovacao=1`) — antes abria o `SubscriptionRenewalModal`.
Entrou em `SubscriptionsCarousel`, `Billing`, `SubscriptionManage`
e `ServiceCredentials`.

### Bug corrigido no caminho

`process-overdue-invoices` **resetava a senha da credencial de todo o grupo**
quando um membro ficava overdue. Agora filtra por `assigned_to` — só a linha
do membro afetado é regenerada.

### Filtros do painel admin (`src/pages/admin/Subscriptions.jsx`)

`Todas · Ativas · Atenção · Pendentes · Canceladas`. "Canceladas" é o status
terminal de verdade (`cancelled` + o legado `inactive`); a atrasada legada
(`expired`) fica em "Atenção", porque ainda dá para renovar. Os cards
"Inativas" e "Expiradas" foram removidos e a métrica "Canceladas" ficou
unificada.

### Ordem de publicação (obrigatória)

1. **SQL** — `database/subscription-status-rules.sql` (cria `renewal_due_at`,
   faz backfill, normaliza os legados, cria 4 índices)
2. **Edge functions** — deploy das 8 functions alteradas
3. **Front** — deploy do front

> Se o front subir antes do SQL, o PostgREST devolve **42703** (coluna
> inexistente) e as telas de assinatura quebram.

### Arquivos tocados nesta rodada

- Contrato e filtros: `src/lib/subscriptionAccess.js`, `src/lib/subscriptionFilters.js`,
  `src/lib/subscriptionWindows.js`
- Admin: `src/pages/admin/Subscriptions.jsx`,
  `src/pages/admin/billing/BillingDashboard.jsx`
- Front: `src/components/RenewalReminderCard.jsx|.css`,
  `src/components/SubscriptionsCarousel.jsx|.css`,
  `src/pages/user/Billing.jsx|.css`, `SubscriptionHistory.jsx|.css`,
  `SubscriptionManage.jsx|.css`, `ServiceCredentials.jsx|.css`,
  `src/hooks/useAppData.js` (derivou `visibleSubscriptions`; a query busca
  `active` + o legado `expired`)
- Back: `supabase/functions/_shared/subscriptionLifecycle.ts` (novo),
  `update-subscription-statuses`, `process-overdue-invoices`,
  `process-recurring-billing`, `check-iopay-tx`, `confirm-payment`,
  `force-confirm-payment`, `mercado-pago-webhook`, `create-payment/handlers/iopay`
- SQL: `database/subscription-status-rules.sql` (novo)

### Auditoria independente (verifier) e correções

Uma revisão independente do conjunto (só leitura) não achou nenhum bug
**crítico** ou **alto** — os 5 requisitos foram confirmados com evidência linha
a linha. Apontou 3 médias e 6 baixas, **todas corrigidas**:

| Achado | Correção |
|---|---|
| `ServiceCredentials.jsx` não checava `subRes.error`: se a coluna `renewal_due_at` não existisse (ordem de publicação errada), `sub = null` e o código caía em "sem assinatura → libera" — **fail-open**, entregando credencial de assinatura vencida | erro de consulta agora **bloqueia** o acesso (fail-closed, igual ao `catch`) |
| `BillingDashboard.jsx` contava "Vencidas" por `next_charge_at`: depois do primeiro retry a contagem zerava, divergindo do painel de Assinaturas | passa a usar o filtro compartilhado `attentionServerFilter` (data de vencimento + fallback) |
| A query do front buscava só `status = 'active'`: a **atrasada** legada (`expired`) ficava invisível até o job das 03h normalizá-la — e o card de renovação sumia junto | a query busca `active` + `expired`; o estado exibido continua sendo o derivado |
| `confirm-payment` / `force-confirm-payment` religavam o membro sem zerar `left_at` (o cancelamento por carência grava `left_at`) | `left_at: null` ao religar o vínculo |
| Cancelamento pelo painel admin não cancelava `billing_cycles` e usava `status = 'inactive'` no membro (que a tela de credenciais não bloqueia) | cancela os `billing_cycles` pendentes/failed/retrying, `billing_status = 'cancelled'` e membro `cancelled` + `payment_status = 'cancelled'` |
| `'expired'` entrava em "Atenção" **e** em "Canceladas" ao mesmo tempo | `CANCELLED_STATUSES` passou a ser `['cancelled','inactive']` (terminal de verdade) e `LISTED_STATUSES` = `['active','expired','pending']` (a atrasada é "Atenção", não "Cancelada") |
| Datas calculadas por fora do domínio: `admin/Subscriptions.jsx` (`dueDate`, `isRenewalSoon`), `subscriptionFilters.js` (janela de renovação + ordenação) e `Billing.jsx` (vencimento exibido) | todas passam a usar `renewalDeadline` / `subscriptionRenewalDate` / `renewal_due_at` |

### Armadilha: dois enums com nomes parecidos (22P02)

`billing_cycles.status` **não** aceita `'retrying'`. São dois enums
diferentes:

| Coluna | Enum | Valores |
|---|---|---|
| `user_subscriptions.billing_status` | `subscription_billing_status` | `active`, **`retrying`**, `cancelled` |
| `billing_cycles.status` | `billing_status` | `pending`, `processing`, `approved`, `failed`, `cancelled` |
| `user_subscriptions.status` | `subscription_status` | `active`, `inactive`, `cancelled`, `expired`, `pending` |
| `group_members.payment_status` | `payment_flow_status` | `first_attempt`, `awaiting_entrance`, `entrance_paid`, `awaiting_subscription`, `active`, `expired`, `overdue`, `refunded`, `cancelled` |

O "em retry" da ASSINATICA é `user_subscriptions.billing_status =
'retrying'`; no CICLO de cobrança o retry é `status = 'failed'` com
`next_retry_at` preenchido (daí o índice `idx_billing_cycles_next_retry ... WHERE
status = 'failed'`).

Usar `'retrying'` no ciclo dá **22P02 invalid input value for enum
billing_status**. Isso já pegou em 3 lugares (a migration, o
`subscriptionLifecycle` e o cancelamento pelo admin) — no backend a falha era
**silenciosa**, porque o `update()` do supabase-js devolve `{ error }` em vez
de lançar: as crons continuavam pendentes e ninguém via o erro.

**Ainda vai cobrar** = `pending` (agendado) + `processing` (em voo) + `failed`
(recusado, com retry marcado).

**Status:** implementado e validado (`npm run build` ✅, `node --check` nas 9
functions ✅, eslint limpo nos arquivos alterados — os erros restantes são
pré-existentes e não têm relação com esta rodada).

**Status da publicação (27/10/2026, 21h):**

| Etapa | Estado |
|---|---|
| SQL (`database/subscription-status-rules.sql`) | ✅ **aplicado** — confirmado por sonda no banco: a coluna `renewal_due_at` responde sem 42703 |
| Front (Vercel) | ✅ **publicado** — `https://dividepass.com`, bundle novo com `renewal_due_at` e o card de renovação |
| Edge functions | ⏳ **pendente** — os arquivos de arquivo único estão prontos em `.tmp-verify/painel/` (ver `LEIA-ME.md` nessa pasta) |

Sobre as edge functions: várias delas importam código de outras pastas
(`../_shared/…`, `./handlers/…`) e o editor do painel do Supabase edita o
entrypoint. `scripts/empacotar-function-painel.mjs` embute cada módulo num
namespace e gera um **arquivo único** por função — assim o arquivo colado não
depende de nenhuma pasta e funciona mesmo se o editor for de arquivo único.
`scripts/validar-arquivos-painel.mjs` confere sintaxe, consistência dos
namespaces, ausência de import local pendente e o enum de `billing_cycles`.

**Armadilha do deploy manual:** `confirm-payment` **não é uma função** — é uma
biblioteca que exporta `confirmPayment` e é embutida dentro dos webhooks
(asaas, iopay, mercado-pago, pagarme, stripe). O `confirmPayment` novo já vai
dentro deles; não há o que colar no painel. E nas funções de cron o interruptor
**Verify JWT** do painel precisa continuar **desligado** — ligado, o gateway
devolve 401 antes do código rodar e a cobrança recorrente nunca acontece.

`node .tmp-verify/regra-status-teste.mjs` roda a regra do front contra os 28
casos do requisito (limite de 7 dias, fallback de data, visibilidade,
card de 2 dias) — **todos passam**.

---

## 16. Origem do lead (Totens / TVs) + card no admin + WhatsApp (2026-10-28)

O dono pediu: (1) **Totens** e **TVs Publicidades** na etapa 4 do `/register`;
(2) o card "onde nos achou" dentro de `/admin/onboarding`, porque a origem do
lead é dado de negócio; (3) um **botão de WhatsApp** que já abre a conversa
com o texto pronto.

### A origem do lead mora em `users`, não no onboarding

A pergunta "como você conheceu a DividePass?" é a **etapa 4 do `/register`**
(antes do onboarding) e grava em `users.lead_source` +
`users.lead_source_other` (via metadata do `auth.signUp` → trigger
`on_auth_user_created`). O relatório de onboarding lê essa coluna.

**Detalhe que importa:** o card conta **todos** os usuários que responderam
(`users`), não só quem respondeu o onboarding — a pergunta é feita no
cadastro, antes do fluxo de qualificação.

"Outro" vira rótulo próprio na barra (`Outro: num shopping`), porque o
texto digitado é a informação útil.

### Botão de WhatsApp

`src/lib/leadWhatsapp.js` (import com `.js` explícito — mesmo padrão de
`src/lib/evolutionMetrics.js` — para o módulo poder ser testado em node
puro). A mensagem é a do dono, com dois campos dinâmicos:

- `[nome_cliente]` → primeiro nome (só o primeiro: "Eai Michael tudo bem?").
- `[nomes_das_plataformas]` → plataformas de "Quer dividir"; se não houver,
  cai para "Já usa"; se não houver nenhuma, a frase vira genérica
  ("dividir assinaturas") para não sobrar "as assinatura ," quebrado.

`buildLeadWhatsappUrl()` devolve `null` quando o telefone não é utilizável
(menos de 10 dígitos) — o botão **some** em vez de abrir conversa quebrada.
`phoneToWhatsApp` é tolerante (aceita qualquer coisa com dígito), então a
validação do tamanho fica no `leadWhatsapp`.

### Como testar o painel admin sem conta admin

Não dá para auto-promover usuário (`PATCH role=admin` → 403). O truque do
teste: interceptar o REST do Playwright e injetar `role: 'admin'` na
resposta do **perfil** (`/rest/v1/users?id=eq.<uid>`), devolvendo uma lista
sintética de leads na resposta da **lista**. Os leads sintéticos precisam
ser os MESMOS ids nos perfis e nos interesses — senão o relatório fica
vazio (a tela inteira é substituída pelo estado "Nenhum usuário entrou no
onboarding ainda" quando `total === 0 && funnel.entered === 0`).

`node .tmp-verify/visual-admin-onboarding.mjs` faz isso (13 checks).

---

## 17. Aba "Logs de Eventos" na ficha do usuário (2026-10-28)

O `/admin/events` (registro de `platform_events`) é a **fonte** dos logs dos
usuários. A ficha do usuário (`/admin/users/[id]`) ganhou a aba **"Logs de
Eventos"**, com o **mesmo componente** do painel — não uma cópia.

### Um componente, dois escopos

`src/pages/admin/EventLog.jsx` ganhou a prop `userId`. Sem ela, o componente
continua sendo o registro do painel (busca e período vêm do `PlatformEvents`).
Com ela, o componente vira a ficha de um usuário: carrega a própria busca e o
próprio período, porque na página do usuário não existe a barra de controles
do painel.

O que muda no escopo do usuário:

- a lista inteira do usuário é carregada de uma vez (o volume é pequeno), então
  a contagem e a ordenação são exatas e a busca é **local** — digitar não
  dispara nova consulta;
- o cabeçalho passa a falar "N eventos deste usuário" e "N no histórico";
- o estado vazio é "Nenhum evento registrado para este usuário.";
- o botão "Ver usuário" some (é o mesmo usuário) e no painel aparece o
  **"Ver logs"**, que leva direto para `/admin/users/<id>?tab=events`.

### A aba vive na URL

O estado da aba saiu do `useState` e virou `?tab=` na URL (`?tab=events`).
Assim quem abre o link chega direto na aba pedida — o mesmo princípio das
páginas de detalhe com id no caminho.

### O `metadata` é gravado em DOIS formatos (e isso quebrava o filtro)

O `logPlatformEvent` do front grava `metadata: JSON.stringify(metadata)` — ou
seja, **texto** dentro de uma coluna `jsonb`. As edge functions
(`send-notification.ts`) gravam o **objeto**. As duas coisas convivem na mesma
tabela.

Consequência: `metadata->>'user_id'` (filtro do PostgREST) **quebra** —
`jsonb ->> text` em um escalar jsonb dá erro no Postgres
("cannot extract field from a scalar value") e derruba a consulta inteira,
mesmo que a linha problemática não seja a do usuário procurado. Por isso o
filtro por metadata no front só é um **best effort**, dentro de try/catch.

`database/add-user-events-function.sql` resolve de vez: a função
`admin_user_events(user_id, since, limit)` lê os dois formatos (objeto com
`->>`, texto com regex) e é `SECURITY DEFINER` com a checagem de admin
**dentro** da função (a RLS da tabela só deixa o admin, mas o SECURITY
DEFINER passa por cima dela). Enquanto a função não está aplicada no banco, o
front cai no caminho direto (`created_by` + tentativa por metadata) e a aba
continua funcionando.

### Verificação

- `node .tmp-verify/visual-user-logs.mjs` — 23 checks: aba existe e abre pela
  URL, só os eventos do usuário aparecem (nos dois caminhos), busca e período
  filtram, a linha abre o detalhe, trocar de aba não perde o log, o log
  continua quando a função do banco ainda não existe (fallback) e não há
  estouro horizontal em 390px.
- `node .tmp-verify/visual-events-platform.mjs` — 7 checks: o `/admin/events`
  continua igual e o "Ver logs" leva para a aba do usuário.

---

## 18. Catálogo: recomendados, ofertas patrocinadas, lista de espera e votos (2026-10-30)

Rodada que abre uma **fonte de receita** (espaço patrocinado no catálogo) e
melhora a descoberta de serviço no dashboard.

### O que entrou no dashboard (nesta ordem)

1. **Topo: saudação + Grupo VIP** — o card do WhatsApp subiu para o cabeçalho
   e virou um botão compacto ("Entre no Grupo VIP 💜"). A frase "Escolha um
   serviço no catálogo para começar." saiu.
2. **Recomendados para você** (`RecommendedServices`) — faixa compacta em
   scroll horizontal, logo acima de "Grupos disponíveis para assinar", com as
   frases "Encontre mais. Pague menos." e "Descubra serviços digitais que
   combinam com você." **As ofertas patrocinadas entram no MEIO dessa faixa.**
3. Grupos disponíveis para assinar (já existia)
4. **Ofertas e oportunidades** (`OpportunitiesSection`) — "Novas vagas",
   "Ofertas de parceiros" e "Alternativas para economizar"
5. **O que você gostaria de compartilhar?** (`InterestPollCard`) — voto de
   interesse por serviço

No **catálogo** (`/dashboard/catalog`), as ofertas patrocinadas entram no topo,
antes da busca e do grid de serviços.

### A faixa compacta do topo (2ª revisão do mesmo dia)

A primeira versão do "Recomendados" era um **grid de cards grandes** com logo,
nome, motivo ("Você já usa"), "3 grupos • 4 vagas" e "Ver grupos". No celular
isso comia a tela inteira e empurrava tudo para baixo.

Virou **uma faixa horizontal**: cada item é só **logo + nome**, o motivo virou
tooltip (`title`) e a faixa rola com o polegar (sem barra visível). As ofertas
patrocinadas entram **no meio** da mesma faixa, com:

- borda laranja + halo (`offer-glow`) e um brilho que atravessa no hover;
- selo "Patrocinado" (curto: um badge longo como "Oferta em destaque" vazava
  por cima do vizinho);
- **sem duplicar**: se o serviço patrocinado também é recomendado, o chip
  comum sai e só fica a versão com destaque.

O bloco grande de "Ofertas patrocinadas" saiu do **dashboard** (continua no
**catálogo**, que é onde o anúncio tem espaço para o texto completo). No
dashboard, o detalhe do anúncio continua em "Ofertas e evidências →
Ofertas de parceiros".

O `placement` padrão no admin passou para `both` (catálogo **e** faixa do
dashboard): quem paga quer ser visto nos dois lugares.

O cabeçalho do dashboard ganhou a classe `.dashboard-header` — antes ele
dependia de uma regra global de `.page-header` que vinha de outra folha
(`Support.css`) e não é garantida aqui.

### As duas tabelas novas

`database/add-sponsored-offers.sql`:

- **`sponsored_offers`** — o espaço que se vende. Guarda o quê (serviço e/ou
  grupo), quem patrocinou, o texto do anúncio, onde ele aparece
  (`catalog` | `recommendation` | `both`), o período, o valor pago e as
  métricas de clique. A policy de leitura pública só devolve o que está
  `active` **e** dentro do período — o filtro acontece no banco, não no front.
- **`service_votes`** — o voto de "O que você gostaria de compartilhar?".
  `UNIQUE (user_id, service_id)`: um voto por pessoa por serviço.

Mais duas views: `service_vote_counts` (total por serviço) e
`service_watchlist` (quem espera vaga em cada serviço).

### A lista de espera não é uma tabela nova

"Avise-me quando houver uma vaga" **reaproveita `group_interest`** — a mesma
tabela que o admin já acompanha em "Lista de espera". Consequência prática:
a lista de espera e o "queria um grupo novo" do modal do catálogo são o
mesmo dado, e não existe o risco de as duas listas divergirem.

`group_interest` é `UNIQUE (service_id, user_id)`, então "entrar na lista" e
"avisar quando abrir vaga" são a mesma linha.

### "Recomendados para você": a ordem é explicável

`buildRecommendations` (`src/lib/catalogEngagement.js`) pontua cada serviço e
**carrega o motivo** de cada indicação. Pesos:

| Sinal | Peso |
|---|---|
| Interesse do onboarding (`current`) | +6 |
| Interesse do onboarding (`interested`) | +5 |
| Lista de espera (avisar quando abrir vaga) | +4 |
| Voto em "o que gostaria de compartilhar" | +3 |
| Oferta patrocinada ativa | +4 |
| Tem grupo com vaga | +3 |
| Categoria que a pessoa já assina | +2 |
| Popularidade (grupos) | até +3 |

Serviço que a pessoa **já assina** sai da lista. O motivo aparece como chip
no card ("Você já usa", "Você pediu aviso de vaga", "Oferta de parceiro"…).

A lista de espera pesa mais que o voto de propósito: "me avisa quando abrir"
é uma intenção mais forte do que "gostei desse".

### "Ofertas patrocinadas": onde o dinheiro entra

O admin registra a venda em `/admin/sponsored-offers` (menu **Plataforma →
Ofertas patrocinadas**): serviço e/ou grupo, patrocinador, título, descrição,
selo, link, banner, posição, valor pago, período, prioridade e status.

O efeito no app é duplo, e é esse o motor de receita:

1. o serviço aparece **no topo do catálogo** (e dentro de "Ofertas e
   oportunidades");
2. o serviço e os grupos de quem patrocinou **sobem nos "Recomendados"**
   (`boostServiceIds`).

Ou seja: quem paga, aparece — e o grupo do patrocinador é recomendando junto.

O valor pago é **registro comercial**, não processamento de pagamento: a
tabela não cobra ninguém.

### O aviso de vaga (edge function)

`supabase/functions/notify-service-watchers` — quando um grupo é aprovado
(`Platforms.jsx`) ou criado pelo admin (`GroupForm.jsx`), dispara o aviso
para quem está na lista de espera daquele serviço. Reaproveita
`dispatchNotification` de `_shared/send-notification.ts` com
`audience: { type: 'users', user_ids: [...] }` — ou seja, in-app + push.

Quem já tem o serviço não recebe o aviso. O chamador precisa ser admin ou o
dono do grupo.

### Degradação: as telas não quebram antes da migration

Toda leitura nova trata **PGRST205** (tabela inexistente) como "vazio", e
não como erro. Consequência: **a migration pode ser aplicada depois do
deploy** sem quebrar ninguém. Se a tabela não existir:

- as ofertas patrocinadas simplesmente não aparecem;
- o card de votação não aparece (não há votos nem fila contável);
- "Recomendados para você" e "Ofertas e oportunidades" funcionam normal,
  porque usam tabelas que já existem.

### Estado compartilhado sem requisição duplicada

`src/hooks/useEngagement.js` é um store de módulo (com `useSyncExternalStore`)
que carrega votos, lista de espera, interesses e ofertas **uma vez** para os
vários componentes que precisam dos mesmos dados — sem 4x a mesma consulta.

A atualização é **otimista** (o botão responde na hora) com rollback se a
gravação falhar.

### Verificação

- `node .tmp-verify/test-engagement.mjs` — **25/25**: pesos da
  recomendação, ordem dos candidatos do voto, cálculo de vagas, economia
  (plano ativo mais barato), e o comportamento com dados reais do banco.
- `node .tmp-verify/visual-engagement.mjs` — **30/30**: as quatro seções
  aparecem no dashboard **na ordem pedida**, as duas frases de efeito estão
  lá, o catálogo tem o bloco patrocinado no topo, o botão de aviso de vaga
  alterna de estado gravando em `group_interest`, a tela do admin lista a
  oferta com valor e período, não há estouro horizontal em 390px e não há
  erro de console.
- `node .tmp-verify/visual-faixa-topo.mjs` — **29/29** (faixa compacta): a
  frase "Escolha um serviço no catálogo para começar." saiu, o card do WhatsApp
  está no topo com "Entre no Grupo VIP 💜" (o antigo saiu), o grid antigo de
  recomendados não existe mais, cada item da faixa tem **só logo + nome**
  (sem "grupos"/"vagas"/"Ver grupos"), a faixa rola na horizontal, o item
  patrocinado fica **no meio**, tem selo e efeito animado (`offer-glow`), a
  seção inteira ficou com menos de 260px de altura, e no celular (390px) não
  há estouro de página e os itens encolhem.

Como as tabelas novas ainda não existem no banco, o script **intercepta as
respostas REST** de `sponsored_offers` / `service_votes` e devolve dados de
exemplo — o componente, o CSS e o caminho de código são os reais.

A conta de teste criada para a verificação foi **excluída** ao final (edge
function `delete-account`; confirmado com `GET /auth/v1/user` → 403
`user_not_found`). A linha de `group_interest` dessa conta ficou órfã porque
a função **deployada** é a versão antiga — por isso a limpeza está no
`database/apply-pending-2026-10-30.sql` (ver o bug de FK acima).

### Bug de FK descoberto na verificação: `group_interest` x re-cadastro

Ao criar a conta de teste da rodada anterior, o cadastro voltou:

```
23503: update or delete on table "users" violates foreign key
       constraint "group_interest_user_id_fkey" on table "group_interest"
```

A causa não é a lista de espera: é o trigger `public.handle_new_user()`, que
faz `UPDATE public.users SET id = NEW.id WHERE email = ...` — ele **troca a
chave primária** do profile no re-cadastro. Toda FK que aponta para
`users(id)` precisa de `ON UPDATE CASCADE` (o `ON DELETE CASCADE` do
`group_interest` **não** cobre update de id). Sem isso, qualquer conta que
tenha ficado na lista de espera (ou em qualquer outra tabela filha de
`users`) não consegue mais se cadastrar de novo com o mesmo e-mail.

Dois problemas se somaram:

1. a edge function `delete-account` **deployada** era uma versão antiga, que
   não limpava `group_interest` antes de apagar o profile — então o
   `DELETE FROM public.users` falhava por FK e a exclusão terminava em
   silêncio (o auth sumia, o profile e a lista de espera ficavam);
2. a FK do `group_interest` não tinha `ON UPDATE CASCADE`.

O **código** da `delete-account` já foi corrigido (limpa `group_interest` e
`service_votes` antes do profile e **falha alto** com 500 se o profile não
sair). O que falta é o deploy.

O conserto no banco está pronto em
**`database/apply-pending-2026-10-30.sql`** (um único paste no SQL Editor):

1. limpa as 2 contas de teste órfãs (filhas + profile);
2. recria **todas** as FKs que apontam para `users(id)` com
   `ON UPDATE CASCADE`, preservando o `ON DELETE` original de cada uma;
3. aplica a migration das ofertas patrocinadas.

### Arquivos tocados nesta rodada

Novos:

- `database/add-sponsored-offers.sql`
- `database/apply-pending-2026-10-30.sql`
- `src/lib/catalogEngagement.js`
- `src/hooks/useEngagement.js`
- `src/components/SponsoredOffers.jsx`
- `src/components/RecommendedServices.jsx`
- `src/components/OpportunitiesSection.jsx`
- `src/components/InterestPollCard.jsx`
- `src/components/WatchlistButton.jsx`
- `src/components/ServiceLogo.jsx`
- `src/components/engagement.css`
- `src/pages/admin/SponsoredOffers.jsx` + `.css`
- `supabase/functions/notify-service-watchers/index.ts`

Modificados: `src/App.jsx` (rota), `src/pages/admin/AdminLayout.jsx` (menu),
`src/pages/user/UserDashboard.jsx` (seções), `src/pages/user/Catalog.jsx`
(ofertas no topo + alerta de vaga), `src/pages/user/Catalog.css`,
`src/pages/admin/Platforms.jsx` e `src/pages/admin/GroupForm.jsx` (chamada
da edge function), `supabase/config.toml` (registro da função).

### Bug do card de votação invisível (achado no smoke test de produção)

No primeiro deploy, o card "O que você gostaria de compartilhar?" **não
aparecia em produção** — mas aparecia na verificação local. Motivo:
`fetchInterestCounts` lia a tabela base `group_interest`, e o **RLS entrega
só as linhas do próprio usuário**. Então "ninguém na fila" significava
"ninguém **que eu possa ver** na fila" — e como o card só aparece quando há
voto ou fila, ele nascia invisível para quem não estava na fila de ninguém.
Como ninguém via o card, ninguém votava, e ele continuava invisível.

A correção é ler a **view `service_watchlist`** (uma linha por pessoa na
fila), que é pública para autenticados — o mesmo caminho que
`service_vote_counts` já usava para os votos. No banco de produção há **24
pessoas na fila**, então o card passa a aparecer para todo mundo.

> A verificação local não pegou isso porque o script de visual intercepta a
> resposta REST de `service_vote_counts` e devolve votos de exemplo — o mock
> mascarava o problema. O smoke test contra o site publicado (dados reais)
> que expôs.

> Nota de privacidade: `service_watchlist` é uma view do Postgres e, sem
> `security_invoker`, ela **ignora o RLS da tabela base** — por isso dá para
> ler as 24 linhas até com a anon key. Ela só expõe `service_id`, `user_id` e
> `since` (nenhum dado pessoal), mas vale saber.

### Deploy (2026-10-30)

**Front publicado em produção** pela Vercel (o caminho real está em
`DEPLOYMENT.md`, seção "Option 1b"):

- produção: **https://dividepass.com** (alias), build
  `https://dividepass-8y2yzfmjn-divide-pass.vercel.app`;
- build do lado da Vercel: 2041 módulos, verde;
- conferido no bundle em produção: "Recomendados para você", "Entre no Grupo
  VIP", "Ofertas e oportunidades", "O que você gostaria de compartilhar?",
  "Patrocinado", rota `admin/sponsored-offers`, `@keyframes offer-glow`,
  `.highlight-strip`, `.highlight-chip--offer`, `.opp-grid`, `.sf-footer`
  (rodapé) — tudo presente;
- rotas `/login`, `/dashboard`, `/dashboard/catalog`,
  `/dashboard/my-groups/create`, `/admin/sponsored-offers`, `/admin/groups/new`
  respondem 200.

**Smoke test contra o site publicado** (`node .tmp-verify/visual-producao.mjs`
— 14/14): cria conta descartável, confere o topo novo no dashboard real,
mede o estouro horizontal em 390px, confere que não há erro de console e
**apaga a conta no fim** (`GET /auth/v1/user` → 403 `user_not_found`).

> O script **não** interage com a lista de espera de propósito: a edge
> function `delete-account` deployada ainda é a versão antiga e deixaria
> órfão em `group_interest`. Depois do deploy dela, a limpeza do
> `apply-pending-2026-10-30.sql` resolve.

A árvore continua **sem commit** (a Vercel compila o que está no disco).

### Pendente para o movimento

1. **Aplicar o SQL do banco**: cole `database/apply-pending-2026-10-30.sql`
   inteiro no SQL Editor do Supabase (projeto `lasoouwboxspstqvjbsv`). Ele
   aplica a migration `add-sponsored-offers.sql` **e** corrige as FKs de
   `users(id)` com `ON UPDATE CASCADE` (sem isso o re-cadastro de quem está
   na lista de espera fica quebrado). É idempotente.
2. **Deploy das edge functions**: `notify-service-watchers` (nova — sem ela o
   aviso de vaga não sai, o botão salvar funciona) **e** `delete-account`
   (corrigida — limpa a lista de espera antes de apagar o profile e falha
   alto em vez de excluir em silêncio).
3. Cadastrar a primeira oferta em `/admin/sponsored-offers`.

> A CLI do `supabase` neste ambiente está autenticada em **outra org** (403 em
> `functions list`) e não há `SUPABASE_ACCESS_TOKEN`/`SUPABASE_SERVICE_KEY` no
> ambiente — por isso a migration **não** foi aplicada aqui. O `exec_sql` RPC
> também não existe neste projeto (`PGRST202`).
>
> Depois do deploy da `delete-account`, **rode o SQL do item 1**: ele limpa as
> 2 contas de teste que ficaram órfãs nas rodadas de verificação.

---

## 19. Regrinhas com tipo: a regrinha que nasce junto com o grupo (2026-10-30)

Rodada pedida em `/dashboard/my-groups/create`: o dono do grupo precisa
**criar uma regrinha na hora de criar o grupo**, mas escrevendo "não
compartilhar a senha; usar apenas 1 tela" num textarea é trabalho que quase
ninguém faz — o campo nascia vazio e o grupo saía sem nenhum aviso para o
membro.

A solução: **tipos de regrinha**. O dono marca as regrinhas prontas que valem
para o grupo e, se quiser, escreve uma só dele. O texto final continua
indo para a **mesma coluna `groups.rules`** (TEXT, uma regrinha por linha) —
**nenhuma migration é necessária**.

### O catálogo (`src/lib/groupRuleTypes.js`)

8 tipos, cada um com `id` estável, `label`, `hint` e `text`:

`nao_compartilhar_senha` · `um_dispositivo_por_membro` · `sem_revenda` ·
`aviso_de_cancelamento` · `pagamento_em_dia` · `sem_conteudo_ilegal` ·
`credencial_confidencial` · `grupo_pode_mudar_as_regras`

O **`text`** é o que vai para `groups.rules`; o **`id`** serve para
reconhecer a regrinha quando o rascunho é retomado.

### A regrinha que já vem marcada

`DEFAULT_RULE_TYPE_IDS = ['nao_compartilhar_senha']` — o rascunho nasce com
"Não compartilhe a senha nem o link de acesso fora deste grupo." marcada. O
grupo **sempre nasce com pelo menos um aviso** para o membro, e o dono
desmarca se não quiser. Vale para o usuário (`EMPTY_DRAFT`), para o rascunho
retomado (`rules: g.rules || DEFAULT_RULE_TEXT`) e para o admin.

### O texto gravado é a fonte da verdade

Não existe coluna de "tipos marcados": o que está em `groups.rules` é o
texto. Para reconstruir a tela, `parseRuleText` quebra o texto em linhas e
reconhece as que batem com o catálogo (comparando sem acento e sem caixa —
`normalizeRuleText`), devolvendo `selectedIds` + o texto livre. Uma regrinha
escrita à mão **não vira** tipo, e uma regrinha cujo texto do catálogo mudar
no futuro continua valendo como texto livre (não some do grupo).

`buildRuleText` monta o texto na volta: tipos do catálogo (na ordem do
catálogo) e depois o texto livre — sem linha duplicada e sem linha vazia.

### Onde aparece

- **Wizard do usuário** (`/dashboard/my-groups/create`) e **wizard do admin**:
  etapa "Cobrança" (`BillingStep`) — o seletor compartilhado
  `RuleTypesField`. O admin, ao **editar** um grupo, usa o mesmo seletor no
  formulário legado.
- **Resumo** dos dois wizards: linha "Regrinhas" com a contagem e as
  primeiras (`rulesSummary`).
- **Leitura pelo membro**: `GroupRules` (novo componente, lista compartilhada)
  no detalhe do grupo, no checkout (2 pontos) e na tela de credenciais; o
  admin vê a mesma lista nas telas de grupos pendentes.

> A classe nova é `.group-rules-list` — **não** `.group-rules`, que já existe
> no `App.css` num seletor global (colisão mudaria o visual).

### Verificação

- `node .tmp-verify/teste-regrinhas.mjs` — **17/17** em node puro: ids
  únicos, texto sem `\n`, normalização sem acento/caixa, ida e volta
  (`buildRuleText` → `parseRuleText` → `buildRuleText`) preservando o texto,
  texto livre não vira tipo, regra duplicada não se repete.
- `node .tmp-verify/qa-regrinhas.mjs` — **12/12** no Chrome (harness em
  `.tmp-verify/preview/regras.html` com o `BillingStep` real e o tema real):
  a regrinha padrão vem marcada, marcar outra soma uma, o texto livre entra
  no fim e sai com a lixeira, o membro vê a lista, limpar tudo esvazia
  `groups.rules`, voltar ao padrão remarka, **sem estouro horizontal em
  390px** e sem erro de console.
- `node .tmp-verify/qa-regrinhas-e2e.mjs` — **13/13 na rota REAL**
  `/dashboard/my-groups/create` (conta descartável criada pela API de auth e
  apagada no final pela edge function `delete-account`): a etapa de cobrança
  mostra os tipos, o título é o da etapa certa, a regrinha padrão vem
  marcada, marcar outra soma uma, a livre entra por último, **o rascunho
  gravado no banco tem as três regrinhas** e o resumo mostra "Regrinhas 3".
  Sem estouro em 390px e sem erro de javascript.
- `npm run build` — OK. `npx eslint` nos arquivos novos — limpo (os erros
  restantes em `GroupForm.jsx`/`ServiceCredentials.jsx`/`GroupDetail.jsx` são
  **pré-existentes**, confirmados contra `HEAD`).

> Atenção ao dirigir o wizard num script: **não conte as etapas**. A contagem
> muda a cada refactor (esta rodada rodou com 9 etapas) e um `count()`
> instantâneo passa reto pela etapa que você quer. Use
> `waitFor({ state: 'visible' })` no seletor da etapa.

### Arquivos tocados nesta rodada

Novos:

- `src/lib/groupRuleTypes.js`
- `src/components/group-creation/RuleTypesField.jsx`
- `src/components/GroupRules.jsx` + `src/components/GroupRules.css`

Modificados: `src/components/group-creation/BillingStep.jsx`,
`src/components/group-creation/GroupCreation.css`,
`src/pages/user/CreateGroup.jsx`, `src/pages/admin/GroupForm.jsx`,
`src/pages/user/Checkout.jsx`, `src/pages/user/ServiceCredentials.jsx`,
`src/pages/user/GroupDetail.jsx` (+ `.css`), `src/pages/admin/Groups.jsx`,
`src/pages/admin/Platforms.jsx`.

### Pendente

1. **Nada no banco** — a coluna `groups.rules` já existe; a rodada roda
   assim que o front for deployado.
2. Se quiser os tipos **editáveis pelo admin** (tabela `group_rule_types` em
   vez de catálogo no código), dá para fazer na próxima rodada.

---

## Apêndice — como reproduzir as confirmações

```powershell
# matriz de exposição (anon × autenticado) nas 49 tabelas
# contrato de colunas: PostgREST devolve 42703 "column X does not exist" p/ coluna ausente
# escalada em groups: PATCH verified / is_official / approval_status com JWT de usuário comum
# escalada em users: PATCH role=admin -> 403 (fix 98e1795 funciona)
# escrita anônima: POST /rest/v1/password_resets e /payment_attempts -> 201
# runtime: node logs\dp-walk.mjs (Playwright, 23 rotas, screenshots em logs\shots\)
```

**Estado final:** o bloco P0 está **aplicado e verificado em produção** — `verify-p0.mjs` passou de **3/30** para **30/30**. Todas as contas e grupos de teste criados durante a verificação foram removidos e as escritas anônimas de teste foram revertidas. Commit `67ce49c` no branch `main` → deploy de produção do front `dpl_8S6oaFjVjQTaAnADCCBkfeShjCUY` (READY).

---

## 20. Monetização das ofertas patrocinadas: a métrica estava morta (2026-11-01)

O pedido foi o conjunto de features da rodada 18 (recomendados, lista de
espera, ofertas e oportunidades, votação, ofertas patrocinadas) mais a
**monetização**: um parceiro paga para o serviço dele ficar destacado no topo
do catálogo e nos recomendados.

**O código de tudo isso já existia e está no ar.** O que a auditoria de
produção do dia 01/11 encontrou foi que **duas peças da engrenagem não
funcionavam** — e uma delas é justamente o que faz a monetização valer
alguma coisa.

### 20.1 O clique no anúncio nunca era contado

`registerSponsorClick` (`src/lib/catalogEngagement.js`) fazia isto:

```js
await supabase.from('sponsored_offers').update({ clicks: 1 }).eq('id', offerId);
```

Dois defeitos no mesmo lugar:

1. **`clicks: 1` em vez de `+ 1`** — a métrica nunca passaria de 1 mesmo que a
   escrita passasse;
2. **a escrita é bloqueada pelo RLS.** A policy de escrita de
   `sponsored_offers` é `public.is_admin()`. Um `PATCH` do navegador do
   usuário comum é engolido: o PostgREST devolve **`200 []`** — sucesso falso,
   sem erro no console. Verificado em produção:
   `PATCH /rest/v1/sponsored_offers` com a anon key → `200 []`.

Ou seja: o painel do admin mostrava "0 cliques" para sempre, e o parceiro
pagava por um destaque que **não rendia nada mensurável**. `impressions` era
pior: era lida no painel e **nunca era escrita por ninguém**.

**Correção:** a métrica passou a ser somada por uma RPC `SECURITY DEFINER`
(`increment_sponsor_metric`), que é a única escrita pública na tabela e só
conta oferta **ativa e dentro do período**:

- `database/apply-pending-2026-11-01.sql` — o SQL isolado para colar no SQL
  Editor (idempotente);
- `database/add-sponsored-offers.sql` — o mesmo SQL na migration canônica,
  para instalação do zero;
- `src/lib/catalogEngagement.js` — `registerSponsorMetric(offerId, metric)`;
- `src/components/SponsoredOffers.jsx` — **impressão** contada com
  `IntersectionObserver` (conta só o anúncio que entrou na tela, uma vez).

### 20.2 Três edge functions do front NÃO estão no ar

Sondagem das 26 funções que o front chama (`POST` na URL da função; **404
"Requested function was not found" = ausente**, 401 = existe e exige sessão):

| Função | Chamada por | Estado |
| --- | --- | --- |
| `notify-service-watchers` | `admin/GroupForm.jsx`, `admin/Platforms.jsx` | **AUSENTE** |
| `provision-group-mailbox` | `lib/managedGroupEmail.js` | **AUSENTE** |
| `send-welcome-email` | `lib/welcomeEmail.js` | **AUSENTE** |

As outras 23 estão no ar.

**`notify-service-watchers` é o botão "Avise-me quando houver uma vaga".**
Sem ela, o botão **salva** a pessoa na lista de espera (`group_interest`) e
nada mais: ninguém é avisado quando a vaga abre. É a feature do pedido que
dependia dela para ter efeito — e é exatamente a função que a rodada 18
deixou pendente.

> A CLI do `supabase` deste ambiente continua com o token da outra org
> (`byefit`): `supabase functions deploy notify-service-watchers --project-ref
> lasoouwboxspstqvjbsv` sobe os assets e morre em **403 "Your account does
> not have the necessary privileges"**. O caminho é o empacotador, que gera o
> arquivo único para colar no painel.

### 20.3 Como publicar as três (dashboard do Supabase)

Arquivos prontos em `.tmp-verify/painel/` (validados por
`scripts/validar-arquivos-painel.mjs` — **17/17 OK**):

| Função | Arquivo | "No Verify JWT" |
| --- | --- | --- |
| `notify-service-watchers` | `notify-service-watchers.ts` (32.991 bytes) | **ligado** (`verify_jwt = false`) |
| `send-welcome-email` | `send-welcome-email.ts` (37.743 bytes) | **ligado** (`verify_jwt = false`) |
| `provision-group-mailbox` | `provision-group-mailbox.ts` (18.140 bytes) | **desligado** (`verify_jwt = true`) |

No painel do Supabase (projeto `lasoouwboxspstqvjbsv`): **Edge Functions →
Nova função** → nome da função → **Create new function** → **Substituir**
(colar o arquivo inteiro) → **Deploy**. Se a função já existir, **Edit →
substituir o conteúdo → Deploy**.

### 20.4 O resto do pedido: estado verificado em produção

- `sponsored_offers`, `service_votes` e as views `service_vote_counts` /
  `service_watchlist` **existem** (migration de 30/10 aplicada);
- `service_vote_counts` devolve **2 serviços com votos** e `service_watchlist`
  devolve as linhas da fila de espera — as duas views funcionam (elas ignoram
  o RLS da tabela base, que é o que se quer aqui);
- **`sponsored_offers` está VAZIA** — a área de ofertas patrocinadas não
  aparece para ninguém até cadastrar a primeira oferta em
  `/admin/sponsored-offers` (menu **Plataforma → Ofertas patrocinadas**);
- o front publicado tem todas as seções: "Recomendados para você"
  (logo acima de "Grupos disponíveis para assinar"), "Ofertas e
  oportunidades", "O que você gostaria de compartilhar?", "Avise-me quando
  houver uma vaga" e a rota `admin/sponsored-offers`.

Copy alinhado nesta rodada (texto exato do pedido): *"Salve serviços que
ainda não têm grupos disponíveis e receba alertas quando aparecer uma
oportunidade."* — em `src/pages/user/Catalog.jsx`.

### 20.5 Pendências (nenhuma delas roda deste ambiente)

1. **Colar `database/apply-pending-2026-11-01.sql` no SQL Editor** (projeto
   `lasoouwboxspstqvjbsv`) — **um paste só faz as duas coisas**:
   - cria a RPC `increment_sponsor_metric` (sem ela a métrica de
     clique/impressão continua zerada — o front chama a RPC; se ela não
     existir, o `logSilently` engole o erro e nada quebra, só não conta);
   - limpa os **4 perfis órfãos** `dp.prod.*` que ficaram de rodadas
     anteriores (o `delete-account` implantado apaga o auth mas o
     `DELETE FROM public.users` falha por FK em `platform_events.created_by`
     — bug já mapeado na seção 18; a rotina é dinâmica porque o schema de
     produção diverge do repo).
2. **Publicar as 3 edge functions** pelo painel (tabela acima).
3. **Cadastrar a primeira oferta** em `/admin/sponsored-offers`.

### 20.6 Deploy (2026-11-01)

Front publicado pela Vercel (caminho em `DEPLOYMENT.md`, "Option 1b"):

- produção: **https://dividepass.com** (alias);
- build: 2054 módulos, verde;
- conferido no bundle em produção: `increment_sponsor_metric`, `p_metric`,
  "impressões", "Salve serviços que ainda não têm grupos disponíveis",
  "Recomendados para você", "Ofertas e oportunidades", "O que você
  gostaria de compartilhar?";
- **smoke test contra o site publicado** (`node .tmp-verify/visual-producao.mjs`)
  → **14 ok, 0 fail**: faixa compacta de recomendados com logo + nome, frase
  "Encontre mais. Pague menos.", seção "Ofertas e oportunidades", card de
  votação presente, sem estouro horizontal no mobile e **sem erro de
  console**.

> Antes de aplicar o SQL da RPC, o `supabase.rpc('increment_sponsor_metric')`
> responde `PGRST202` (função inexistente). O front trata isso como estado
> esperado e **não** polui o console — `logSilently` agora silencia
> `PGRST202` junto com `PGRST205`.



---

## 21. Regrinha: o dono volta a poder mudar as regras depois de criar o grupo (2026-11-01)

A rodada 19 (30/10) entregou os **tipos de regrinha** na criação do grupo
(`/dashboard/my-groups/create`): 8 tipos prontos, a regrinha padrão já
marcada e a lista que o membro lê no detalhe, no checkout e nas credenciais.

**O que faltava:** as regrinhas ficavam **congeladas no momento da criação**.
A tela "Gerenciar Grupo" (`/dashboard/my-groups/:groupId/manage`) — onde o
dono muda tipo de conta, ciclos, chave PIX e credenciais — **não tinha nenhum
editor de regras**. Se o grupo já estava no ar e o dono precisasse avisar
"não revenda a vaga" (ou acrescentar "avise antes de cancelar"), não havia
como: o texto nascia na criação e morria ali.

### 21.1 O que foi feito

- `src/pages/user/ManageGroup.jsx` — novo card **"Regras do grupo"** na
  lateral, com o **mesmo componente da criação** (`RuleTypesField`), uma
  prévia **"Como o membro vê hoje"** (o `GroupRules`, exatamente a lista que
  o membro lê) e o botão **"Salvar regras"** que grava em `groups.rules`.
  O botão só acende quando o texto realmente mudou (`rulesDirty`).
- `src/components/group-creation/RuleTypesField.jsx` — nova prop opcional
  `hideLabel`: quando a tela já tem título e explicação do bloco, o
  componente esconde o rótulo e a dica para **não repetir o mesmo texto
  duas vezes** na tela. O wizard de criação continua com o rótulo.
- `src/pages/user/ManageGroup.css` — estilo da prévia (`.manage-rules-preview`).

**Sem migration:** o texto continua indo para a mesma coluna `groups.rules`
(uma regrinha por linha). O texto gravado é a fonte da verdade — ao
reabrir o editor, o catálogo é reconhecido pelo texto (comparando sem acento
e sem caixa) e os tipos marcados voltam marcados.

### 21.2 Verificação

- `node .tmp-verify/teste-regrinhas.mjs` — **17/17** (lógica do catálogo,
  ida e volta do texto, texto livre, normalização).
- `node .tmp-verify/qa-regrinhas-manage.mjs` — **19/19 na rota REAL**
  `/dashboard/my-groups/:groupId/manage` (conta descartável pela API de
  auth, apagada no final pela edge `delete-account`): o card existe, a prévia
  mostra as regrinhas de hoje, os 2 tipos marcados voltam marcados, a
  regrinha livre volta como texto livre, o botão começa desabilitado,
  marcar outro tipo habilita, **o banco recebe a regrinha nova** e ela
  continua marcada depois de recarregar a página. Sem estouro em 390px e
  sem erro de javascript.
- `node .tmp-verify/qa-regrinhas-e2e.mjs` — **13/13** (regressão da
  criação: a etapa de cobrança mostra os tipos, o rascunho no banco tem as
  regrinhas e o resumo conta 3).
- `npm run build` — OK. `npx eslint` nos arquivos tocados — limpo.

> **Lição de QA (vale para os scripts que criam conta de teste):** o gate de
> avatar (rodada do avatar obrigatório) aparece **por cima de tudo** para
> quem entra sem avatar e **bloqueia o clique** — o Playwright falha com
> "avatar-gate-backdrop intercepts pointer events". A conta de teste precisa
> nascer com `avatar_url` (`PATCH /rest/v1/users` com
> `avatar_url: '/avatars/avatar-02.svg'`), senão nenhum E2E de tela passa.

### 21.3 Pendência de limpeza no banco (rodada 01/11)

O E2E rodou com conta descartável e apagou tudo pela edge `delete-account`
(HTTP 200), **mas sobrou lixo**, como já acontece nesta projeto (ver seção
de memória "conta deletada deixa perfil órfão"):

- **9 perfis órfãos** em `public.users` (`regrinhas.*@divteste.com`,
  `sonda.orfao.*@divteste.com`) — o auth foi apagado, o perfil não;
- **2 grupos "draft"** ("Spotify Individual") das rodadas de E2E.

Sonda feita nesta rodada (`sonda-orfao.mjs`): **o próprio usuário NÃO
consegue apagar o próprio perfil** — `DELETE /rest/v1/users?id=eq.{uid}`
devolve **204 sem efeito** (RLS sem policy de DELETE para si). E a edge
`delete-account` **em produção** é a versão antiga (não limpa
`platform_events`), então o `DELETE FROM public.users` dela morre na FK. A
versão corrigida já está no repo (`supabase/functions/delete-account/index.ts`,
linha 104) — **falta publicar**.

**Como limpar (precisa do SQL Editor do Supabase):** o script
`database/cleanup-orphan-qa-accounts.sql` foi ampliado nesta rodada para
pegar também `regrinhas.%@divteste.com`, `sonda.orfao.%@divteste.com`,
`limpeza-regrinhas-%` e `diag-regrinhas-%` (além do `qa.%@example.com` de
antes). A rotina é dinâmica: ela lê as FKs **reais** do banco e apaga as
linhas filhas antes do perfil — por isso ela leva junto os grupos "draft".

## 22. Card do Grupo Oficial da DividePass no WhatsApp (2026-11-01)

Pedido: chamar atenção no `/dashboard` para o **grupo oficial do WhatsApp**,
com o card **acima do card de feedback**, ícone **oficial da marca** e o texto
do convite embaixo. A ideia é transformar o grupo no canal onde a pessoa
descobre as vagas assim que elas abrem.

### 22.1 O que foi feito

- `src/components/WhatsAppIcon.jsx` — **ícone oficial do WhatsApp** em SVG
  inline (traçado da marca, `viewBox` 24x24, `fill="currentColor"`). O
  `lucide-react` **não tem** ícone de WhatsApp (a marca foi removida da
  biblioteca), então ele não seria importável. O componente serve para o card
  e para o chip do cabeçalho.
- `src/components/WhatsAppGroupCard.jsx` + `WhatsAppGroupCard.css` — o card
  novo: fundo no **verde oficial** do WhatsApp com gradiente, marca d'água do
  glifo, ícone da marca com **anel pulsando** (puxa o olho), título, o texto
  do convite com o 💜 e o botão **branco** "Entrar no grupo" (máximo contraste
  sobre o verde) com `target="_blank"`. Em 390px o card empilha e o botão
  fica com largura total. `prefers-reduced-motion` desliga o pulso e a
  levitação.
- `src/pages/user/UserDashboard.jsx` — o `<WhatsAppGroupCard />` entra
  **imediatamente antes** do `.feedback-cta-card` (o card de feedback), com
  comentário explicando a ordem: o WhatsApp é o canal que dá retorno
  imediato, o feedback é a caixinha de sugestão.

**O link:** vem de `WHATSAPP_VIP_URL` (`src/lib/siteLinks.js`) — o **único**
convite de grupo do projeto (o mesmo do chip do cabeçalho, do rodapé e da
home). Se o "Grupo Oficial" for um convite diferente do grupo da comunidade,
basta trocar a constante em um lugar só.

### 22.2 Verificação

- `node scripts/qa-card-whatsapp.cjs` — **13/13** na rota real `/dashboard`:
  o card existe, usa o SVG da marca (o `path` começa em `17.472 14.382`), fica
  **acima** do card de feedback na ordem real do DOM (`waY=1391` vs
  `fbY=1568`), o botão aponta para `chat.whatsapp.com` e abre em nova aba, o
  texto do convite é o pedido literal e começa com o 💜, e não há erro de JS no
  console. Prints em `qa-out/` (card isolado, contexto com o feedback e mobile).
- `npm run build` — OK (2054 módulos). `npx eslint` nos arquivos novos — limpo.
  (Os 10 erros que o `eslint` aponta em `UserDashboard.jsx` — `servicesMap` e
  `MONTHS_PT` sem uso e `setState` dentro de efeito — são **pré-existentes**,
  em linhas que esta rodada não tocou.)

### 22.3 Lição de QA: a conta QA não enxerga o `/dashboard`

A conta QA única (`qa.mavis@divteste.com`) **nunca terminou o onboarding**
(ela existe para sondagem). Com `users.onboarding_completed_at` nulo, o
`UserLayout.jsx:32` redireciona para `/onboarding` e o `/dashboard` **nem
chega a renderizar** — o card "não existe" e o QA passa fooled. E, sem
`avatar_url`, o `AvatarGate` toma a tela por cima.

**Como contornar sem sujar a produção:** remendar **só a leitura** do perfil
no Playwright — interceptar `GET /rest/v1/users` e devolver o mesmo objeto
com `onboarding_completed_at` e `avatar_url` preenchidos. Nenhum POST sai, o
resto da tela continua **real** (grupos, planos e serviços do banco). É o
complemento da lição do gate de avatar da seção 21.2: lá o jeito era a conta
nascer com avatar; aqui, para a conta QA que já existe, o conserto é no mock
de leitura.

---

## 23. Auditoria da rodada "novas features" + o painel que vende o espaço (2026-11-01, tarde)

O pedido voltou como lista de features (recomendados, lista de espera,
oportunidades, votação e **ofertas patrocinadas no catálogo**). Antes de
escrever qualquer linha de código, a auditoria conferiu o que já estava no ar
e o que estava morto.

### 23.1 O pedido inteiro já está no ar (verificado em produção)

Sonda contra o projeto `lasoouwboxspstqvjbsv` e contra o bundle publicado em
`https://dividepass.com`:

| Feature do pedido | Onde está | Estado |
| --- | --- | --- |
| "Recomendados para você" (logo + nome, scroll) | `src/components/RecommendedServices.jsx` | no ar, **acima** de "Grupos disponíveis para assinar" (`UserDashboard.jsx:572`) |
| "Encontre mais. Pague menos." / "Descubra serviços digitais que combinam com você." | idem, no cabeçalho da faixa | no ar |
| "Avise-me quando houver uma vaga" + "Salve serviços que ainda não têm grupos disponíveis…" | `src/components/WatchlistButton.jsx` + `src/pages/user/Catalog.jsx` | no ar (o botão salva; o **aviso** depende da edge, ver 23.3) |
| "Ofertas e oportunidades" (vagas novas, ofertas de parceiros, alternativas para economizar) | `src/components/OpportunitiesSection.jsx` | no ar |
| "O que você gostaria de compartilhar?" (voto) | `src/components/InterestPollCard.jsx` | no ar |
| "Oferta em destaque" (área patrocinada no catálogo) | `src/components/SponsoredOffers.jsx` + `/admin/sponsored-offers` | **no ar, mas sem ninguém cadastrado** |

Ou seja: **nenhuma feature nova precisou ser escrita**. O que faltava era
"acender" as engrenagens de produção.

### 23.2 O que a sonda mostrou de quebrado

- `sponsored_offers` existe, a view `service_vote_counts` devolve 2 serviços com
  voto, `service_watchlist` devolve 24 linhas da fila de espera e o `select`
  exato do painel admin (com embed de serviço e grupo) responde **200** — o
  painel do admin abre com o embed certo;
- **`sponsored_offers` está VAZIA** — a área de ofertas não aparece para
  ninguém até existir a primeira oferta;
- a RPC `increment_sponsor_metric` **não existe** (`PGRST202`) — então o
  clique/impressão do anúncio nunca é somado (o front engole o erro de
  propósito);
- 4 edge functions **ausentes** (404 "Requested function was not found"):
  `notify-service-watchers`, `reconcile-payments`, `provision-group-mailbox`,
  `send-welcome-email`. A `delete-account` está no ar, mas na **versão antiga**
  (a que deixa o perfil órfão).

Os perfis órfãos `dp.prod.*` **já foram limpos** (a sonda devolve 0 linhas) —
a parte de limpeza do `apply-pending-2026-11-01.sql` já rodou; a RPC, não.

### 23.3 Bug real encontrado no painel que vende o espaço

O QA do painel admin de ofertas (`scripts/qa-admin-ofertas-patrocinadas.mjs`)
estourou no preenchimento do campo "Valor pago (R$)":

> `Error: Cannot type text into input[type=number]`

O campo era `type="number"`, e **o navegador rejeita vírgula** em input
numérico (o valor sanitizado volta vazio). O rótulo pede "(R$)" e o admin
brasileiro digita "199,90" — o campo ficava em branco e
`Number("199,90")` é `NaN`, que virava `null` no payload: **a oferta entrava
sem valor nenhum**, e a métrica "Patrocínio" do painel mostrava R$ 0,00.

Correção (`src/pages/admin/SponsoredOffers.jsx`): o campo passou a `type="text"`
com `inputMode="decimal"`, e o payload usa a função `valorPago()`, que troca a
vírgula por ponto e devolve 0 em vez de `NaN`. Ao editar, o valor volta
formatado no padrão brasileiro ("250,00").

### 23.4 `config.toml`: duas funções sem entrada (deploy quebrado)

`reconcile-payments` e `delete-account` **não existiam** no `config.toml`.
Sem a entrada, o `supabase functions deploy` sobe com o padrão
`verify_jwt = true` — e a reconciliação é chamada pelo cron com um **segredo**
guardado em `app_settings`, que não é JWT: o gateway responderia 401 antes do
código rodar (é exatamente o bug que o próprio `config.toml` documenta nas
funções de billing).

Entradas adicionadas:

```toml
[functions.reconcile-payments]
enabled = true
verify_jwt = false
entrypoint = "./functions/reconcile-payments/index.ts"

[functions.delete-account]
enabled = true
verify_jwt = true
entrypoint = "./functions/delete-account/index.ts"
```

O empacotador (`scripts/empacotar-function-painel.mjs`) também ganhou
`delete-account` — a versão corrigida (que limpa `platform_events` antes do
`DELETE`) agora entra no pacote do painel.

### 23.5 O script que publica tudo de uma vez

`scripts/publicar-pendencias-supabase.mjs` — a CLI do `supabase` deste
ambiente está ligada na **outra** organização (`byefit`) e o `composio` não tem
conexão com o Supabase; o painel do Supabase trava o navegador (a página do
dashboard não termina de carregar). Com **um token de acesso pessoal**
(`sbp_...`) o script resolve tudo:

```
node scripts/publicar-pendencias-supabase.mjs            # SQL + cron + functions
node scripts/publicar-pendencias-supabase.mjs --status   # só diagnostica (não precisa de token)
```

- o SQL entra pela Management API (`POST /v1/projects/{ref}/database/query`);
- as functions sobem pela CLI com `SUPABASE_ACCESS_TOKEN` no ambiente da
  chamada (sem trocar o login global da máquina);
- `database/add-reconcile-cron.sql` (novo) agenda a reconciliação a cada 15 min
  e cria o segredo `reconcile_payments_cron_secret` em `app_settings`.

**Onde o token fica:** `.env.local` (gitignored) ou
`.tmp-verify/sbp-dividepass.txt`. Nunca no chat.

### 23.6 Verificação

- `node scripts/qa-admin-ofertas-patrocinadas.mjs` — **22/22** na rota real
  `/admin/sponsored-offers`: resumo (cadastradas / no ar / patrocínio /
  cliques), lista com selo e período encerrado, formulário com todos os campos
  de venda, validação do título obrigatório e **o payload do INSERT** (placement
  `both`, `amount_paid` 199.9 a partir de "199,90", período, badge padrão).
  Print em `qa-out/admin-ofertas-patrocinadas.png`. Nada é gravado: as
  escritas em `sponsored_offers` são interceptadas.
- `database/apply-pending-2026-11-01.sql` rodado no **Postgres local** (schema
  de teste `scripts/test-rpc-sponsor-metric-schema.sql`): a RPC soma 1 em
  oferta **ativa** e devolve **0** na pausada — o comportamento esperado.
- `database/add-reconcile-cron.sql` rodado no Postgres local
  (`scripts/test-cron-reconciliacao-schema.sql`): cria o segredo, agenda o job
  e é **idempotente** (rodar duas vezes não duplica o job).
- `npm run build` — OK. `npx eslint` nos arquivos tocados — limpo.

### 23.7 Pendências (dependem do acesso do Gabriel)

O SQL Editor do painel é o caminho que ele escolheu, então a entrega é **um
arquivo só**:
`database/EXECUTAR-2026-11-01-ofertas-patrocinadas.sql`.

**1. No painel do Supabase** (SQL Editor → New query → colar tudo → Run):

| Bloco do arquivo | O que faz |
| --- | --- |
| 1. id curto + `increment_sponsor_metric` | a coluna `id` da oferta vira TEXT (8 caracteres, letras e números) e a RPC que soma clique/impressão passa a receber `p_offer_id TEXT` (SECURITY DEFINER, só `authenticated`/`service_role` podem chamar) |
| 2. segredo + `cron.schedule` | agenda a reconciliação de pagamentos a cada 15 min (guarda: se o `pg_cron` estiver desligado, **avisa e segue** — não quebra o resto do arquivo) |
| 3. oferta de demonstração | `dddddddd` — Netflix, 7 dias, `placement = 'both'`, R$ 49,90, prioridade 10. É o que faz a área patrocinada aparecer para o usuário |
| 4. conferências | 3 `SELECT` que provam que a RPC, a oferta e o cron ficaram no lugar |

O arquivo é **idempotente**: pode colar e rodar quantas vezes quiser.

**2. As edge functions** (SQL não publica função) — no terminal, com o login da
conta que tem o projeto:

```bash
npx supabase login
node scripts/publicar-edge-functions.mjs
```

Sobe as 5 (`notify-service-watchers`, `reconcile-payments`,
`provision-group-mailbox`, `send-welcome-email`, `delete-account`) e depois
**confere**: 404 = ainda ausente, 401 = no ar exigindo sessão (normal). O
script avisa e para se a CLI não estiver logada na conta certa.

**Validação do SQL antes de chegar na produção** (Postgres local, banco
`dp_exec_test`, schema `scripts/test-sql-publico-schema.sql`):

- o arquivo roda inteiro sem erro: `CREATE FUNCTION` → `GRANT` → segredo →
  cron → `INSERT` da oferta → conferências;
- caminho **sem** `pg_cron`: aviso e o resto segue (é o que acontece se a
  extensão estiver desligada no projeto);
- caminho **com** `pg_cron` (testado com uma cópia sem o guard): "Job
  reconcile-payments agendado: a cada 15 minutos";
- a oferta demo é **contável**: `increment_sponsor_metric(..., 'impression')` →
  1 e `..., 'click'` → 1, porque ela nasce ativa e dentro do período;
- rodar o arquivo de novo não duplica nada (segredo mantido, job recriado,
  oferta atualizada).

**3. Conferir depois** (a partir daqui, sem token):

```bash
node scripts/publicar-pendencias-supabase.mjs --status
```

### 23.8 Deploy do front (2026-11-01, 18:26)

A correção do campo "Valor pago (R$)" (23.3) só vale no ar depois do deploy:

- `vercel --prod --yes --token $t` (o token de projeto está em `.vercel_token`);
- build na Vercel: **2054 módulos, verde**; alias em **https://dividepass.com**;
- conferido no bundle publicado: `type:`text`,inputMode:`decimal`,placeholder:`0,00``
  no campo do valor pago (o minificador usa crase, então o marcador do QA
  procurava aspas duplas e dava "FALTA" à toa — o grep do bundle tem que
  olhar a forma minificada);
- o resto dos marcadores da rodada está no bundle: "Recomendados para você",
  "Encontre mais. Pague menos.", "Descubra serviços digitais que combinam com
  você", "Avise-me quando houver uma vaga", "Salve serviços que ainda não têm
  grupos disponíveis", "Ofertas e oportunidades", "O que você gostaria de
  compartilhar?", "Oferta em destaque", "increment_sponsor_metric".

> "Parceiro de Teste" **não** aparece no bundle — e está certo: a oferta de
> demonstração é criada pelo SQL (23.7), não pelo front.


## 24. Rodapé do card no catálogo: foto de perfil dos membros (2026-11-01)

### O pedido

Na rota `/dashboard/catalog/:slug_plataforma` (a listagem dos grupos que já
existem para a plataforma), o rodapé do card mostra os retratos dos membros.
A regra pedida: **foto de perfil** para quem tem foto (fica mais bonito) e
**ícone de letra** (inicial do nome) para quem não tem.

### O que o código faz

- `src/components/MemberAvatar.jsx` — componente único do retrato: foto quando
  existe, inicial do nome quando não, e **inicial também quando a foto não
  carrega** (URL quebrada / storage removido), via `onError`.
- `src/pages/user/Catalog.jsx` — ordena os membros ativos colocando **quem tem
  foto primeiro**, corta em 4 retratos e vira o resto no badge `+N`
  (`gc-member-more`). Sem membros, mostra o placeholder `?`.
- `src/hooks/useAppData.js` — o `select` dos grupos embute o usuário para o
  rodapé ter a foto: `members:group_members (*, user:user_id (id, name, avatar_url))`.
  **Sem esse embed o card cai em letra para todo mundo** (foi o bug do
  rodapé "só com letras"): o `m.user` chega `undefined` e a foto não existe
  para o React.
- A mesma query existe na busca de apoio do próprio `Catalog.jsx` (usada
  quando o contexto ainda não carregou os grupos).

### Verificação

- `node scripts/qa-catalog-avatares.cjs` — **12/12** no dev local
  (`http://127.0.0.1:5173`) e **12/12 em produção**
  (`QA_BASE_URL=https://dividepass.com node scripts/qa-catalog-avatares.cjs`).
  O script lê os membros do grupo pela REST (conta QA única), monta o esperado
  (fotos primeiro, no máximo 4) e compara com o DOM: fotos **antes** das
  letras, URL da foto igual à do banco, inicial igual à do banco, foto
  realmente carregada (`naturalWidth > 0`) e badge `+N` dos membros ocultos.
  Grupo usado: "Max" (5 membros ativos — 2 com foto, 3 sem) em
  `/dashboard/catalog/max`.
  Prints: `qa-out/catalogo-listagem.png`, `qa-out/catalogo-card-rodape.png`.
  Nada é gravado: só leitura (o `GET /rest/v1/users` da conta QA é remendado
  para passar do gate de onboarding/avatar, sem nenhum POST).

---

## 24. Id curto na oferta patrocinada: `dddddddd` em vez de UUID (2026-11-01, 18:40)

Pedido: *"arrume este id gigante com a mesma letra, use máximo de id 8 letras
e números"*. O id em questão era o da oferta de demonstração do script de
publicação — `dddddddd-dddd-4ddd-8ddd-dddddddddddd` (36 caracteres, UUID).

### 24.1 O obstacle: a coluna era UUID

Confirmado em produção (read-only, pelo PostgREST):

```
GET /rest/v1/sponsored_offers?select=id&id=eq.dddddddd
→ 400 {"code":"22P02","message":"invalid input syntax for type uuid: \"dddddddd\""}
```

Ou seja: **"8 letras e números" não cabia** — a coluna era `UUID PRIMARY KEY`.
A resposta não foi só encurtar a string: a coluna passou a ser `TEXT`, com
default que gera 8 caracteres (letras e números) para toda oferta nova.

```sql
-- a conversão (rodar de novo é seguro: text -> text não tem efeito)
ALTER TABLE public.sponsored_offers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.sponsored_offers ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE public.sponsored_offers
  ALTER COLUMN id SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8);
```

Seguro porque: a tabela está vazia, **nenhuma** outra tabela tem FK apontando
para `sponsored_offers.id`, e o front nunca formata o id (ele só o repassa
para a RPC e usa como `key` do React).

### 24.2 A RPC mudou de assinatura

`increment_sponsor_metric(p_offer_id UUID, p_metric TEXT)` → **`TEXT`**.
A versão antiga é removida antes de criar a nova:

```sql
DROP FUNCTION IF EXISTS public.increment_sponsor_metric(UUID, TEXT);
```

Sem esse DROP ficariam duas funções de mesmo nome e o PostgREST não saberia
qual chamar (a que sobrou no banco hoje é a de UUID).

O front **não muda**: `supabase.rpc('increment_sponsor_metric', { p_offer_id: offerId, p_metric: 'click' })`
— o PostgREST casa a função pelo NOME dos argumentos, não pelo tipo.

### 24.3 A armadilha do `information_schema` (pega no teste local)

A primeira versão do script era assim:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sponsored_offers' AND data_type = 'uuid') THEN
    ALTER TABLE ... TYPE TEXT ...;
    RAISE NOTICE 'convertida';
  ELSE
    RAISE NOTICE 'já é text';
  END IF;
END $$;
```

No teste local (rodando o arquivo DUAS vezes) o script **anunciou a conversão
as duas vezes** — mesmo com a coluna já em `text`. Motivo: dentro de um bloco
`DO`, o `information_schema` devolve o **tipo antigo**: o plano da view fica
cacheado com o snapshot do catálogo de quando foi compilado. Um SELECT
"comum" na mesma sessão mostra `text`; dentro do plpgsql, `uuid`.

**Lição:** nunca usar `information_schema` como guard de DDL dentro de
plpgsql. Ou consulta o catálogo direto (`pg_attribute` + `pg_type`), ou —
melhor — escreve o `ALTER` de forma idempotente e deixa ele ser idempotente
de verdade (`text -> text` não tem efeito, então rodar de novo não quebra).

### 24.4 Verificação (Postgres local, banco `dp_exec_test`)

- 1ª execução: `uuid -> text`, RPC recriada em TEXT, segredo criado, oferta
  `dddddddd` inserida;
- 2ª execução: **sem erro e sem duplicar** (segredo mantido, job do cron
  recriado, oferta atualizada no `ON CONFLICT`);
- ids novos gerados pelo default: `6308cdbd`, `a57d4c0d`, `c4ceab1c`,
  `c948d466`, `1d3725cc` — 8 caracteres, letra e número;
- métrica na oferta `dddddddd`: `impression` → 1, `click` → 1;
- `pg_proc` confirma **1 só** função `increment_sponsor_metric` (a de UUID foi
  removida);
- `node scripts/qa-admin-ofertas-patrocinadas.mjs` — **22/22** com os ids
  curtos (o front não mudou).

> O SQL que o Gabriel executa é `database/EXECUTAR-2026-11-01-ofertas-patrocinadas.sql`
> (seção 1.1 faz a conversão). Rodar o arquivo é o que leva o id curto para
> produção.




---

## 25. Wizard de criação de grupo em 6 etapas (2026-11-01, noite)

Pedido: reestruturar a criação de grupo ("muitas coisas faltando, informações que
passam a ser irrelevantes"), com **planos padrão por plataforma** (com teto
mínimo/máximo de cobrança), busca de plataforma na primeira etapa e a
confirmação final com as políticas de responsabilidade.

### 25.1 O que a produção tinha (e o que foi removido)

O fluxo em produção (`/dashboard/my-groups/create` e `/admin/groups/new`) tinha
6 etapas, mas elas não eram as 6 do pedido:

| # | Etapa antiga | Problema apontado |
|---|---|---|
| 1 | Plataforma | sem busca, sem ordem por uso |
| 2 | **Identidade** (nome, descrição, capa) | "remover a etapa 2" — nome passa a ser automático, descrição e capa saem |
| 3 | Plano | tipo de conta solto, sem vínculo com plano da plataforma |
| 4 | Cobrança | — |
| 5 | Credenciais | — |
| 6 | **Pagamento + resumo misturados** | "separa os Pagamentos, o resumo tem que ser a última step" |

### 25.2 A trilha nova (6 etapas, idêntica nos dois wizards)

1. **Plataforma** — campo de busca, "Mais usadas" fixada no topo e **popup de
   confirmação** ("é esta plataforma? Continuar / Voltar à lista").
2. **Plano** — os planos cadastrados da plataforma (preço oficial, qualidade,
   telas simultâneas, faixa de cobrança) **+ vagas + status da assinatura**.
3. **Grupo** — **visibilidade** (Público / Privado) **+ regras do grupo**
   (opcional) — é aqui que as regras ocupam o lugar da descrição.
4. **Credenciais** — como os membros acessam a conta (+ chat e e-mail gerenciado).
5. **Pagamentos** — ciclos de cobrança, chave PIX, taxa de adesão e o valor do
   grupo (com o teto do plano).
6. **Resumo** — resumo + **políticas** + botão de criar o grupo.

Arquivos: `src/pages/user/CreateGroup.jsx` e `src/pages/admin/GroupForm.jsx`
(mesma ordem de etapas, mesma validação). As etapas são montadas com os
componentes de `src/components/group-creation/`.

### 25.3 Nome automático

`buildGroupName()` (`src/lib/platformPlanPricing.js`): **[plataforma] + [plano]**
ou, sem plano, **[plataforma] + [id curto do grupo]** (6 primeiros caracteres do
UUID em maiúsculo). O nome é refazido depois que o rascunho ganha id.

### 25.4 Planos padrão da plataforma (tabela `service_plans`)

O editor fica em **`/admin/platforms/new`** (`PlatformPlansEditor.jsx`) e grava em
`service_plans` — a tabela que já existia, com as colunas novas:

| Campo | Coluna | Papel |
|---|---|---|
| Nome do plano | `name` | identificação |
| Valor cobrado pela plataforma | `official_price` | o preço oficial do plano |
| Quantidade máxima | `max_members` | teto de vagas do grupo |
| Valor sugerido | `suggested_price` | pré-preenchido no wizard (por pessoa) |
| Valor mínimo sugerido | `min_price` | **teto inferior** por pessoa |
| Valor máximo | `max_price` | **teto superior** por pessoa |
| Telas simultâneas | `max_screens` | aparece no card do plano |
| Qualidade / observações | `quality`, `details` | aparecem no card do plano |

**O teto é POR PESSOA** (`groups.price_per_slot`), não do total: o dono não pode
cobrar de cada membro mais (nem menos) que a faixa do plano. Sem plano
cadastrado, o grupo nasce **sem vínculo de plano** e sem teto (só o mínimo
global por vaga).

### 25.5 Visibilidade e regras

`groups.visibility` (`public` | `private`): o privado **não aparece no
catálogo** — entra por convite ou pelo link. As regras do grupo
(`groups.rules`) foram para a etapa 3 e são opcionais.

### 25.6 Políticas da etapa final

`src/lib/groupPolicies.js`: a DividePass é **somente uma facilitadora de
acesso**, sem responsabilidade sobre a conta e as credenciais; **quem cria o
grupo assume total responsabilidade** por compartilhar as credenciais com os
membros. Sem aceitar, o grupo não é criado.

### 25.7 Banco

`database/add-platform-plans-and-group-visibility.sql` — **já aplicado em
produção** (conferido por REST em 01/11/2026: as colunas respondem). O arquivo
é idempotente e pode ser rodado de novo. Ele faz: campos novos de
`service_plans` + RLS (leitura pública, escrita só admin), `groups.visibility`,
`groups.plan_id`, `groups.chat_enabled` e `groups.subscription_status`.

### 25.8 QA

- `node scripts/qa-wizard-planos.cjs` → **27/27** (usuário): busca, "Mais
  usadas", popup, planos com telas/qualidade, teto bloqueando total fora da
  faixa, resumo na etapa 6 de 6 com as políticas.
- `node scripts/qa-admin-planos.cjs` → **14/14** (admin): editor de planos em
  `/admin/platforms/new` com todos os campos pedidos + a mesma trilha de 6.
- `node scripts/qa-teto-planos.mjs` → 9 planos com teto conferido, 0 falhas.

Os dois QAs leem os planos REAIS de produção (Netflix: Básico com anúncios
R$ 6,00–9,90 por pessoa, sugestão R$ 7,90; Padrão R$ 9,90–17,90; Premium
R$ 12,90–23,96) e mockam só o que grava (`groups`, `group_credentials`).

## 26. O painel admin no celular — o contrato de densidade

O admin é usado pelo operador **no celular**. Em 01/11/2026 o painel foi
redesenhado para o polegar: antes, os 9 indicadores do `/admin` ocupavam
mais de mil pixels de rolagem empilhados, os filtros do `/admin/users`
quebravam em 4 linhas de largura inteira e a lista de usuários era uma
tabela de 7 colunas que só se lia arrastando para o lado.

O contrato está em **`src/pages/admin/admin-responsive.css`** (importado por
`AdminLayout.jsx`, vale para todas as páginas do painel) e vale em três
regras:

1. **Tabela vira cartão.** A tabela recebe a classe `ad-card-table` e cada
   `<td>` recebe `data-label="Nome da coluna"`. No celular (≤720px) o
   cabeçalho some e a linha vira um cartão empilhado: `CONTATO` à esquerda,
   valor à direita; a identidade (`.ad-lead`) ocupa a linha inteira; a
   seleção em lote (`.ad-pick`) vira o quadrado no canto; as ações
   (`.ad-actions`) viram o rodapé com fio divisório. A variante
   `ad-card-table--grid` (a lista de usuários) põe os metadados em 2 colunas
   por linha. **Regra de ouro: o cartão nunca exige rolagem lateral.**
2. **Filtro não empilha.** O wrapper recebe `ad-filter-grid` (grade de 2
   colunas) ou `ad-scroll-row` (faixa rolável horizontal, para abas e
   chips).
3. **Nenhum scroll aninhado.** Painel com rolagem própria dentro da página
   obriga o operador a rolar dois eixos; no celular a lista cresce e a
   página rola uma vez só.

### 26.1 O que mudou em cada tela

| Tela | Antes | Agora |
|---|---|---|
| `/admin` | 9 indicadores em 1 coluna (~1200px) | 2 colunas, tile compacto (432px no total) |
| `/admin` | lista de atividade com rolagem interna | a página rola uma vez só |
| `/admin/users` | 4 filtros empilhados, tabela de 7 colunas | filtros em 2×2, lista em cartões |
| `/admin/users/[id]` | 7 abas empilhadas (7 linhas) | faixa de abas rolável no topo |
| `/admin/events` | chips quebrando em 5 linhas | 2 faixas roláveis (38px cada) |
| `/admin/onboarding` | indicadores em 1 coluna, gráfico espremido | 2 colunas, rótulo acima da barra |

### 26.2 O link do grupo na aba Assinaturas

Em `/admin/users/[id]?tab=subscriptions` o nome do grupo virou **link**
(`/admin/groups/{group_id}/edit`) — clicar leva direto ao grupo no admin.
O grupo vem de `user_subscriptions.group_id` (a coluna existe na assinatura;
o *embed* `group:group_id(name)` só traz o nome, por isso o id vem da
própria assinatura).

### 26.3 classes CSS globais do painel: cuidado

`.actions-cell`, `.action-btn`, `.date-cell` e `.status-badge` são classes
**globais** repetidas em 5+ arquivos do admin. Uma regra de celular em um
arquivo vaza para as outras telas: foi exatamente o que aconteceu com
`Announcements.css` (`flex-direction: column` no mobile), que empilhava os
botões de ação da lista de usuários. **Ao mexer numa dessas classes,
use o seletor da página (`.announcement-actions-cell`), não a classe global.**

### 26.4 QA

`node scripts/qa-admin-mobile.mjs` → **22/22**. Roda em viewport de celular
(390×844) e conferiu: nenhuma rolagem horizontal, indicadores em 2 colunas,
filtros em grade, tabela virada em cartão (rótulos presentes, cartão sem
estouro de largura), botões de ação em uma linha só, abas e chips em faixa
rolável, link do grupo na assinatura e — no desktop — a tabela continuando
tabela com as 7 colunas e os filtros em uma linha. Screenshots em
`qa-out/mobile/`.

---

## 26. "Acesso Negado" para quem pagou: o caso da Carolina (02/11/2026)

Relato do dono: *"a cliente está reclamando que não está conseguindo ter
acesso, mais o grupo que ela assinou... no painel admin está tudo certo com a
assinatura e ela está dentro do grupo e ativo, mas a cliente entra, clica no
grupo dela e fala acesso negado."*

### 26.1 O que o banco mostrava (e o que NÃO mostrava)

Cliente: `carolinasantos0594@gmail.com` (id `7aba6969-…-1472db68f360`).

| Fonte | Resultado |
|---|---|
| `users` | conta ativa |
| `group_members` (grupo `8a4e94ca` — "Netflix C/ Anúncio") | `status=active`, `payment_status=active`, `subscription_deadline=2027-01-27` |
| `user_subscriptions` (visão do admin) | 1 linha: Netflix, R$ 59,40, semestral, **Ativa**, próx. cobrança 26/01/2027 |
| `sync-members` (service role) | `total_subscriptions=6`, `already_ok=6`, `orphan_members=0` |

Ou seja: **a base está sadia**. A assinatura está ativa, o vínculo está
sincronizado e não há nenhum membro órfão no grupo.

### 26.2 Os três caminhos que negavam o acesso (e por que mentiam)

A tela de credenciais (`src/pages/user/ServiceCredentials.jsx`) negava o
acesso em três situações, e nas três a mensagem era a mesma — "seu acesso ao
Netflix foi encerrado, sua assinatura foi cancelada ou você saiu do grupo":

1. **Falha na consulta** (rede/banco). O código fazia *fail-closed*: negava
   e ainda culpava a cliente. Um erro passageiro trancava quem tinha pago.
2. **Link apontando para outro grupo** (`?group=` de um link antigo). As duas
   consultas voltavam vazias → negava. A cliente tinha assinatura ativa —
   só não *daquele* grupo — e a tela dizia que ela "saiu do grupo".
3. **Espelho do grupo defasado** (`group_members.status` = `inactive` /
   `cancelled` / `left`) sem assinatura visível. O `status` do espelho é lixo
   de um fluxo antigo; o que prova o pagamento é `payment_status` + prazo.

O bundle em produção (v1.0.42) já tinha a correção de 01/11 ("a assinatura
manda"), mas as outras duas portas continuavam abertas — e o conserto de 01/11
só valia enquanto houvesse assinatura visível.

### 26.3 A regra nova (o pagamento manda)

```
assinatura existe  -> estado da assinatura manda (ativa/atrasada/cancelada)
sem assinatura     -> pagamento_status='active' E prazo vigente (ou prazo
                      ausente com o espelho ativo) -> LIBERA
falha de consulta  -> "Não foi possível verificar" + "Tentar de novo"
grupo sem assinatura -> "Você não tem assinatura ativa do X neste grupo"
                       + botão "Abrir meu grupo" (o grupo que ela tem)
```

O espelho deixou de decidir o acesso: ele virou o que sempre devia ter sido —
um espelho. O `group_members` continua sendo curado pelo banco (painel +
cron), mas **ninguém mais fica trancado fora por causa dele**.

### 26.4 Prevenção (para não acontecer com mais ninguém)

- `sync-members` agora grava também a data "paga até" no vínculo
  (`subscription_deadline`) e zera o `left_at` — sem ela, ninguém consegue
  dizer se o período ainda vale.
- `update-subscription-statuses` (cron diário) passou a curar o espelho
  **mesmo quando a data "paga até" está vazia**. Antes ele exigia o prazo
  preenchido, e um vínculo sem prazo ficava defasado para sempre.
- `database/EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql`: cura o
  passado de todo mundo (diagnóstico + reparo + conferência), **sem cancelar
  assinatura e sem desvincular ninguém**. Testado no Postgres local
  (`scripts/test-reparo-acesso-schema.sql` + `…-verifica.sql`): 5 casos,
  idempotente na segunda rodada.

### 26.5 QA

`node scripts/qa-acesso-credenciais.cjs` → **13/13**. Reproduz os cenários com
o PostgREST mockado (nada é gravado no banco):

| Cenário | Esperado |
|---|---|
| A) pagou e está em dia | entra |
| B) espelho legado + pagamento ativo | entra |
| C) falha na consulta | "não foi possível verificar" + "Tentar de novo" |
| D) link de outro grupo | aviso certo + "Abrir meu grupo" |
| E) assinatura cancelada de verdade | "Pague de novo para reativar" |
| F) pagou mas sem a data "paga até" gravada | entra |

### 26.6 O que responder à cliente

O pedido de acesso dela está correto no banco: assinatura ativa até 26/01/2027
e vínculo ativo no grupo. Publicando o front, a tela passa a abrir direto —
e, se ela chegar por um link antigo de outro grupo, o botão "Abrir meu grupo"
leva ao grupo certo.

---

## 27. Onboarding novo: 11 perguntas → 6, com bifurcação (02/11/2026)

O pedido: "tem muita coisa que deixa o usuário cansativo de responder". O
questionário antigo tinha 11 perguntas (quantas assinaturas, gasta quanto,
já compartilha, com quem, dificuldade, 5 perguntas de plataforma e as
indicações). O fluxo novo tem **6 no caminho padrão e 5 no mais curto**.

### 27.1 O caminho

```
avatar → boas-vindas → maior dificuldade → 2 convidados
       → criar / entrar / ambos
       → [serviços para CRIAR] → [serviços para ENTRAR] → texto livre
```

A bifurcação é **por resposta**, declarada no questionário — não é um `if`
espalhado no componente:

| Onde | O quê |
|---|---|
| `options[].next` | a opção escolhida aponta o próximo passo ("criar" → `share_platforms`) |
| `nextWhen(answers)` | o próximo depende de outra resposta ("criar" pula a pergunta de entrar) |
| `thenNext` | próximo passo fixo |

`buildOnboardingPath(answers)` resolve isso e devolve a sequência; o
componente só anda no índice. Mudar o fluxo é mexer em
`src/lib/onboardingQuestions.js` — o relatório admin lê a MESMA constante,
então pergunta e gráfico nunca divergem.

**Resultado dos caminhos:**

| Resposta | Passos | Perguntas |
|---|---|---|
| "Quero criar meu grupo" | criar → texto livre | 5 |
| "Entrar em grupo existente" | entrar → texto livre | 5 |
| "Ambos" | criar → entrar → texto livre | 6 |

### 27.2 Regras que o usuário pediu

- **Mínimo de 2 convidados.** O botão de continuar fica *desabilitado* (não
  "erro depois do clique") e a dica diz quantas faltam.
- **Última pergunta aberta** ("O que você espera encontrar na plataforma? E o
  que te faria usar a nossa plataforma?"), com `textarea`. É **opcional** —
  forçar texto no celular seria o oposto de reduzir o atrito.
- **"Onde nos conheceu" no admin.** A pergunta é feita no *cadastro*
  (`users.lead_source`), não no onboarding — duplicar seria pedir a mesma
  coisa duas vezes. No admin ela vira: card "Onde nos conhecem" (com "X de Y
  cadastros"), chip por pessoa e item no detalhe da resposta.

### 27.2.1 Depois: 1 indicação e o próprio número bloqueado (03/11/2026)

No primeiro acesso em produção apareceu o que as pessoas faziam: **digitavam o
próprio número duas vezes** só para cumprir a etapa, e o fluxo perde gente
justamente nela. Duas regras novas:

| Regra | Como funciona |
|---|---|
| Mínimo 1 indicação (era 2) | `minInvites: 1` no questionário; o botão libera com uma pessoa |
| O próprio número não vale | `mesmoTelefone(phone, profile.phone)` → "Este número é idêntico ao seu do cadastro. Indique outra pessoa." |

**Comparar telefone exige tirar o DDI.** O cadastro grava com o código do
país ("55 11 98888-7777") e a pessoa digita com DDD ("11 98888-7777"), então
comparar a string ou os últimos 10 dígitos não funciona: os últimos 10
confundem dois números de DDD diferente com o mesmo sufixo (11 e 21 com os
mesmos 8 dígitos). A regra certa é **tirar o 55 e comparar o national
inteiro**. E o DDI nem é digitável no formulário: `maskPhone` trava em 11
dígitos.

No caminho de retomada, a indicação salva com o próprio número **sai da
lista** — assim ela não conta para o mínimo e não trava a etapa.

### 27.2.2 A aba de qualificação com a cara do relatório (03/11/2026)

`/admin/users/[id]?tab=onboarding` mostrava os nomes crus das plataformas
("netflix"), sem ícone, sem categoria e sem dizer se a pessoa quer criar ou
entrar num grupo. Agora usa a **mesma linguagem visual** do
`/admin/onboarding`:

- 6 indicadores no topo (`.ob-report-stats`): onde nos conheceu, quer criar
  grupo, quer entrar em grupo, pessoas indicadas, serviços para criar,
  serviços para entrar;
- cards (`.chart-card`) com o perfil de qualificação, a resposta aberta em
  citação, os serviços de cada intenção **agrupados por categoria** e as
  pessoas convidadas (com link de WhatsApp);
- a origem do cadastro no indicador e no detalhe.

A lógica de leitura das plataformas (casar pelo id ou pelo nome, trazer
ícone, cor e categoria) saiu do relatório e foi para
`src/lib/onboardingPlatforms.js` — as duas telas leem o mesmo lugar, então
não podem divergir.

### 27.3 O `kind` das plataformas

Cada pergunta de plataforma tem um `kind` **próprio**:

- `share` → serviços que a pessoa quer **criar** um grupo
- `join` → serviços que a pessoa quer **entrar** num grupo

Antes, 4 perguntas dividiam o mesmo `kind` e o banco não guardava em qual
pergunta a plataforma tinha sido marcada (o card de "filmes e séries" acabava
mostrando Spotify junto). Os valores antigos (`current`, `interested`) seguem
aceitos no CHECK para não quebrar dado já gravado.

### 27.4 Migration (aplicada em produção)

`database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql` — 1 bloco, idempotente:

- `user_onboarding_profiles` += `group_intent text`, `expectations text`
- `user_onboarding_interests.kind` aceita `share` e `join`
- GRANTs de `anon`/`authenticated` (guardados: não quebram se o papel não
  existir) + índice de `group_intent`
- Conferência no fim: "colunas novas: OK" / "kind aceita share e join: OK"

Testado no Postgres 18 local (`scripts/test-onboarding-novo-fluxo.sh`): **8/8**,
inclusive a idempotência na segunda rodada.

**Enquanto a migration não roda, o app NÃO trava**: `persistProgress` cai
para as colunas antigas quando o PostgREST responde `PGRST204` / `42703`
(coluna fora do schema cache) e o `kind` que o CHECK rejeita é pulado. O
usuário termina o onboarding; só as respostas novas ficam de fora.

### 27.5 O seletor de plataformas

O catálogo tem **103 serviços ativos**. Uma lista única seria pior que o
questionário antigo — então o `PlatformPicker` ganhou **busca por nome** e
**blocos por categoria** (10 blocos: Filmes e séries, Música, Saúde,
Educação, IA, Ferramentas, Produtividade, Leitura, Games, Segurança).
"Nenhuma destas" fica no topo, e o "Outra plataforma" continua no rodapé.

### 27.6 QA

`scripts/qa-onboarding-novo-fluxo.mjs` → **29/29** (local e produção):

| Bloco | O que confere |
|---|---|
| convidados | botão travado sem ninguém, libera com 1, recusa o próprio número (com e sem DDI no cadastro) |
| criar | cai em "criar um grupo" e **não** passa por "entrar" |
| entrar | cai em "entrar em grupos" e **não** passa por "criar" |
| ambos | as duas perguntas, nesta ordem |
| última | eyebrow "Última pergunta" + `textarea` + tela "Tudo pronto!" |
| banco | barreira, intenção, resposta aberta, plataforma `share`, a indicação, `onboarding_completed_at` |
| contagem | "Pergunta 1 de 6" (o antigo era 11) |

`scripts/qa-admin-origem.mjs` → **13/13**: card "Onde nos conhecem", chip de
origem por pessoa, chip da resposta aberta, a citação no detalhe e a aba de
qualificação da ficha (indicadores, plataformas por categoria, citação).

### 27.7 Armadilhas

- **Erro de coluna ausente no PostgREST é `PGRST204`**, não `42703`:
  `{"code":"PGRST204","message":"Could not find the 'group_intent' column of
  'user_onboarding_profiles' in the schema cache"}`. Tratar só `42703` faz o
  fallback não disparar — e o "Concluir" falha, prendendo o usuário no
  primeiro acesso.
- **A tela "Tudo pronto!" era código morto**: o `refreshProfile()` do fim
  trazia `onboarding_completed_at` preenchido e o `OnboardingPage` redirecionava
  para o dashboard antes da confirmação. Agora o estado "terminou" sobe para
  a página (`onFinished`), que segura o redirect.
- **O `helper` da etapa de plataforma aparecia duas vezes** (uma no passo,
  outra no `PlatformPicker`).
- **Comparar telefone pelos últimos dígitos não funciona**: o DDD é o que
  diferencia duas pessoas. Tire o DDI e compare o national inteiro.
- **`maskPhone` trava em 11 dígitos**: o DDI não é digitável no formulário.
  O caso real é o inverso — o *cadastro* tem o 55 e a pessoa digita sem.

---

## 28. A landing page em movimento (04/11/2026)

O pedido: dar **sensação de economia e de prazer** na primeira tela, e
sinalizar de forma grata os momentos de conquista (cadastro, onboarding).

### 28.1 O card do preço virou uma demonstração

O `SplitDemo` do hero mostrava sempre a **primeira** plataforma com preço
(`lista.find(...)` → Disney Plus) e o preço já dividido em 4, parado. Agora:

- **a plataforma é sorteada a cada visita**, dentro do catálogo que tem
  `official_price` real (`services` → `lista[Math.floor(Math.random()*len)]`).
  Um `ref` garante uma escolha só por carregamento, mesmo com o catálogo
  chegando depois;
- **as pessoas entram uma a uma** (1 → 4, 1,5s entre elas), e o preço de
  cada uma cai junto: `share = official_price / pessoas`. As vagas vazias
  ficam visíveis (borda tracejada) e se preenchem;
- **o número "conta"** até o valor novo — `useMotionValue` + `useSpring` +
  `useMotionValueEvent` (sem estado no meio do caminho);
- **quando o grupo fecha com 4 pessoas**, o confete dispara e o card dá um
  pulo (`animate={{ scale: [1, 1.015, 1] }}`).

O texto também muda: com 1 pessoa, "Por enquanto é só você no grupo: paga o
valor cheio" (economia zero não pode aparecer como se fosse economia).

### 28.2 Confete em 3 lugares

`src/components/Confetti.jsx` — **sem dependência nova**: o projeto já usa
`motion` (Framer Motion v14). O gatilho é o `fire` (um contador): trocar o
valor dispara de novo, e a `key` no container remonta as peças.

| Onde | Como entra |
|---|---|
| Card do hero | camada **contida** no card (`position: relative` + `overflow: hidden`) |
| Cadastro (`/register`) | overlay fixo de tela cheia ao aparecer "Conta criada!" |
| Onboarding | overlay fixo ao aparecer "Tudo pronto!" |

Cores: as da marca (indigo, violeta, laranja, âmbar, verde, rosa).
`useReducedMotion` desliga tudo — quem pediu menos movimento no sistema
operacional não ganha confete.

### 28.3 Animação de rolagem

`src/components/Reveal.jsx` — envolve a seção e usa `whileInView`. A
animação é **só de transform** (y + scale), nunca `opacity: 0` no estado
inicial: a regra do projeto é que, se o navegador pausar o `requestAnimation
Frame` (aba em segundo plano), o conteúdo não pode ficar invisível. Com
transform, o pior caso é o bloco parado 20px abaixo.

### 28.4 QA

`scripts/qa-landing-animacoes.mjs` → **11/11** (celular): sorteio da
plataforma a cada carregamento, entrada das pessoas, queda do preço, confete
no 4º, animação de scroll e confete do cadastro (com o `signup`
interceptado — nenhum usuário real é criado).

`scripts/qa-landing-desktop.mjs` → **7/7**: 4 pessoas no card, confete, sem
estouro de largura, FAQ e CTA aparecem na rolagem, sem rolagem horizontal.

`scripts/qa-onboarding-novo-fluxo.mjs` → **30/30**: inclui o confete da tela
"Tudo pronto!".

**Armadilha de medir confete.** No primeiro frame as peças já estão no DOM
com `opacity: 0`. Contar peças não prova que o confete apareceu — conte só
as que têm `opacity > 0.2`, e faça isso **durante** a animação (a do
onboarding dura ~3s e só começa ~2s depois do clique, porque a gravação no
banco vem antes da troca de tela).

---

## 29. Card de pagamentos no painel admin (04/11/2026)

O pedido: "quando tiver qualquer pagamento deve ter um card informando os
valores pagos e a quantidade; clico aqui e abre o toggle com as informações
de quem pagou, qual grupo, valor e status".

### 29.1 O que o card mostra

| Estado | Tela |
|---|---|
| Fechado (padrão) | "Pagamentos de novembro" · **R$ 83,85** · "5 pagamentos · 2 confirmados · ver quem pagou" + chevron |
| Aberto | a lista dos pagamentos, um por linha |

Cada linha mostra **quem pagou** (nome + e-mail), **o grupo** (nome + serviço),
**o valor** e o **status** (Pago / Pendente / Falhou / Estornado / Cancelado,
com bolinha colorida e etiqueta).

### 29.2 Decisões

- **O card só aparece se houver pagamento** do mês. Sem dado, ele é só
  ruído no painel.
- **O total é só o que está com status `paid`**; a lista mostra **todos**
  (inclusive pendente e falhado) — o operador precisa ver o que ainda não
  entrou, não só o que entrou.
- **Escopo: o mês corrente**, o mesmo período do card "Receita do mês".
- **Join na query**: `user:user_id (id, name, email)` e
  `group:group_id (id, name, service:service_id (id, name))`. Sem isso o
  operador teria que abrir pagamento por pagamento para descobrir de quem
  era — que é exatamente o trabalho que o card veio eliminar.
- O cabeçalho é um `<button>` com `aria-expanded`/`aria-controls`: teclado
  funciona e leitor de tela anuncia o estado.

### 29.3 CSS

Prefixo `pay-` **escopado em `.admin-dashboard`** — as classes do admin são
globais e vazam para as outras telas (regra do projeto). No celular a linha
vira duas linhas (quem + valor na primeira, grupo na segunda); no desktop
fica em uma só (70px de altura).

### 29.4 QA

`scripts/qa-admin-pagamentos.mjs` → **14/14** (celular + desktop):

| Bloco | O que confere |
|---|---|
| sem pagamento | o card **não** aparece (dados reais, tabela vazia) |
| com pagamento | card, total (R$ 83,85), quantidade (5 · 2 confirmados) |
| toggle | abre, fecha, e a lista tem uma linha por pagamento |
| lista | quem pagou, grupo + serviço, valor e status de cada um |
| celular | não estoura a largura (366px de 390px) |
| desktop | uma linha só por pagamento, sem rolagem horizontal |

**A lista é injetada na resposta da API** — a tabela `payments` está vazia em
produção, e o teste é da TELA, não do dado. O caso "sem pagamento" é
conferido com os dados reais.

**Armadilha do teste.** O `select` do PostgREST vem codificado
(`user%3Auser_id`), então o filtro da rota precisa do `decodeURIComponent`.
E o `Intl.NumberFormat` usa espaço **não separável** (U+00A0) entre "R$" e
o número: comparar com espaço normal dá falso negativo.

---

## 30. Revenda via Pulse Coding: o catálogo da Pulse dentro do DividePass (06/11/2026)

O DividePass passou a vender produtos de **terceiro** (a revenda da Pulse
Coding): o cliente paga no gateway do DividePass, o DividePass compra na
Pulse e entrega o acesso. A documentação completa está em
`docs/pulse-parceiro.md`. Aqui ficam as **decisões e as armadilhas**.

### 30.1 O modelo

Cada pacote da Pulse vira um **grupo** do DividePass com a tag
`"Via Parceiro"`, dentro da plataforma correspondente (Netflix, ChatGPT,
Claude...). Como a Pulse vende **conta privada por compra**, cada compra gera
**uma credencial só do comprador** — 1 compra = 1 cliente.

O grupo é a vitrine, não o rateio:

- `has_slot_limit = false` ("vagas ilimitadas") — cada comprador leva a SUA
  conta;
- `is_official = true` e `owner_id` = admin → **sem repasse** de carteira (o
  custo é da plataforma);
- `has_entrance_fee = false` e `chat_enabled = false`.

### 30.2 Decisões do dono

| Decisão | Valor |
|---|---|
| Preço de venda | `original_price` + **20%** de markup (editável por grupo) |
| Pacote indisponível na Pulse | importado, mas **fora da vitrine** |
| Categoria "Serviços" | **excluída** do import automático |
| Renovação | **manual** (nova compra na Pulse pelo fluxo normal) |

### 30.3 A API mente sobre os status HTTP

A documentação diz 410 para pacote antigo e 402 para saldo insuficiente.
**Não é assim** (testado em 06/11/2026):

| Real | HTTP | `code` |
|---|---|---|
| Saldo insuficiente | **400** | `saldo_insuficiente` |
| Sem estoque | 409 | `sem_estoque` |
| Pacote inexistente | **404** | `pacote_inexistente` |
| Pedido inexistente | 404 | **sem `code`** |

Um 400 pode ser "dado inválido" ou "saldo"; um 404 pode ser "pacote sumiu" ou
"pedido não existe". **O `code` do corpo é o discriminador** — o status HTTP
sozinho quebraria a lógica de remapeamento. O `pulseClient` traduz tudo em
`PulseError.code`.

### 30.4 A armadilha do `next_charge_at`

`process-recurring-billing` **NÃO** chama `confirmPayment`: ele grava o
pagamento e a assinatura por conta própria. Se a assinatura "Via Parceiro"
fosse criada com `next_charge_at` preenchido, o job de recorrência
**cobraria o cliente de novo sem comprar nada na Pulse** — porque o gancho
que compra na Pulse está no `confirm-payment`.

Por isso, para grupo "Via Parceiro":

- `next_charge_at = NULL` (o job filtra por `next_charge_at <= agora` e o
  NULL é excluído pelo PostgREST);
- `renewal_due_at` / `expires_at` = data de validade do pacote;
- **não** cria `billing_cycles` pendente.

A renovação é manual: o `SubscriptionRenewalModal` já existente →
`create-payment` → `confirm-payment` → nova compra na Pulse.

### 30.5 Por que a entrega NÃO vai para `group_credentials`

`group_credentials` é lida pelo navegador via RLS e tem o trigger
`release_credential`: quando o membro sai do grupo, a credencial é
desalocada (`assigned_to = NULL`) e, pela policy que aceita `assigned_to IS
NULL`, **a conta privada passaria a ser visível para os outros membros do
grupo**.

Por isso a entrega da Pulse vive em `pulse_entregas` (RLS: só o dono, via
edge function). E, de brinde, o `ServiceCredentials.jsx` tinha um bug real:
pegava `group.credentials[0]` — mostrava a conta de **outro** cliente em
grupo com várias credenciais. Agora ele escolhe a credencial **atribuída a
mim** (`MyCredentials.jsx` já fazia certo).

### 30.6 Idempotência

`external_id` = 8 caracteres (letras e números), gerado **uma vez** por pedido
e **nunca** muda. Repetição de rede/timeout usa o **mesmo** `external_id` (a
Pulse devolve `duplicate: true` e não cobra de novo) e
`pulse_pedidos` tem `UNIQUE (transaction_code, group_id)`, então o replay do
webhook do gateway não cria um segundo pedido.

### 30.7 O que a API tem no catálogo (e a doc não)

`price` (o que EU pago), `original_price` (preço de venda ao consumidor),
`stock`, `automatic_stock`, `purchase_capacity`, `available_stock`,
`availability`, `delivery`, `orderable_via_api`, `credits`, `features`.

No dia: **81 pacotes, 63 compráveis, 18 indisponíveis** (Netflix, Spotify,
YouTube Premium, ChatGPT Plus Conta Privada...). **21 dos 63 têm margem zero**
(`price` == `original_price`) — o painel marca esses como "sem margem".

E o **saldo da conta está em R$ 0,00**: até recarregar, nenhum `dry_run`
passa (400 `saldo_insuficiente`) e nenhum pedido real sai.

### 30.8 Os arquivos

- `supabase/functions/_shared/pulse.ts` — o `pulseClient` (6 ações, timeout
  30 s, erro por `code`, HMAC do webhook);
- `supabase/functions/_shared/pulse-catalog.ts` — plataforma de destino,
  ciclo, markup, margem, exclusões;
- `supabase/functions/_shared/pulse-orders.ts` — idempotência e gravação;
- `supabase/functions/_shared/pulse-import.ts` — o importador de catálogo;
- `supabase/functions/pulse-admin|pulse-webhook|pulse-entrega|pulse-poll/`;
- `database/EXECUTAR-2026-11-06-pulse-parceiro.sql` — 5 tabelas, view, RLS,
  guarda do trigger e o cron do polling;
- `src/pages/admin/PulseCatalog.jsx` + `PulseOrderDetail.jsx` (o detalhe é
  **página com id na URL**: `/admin/pulse/pedidos/:id`);
- `src/pages/user/MyDeliveries.jsx` → `/dashboard/entregas`;
- `scripts/pulse-teste.mjs` (65 asserções, sem rede) e
  `scripts/pulse-dry-run.mjs` (cadeia real, `dry_run`, não cobra).

### 30.9 Bug pego pelo teste

"Combo Play — Spotify Premium + YouTube Premium | 3 Meses Cada" caía na
plataforma **Spotify** (a regra do serviço batia antes da regra do combo).
Agora a regra "combo" vem **primeiro** na lista.

---

## 31. `payment_method` do gateway é um OBJETO — e o VARCHAR(50) travava a liberação (07/11/2026)

### 31.1 O que apareceu

No painel admin, o evento **"Pagamento aprovado sem liberação"** se repetia a
cada 15 minutos, para vários clientes, com a mesma mensagem:

```
user_subscriptions update failed: value too long for type character varying(50)
```

Em 24h foram **1.536 eventos** — o painel ficou inutilizável e, o pior: o
cliente **tinha pago** e a liberação do grupo falhava.

### 31.2 A causa (três elos)

1. A IO Pay devolve `payment_method` como **objeto**: no cartão é o cartão
   inteiro (`holder_name`, `fingerprint`, `verification_checklist`) e no Pix é
   o BR Code. São **480–540 caracteres**.
2. `check-iopay-tx` gravava esse objeto **cru** em
   `payment_attempts.payment_method`.
3. O job `reconcile-payments` lia a tentativa e repassava o valor cru para o
   `confirm-payment`, que gravava em `user_subscriptions.payment_method` —
   uma coluna **VARCHAR(50)**. → estouro.

### 31.3 Por que explodiu de uma vez

O bug era antigo, mas o **`reconcile-payments` estava AUSENTE em produção**
até 06/11/2026. Publicada a função, o job passou a rodar a cada 15 minutos e
a reprocessar as tentativas antigas — todas com o JSON dentro.

E o webhook responde **503** de propósito quando a confirmação falha (para o
gateway reenviar). Como a confirmação falhava sempre, virava **loop**.

### 31.4 A regra

> Para uma coluna curta, **NUNCA** gravar o que veio do gateway. Grave o
> método **normalizado**: `pix` / `credit_card` / `bank_slip`.

- `supabase/functions/_shared/metodo-pagamento.ts` (novo) — normaliza e limita;
- `check-iopay-tx` grava o método normalizado em `payment_attempts`;
- `reconcile-payments` normaliza antes de confirmar e **ignora tentativas
  órfãs** (grupo que não existe mais), que geravam evento sem cliente real;
- `confirm-payment` grava o método normalizado e limita `billing_cycle`;
- `scripts/test-metodo-pagamento.ts` — 22 casos, com o JSON real do IO Pay.

### 31.5 O que foi feito em produção

- Cron `reconcile-payments` **removido** durante o atendimento e **recriado**
  (jobid 18, `*/15`);
- 3 functions republicadas;
- 71 `payment_attempts` com JSON normalizadas;
- 29 tentativas órfãs marcadas (`reconciled_orphaned`);
- **42 assinaturas liberadas** nas rodadas manuais do job;
- **1.542 eventos de spam** removidos do painel (ficaram só 3 casos reais de
  "grupo cheio").

### 31.6 O que NÃO era

**Nenhum cobro indevido.** O `reconcile-payments` **não cobra**: ele pergunta
à IO Pay o status de transações antigas e **libera** o acesso de quem já
pagou. Os 43 pagamentos de 24h (R$ 1.167,60) são todos `paid` — confirmações
de pagamentos que já tinham sido feitos. O job de cobrança recorrente não
rodou nenhuma vez no período (`billing_logs` vazio).

### 31.7 A armadilha: function que importa function embute uma CÓPIA

Depois de corrigir o `confirm-payment`, o job **continuou** criando um evento
por rodada. A pista estava no dado: o evento novo nascia com
`transaction_id = NULL`, porque a versão antiga nem tinha esse campo.

**Por quê:** `reconcile-payments` faz
`import { confirmPayment } from "../confirm-payment/index.ts"`. O bundler
embute uma **cópia** do `confirm-payment` dentro do `reconcile-payments`.
Publicar o `confirm-payment` **não** atualiza quem o importa — é preciso
republicar as dependentes:

| Function | Importa o `confirm-payment`? |
|---|---|
| `reconcile-payments` | sim (é o caso deste incidente) |
| `check-iopay-tx` | sim |
| `iopay-webhook` | sim |
| `asaas-webhook` | sim |
| `stripe-webhook` | sim |
| `pagarme-webhook` | sim |
| `force-confirm-payment` | sim |
| `woovi-webhook` / `check-woovi-tx` | sim (via `_shared/woovi-confirm.ts`) |

**Regra:** depois de mexer numa function compartilhada, liste quem a importa
e publique todas. E confirme pelo **bundle publicado** (Management API:
`GET /v1/projects/<ref>/functions/<fn>/body` — o corpo vem em **bytes**,
decodifique como UTF-8), não pelo código local nem pelo "deployed
successfully".

### 31.8 A trava de spam: um evento por problema, não por rodada

`platform_events.metadata` é jsonb, mas o conteúdo gravado é uma **STRING
JSON** (`metadata: JSON.stringify({...})`). Por isso `metadata->>'transaction_id'`
devolve NULL e `metadata LIKE` nem existe (jsonb não tem o operador `~~`).

Daí a coluna dedicada `platform_events.transaction_id`
(`database/add-platform-events-transaction-id.sql`, com backfill dos eventos
antigos). Com ela, o `confirm-payment` verifica se o **mesmo pagamento** já
foi registrado nas últimas 24h e, se sim, não duplica o evento.

O caso real continua visível — só não se repete a cada 15 minutos.

### 31.9 O job foi PAUSADO a pedido do dono (07/11/2026)

Mesmo com o bug corrigido, o `reconcile-payments` continuava rodando a cada
15 minutos e consumindo **21 chamadas à API da IO Pay por rodada**. O dono
pediu para pausar. Foi pausado — **removido do `cron.job`** (a função segue
no ar; só o agendamento parou).

```
node scripts\supabase-sql.mjs database\pausar-reconcile-payments.sql   # pausar
node scripts\supabase-sql.mjs database\religar-reconcile-payments.sql  # religar
node scripts\checar-reconciliacao.mjs                                  # rodar na mao
```

`scripts/checar-reconciliacao.mjs` roda a mesma coisa na mão e mostra o
panorama: quantas foram liberadas, o que continua travado (com o motivo) e o
que ainda está esperando o gateway.

**O que fica sem a rede de segurança enquanto estiver pausado:** quem paga o
Pix pelo aplicativo do banco e **fecha a aba** antes de a confirmação chegar.
O caminho normal (webhook da IO Pay) continua funcionando — o job é a rede
de segurança, não o caminho principal.

**O caso que ficou aberto (decisão do dono):** o pagamento de R$ 1,00 no
grupo "Max" (5/5, com 5 clientes reais pagando). O valor foi cobrado e a
liberação não saiu porque o grupo está cheio. Duas saídas: abrir uma vaga no
grupo e rodar `scripts\checar-reconciliacao.mjs`, ou estornar na IO Pay.

O modal "Pagamento com Problema" do painel admin é disparado pelo Realtime a
cada INSERT novo em `platform_events`. Com o job pausado e o evento pendente
removido, ele não abre mais (verificado no browser: 0 inserções em 12s).

---

## 32. "appID inválido": o AppID da Woovi é POR AMBIENTE (07/11/2026)

### 32.1 O sintoma

O dono estava testando o checkout V2 com o PIX na Woovi. Em **sandbox** o PIX
saía; ao trocar o interruptor para **produção**, toda cobrança voltou:

```
Pagamento não concluído
Erro ao criar cliente na Woovi: appID inválido
```

### 32.2 A causa (e por que o erro não ajudava)

A Woovi tem **duas contas**: a de teste (`api.woovi-sandbox.com`) e a real
(`api.woovi.com`). Cada uma tem o seu **AppID**, e o AppID de uma é **recusado**
pela outra. O projeto guardava **um AppID só** (`woovi_app_id`) e trocava
apenas a URL — então, em produção, a API real recebia o AppID do sandbox.

Verificado na API em 2026-11-07, com o AppID do sandbox:

| Chamada | Resultado |
|---|---|
| `GET api.woovi-sandbox.com/api/v1/customer` | **200** |
| `GET api.woovi.com/api/v1/customer` | **401 `appID inválido`** |

O 401 é o MESMO erro para AppID trocado, AppID do ambiente errado, conta
diferente ou AppID revogado. Não dava nenhuma pista do que era.

### 32.3 A correção

Um AppID por ambiente, escolhido **pelo ambiente** (`_shared/woovi.ts`):

- `woovi_app_id_sandbox` → conta de teste; se vazia, cai na legada
  `woovi_app_id` (que sempre guardou o AppID de teste);
- `woovi_app_id_production` → conta real. **Sem reserva**: cair no AppID do
  sandbox reproduziria o 401 e poderia mandar cobrança para a conta errada;
- `woovi_app_id` → legada, continua espelhando o sandbox (o script do webhook
  ainda a lê).

Migration idempotente: `database/add-woovi-app-id-por-ambiente.sql` (rodada em
produção em 07/11/2026).

**Detalhe que ficou claro:** o interruptor `app_settings.ambiente` — chamado de
"global" — **só move a Woovi**. A IO Pay tem o seu (`iopay_env`). Dá, portanto,
para testar o V2 na Woovi de sandbox **com o cartão da IO Pay em produção** ao
mesmo tempo. A tela do Admin agora diz isso na cara.

### 32.4 A tela de Configurações foi reformulada

O pedido foi "melhorar o UI/UX e colocar o input das credenciais da Woovi
por lá". O que mudou em `/admin/settings`:

- **menu lateral fixo** com as 9 seções, com a seção ativa destacada;
- cada seção virou um **card** próprio (antes era um card só com divisórias);
- **barra de salvar fixa** no rodapé, com a contagem de alterações pendentes
  ("3 alterações não salvas") e aviso ao sair da página;
- **olho** para revelar/ocultar qualquer credencial (antes o campo de senha
  era um `type=password` sem saída);
- **credenciais da Woovi por ambiente** (Sandbox e Produção lado a lado), com a
  etiqueta **"em uso agora"** no AppID do ambiente ativo e o botão **"Testar"**;
- cabeçalho com o resumo do estado real (ambiente, gateway ativo, gateway do
  PIX e do cartão) e alerta quando falta o AppID do ambiente ativo.

O botão "Testar" chama a edge function nova **`woovi-teste-conexao`** (só
admin): ela faz uma leitura simples (`GET /api/v1/customer`) na URL do
ambiente escolhido e devolve "aceita" ou "recusada, com a dica de qual AppID
usar". Testa **o que está no campo**, sem precisar salvar antes. O AppID
nunca volta na resposta.

### 32.5 O roteamento do V2 foi PROVADO em produção

Com a divisão ligada (`split_gateway_enabled=true`, `split_gateway_pix=woovi`,
`split_gateway_card=iopay`, `split_gateway_scope=v2`), três chamadas reais
ao `create-payment` (o grupo é um UUID **inexistente**, para não criar
cobrança):

| Chamada | Resposta | Prova |
|---|---|---|
| V2 + PIX (`split_gateway: true`) | 400 `Credenciais da Woovi (produção) não configuradas…` | caiu na **Woovi** |
| V1 + PIX (sem `split_gateway`) | 404 `Grupo não encontrado` | caiu na **IO Pay** |
| V2 + cartão (`split_gateway: true`) | 404 `Grupo não encontrado` | caiu na **IO Pay** |

Script: `.tmp-verify/provar-roteamento-v2.mjs` (6/6).

> ⚠️ **Armadilha do teste**: o id de grupo `00000000-0000-0000-0000-000000000000`
> **existe** (é um grupo de teste antigo). Com ele, a chamada que vai para a IO
> Pay **cria um PIX de verdade** antes de qualquer validação — o handler da IO
> Pay cobra antes de conferir o grupo. Use sempre um UUID aleatório. (Foi o
> que aconteceu na primeira rodada: sobrou um PIX pendente de R$ 14,90 na conta
> "QA Mavis" — **não pago**, sem dinheiro movido, e as duas linhas do banco
> foram apagadas. A IO Pay não expõe endpoint de cancelamento: os 4 tentados
> devolvem 404 "This endpoint has not found".)

### 32.6 Bônus: um bug de CSS que só apareceu com a tela nova

O radio de "Onde a divisão vale" ficava a ~290px do texto. Causa: o
`.form-group input { width: 100% }` de `src/pages/admin/Platforms.css` —
o radio está dentro de um `.form-group`, então virava uma barra de 100% de
largura e empurrava o texto. Corrigido com `width: auto` no
`.split-scope-option input[type="radio"]`.

**Lição:** `.form-group input` é regra **global por classe** — qualquer input
dentro de um `.form-group` herda `width: 100%`. Radio e checkbox precisam
voltar ao tamanho natural.

### 32.7 O que ainda falta

O **AppID da conta real da Woovi**. Ele só existe no painel da Woovi (conta de
produção → API/Plugins → Nova API/Plugin) — nenhuma API do sandbox o gera
(`POST /api/v1/application` cria aplicação **na conta do sandbox**).

Caminho: Admin → Configurações → Credenciais → Woovi → "AppID de Produção" →
colar → **Testar** (tem que responder "aceita") → **Salvar Configurações**.

Até lá, o checkout V2 com PIX responde a mensagem clara acima — **não** cai
para a IO Pay em silêncio (nunca cairia: o roteamento é decidido no backend).

### 32.8 Como rodar o QA do painel admin (procedimento)

`scripts/lib/conta-qa.mjs` injeta a sessão da conta `qa.mavis@divteste.com`
no `localStorage`, mas **a conta não é admin no banco**. Isso não basta para
QA de verdade, por dois motivos:

- a **RLS** do `app_settings` só libera as chaves públicas para usuário
  logado — as credenciais (AppID, segredos) não chegam no frontend;
- a edge function `woovi-teste-conexao` confere `users.role = 'admin'` **no
  banco** e devolve 403 para quem não é.

Procedimento (promover → rodar → reverter), com a conta de teste:

```powershell
node scripts\supabase-sql.mjs --query "update public.users set role = 'admin' where email = 'qa.mavis@divteste.com'"
node .tmp-verify\qa-admin-settings.mjs      # 20/20
node scripts\supabase-sql.mjs --query "update public.users set role = 'user' where email = 'qa.mavis@divteste.com'"
```

**Reverta sempre** — a conta não pode ficar como admin. Os scripts de QA do
checkout (`qa-checkout-v2-split.mjs`) **não** precisam da promoção: rodam com
usuário comum. E nenhum script de QA pode clicar em "Pagar" nem em "Salvar".

---

## 33. O Pix Automático é recorrente de verdade — três bugs achados no teste real (07/11/2026)

O dono testou o V2 e escreveu: *"foi o pix normal, porem nesta caso estamos
fazendo uma assinatura pix precisa ser recorrente e nao me mostrou nada
quando foi gerado o pix"*.

O diagnóstico saiu do dado, não do palpite. As duas tentativas dele estão no
`payment_attempts` (`gateway = 'woovi'`, `payment_type = 'subscription'`) e as
duas tinham **exatamente o mesmo formato**:

```json
{ "charge": { ... }, "subscription": null, "pix_copy_paste": null }
```

`subscription: null` = **o mandate (assinatura) NÃO foi criado**. O que
chegou ao usuário foi uma cobrança avulsa — o "pix normal".

### 33.1 Bug 1 — a Woovi só cria a assinatura de um cliente com CPF

```
POST /api/v1/subscriptions
-> 400 {"error":"You need to inform a customer to create a subscription"}
```

O `customer` do corpo não é um objeto livre: **a API resolve o cliente pelo
CPF** (`taxID`). Verificado na API:

| Cliente | Assinatura |
|---|---|
| COM CPF | **200** (mandate criado) |
| SEM CPF | **400** "You need to inform a customer…" |

E o motivo de ninguém ter CPF: **o app não coleta CPF**. `users.cpf` era
`null` para todo mundo — inclusive para o dono (`gabriel@byefit.com.br`) e
para a conta de QA.

A cobrança avulsa (`POST /api/v1/charge`) funciona sem CPF; só o mandate
exige. Por isso o CPF é obrigatório só nos fluxos com recorrência.

**O que piorava o estrago:** o código tinha um *fallback* — se o mandate
falhava, criava uma cobrança Pix avulsa do valor do ciclo. O usuário pagava
uma vez e **nunca mais era cobrado**, achando que tinha assinado. Havia um
aviso, mas pequeno, depois de um QR normal: nada dizia que aquilo **não** era
recorrente.

**Correção:**

- o backend responde `400` com `code: "cpf_required"` (sem fallback nesse
  caso) e uma mensagem que diz o que fazer;
- o checkout mostra o **campo de CPF** (máscara + dígitos verificadores
  oficiais) e reenvia;
- o CPF validado é gravado em `users.cpf` (coluna sensível: só o backend
  escreve, o front não consegue ler);
- o cliente que já existe na Woovi **sem** CPF é atualizado com
  `PATCH /api/v1/customer/{correlationID}` — o `POST` devolve 400 "Há outro
  cliente com esses dados";
- o cliente existente é reencontrado pelo **CPF** e, na falta dele, pelo
  **correlationID** (`dp-user-<user_id>`) — sem isso, uma compra quebraria
  com 500 quando o `users.customer_id_woovi` não estivesse gravado.

### 33.2 Bug 2 — o `correlationID` é chave ÚNICA e o retry sempre falhava

```
POST /api/v1/subscriptions
-> 400 {"error":"correlationID already used"}
```

O nosso era `{grupo}:{usuário}:{tipo}:{kind}` — **sempre igual** para o mesmo
grupo/usuário/tipo. A **segunda** tentativa de pagamento era recusada pela
Woovi. (A cobrança avulsa NÃO sofre disso — só a assinatura.)

**Correção:** o correlationID ganhou uma 5ª parte, o **id da tentativa**
(único por chamada), e o `parseCorrelationId` passou a aceitar 4 **ou** 5
partes. O webhook não depende dessa parte: ele acha a assinatura pelo **id
do mandate** e, na falta, pelo grupo/usuário.

### 33.3 Bug 3 (bônus) — o botão "Copiar Código PIX" estava invisível

O `.btn-outline` do `SavingsStats.css` (admin) não era escopado. O Vite junta
**todo** o CSS do app em UM arquivo, e esse entra no bundle por último — então
a regra vencia a `.btn-outline` global do `index.css`, e o
`color: var(--text, #e2e8f0)` (com `--text` inexistente globalmente) deixava o
texto quase branco sobre o cartão branco.

**Lição:** no bundle único do Vite, **toda regra genérica de página vaza para
o app inteiro** — e vence. `.btn`, `.btn-outline`, `.modal-overlay`,
`.badge`… precisam de escopo. As regras daquele arquivo foram escopadas em
`.savings-stats`.

### 33.4 Bug 4 (bônus) — o guard do CPF travava o botão

O guard (`if (!cpfPronto()) return;`) estava **antes** do `try`, e o
`setProcessing(false)` está no `finally` **dentro** do `try`. Resultado: com
o CPF inválido, o botão ficava desabilitado para sempre. O QA achou isso
esperando o segundo clique.

### 33.5 O que a verificação provou

| QA | Resultado |
|---|---|
| `qa-pix-automatico.mjs` | **15/15** — sem CPF pede o CPF (400 `cpf_required`), CPF inválido é recusado no navegador, CPF válido cria o **mandate** (`recurrence.enabled = true`, `fallback = false`), o QR aparece e o aviso de "recorrência não ativada" **não** aparece |
| `qa-retry-woovi.mjs` | **6/6** — duas tentativas seguidas, cada uma com o **seu** mandate (antes: 400 "correlationID already used") |
| `qa-woovi-producao.mjs` | **4/4** — em produção responde `cpf_required`, sem "appID inválido" |

No banco, depois do teste:

```
woovi_subscription_id   = UGF5bWVudFN1YnNjcmlwdGlvbjo...   (o mandate)
woovi_recurrency_id     = RN5481141720261107ID...
woovi_recurrence_status = CREATED
next_charge_at          = 2026-12-07        (a próxima cobrança, sozinha)
```

### 33.6 Testes que ficaram

- `scripts/test-cpf.ts` — **34/34** (dígitos verificadores, máscara
  progressiva, e as duas implementações — backend e front — têm que concordar)
- `scripts/test-woovi-correlacao.ts` — **32/32** (formato, tentativa, parse)
- `.tmp-verify/resetar-qa-woovi.mjs` — zera o estado da conta de teste (perfil,
  assinatura, tentativas e o CPF do cliente na Woovi) para o QA poder rodar
  várias vezes

> ⚠️ O `resetar-qa-woovi.mjs` **precisa** rodar antes do QA: sem ele, o CPF
> fica salvo da rodada anterior e o primeiro clique já vai direto para o
> mandate (o teste espera o `cpf_required`).

### 33.7 A armadilha do `active_gateway` (achada já no fim da sessão)

Ao conferir o roteamento de verdade em produção, com a simulação
`testar-gateway-por-metodo-producao.mjs`, apareceu isto:

```
gatewayPadrao = woovi     escopoDoSplit = v2

checkout V1:  pix -> woovi    cartao -> woovi     ← produção real quebrada
checkout V2:  pix -> woovi    cartao -> iopay
```

O `active_gateway` é o gateway **padrão**, não o do método. Com o escopo em
`v2`, a divisão só vale no checkout que **pede** (`split_gateway: true`), e
todo mundo cai no `active_gateway` — inclusive o checkout V1, que está em
produção e funciona.

Com `woovi` no `active_gateway`, o V1 quebrava nos dois métodos: o cartão
tomava `400 "A integração Woovi está disponível apenas para PIX por enquanto"`
e o PIX caía na recorrência, que exige CPF (`cpf_required`).

**A regra:** com o escopo `v2`, `active_gateway` fica em `iopay`. Quem manda no
método é `split_gateway_pix` / `split_gateway_card`. O `active_gateway` só é
o **fallback** (método desconhecido ou divisão não aplicável).

O valor estava em `woovi` desde uma gravação no painel de Admin — nenhuma
dassuas rotinas de QA escreve nessa chave. Nenhum cliente real foi afetado
(a última tentativa de cliente real era de 02/11, antes da integração), e
foi restaurado para `iopay` no mesmo dia.

> 💡 **O custo de não conferir:** nada quebrou visivelmente — o V2 continuou
> funcionando exatamente igual. O defeito só aparecia no checkout V1, que
> ninguém estava testando. Simular o roteamento (`resolverGatewayParaPagamento`
> com as chaves lidas do banco) é o que pega esse tipo de coisa; conferir só o
> gateway do fluxo que você está testando, não.

### 33.8 O CPF do perfil: "já cadastrei, não me perguntem de novo"

O pedido do usuário foi: *quem já tem o CPF cadastrado não precisa perguntar
de novo; quem não tem, aí sim pergunta*.

**O que os dados mostravam** (antes de mexer):

| Onde | Quantos têm CPF |
|---|---|
| `users.cpf` | **0 de 122** usuários |
| `auth.users.raw_user_meta_data` | **0 de 120** |
| `groups.pix_key` com `pix_type='cpf'` | 2 de 32 grupos |

Ou seja: o CPF que as pessoas "já cadastram" é a **chave PIX do grupo** (para
receber), não o CPF do **pagador**. O pagador nunca tinha CPF guardado em
lugar nenhum — e a coluna `users.cpf` estava vazia.

**A regra implementada:** o CPF do **perfil** manda.

- O backend (`_shared/cpf.ts` → `escolherCpf`) usa o do perfil; o que vem no
  pedido nunca sobrescreve. Um mandate em nome de outra pessoa é pior do que
  nenhum mandate.
- O checkout pergunta o **status** (`meu_cpf_status()`) e só mostra o campo
  quando falta — e mostra **antes** do clique, barrando o botão no
  navegador (sem gastar chamada no backend).
- `Meu Perfil` ganhou o campo (mascarado / trocar / remover).

**O detalhe de permissão que decide o desenho:** a coluna `users.cpf` **não
tem `SELECT`** para `authenticated` — e não pode ter, porque a policy
`Authenticated users read profiles` (`auth.role() = 'authenticated'`) deixa
**qualquer** logado ler **qualquer** linha de `users`. Dar `SELECT` na coluna
vazaria o CPF de todo mundo. Por isso o front só tem acesso a uma função
`SECURITY DEFINER` que devolve status + mascarado, e a **escrita** é liberada
por `GRANT UPDATE (cpf)` — com a RLS (`auth.uid() = id`) garantindo que cada
um escreve só o próprio.

**Duas armadilhas do RLS que o teste local pagou** (Postgres 18 no WSL):

1. `CREATE POLICY` **não liga** o RLS — sem `ALTER TABLE ... ENABLE ROW LEVEL
   SECURITY` a policy é decorativa e o dono grava o CPF de outra pessoa. (A
   primeira rodada do teste pegou exatamente isso: `UPDATE 1` onde devia ser
   `UPDATE 0`.)
2. `REVOKE ... FROM PUBLIC` **não** fecha a função para o `anon`: o Supabase
   dá `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon,
   authenticated, service_role`, então o `anon` tem grant **direto**. Precisa
   de `REVOKE ... FROM anon` explícito.

> 💡 **A lição de método:** o teste do RLS local (Postgres no WSL) pegou as
> duas armadilhas em minutos. As duas Apply SQL em produção direto teriam
> deixado um CPF alheio gravável e a função aberta para o `anon` — e nenhuma
> delas apareceria no QA do navegador.


---

## 31. Publicação da revenda Pulse + as armadilhas do empacotador (07/11/2026)

A integração da revenda (seção 30) foi para o ar. Este registro é sobre o
**como** e — o que importa — sobre os quatro defeitos que só apareceram na
publicação de verdade.

### 31.1 O que era "não funciona" e por quê

A tela `/admin/pulse` existia, mas a função `pulse-admin` **não estava
publicada** no Supabase: ela vivia só no disco. O sintoma é o
`Failed to send a request to the Edge Function` — que **não** é problema de
segredo. O painel agora traduz essa mensagem para o comando de publicação
certo, porque a primeira leituranatural é "falta o PULSE_API_KEY".

### 31.2 O fluxo de publicação

As funções são publicadas pela **Management API** (o CLI do Supabase dá 403
neste projeto), com o empacotador do repo, que embute os módulos de
`_shared/` num arquivo só:

```bash
node scripts/empacotar-function-painel.mjs pulse-admin pulse-entrega pulse-webhook pulse-poll
node scripts/publicar-functions.mjs --only=pulse-admin,pulse-entrega,pulse-webhook,pulse-poll --real
```

O `--only` é novo: publica **uma rodada** sem tocar no resto do que já está
no ar. Sem ele, o script redeployava as sete functions da lista — com o
código local, que nem sempre era o que estava no ar.

O segredo e as configurações saem em `node scripts/configurar-pulse.mjs
--aplicar`: ele cadastra o `PULSE_API_KEY` (a Management API é a única coisa
que escreve secret), grava `pulse_webhook_url` e `pulse_markup` em
`app_settings` e mostra o estado (functions, segredo, saldo).

### 31.3 As configurações no painel (o que o dono pediu)

`/admin/settings` ganhou a seção **"Revenda — Pulse Coding"**: a URL do
webhook e a margem (%). A margem é lida pelo importador **do banco**, e não
do código — mudar no painel vale na próxima sincronização, sem republicar
nada.

A **chave da API não é editável no painel**, de propósito: campo de texto de
segredo no navegador é brecha. A seção explica onde ela é configurada.

### 31.4 Os quatro defeitos (todos achados rodando de verdade)

**1. O empacotador não entendia `import type { X } from "./y.ts"`.** O
arquivo gerado saía com `const type { X } = m_y;` — inválido — e o deploy
morria com *"Expected a semicolon"*. O modificador **inline**
(`import { a, type B }`) já funcionava; a forma de **statement** não.
Corrigido no empacotador: import só de tipo não gera vínculo (o tipo já foi
içado para o topo do arquivo).

**2. Forma abreviada com nome diferente do campo.** No importador, o campo do
parâmetro é `grupo_id` e a variável local é `group_id`; a abreviada
(`grupo_id,`) procurava uma variável inexistente. No `dry_run` isso **só**
atingia as plataformas que já existiam (as novas eram puladas), então o
catálogo parecia importar bem — e no sync real caía em **todos** os 81
pacotes. Dry-run não prova o caminho feliz: ele nem executa a parte que cria
o grupo.

**3. Nome de função diferente do importado.** `limiterDescricao` importado de
um módulo que exporta `limparDescricao`. TypeScript reclama; o stripper de
tipos do Deno não — no runtime vira `undefined` e o erro só aparece no uso.
**Regra que sobrou:** depois de mexer num módulo de `_shared/`, empacotar e
olhar o pacote gerado antes de publicar.

**4. `CHECK` do banco em `service_plans.billing_cycle`.** A tabela `groups`
aceita `days`; `service_plans` aceita **só** monthly/quarterly/semiannual/
annual. Um produto de prazo em dias (extensão de 7 dias) gerava `days` no
plano e o banco recusava. O plano grava agora o ciclo mais próximo e o
**prazo exato fica no grupo**, em `custom_cycle_days` — que é o que vale na
cobrança e na expiração.

### 31.5 Estado depois da publicação

| Item | Resultado |
|---|---|
| Functions | 4 publicadas e **ATIVAS** (ping/balance respondem) |
| Segredo | `PULSE_API_KEY` cadastrado |
| Catálogo | **81 pacotes** no espelho local |
| Vitrine | **60 grupos** abertos e visíveis (tag "Via Parceiro") |
| Fora da vitrine | 19 grupos fechados (`closed` + `private`) |
| Ignorados | 2 (categoria "Serviços") |
| Erros de sync | **0** |

Os 19 indisponíveis continuam no painel do admin: quando a Pulse liberar
algum deles, o sync o traz de volta para a vitrine sozinho.

### 31.6 O que ainda depende do dono

- **Recarregar o saldo na Pulse** (continua em R$ 0,00 — sem isso nenhum
  pedido real sai).
- **Rotacionar a chave** que ficou exposta no chat de 06/11.
- Cadastrar a URL do webhook no painel da Pulse.

---

## 32. No ciclo `days`, o preço é o TOTAL do período — e o front dizia "/mês" (07/11/2026)

### 32.1 O que foi conferido

Faltava a verificação da última ponta da integração: **o checkout aceita
compra de um grupo em ciclo `days`?** A resposta é sim — `Checkout.jsx` já
tratava `days` desde o começo (`monthsForCycle` devolve 1 para o cálculo e
`daysForCycle` devolve o prazo exato, que vai no payload como
`custom_cycle_days`), e o `confirm-payment` grava o `next_charge_at` no prazo
correto.

Mas a verificação mostrou um defeito de **texto**: o ciclo em dias quebra a
semântica do preço.

### 32.2 A regra

Em todos os outros ciclos, `groups.price_per_slot` é o preço **mensal** da
vaga — o checkout multiplica pelo ciclo. No ciclo `days` não há "mês": o
pacote "Extensão de 7 dias" custa R$ 119,88 **pelos 7 dias**.

| Grupo | `price_per_slot` | O que é |
|---|---|---|
| Extensão de 1 dia | R$ 23,88 | total de 1 dia |
| Extensão de 7 dias | R$ 119,88 | total de 7 dias |

Mostrar "/mês por perfil" num pacote de 7 dias mostra ao cliente um valor por
mês que **não existe**. Três telas eram afetadas: o card do catálogo, a página
do grupo e o resumo do checkout.

### 32.3 A correção

`src/lib/subscriptionCycles.js` ficou com a fonte única da verdade:

| Helper | Para que serve |
|---|---|
| `groupPeriodLabel(group)` | `'mês'`, `'trimestre'`, `'7 dias'`, `'2 meses'` |
| `groupPriceSuffix(group)` | `'/mês por perfil'` ou `'/7 dias'` |

O `Catalog.jsx` e o `GroupDetail.jsx` passaram a usar o helper (o
`GroupDetail` também ganhou "7 dias" no botão de entrada, que antes mostrava
"/ dias"). O `Checkout.jsx` trocou "Preço mensal" por **"Período (7 dias)"** no
ciclo em dias.

O importador passou a gravar o rótulo em `groups.custom_cycle_label`
(`rotuloCiclo()` em `pulse-catalog.ts`) — é ele que evita o "1 dias" no
singular. Os dois grupos que já existiam foram corrigidos no banco.

### 32.4 O que foi validado

- `npm run pulse:test` → **68/68** (três asserções novas para o `rotuloCiclo`).
- `npm run build` → ok; as strings novas estão no bundle do front.
- eslint → só os erros **pré-existentes** (nenhum no código novo).
- As 4 functions republicadas (o `pulse-catalog`/`pulse-import` mudaram) e o
  **bundle publicado** conferido: `npm run pulse:bundle`.

> O `conferir-bundle-pulse.mjs` nasceu dessa última checagem. *"Deployed
> successfully"* não prova que a versão nova foi publicada — cada function
> embute uma cópia dos módulos de `_shared/`. O script lê o corpo publicado
> (vem em bytes: decodificar como UTF-8) e procura as marcas do código novo.

---

## 33. O nome do parceiro não pode aparecer para o cliente (07/11/2026)

### 33.1 O pedido

> "não quero que coloque o nome da pulse coding nas coisas, ninguém precisa
> saber quem é o nosso parceiro"

O nome do parceiro estava em **seis lugares** que o cliente lê:

1. no nome do grupo (o título do pacote vinha cru: "Extensão Pulse Codig
   Duração De 7 dias");
2. na descrição do grupo (o texto do pacote, com "Suporte da PULSE para
   dúvidas sobre a entrega");
3. nas regras do grupo ("Esta é uma entrega individual **via Pulse Coding**…");
4. no nome do plano (`service_plans.name`);
5. no nome da **plataforma** — "Pulse Coding", "Combos Pulse", "Pulse Clone" —
   que aparece no cabeçalho do catálogo e na URL;
6. no nome do produto da tela "Minhas Entregas" e no tooltip do selo.

### 33.2 A solução

`semMarcaParceiro()` em `_shared/pulse-catalog.ts`: tira a marca e limpa o
separador que ficou pendurado (o "|" do "… | PULSE" vira nada, não uma
pípipe solta no texto).

| Antes | Depois |
|---|---|
| Extensão Pulse Codig Duração De 7 dias | Extensão Duração De 7 dias |
| ANTIGRAVITY — 1 BILHÃO DE TOKENS \| PULSE | ANTIGRAVITY — 1 BILHÃO DE TOKENS |
| Suporte da PULSE para dúvidas | Suporte para dúvidas |
| plataforma "Pulse Coding" | plataforma "Extensões" (slug `extensoes`) |

As plataformas foram renomeadas **no banco** antes do sync — senão o
importador, que procura a plataforma pelo slug, criaria uma plataforma nova
("Extensões") e a antiga ("Pulse Coding") ficaria órfã aparecendo na vitrine
com zero grupos.

O **espelho local** (`pulse_pacotes.title`) continua com o texto cru: quem
precisa saber qual pacote é qual é o painel do ADMIN, não o cliente.

### 33.3 O chip duplicado

O selo "Via Pareiro" aparecia **duas vezes** no card. A causa: o importador
usava `groups.plan_type = 'Via Parceiro'` para marcar o grupo, e o `GroupTags`
desenha o selo da tag **e** o de "Tipo de conta compartilhada" — que, além de
duplicar, descrevia errado (o acesso do parceiro é PRIVADO, não compartilhado).
O `plan_type` agora fica vazio.

### 33.4 Aplicado

- Importador e `pulse-entrega` sanitizam o texto na origem.
- 4 edge functions republicadas (v8/v5/v4/v4) e o bundle conferido.
- Sync real rodado (conta QA promovida só durante a chamada e rebaixada no
  `finally`): 79 grupos Via Parceiro, **0** com a marca no nome, na descrição
  ou nas regras; 0 planos e 0 plataformas com a marca.
- Front republicado na Vercel.
- Varredura em PRODUÇÃO (`visual-sem-marca.mjs`): vitrine (Extensões, Clones,
  Combos, Netflix), página do grupo e "Minhas Entregas" — **0 linhas** com a
  marca.
- `npm run pulse:test` → 75/75 (7 asserções novas).

---

## 34. O fornecedor é a DividePass — e o dono dos grupos é o admin oficial (07/11/2026)

### 34.1 A correção do texto

A primeira passada do item "não mostra o nome do parceiro" removeu a marca.
O dono então corrigiu o rumo:

> "onde está escrito nas descrições dos grupos e onde está falando do parceiro
> 'Pulse Coding' você vai trocar para a 'DividePass'"

Ou seja: não é apagar a marca, é **trocar por DividePass**. A função passou de
`semMarcaParceiro()` para `marcarComoDividePass()`:

| Antes (marca removida) | Agora (marca trocada) |
|---|---|
| Extensão Duração De 7 dias | Extensão **DividePass** — Duração De 7 dias - 100 créditos |
| Suporte para dúvidas | Suporte da **DividePass** para dúvidas |
| ANTIGRAVITY — 1 BILHÃO DE TOKENS | ANTIGRAVITY — 1 BILHÃO DE TOKENS \| **DividePass** |

Quando a marca cai no MEIO do nome, entra um separador ("Extensão DividePass —
Duração De 7 dias"); quando está no começo ou no fim, o texto original já fica
bom ("DividePass — 01 Clone", "… | DividePass").

### 34.2 O dono dos grupos estava errado

> "pude notar que criou os grupos e colocou como 'QA Mavis' — coloque o
> usuário admin oficial do email como admin@dividepass.com"

Achei o motivo: `importarCatalogoPulse` usava `adminUserId: authData.user.id`
— o id de **quem disparou o sync**. O primeiro sync foi rodado com a conta QA
de sondagem (a única que o projeto tem para testar), então os 79 grupos
ficaram com `owner_id` da conta QA.

Isso não é cosmético: **o `owner_id` decide para onde vai o repasse do
dinheiro**. Os grupos da revenda são do DONO (sem repasse), mas o dono errado
faz o dinheiro ir para a conta de teste.

Agora `resolverDonoAdmin()` procura o admin oficial
(`admin@dividepass.com`) e só cai no "admin mais antigo" se ele não existir.
Os 79 grupos foram corrigidos e o card passou a mostrar "Criado por:
DividePass".

### 34.3 A armadilha do trigger (79 erros)

Ao rodar o sync com a correção, ele quebrou em **todos** os pacotes:

> Campo de moderacao (verified, is_official, approval_status, owner_id) so
> pode ser alterado por admin

O trigger `guard_group_privileged_fields` bloqueia a mudança de `owner_id` para
quem não é admin. E a edge function roda com `service_role`, que **não passa**
por essa checagem: `is_admin()` olha o `app_metadata` do JWT e o `auth.uid()` —
nos dois, a service_role devolve vazio.

Por que o primeiro sync funcionou? Porque os grupos ainda não existiam: o
trigger só barra a **alteração** (UPDATE); na criação (INSERT) ele só
preenche os campos. O bug ficou escondido até o primeiro UPDATE.

A correção é surgical: o próprio trigger passa a aceitar a `service_role`
(o backend da plataforma), sem mexer no `is_admin()` e sem abrir nada para o
usuário — a `service_role` já ignora RLS (BYPASSRLS) em todas as tabelas.

```sql
-- seção 9.5 de database/EXECUTAR-2026-11-06-pulse-parceiro.sql
IF public.is_admin() OR auth.role() = 'service_role' THEN
  RETURN NEW;
END IF;
```

### 34.4 Aplicado

- Importador: `marcarComoDividePass()` + `resolverDonoAdmin()`.
- 4 edge functions republicadas (v10/v7/v6/v6) e o bundle conferido.
- Trigger atualizado no banco (e registrado na seção 9.5 do SQL do projeto).
- Sync real rodado (conta QA promovida só na chamada, rebaixada no `finally`):
  81 pacotes, **0 erros**, 79 grupos com dono `admin@dividepass.com`, 0 com a
  marca do fornecedor.
- Front republicado (tooltip do selo).
- Varredura em produção: **0 linhas** com a marca do fornecedor.
- `npm run pulse:test` → 76/76.

---

## 35. Capa, assinatura x pagamento único e onde está o dinheiro (07/11/2026)

### 35.1 Três perguntas do dono

> "coloque as fotos de capa que vem na api" · "verificar se o serviço que
> criamos é uma assinatura ou é algo de um pagamento único" · "a ideia era
> fazer um split… pegar o valor de fato cobrado de custo, e fazer o pagamento
> para o parceiro"

### 35.2 A API não tem capa

A API de revenda devolve **23 campos** e **nenhum** é imagem. A lista
completa: `automatic_stock, availability, available, available_stock,
base_price, category, credit_amount, credits, delivery, description,
discount_pct, features, id, in_stock, is_fixed_price,
manual_delivery_available, max_quantity, min_quantity, orderable_via_api,
original_price, price, purchase_capacity, rule_applied, stock, title`.

O que existe é o **logo da plataforma** no Supabase Storage
(`streaming_services.icon_url`): Netflix, Spotify, ChatGPT, Claude, Prime
Video e YouTube já têm. A capa do grupo importado passou a ser esse logo
(`groups.photo_url`) — **43 dos 81** pacotes já têm capa. Os que faltam estão
em plataformas criadas pelo importador (Extensões, Clones, Combos,
Antigravity…), que ainda não têm logo no bucket.

### 35.3 A API também não tem "recorrente"

O que ela devolve de útil para decidir a cobrança:

| Campo | Serve para |
|---|---|
| `price` | o **custo** (o que a gente paga) |
| `original_price` | a base do markup |
| `delivery` | `"automatica"` ou `"manual"` |
| `credits` / `credit_amount` | saldo que vem junto |
| o período no título | 1 mês, 12 meses, 7 dias… |

`classificarProduto()` junta isso: **período no título + acesso contínuo =
recorrente**; **saldo (créditos/tokens) ou extensão curta = pagamento único**.
Resultado: 36 recorrentes, 43 pagamento único, e 20 pacotes com **entrega
manual** (o pedido fica esperando a entrega à mão).

Gravado em `pulse_mapeamentos.natureza` / `entrega_tipo` (SQL 9.6) e
exposto na view `pulse_painel` (SQL 9.7) → coluna "Cobrança" no painel
`/admin/pulse`.

**Na cobrança, os dois casos são iguais**: uma compra, `next_charge_at = NULL`.
A diferença é o efeito (renova a cada ciclo x compra de novo quando o saldo
acaba). A recorrência automática continua desligada de propósito — o
`process-recurring-billing` não chama o `confirm-payment`, então cobraria sem
comprar nada na Pulse.

### 35.4 Onde está o "split"

**O "split" deste projeto não é partilha de receita**: é a *divisão por
método de pagamento* (`gateway-por-metodo.ts` — Pix num gateway, cartão
noutro).

E não é preciso partilha: o repasse ao dono do grupo é feito pelo trigger
`trg_credit_wallet_on_payment`, que **não repassa** quando o grupo é
`is_official` ou quando o dono é admin da plataforma. Os grupos "Via Parceiro"
são os dois casos → **100% do valor fica na plataforma**.

O pagamento ao parceiro é o `create_order` da API da Pulse, que debita o
**saldo de revenda** com o custo — automático, mas **depende de saldo** (hoje
R$ 0,00).

### 35.5 O fluxo do dinheiro

```
Cliente paga R$ 119,88  →  gateway  →  cai na conta da plataforma
      ↓
confirm-payment → processarCompraViaParceiro → create_order na Pulse
      ↓
a Pulse debita o saldo de revenda com o CUSTO (R$ 99,90)
      ↓
pulse_entregas → a conta/link/licença chega ao cliente
      ↓
DividePass fica com a margem: R$ 19,98
```

O custo, o preço de venda e a margem ficam gravados em `pulse_mapeamentos` e
em cada pedido (`pulse_pedidos.custo` / `preco_pago`) — dá para conferir o
lucro de cada venda depois.

### 35.6 O que foi feito

- Importador: capa (logo da plataforma) + classificação gravada no mapeamento.
- SQL: seções 9.6 (colunas) e 9.7 (view do painel).
- 4 edge functions republicadas (v11/v8/v7/v7) e o bundle conferido.
- Sync real rodado: 81 pacotes, 0 erros, 43 com capa.
- Front republicado com a coluna "Cobrança".
- `npm run pulse:test` → 83/83 (7 asserções novas do classificador).

---

## 36. Estoque do parceiro (tag "Esgotado") + dois bugs do empacotador (07/11/2026)

### 36.1 O pedido

> "não podemos vender algo sem o estoque então produtos que tiver com o
> Estoque igual ou menor que 0 não pode ser vendido aí você desativa o grupo
> como se estivesse cheio mas aí utilizamos a TAG 'Esgotado'"

### 36.2 A API traz CINCO campos de estoque, e eles não concordam

| Campo | O que é |
|---|---|
| `stock` / `automatic_stock` | estoque automático — **0 em 22 produtos de entrega manual que ainda vendem** |
| `available_stock` | **o que dá para vender agora** |
| `in_stock` / `available` | flags — `false` nos 19 produtos zerados de verdade |
| `purchase_capacity` | limite de compra |

Usar o `stock` apagaria da vitrine 22 produtos à venda. A regra ficou:
estoque <= 0 = `available_stock <= 0` **ou** `in_stock === false`.

### 36.3 O que foi feito

- Importador: tag **"Esgotado"** no grupo quando o estoque acaba. O grupo
  **continua na vitrine** (a pessoa vê que o produto existe), igual a um
  grupo cheio.
- Front: selo vermelho no card, botão desativado na página do grupo e tela
  "Esgotado" no checkout (`src/lib/groupEsgotado.js`).
- **Servidor**: `create-payment` recusa com **403 `grupo_esgotado`**. O front
  sozinho não protege nada — dá para chamar a API direto. A renovação não é
  bloqueada (a pessoa pagou antes).
- **Cron**: o `pulse-poll` (a cada 5 min) agora também atualiza o estoque
  (`_shared/pulse-estoque.ts`): 1 `list_packages` por rodada, bem dentro do
  limite de 30 req/min da API. Sem isso a tag ficaria velha e o bloqueio
  tardio.
- `npm run pulse:test` → 89/89 (6 asserções novas do estoque).

### 36.4 Prova em produção

`prova-esgotado.mjs` põe a tag à mão, confere as três camadas e remove a tag:

```
card: CTA="Esgotado"  selo="Esgotado"
checkout: Esgotado — Este produto está sem estoque no momento…
create-payment -> HTTP 403 {"code":"grupo_esgotado"}
```

### 36.5 Dois bugs do empacotador (e uma armadilha)

Publicando o `create-payment` (que é grande e temmany dependências), o
deploy caiu **duas vezes** — e a segunda derrubou a função no ar
(`BOOT_ERROR`).

**Bug 1 — união de tipo em várias linhas.** O empacotador dichava o fim de um
`export type` no primeiro `}`:

```ts
export type CouponResult =
  | { ok: true; coupon: ResolvedCoupon }
  | { ok: false; error: string };   // ← ficava órfão no corpo
```

O resto do tipo sobrava no corpo e o bundle saía quebrado ("Expected ',', got
';'"). O `fimDeclaracaoTipo()` agora continua a varredura quando o próximo
caractere é `|` ou `&`.

**Bug 2 — alias de import.** `import { createCharge as apiCreateCharge }`
virava `const { createCharge as apiCreateCharge } = m_mod;` — o `as` é
sintaxe de **import** do TypeScript; no destructuring o apelido é com `:`.
O bundle saía com "Expected ',', got 'as'".

**A armadilha.** Depois de consertar os dois, o `create-payment` **subiu mas
não inicializou** (`BOOT_ERROR`): o empacotador do painel manda **arquivo
único**, e a função tem 15 módulos em `handlers/` + `_shared/`. A versão que
funcionava em produção tinha sido publicada pela **CLI do Supabase**, que
mantém a estrutura de diretório (o `entrypoint` no Management API mostra:
`.../source/supabase/functions/confirm-payment/index.ts` na CLI ×
`.../source/index.ts` no empacotador).

**Regra que fica:** função grande/com muitas dependências → publicar pela
CLI (`supabase functions deploy <fn> --project-ref … --use-api`); o
empacotador do painel é para as functions da revenda, que são pequenas.

> `create-payment` é a função que cria a cobrança: ficar no ar quebrada
> derruba o checkout inteiro. Depois de uma publicação, **sempre chamar a
> função e ver o status** — "deployed successfully" não prova que ela
> inicializou.

---

## 37. Grupo que não dá para comprar fica TRANSPARENTE (08/11/2026)

**Pedido do dono.** "quando tiver esgotado ou o grupo cheio ou desativado você
deixa o grupo com uma opacidade menor e deixa mais transparente."

**Regra.** O card de um grupo **indisponível** (esgotado, cheio ou fechado)
perde o destaque: opacidade **0.6** no card da vitrine, **0.65** no cabeçalho
da página do grupo e **0.6** no card de "Meus Grupos". O card transparente
**não ganha elevação no hover** — card morto não pode chamar mais atenção que
card vivo.

**Como ficou o código.** Um lugar só decide o estado: `src/lib/groupEstado.js`
(troca do antigo `groupEsgotado.js`):

```js
grupoEsgotado(g)      // tag "Esgotado" em g.tags (o cron do parceiro aplicou)
grupoDesativado(g)    // g.status === 'closed'
grupoIndisponivel(g)  // qualquer um dos dois
```

O `Catalog.jsx` aplica três classes (`group-card-full`,
`group-card-esgotado`, `group-card-desativado`); o `GroupDetail.jsx` aplica
`gd-header-indisponivel` no header e desativa o segundo CTA com o texto
**"Esgotado — sem estoque"** (antes era "Entrar no grupo", que prometia uma
compra impossível); o `MyGroups.jsx` aplica `my-group-card-inativo`.

**Armadilha de copy.** "Vagas ilimitadas" (antes "Infinity vagas") — o
cliente precisa entender que o grupo não lotou, não que o produto sumiu.

**Prova (produção, estoque REAL zero).** O script abre por um instante um
produto que o parceiro **não libera** (estoque zerado de verdade), deixa o
cron `pulse-poll` aplicar a tag sozinho, mede e **restaura** no `finally`:

```bash
node .tmp-verify/prova-transparencia-esgotado.mjs   # estados e opacidades
node .tmp-verify/prova-transparencia-cards.mjs      # screenshot do card
node .tmp-verify/prova-meus-grupos.mjs              # "Meus Grupos"
```

Medido em `dividepass.com` (08/11/2026):

```
Amazon Prime Video 6M   | opacidade=1    | selo=""         | Entrar no grupo
Amazon Prime Video 1M   | opacidade=0.6  | selo="Esgotado" | Esgotado
Prime - Grupo 1         | opacidade=0.6  | selo=""         | Grupo lotado
página do grupo: header opacidade=0.65 | CTA="Esgotado — sem estoque" desativado=true
```

**Como conferir se está no ar (sem confiar no "deployed successfully").** O
bundle publicado se lê no `index.html` da Vercel: os assets `*.js` e `*.css`
servidos em `dividepass.com` **precisam conter** as classes
`group-card-esgotado`, `group-card-desativado`, `my-group-card-inativo` e
`gd-header-indisponivel` — e o CSS precisa ter `opacity: 0.6` / `0.65` nelas.
Scripts: `.tmp-verify/conferir-bundle-front.mjs` e
`.tmp-verify/conferir-css-opacidade.mjs`.

---

## 10/11/2026 — A COBRANÇA PAROU: o `503 BOOT_ERROR` sem CORS

### O sintoma

O botão "Gerar PIX" respondia, no cliente, apenas:

```
Pagamento não concluído
Failed to fetch
```

Não era o gateway, não era o Woovi, não era o cartão: a **edge function
inteira não existia**.

### A ASSINATURA do problema (vale para qualquer função do projeto)

`POST /functions/v1/create-payment` → **HTTP 503**, corpo:

```json
{ "code": "BOOT_ERROR", "message": "Function failed to start (please check logs)" }
```

Duas pistas que denunciam o BOOT_ERROR:

1. o corpo vem **em JSON** (um erro de gateway seria HTML ou texto);
2. a resposta **NÃO traz `access-control-allow-origin`** — e é por isso que
   o browser não mostra a mensagem: o fetch é bloqueado pela CORS e o front
   só sabe dizer "Failed to fetch".

**Diagnóstico em 30 segundos:** `OPTIONS`/`POST` na URL da função e olhar o
`sb-error-code: BOOT_ERROR` + a ausência do header de CORS.

### A causa raiz (dupla)

O `scripts/empacotar-function-painel.mjs` monta o arquivo único que vai pro
painel do Supabase. Ele tinha **DOIS** defeitos de sintaxe:

1. **`return { default, handleWoovi };`** — `default` é palavra reservada em
   JavaScript; o atalho de propriedade é **SyntaxError** ("Unexpected token
   'default'"). O pacote não compilava, a função não subia.
2. **Os seis `import()` dinâmicos eram içados para o topo do arquivo**, o que
   produzia seis `const mod` no mesmo escopo ("Identifier 'mod' has already
   been declared"). Pior: o `switch` de gateway passaria a usar **sempre o
   último** handler — o PIX cairia no handler do Mercado Pago.

Como o arquivo é publicado **inteiro**, um erro de sintaxe em qualquer canto
derruba a função. Foi assim que o PIX ficou 100% fora do ar.

### A REGRA (vale para toda publicação de edge function)

**NÃO publique sem o TESTE DE BOOT.**

```bash
node scripts/empacotar-function-painel.mjs create-payment   # empacota
node scripts/verificar-boot-painel.mjs create-payment        # SOBE?
node scripts/publicar-functions.mjs --real --only=create-payment
```

* `scripts/verificar-boot-painel.mjs` importa o pacote empacotado **no Deno**
  (o mesmo que o runtime faz) e pergunta se ele sobe.
* `scripts/publicar-functions.mjs` tem a **TRAVA DE BOOT** embutida: se
  algum pacote não sobe, a publicação é **CANCELADA**.
* **`deno check` NÃO é o gate.** Erro de TIPO não derruba a função (o runtime
  apaga os tipos). Erro de SINTAXE derruba. Então o gate é o teste de boot.

### Os outros defeitos corrigidos no mesmo pacote

| Onde | Defeito | Sintoma |
|---|---|---|
| `handlers/stripe.ts`, `asaas.ts`, `pagarme.ts` | `group` usado antes da declaração | **TDZ** (ReferenceError em runtime) |
| `handlers/pagarme.ts` | `initialStatus` usado antes da declaração | TDZ |
| `handlers/coupon.ts` | `.catch()` em cima do builder do Supabase | o builder é *thenable*, **não tem `.catch`** → TypeError |
| `_shared/gateway-por-metodo.ts` | `GatewayId` referenciava `GATEWAYS_VALIDOS` (const que fica dentro do namespace no pacote) | "Cannot find name 'GATEWAYS_VALIDOS'" |

O tipo virou **união de literais autossuficiente** + duas checagens de
sincronia com a lista — assim ele vale no fonte e no pacote empacotado.

### FAILOVER DE GATEWAY (o "não podemos ficar sem cobrar o cliente")

Duas chaves em `app_settings` (arquivo `database/failover-gateway-2026-11-10.sql`):

```
gateway_failover_pix  = 'iopay'        # PIX:    Woovi  -> IO Pay
gateway_failover_card = 'mercadopago'  # cartão: IO Pay -> Mercado Pago
```

**VAZIO = FAILOVER DESLIGADO** (padrão seguro). A lista é lida por método, na
ordem, sem repetir o principal; nome desconhecido é ignorado.

A regra que não pode ser furada: **só troca de gateway quando NADA foi
cobrado**. Então:

* 5xx, erro de rede, credencial faltando → **troca** (falha técnica);
* recusa do cliente (cartão recusado), pedido inválido (CPF, grupo
  esgotado), grupo não aprovado → **NÃO troca**, a resposta vai direto para
  o usuário;
* **renovação NUNCA troca** — a assinatura já tem cobrança viva no gateway
  dela; trocar deixaria duas cobranças vivas.

Testes da regra: `scripts/test-gateway-failover.ts` (13 casos).

Prova em produção (10/11/2026, conta QA, grupo "Youcine 1"):

```
caminho normal   -> HTTP 200, gateway=woovi, pix_copy_paste presente
failover (primário apontado para um gateway quebrado)
                 -> HTTP 200, gateway=iopay, pix_copy_paste presente
```

### IMPERSONAÇÃO DO ADMIN (suporte sem a senha do cliente)

Página: `/admin/users/<id>` → botão **"Entrar como este usuário"**.

Edge nova: `supabase/functions/admin-impersonate` (publicada com
`verify_jwt = false`, porque ela valida o admin no próprio código).

* Guarda dupla de admin: `app_metadata.role` **E** `public.users.role`.
* Bloqueia impersonar **outro admin** e a própria conta.
* `auth.admin.generateLink({ type: "magiclink" })` — **não envia e-mail e não
  altera a senha**; devolve só o `token_hash` (uso único).
* O navegador troca a própria sessão com `verifyOtp`.
* A sessão do admin fica em `sessionStorage` (morre com a aba); um marcador
  **sem token** em `localStorage` detecta "aba fechada" e avisa o admin.
* Banner global no `AuthProvider` (z-index acima do gate de avatar, z-800) —
  porque o `UserLayout` não renderiza em `/onboarding`.
* Auditoria em **duas** tabelas: `activity_logs` (sem policy — a trilha
  confiável) e `platform_events` (visível no painel, mas falsificável).

**Prova (10/11/2026, produção):** a senha do alvo e o `email_confirmed_at`
ficaram **intactos**; `verifyOtp` trocou a sessão para a conta do cliente; o
banner apareceu; "Voltar ao painel admin" devolveu a sessão do admin.

**12/11/2026 — o botão "sumiu" da ficha do usuário.** Duas causas somadas:

1. **O front nunca tinha sido publicado.** A feature inteira (edge + front)
   estava num código parado: a edge `admin-impersonate` já estava no ar em
   produção, mas `UserDetail.jsx`, `AuthProvider.jsx`, `UserLayout.jsx` e
   `src/lib/impersonacao.js` nunca entraram em um commit — então a ficha do
   usuário **não tinha botão nenhum**. Commit `2f98d63`.
2. **O botão sumia no TEMA CLARO.** O Vite junta TODOS os CSS do app em UM
   arquivo; a regra `.btn-outline` do `Home.css` (`color: var(--home-text)` =
   branco) entra no bundle e vence a global do `index.css`. O botão ficava
   **branco sobre cartão branco — contraste 1,05:1** (medido). Corrigido
   escopando em `.user-detail-page .btn-outline` no `UserDetail.css`:
   claro 17,85:1 e escuro 14,63:1 (commit `d2b9aef`).

Regra do caso: **no admin, todo botão precisa de cor escopada** — uma
`.btn-outline` genérica de outra página vaza e o botão fica invisível.

**QA:** `scripts/qa-impersonacao-admin.mjs` (16 checks, roda em produção) —
botão presente, contraste nos dois temas, sessão trocada para a conta do
cliente, banner + "Voltar ao painel admin", sessão do admin restaurada e
**hash da senha do cliente idêntico** antes/depois.
`scripts/medir-botao-impersonacao.mjs` mede só o contraste do botão.

> Cuidado no teste: o `addInitScript` do Playwright roda em **toda**
> navegação — injetar a sessão do admin sempre sobrescreve a sessão do
> cliente depois da impersonação e o teste mede a sessão errada. Injetar só
> na primeira carga (`if (!localStorage.getItem(key))`).

---

## 10/11/2026 — "O CLIENTE PAGOU E NÃO ENTROU": o webhook da Woovi nunca chegou

### O sintoma (relato do Gabriel)

> "O usuário fez o pagamento e foi bem sucesso, Aprovado, mas ele não entrou.
> Em `/admin/users/[id]?tab=payments` o pagamento não aparece. Também não
> apareceu no log que o cliente fez o pagamento."

Cliente: Cíntia Daniela Morata Justino. Grupo "Youtube - 01" (R$ 14,90, PIX
recorrente pela Woovi). O painel mostrava a tentativa de pagamento com o
gateway **Woovi** e a assinatura **"Pendente"**.

### A ASSINATURA do problema

| Onde | O que apareceu |
|---|---|
| `payment_attempts` | a tentativa existe, `gateway = woovi`, `status = created` |
| `payments` | **NENHUMA linha** (é dessa tabela que a aba Pagamentos e a lista do admin leem) |
| `platform_events` | **NENHUM evento** de pagamento |
| `user_subscriptions` | `status = pending` — o acesso ao grupo nunca foi liberado |
| Na Woovi | tudo certo: parcela 1 `COMPLETED`, tentativa `PAID`, `R$ 14,90` em 10/11 11:58 |

Ou seja: **o dinheiro entrou e o sistema não soube**. Não era falha de
cobrança — era falta de CONFIRMAÇÃO.

### A causa raiz (duas, uma atrás da outra)

**1. O webhook não estava cadastrado na conta de PRODUÇÃO da Woovi.**

A conta de produção tinha **1 dos 9 eventos** (`PIX_AUTOMATIC_APPROVED`,
criado à mão no painel). Os 8 que faltam — entre eles o
`PIX_AUTOMATIC_COBR_COMPLETED`, que é o que **confirma o pagamento do
ciclo** — só existiam na conta de **SANDBOX**.

Por quê? `scripts/configurar-webhook-woovi.mjs` lia o AppID de
`app_settings.woovi_app_id` — que, no banco, é **o mesmo do sandbox**. O
script falava com a conta errada, achava que já tinha cadastrado tudo e
saía. Pior: ele também abortava se encontrasse **qualquer** webhook nosso
("já existe, nada a fazer"), então mesmo com o AppID certo ele não
completaria a lista.

**2. `woovi-webhook` e `check-woovi-tx` estavam FORA da esteira de publicação.**

As duas funções não estavam na lista `FUNCOES` do `publicar-functions.mjs`
nem na do `empacotar-function-painel.mjs`. Elas estavam no ar (v6) desde uma
publicação manual e **nunca mais recebiam as correções** — foi assim que o
`PIX_AUTOMATIC_COBR_APPROVED` (que a Woovi dispara) ficou registrado no
painel e **sem tratamento no código**.

### O que foi feito

* `scripts/configurar-webhook-woovi.mjs`:
  - o AppID passa a ser escolhido pelo **ambiente** (mesma regra do app:
    `_shared/woovi.ts` → `appIdDoAmbiente`), importando a função em vez de
    reescrever a regra;
  - a criação ficou **idempotente por evento** (`--criar` cadastra só o que
    falta, sem duplicar);
  - os 8 eventos faltantes foram cadastrados na **produção** (são 9 agora).
* `woovi-webhook` e `check-woovi-tx` entraram nas listas de empacotamento e
  de publicação (com a trava de boot).
* `PIX_AUTOMATIC_COBR_APPROVED` passou a ser tratado (a confirmação é
  idempotente: o `COMPLETED` que chega depois não cobra de novo).
* `check-woovi-tx` ganhou **trava de dono**: só o dono da transação (ou um
  admin) consegue confirmá-la. Antes, qualquer usuário logado podia
  disparar a confirmação de outra pessoa (o id é público).
* A confirmação agora marca a tentativa como **`approved`** — sem isso o
  painel mostrava "Pendente" para um pagamento já pago.

### O BUG EXTRA que a prova revelou: o pagamento duplicado

Ao reenviar o evento da Woovi para testar, o mesmo pagamento foi gravado
**DUAS vezes** em `payments`.

A trava de idempotência do `confirmPayment` é por `transaction_code`, e o id
usado **dependia do status da assinatura**:

* 1ª confirmação (assinatura `pending`) → id do **MANDATE**;
* 2ª confirmação da MESMA parcela (assinatura já `active`) → id da
  **PARCELA**.

Ids diferentes ⇒ a trava não reconheceu ⇒ linha duplicada (e o painel
mostrava o cliente pagando duas vezes).

**A regra estável é o número da parcela:** parcela 1 usa o id do mandate (é
com ele que a tentativa e o cupom foram gravados); parcela 2+ usa o id da
própria parcela. Corrigido em `_shared/woovi-confirm.ts`.

### A reconciliação da Cíntia (o dinheiro já tinha entrado)

Foi pelo caminho oficial — o `check-woovi-tx` (o mesmo que o navegador usa),
que consulta a Woovi e confirma o que está lá pago. Resultado:

```
payments:        woovi/pix  R$ 14,90  pago     (linha nova, era 0)
user_subscriptions: status = active, woovi_recurrence_status = APPROVED
                     next_charge_at = 10/12/2026
group_members:   "Youtube - 01" — ativa, desde 10/11/2026
platform_events: "Pagamento de assinatura" + "Membro ingressou no grupo"
```

Prova no navegador (`dividepass.com`): a aba **Pagamentos** mostra
`10/11/2026 | R$ 14,90 | pix | Pago`, a aba **Logs de Eventos** mostra o
pagamento e a entrada, e a aba **Assinaturas** mostra **Ativa** (não mais
"Pendente").

**Varredura de todos os clientes Woovi:** nenhum outro caso preso (as outras
2 assinaturas Woovi estavam confirmadas pelo polling do navegador).

### O botão "Verificar no Gateway" (que falava de IO Pay)

No painel de Eventos, o botão dizia *"Consulta o status real no IOPay"* e
chamava o `force-confirm-payment` — **função que só sabe falar com o IO
Pay**. Numa tentativa da Woovi ele consultava o IO Pay com o id de uma
transação da Woovi e não achava nada.

Agora ele roteia pelo gateway (`check-woovi-tx` para a Woovi,
`force-confirm-payment` para o IO Pay) e o texto nomeia o gateway certo. O
aviso de sucesso ficou **fora** do bloco do botão: como o status passa a
"Aprovado" depois da confirmação, o bloco some — e o admin nunca veria a
confirmação.

### COMO NÃO REPETIR

```bash
node scripts/configurar-webhook-woovi.mjs            # lista e diz o que falta
node scripts/configurar-webhook-woovi.mjs --criar    # cadastra o que falta
```

Rodar de novo é seguro (idempotente por evento). O **gateway de produção
precisa ter os 9 eventos** — é o que garante que o próximo pagamento do
ciclo entre no sistema sem depender do navegador do cliente estar aberto.




---

## Rodada 3 — UI/UX do usuário (Visão Geral e Perfil)

### O que o dono pediu (e o que foi feito)

1. **Ocultar o card "Olá, [nome]"** quando o usuário já tem assinatura.
   Regra: `hasAnySubscription` (`src/lib/pendingPayments.js`) considera
   assinatura **ativa, pendente ou vencida** — **cancelada NÃO conta**
   (quem cancelou ainda pode ser recebido de volta).
2. **Card de cobrança pendente no TOPO**, com botão de pagar, aparecendo
   **só quando o vencimento é hoje ou já passou** (regra por **DIA
   inteiro**, não por instante: `isPaymentDue`).
3. **Mobile de "Explorar todos os serviços"**: os tiles estavam gigantes
   (119×137). Foram para **4 colunas de 88×104**, nome 0.56rem, logo 34px.
4. **Card "Sua opinião vale desconto"**: caiu de 208px para **140px**; o
   parágrafo longo virou a **frase curta** no celular
   (`.testimonial-prompt-text-short`), e o texto completo continua no desktop.
5. **Perfil (`/dashboard/profile`)**: responsividade arrumada.

### A regra de pendência (por que o card some e volta)

`src/lib/pendingPayments.js` — funções puras, testadas em
`scripts/test-pending-payments.mjs` (11 testes):

- `pendingPaymentDate(sub)` — usa `next_charge_at` e cai para
  `renewal_due_at`; assinatura `pending` usa `started_at` (a primeira
  cobrança era devida já na criação).
- `isPaymentDue(data)` — **compara o dia inteiro**: vence hoje ou já passou.
- `daysUntilPaymentDue(data)` — "vence hoje" / "N dias em atraso".
- `pendingPayments(subs)` / `hasAnySubscription(subs)`.

O botão "Pagar agora" **não abre popup**: leva para a **página de checkout**
no modo renovação (`/dashboard/checkout/<grupo>?renovacao=1`). O polling da
página **roteia por gateway** (`check-woovi-tx` na Woovi, `check-iopay-tx` no
resto) — sem isso a renovação Woovi nunca confirmaria.

### A renovação virou PÁGINA (não mais popup)

O pedido foi: "Pagar agora" / "Renovar agora" não podem mais abrir modal —
tem que abrir a página do checkout. O que mudou:

- `src/pages/user/Checkout.jsx` ganhou o **modo renovação** (`?renovacao=1`):
  lê a assinatura que já existe (`user_subscriptions` do usuário no grupo) e
  adapta a tela — **sem taxa de adesão** (já foi paga na entrada), **ciclo
  travado** no da assinatura e o **total = preço do ciclo atual** com o
  desconto recorrente gravado (o mesmo que o backend cobra).
- O pedido de cobrança vai com `renewal: true` — é o que impede o backend de
  rebaixar a assinatura para `pending` e de criar uma segunda assinatura.
- Cancelada **não se renova**: a tela diz que não achou a assinatura e
  manda para o checkout normal (comprar de novo).
- Todos os pontos que abriam o `SubscriptionRenewalModal` foram para a
  página: card de pendência do `/dashboard`, carrossel "Minhas Assinaturas",
  `/dashboard/billing`, `/dashboard/credentials/:servico` e
  `/dashboard/subscription/:id`.
- `scripts/qa-renovacao-checkout.mjs` confere o fluxo no navegador de
  verdade (cria uma assinatura fictícia e apaga no fim; a cobrança é
  interceptada, então nada é cobrado de verdade).

### O nome do gateway NÃO aparece para o usuário

O gateway (IOPay, Woovi, Mercado Pago...) é detalhe interno da plataforma.
Na tela de pagamento a pessoa vê só **"Cartão"** ou **"PIX"** — sem sufixo
("Cartão · IOPay") e sem "via Woovi" no resumo da cobrança.

- `src/pages/user/Checkout.jsx`: saiu o `GATEWAY_NAMES` (e as constantes
  `rotuloGatewayCartao` / `rotuloGatewayPix`) da área visível; o texto do
  botão ficou "Pagar agora — R$ X" e o resumo ficou "Renovação de R$ X
  (ciclo de Mensal).".
- Continua valendo: o aviso de **Pagamento Automático** (o Pix Automático do
  banco), o campo de CPF e o motivo técnico do gateway no admin. Só o
  **rótulo comercial** saiu.
- `scripts/qa-renovacao-checkout.mjs` passou a checar que nenhum nome de
  gateway aparece na tela de renovação nem no botão do PIX.

### A renovação por PIX é pela Woovi — e por isso pede o CPF

A renovação **segue o gateway do método escolhido**: o PIX da assinatura é o
**Pix Automático (Woovi)** e o cartão vai para o gateway de cartão.

- A regra mora em `resolverGatewayParaPagamento`
  (`supabase/functions/_shared/gateway-por-metodo.ts` ↔
  `src/lib/gatewayPorMetodo.js`, com teste de paridade em
  `scripts/test-gateway-por-metodo.ts`).
- Como a renovação por PIX vai para a Woovi, o **CPF** é pedido: o Pix
  Automático só existe para um pagador que a Woovi resolve pelo CPF. O
  campo aparece **antes** de pagar quando o perfil não tem CPF, e o botão
  fica barrado sem ele.
- A assinatura que **já é** da Woovi continua na Woovi no PIX: o mandate é
  dela, e trocar criaria uma segunda recorrência.
- Quem tinha cartão e renova por PIX passa a ser cobrada pela Woovi (o job
  de recorrência do cartão não roda para assinatura `gateway = 'woovi'`).
- Quem tinha a Woovi e renova por cartão tem o **mandate cancelado** — senão
  a Woovi cobraria o ciclo seguinte por conta própria, além do cartão.

### Pagamento forçado: a assinatura é ATUALIZADA, não duplicada

Quando a recorrência falha (a pessoa não tinha dinheiro), ela entra no app e
paga agora. Isso **não** cria uma assinatura nova:

- a cobrança é da **parcela em aberto** da assinatura que já existe
  (`POST /api/v1/installments/{id}/cobr`);
- o `woovi_subscription_id` continua o mesmo e a linha da assinatura é
  **atualizada** (sem virar `pending` e sem duplicar a linha);
- o `transaction_id` que o front acompanha é o **mandate** — é ele que o
  polling e o webhook usam, e é o que impede o pagamento de entrar duas
  vezes no painel.

Contraste do card de pendência

`.dash-pending-item` usava `var(--bg-card, rgba(255,255,255,.6))` — mas
`--bg-card` **não existe** no tema, então caía no fallback **branco** e o
texto (claro, `--text`) sumia dentro dele. Agora o fundo é escuro no tema
escuro e branco no claro, com contraste medido (AA) em ambos.

### Taxa de adesão: só na PRIMEIRA entrada no grupo

A taxa de adesão é **da entrada no grupo** — não é da mensalidade e não
volta. Três condições precisam valer (`src/pages/user/Checkout.jsx`):

1. **o grupo tem taxa** — `has_entrance_fee` + `entrance_fee > 0`. Não são
   todos que têm;
2. **a pessoa ainda não entrou no grupo** — quem já tem vínculo
   (`group_members`) NÃO paga a taxa de novo, nem quando a assinatura está
   `overdue`/`expired` (isso não desfaz a entrada);
3. **não é renovação** — na renovação (`?renovacao=1`) ela já entrou.

Com isso:

- **1ª compra** num grupo com taxa → a etapa "Passo 1 de 2 — Taxa de
  Adesão" explica que é um valor único e o resumo cobra
  `Taxa de Adesão (pagamento único) + 1ª mensalidade` numa única cobrança
  (ex.: R$ 9,90 + R$ 9,90 = R$ 19,80);
- **renovação** → a taxa não aparece no total **e nem é mencionada na tela**.
  O banner só diz o que importa ("Renovação de X — seu ciclo venceu em
  DD/MM/AAAA") e o resumo mostra o ciclo. Mencionar a taxa ("já paga, não é
  cobrada") só confunde quem está renovando: a pessoa já pagou na entrada e
  quer ver o valor do ciclo que está pagando.
- **grupo sem taxa** → nenhuma menção a taxa em lugar nenhum.

A tela **espera** a consulta do vínculo antes de decidir (`membershipCarregada`):
sem isso, quem já estava no grupo veria (e poderia pagar) a etapa da adesão
por um instante.

`scripts/qa-taxa-adesao.mjs` confere os três casos no navegador (a cobrança
é interceptada e os dados fictícios são apagados no fim).

### O Perfil: o que estava quebrado (medido a 390×844)

O Vite junta **todo** o CSS num bundle só, então regras de uma página
vazam para as outras. Duas regras globais werevenceram a do perfil:

- `.page-header` (vazado de `Support.css`) com `flex-direction: column` →
  seta em cima e título embaixo no celular, e título jogado para a direita
  no desktop.
- `.btn-outline` (vazado de `Home.css`) com `color: var(--home-text)`
  (branco) → **"Cancelar", "Trocar CPF", "Remover" e "Abrir Chamado ao
  Suporte" ficavam brancos sobre cartão branco** (invisíveis).

A correção foi **escopar o CSS do perfil em `.profile-page`** (só
`UserProfile.css` mudou; o `.jsx` não precisou de alteração), forçar o
cabeçalho em linha, devolver a cor ao botão outline, zerar o
`margin-bottom` do `.form-group` (que somava com o `gap` e inflava o
formulário) e reduzir fontes com `clamp()` + cortes em 900px e 640px.

Resultado: altura da página 2011 → **1683px**, alvos de toque < 44px
**9 → 0**, sem scroll horizontal em 390/768/1440, tipografia do desktop
inalterada.

> **Pendência conhecida (raiz, não do perfil):** o vazamento de
> `.btn-outline` vem do `Home.css` e **contamina outras telas** do app. Vale
> corrigir na raiz. O `index.css` também impõe `font-size` com
> `!important` em `h1/h2/h3`, o que obrigou `!important` escopado no perfil.

### Como foi provado

`node .tmp-verify/validar-rodada3.mjs` (com `BASE_URL` para produção) —
Playwright com a sessão da conta QA injetada no `localStorage`. Mede o DOM
e tira screenshots (390×844 e 1440×900) do dashboard e do perfil.

**Armadilhas do teste (levam tempo até achar):**

- O app tem **dois gates por cima da tela**: instalação do PWA
  (`PwaInstallGate`) e permissão de notificação push. Para ver a tela
  real: `localStorage.pwa_gate_dismissed = '1'` e clicar em
  "Continuar sem notificações".
- A rolagem do dashboard **não é do `window`**: no desktop quem rola é o
  `<main class="main-content ...">`. `window.scrollTo(0,0)` não faz nada —
  é preciso setar `scrollTop = 0` no elemento que tem
  `scrollHeight > clientHeight`.
- A pendência usada no teste é **fictícia** (criada e removida pelo próprio
  script); nunca deixar uma assinatura falsa no banco.

### Publicação

Front publicado na Vercel (`dividepass.com`). Medições em produção:
hero **ausente**, card de pendência **primeiro da tela** (top 80px no
celular, 40px no desktop), botão "Pagar agora" presente, grid de 4×88px,
depoimento 140px com a frase curta visível, **0 erros de console**.
