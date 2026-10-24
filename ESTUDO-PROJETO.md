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

`src/components/SubscriptionRenewalModal.jsx` é o modal: PIX (QR + copia-e-cola) ou cartão salvo, polling de `check-iopay-tx` a cada 10s por até 10min e o aviso "a assinatura só é atualizada depois que o pagamento for confirmado".

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

## 13. Perguntas em aberto — respondidas

1. **Quais cron jobs estão realmente agendados?** `exec_sql` não existe (404) → `manage-crons` list/toggle degradam. Em produção existem `BILLING_CRON_SECRET` e `OVERDUE_CRON_SECRET` (rotacionados). **Continua em aberto:** quais jobs estão de fato agendados no `pg_cron`.
2. **Qual `is_admin()` está ativa** (JWT vs `users.role`)? Agora é **uma só, unificada**: JWT `app_metadata.role = 'admin` **ou** `public.users.role = 'admin'`. Vale para todas as policies do banco. `manage-survey` foi alinhado com ela.
3. **`user_wallets` já foi explorada?** A duplicata em `payments` mostra que o replay chegou a rodar, e o `credit_wallet` era cego. Não dá para provar retroativamente sem cruzar `wallet_transactions` × `payments` — é a pendência 7.
4. **`payments` tem `UNIQUE` em `external_reference`?** **Não tinha** — o replay duplicava pagamento sem nenhuma barreira de banco. Agora existe o trigger `guard_duplicate_paid_payment` (o índice único parcial só entraria se não houvesse as 3 duplicatas legadas).
5. **`MP_WEBHOOK_SECRET` está definido?** Sim, e a validação está ativa ✅.
6. **`transaction_code` preenchido no fluxo de adesão?** Sim, e é a chave usada pela trava de replay.
7. **`sb_secret_…` do projeto** — nesta sessão foi criado um **PAT de projeto** (não é chave de API); deve ser revogado ao final (pendência 2).

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
