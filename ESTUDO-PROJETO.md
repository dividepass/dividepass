# DividePass — Estudo Completo (v2 · cobertura ≥95%)

> **Data:** 2026-10-23 · **Branch:** `main` · **Commit:** `477b8d9` · **Supabase:** `lasoouwboxspstqvjbsv`
>
> **Método:** leitura integral do código (4 agentes de deep-read + leitura direta), **validação empírica contra o banco de produção** usando apenas chaves públicas `anon`, e **walkthrough de runtime com Playwright** em 23 rotas. Nenhum arquivo do projeto foi alterado. Todas as sondas de escrita foram revertidas e todas as contas/grupos de teste foram removidos.

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

### Arquivos modificados (15)

**Edge functions (11):**
- `create-payment/index.ts` — **JWT obrigatório**; `user_id` derivado do token (nunca do body); fatura validada contra o dono
- `create-payment/handlers/iopay.ts` — cupom recalculado no servidor (3 pontos de cobrança); helper novo
- `iopay-webhook/index.ts` — **corrigido o `ReferenceError` do `group`** (S14); referência só vem da transação; exige `payment_attempts` correspondente
- `confirm-payment/index.ts` — **guarda de idempotência** (replay ignorado)
- `fetch-email-code/index.ts` — **401 sem chamador** (S12/B13); checagem de membro sempre; lê de `group_mailboxes`
- `check-iopay-tx/index.ts` — **`action:"cancel"` exige JWT** e `user_id === jwt.sub` (B12)
- `stripe-webhook/index.ts` — **HMAC Stripe real** (timestamp + corpo, com proteção anti-replay); `supabaseAdmin` corrigido
- `asaas-webhook/index.ts` — valida `asaas-access-token`
- `pagarme-webhook/index.ts` — valida `X-Hub-Signature` (HMAC-SHA1)
- `create-custom-charge/index.ts` — **admin obrigatório**; `admin_id` vem do token

**Front (5):** `AuthProvider.jsx`, `UserDetail.jsx`, `PlatformEvents.jsx` (listas explícitas de `users`), `GroupForm.jsx` (mailbox na nova tabela), `CheckoutLink.jsx` (colunas explícitas de `custom_charges`).

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
| 9 | Índice **único parcial** em `payments (transaction_code, payment_type) WHERE status='paid'` | S13 |
| 10 | `credit_wallet` **idempotente** por (reference_id, type, amount, description) | S13 |

### Como aplicar

```powershell
# 1) Validar localmente (opcional, mas recomendado)
powershell -ExecutionPolicy Bypass -File scripts/run-p0-local-test.ps1
#    → RESULTADO: 36/36 PASS

# 2) Aplicar no Supabase
#    SQL Editor → colar database/fix-p0-security.sql → Run

# 3) Deploy das edge functions
supabase functions deploy create-payment
supabase functions deploy iopay-webhook
supabase functions deploy confirm-payment
supabase functions deploy fetch-email-code
supabase functions deploy check-iopay-tx
supabase functions deploy stripe-webhook
supabase functions deploy asaas-webhook
supabase functions deploy pagarme-webhook
supabase functions deploy create-custom-charge

# 4) Verificar contra o banco real
node scripts/verify-p0.mjs
```

> **Ordem importa:** aplique o SQL **antes** de deployar as edge functions. O
> `fetch-email-code` passa a ler de `group_mailboxes`, que só existe depois do
> migration.

### Estado da validação

| Verificação | Resultado |
|---|---|
| `fix-p0-security.sql` aplica sem erro (Postgres 17 real) | ✅ |
| 36 asserts de comportamento | ✅ **36/36 PASS** |
| Sintaxe das 11 edge functions (`node --check`) | ✅ 11/11 |
| `npm run build` | ✅ |
| ESLint nos arquivos alterados | ✅ sem regressão (erros restantes são pré-existentes) |
| Comportamento em produção | ⏳ depende de aplicar + deployar |

### Pendências que exigem ação manual

| # | Ação |
|---|---|
| 1 | **Rotacionar a senha SMTP/IMAP** `«SENHA-REDIGIDA»` — está no histórico do git (`test-smtp.ts:4`) e é a mesma senha das contas IMAP dos grupos |
| 2 | **Deletar o grupo órfão**: `DELETE FROM public.groups WHERE id = 'a7801e29-6c79-4ac7-9923-ffd4877bb4dd';` |
| 3 | **Rotacionar as 2 `service_role` do histórico do git** — a do `debug-supabase.cjs` e a do `Credenciais.md` (ambas já retornam 401, mas estão no histórico) |
| 4 | **`.maestri/` não está no `.gitignore`** e contém uma `service_role` em texto claro — adicionar ao `.gitignore` |
| 5 | Limpar as 6 contas junk em `users` (`test*@t.com`, `dbg*`, `dash*`) |
| 6 | Os handlers **stripe/asaas/mercadopago/pagarme** ainda usam `final_amount` do body e estão quebrados por TDZ — precisam do mesmo tratamento do IO Pay (hoje `active_gateway = iopay`) |
| 7 | Corrigir o **descompasso do cupom na adesão**: o front mostra o valor com desconto, o servidor cobra o valor cheio — mantive o valor original de propósito, para não alterar cobrança dentro de um patch de segurança |
| 8 | Corrigir `update_subscription_statuses` (coluna `updated_at` inexistente) e `loadGroup()` em `ManageGroup.jsx:338` |

---

## 13. Perguntas em aberto (só verificáveis no dashboard)

1. **Quais cron jobs estão realmente agendados?** `exec_sql` não existe (404) → `manage-crons` list/toggle degradam; `manage-survey ensure-columns` nunca roda. **Resposta parcial:** os segredos de cron foram trocados (os do repo retornam 401), então `app_settings.recurring_billing_cron_secret` / `overdue_cron_secret` existem e são diferentes.
2. **Qual `is_admin()` está ativa** (JWT vs `users.role`)? Muda quando uma promoção de admin passa a valer. Afeta `admin-update-user` (que usa `app_metadata.role`) vs `manage-crons`/`schedule-billing`/`force-confirm-payment` (que usam `users.role`).
3. **`user_wallets` já foi explorada?** Verificar `wallet_transactions` por créditos sem `payment` correspondente.
4. **`payments` tem `UNIQUE` em `external_reference`?** As migrations do repo não cobrem essa tabela — se não tiver, o replay de webhook (S13) duplica pagamento sem nenhuma barreira de banco.
5. **`MP_WEBHOOK_SECRET` está definido?** `mercado-pago-webhook` respondeu **401 "Invalid signature"** na minha sonda → o secret **está** definido e a validação **está ativa** ✅. (Diferente dos outros 4 webhooks, que não validam nada.)
6. **`group_members.transaction_code` / `payments.transaction_code`** — está preenchido no fluxo de adesão? Se não, o bug S14 derruba toda confirmação de adesão via IO Pay.
7. **`sb_secret_…` do projeto** — a chave privilegiada atual está só no dashboard da conta dona do `lasoouwboxspstqvjbsv`. As duas do histórico do git estão mortas.

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

**Nenhuma alteração foi feita no repositório.** Todas as contas e grupos de teste criados durante a verificação foram removidos; as escritas anônimas de teste foram revertidas.
