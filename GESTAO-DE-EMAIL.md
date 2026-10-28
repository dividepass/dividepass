# GESTÃO DE E-MAIL — o que foi construído e como publicar

> Data: 2026-10-27
> Escopo: e-mails automáticos do **cliente** (o e-mail para o admin já existia).

---

## 1. O PROBLEMA

A plataforma já tinha SMTP (`_shared/smtp.ts`) e uma tabela `email_logs`, mas
**nenhum e-mail automático saía para o cliente**. Três momentos do funil
exigiam aviso e não tinham nada:

| Momento | O que o cliente precisa saber | Status antes |
|---|---|---|
| Fez cadastro na plataforma | "Sua conta está pronta, e funciona assim" | ❌ nada |
| Assinou (pagamento aprovado) | "Deu certo, e renova nesta data" | ❌ nada |
| Assinação está prestes a vencer | "Renova em 3 dias, botão aqui" | ❌ nada |

Havia só um cartão in-app (`RenewalReminderCard`) na tela — que some quando a
pessoa fecha o app, e não avisa ninguém que não abriu o painel.

---

## 2. O QUE ENTREGUE

Seis e-mails, com um gatilho cada:

| # | E-mail | Quando dispara | Onde |
|---|---|---|---|
| 1 | **Boas-vindas** | Primeiro login de quem se cadastrou | `send-welcome-email` + job diário |
| 2 | **Assinatura confirmada** | Pagamento da assinatura aprovado | `confirm-payment` |
| 3 | **Lembrete de renovação** | `renewal_due_at` a N dias (padrão 3) | job diário |
| 4 | **Assinatura atrasada** | Venceu, ainda dentro da carência de 7 dias | job diário |
| 5 | **Cobrança recusada** | Cartão não autorizou, haverá retry | `process-recurring-billing` |
| 6 | **Assinatura cancelada** | Carência de 7 dias acabou | `subscriptionLifecycle` |

Mais o **painel admin** de gestão (`/admin/emails`): liga/desliga cada tipo,
ajusta os dias, mostra a trilha de envios e dispara o job na mão.

### Arquivos

```
database/
  add-email-management.sql        <- colunas + chaves de configuração
  add-email-cron.sql              <- agendamento no pg_cron

supabase/functions/
  _shared/email-templates.ts      <- layout único + 6 templates
  _shared/user-emails.ts          <- transporte com trava de duplicidade
  _shared/subscription-emails.ts  <- regra de negócio dos e-mails de assinatura
  _shared/subscription-dates.ts   <- regras de data (fonte única, sem ciclo de import)
  send-lifecycle-emails/          <- job diário
  send-welcome-email/             <- e-mail de boas-vindas

src/
  lib/welcomeEmail.js             <- disparo do front (fire and forget)
  pages/admin/EmailManagement.jsx <- painel de gestão
```

### O que mudou nos arquivos existentes

| Arquivo | Mudança |
|---|---|
| `confirm-payment/index.ts` | dispara o e-mail de assinatura confirmada |
| `process-recurring-billing/index.ts` | dispara o e-mail de cobrança recusada |
| `_shared/subscriptionLifecycle.ts` | dispara o e-mail de cancelamento; regras de data extraídas |
| `manage-crons/index.ts` | descreve o job novo no painel de Crons |
| `contexts/AuthProvider.jsx` | chama o e-mail de boas-vindas no login |
| `supabase/config.toml` | `verify_jwt = false` nas duas functions novas |
| `scripts/empacotar-function-painel.mjs` | o empacotador passou a entender import de várias linhas |
| `scripts/validar-arquivos-painel.mjs` | contagem de arquivos dinâmica (antes fixa em 12) |

---

## 3. A TRAVA DE DUPLICIDADE (o ponto mais importante)

"Renova em breve" chegando três vezes queima a confiança do cliente. O risco
real não é o job diário — é o **webhook reentregue**, o **poll do front** e o
**clique do usuário** disparando o mesmo e-mail ao mesmo tempo.

A solução mora no banco, não no código:

```
email_logs.dedup_key TEXT  →  CREATE UNIQUE INDEX ... WHERE dedup_key IS NOT NULL
```

O fluxo de `sendUserEmail()` (`_shared/user-emails.ts`):

1. **INSERT** com `dedup_key` e `status = 'sending'` → quem chega primeiro
   **reserva** o evento. O segundo recebe erro `23505` e sai **sem enviar**.
2. Envia o e-mail pelo SMTP.
3. Deu certo → `status = 'sent'`.
4. Falhou → `status = 'failed'`, `error` preenchido e **`dedup_key` devolvida a
   NULL** — assim a próxima execução tenta de novo. Falha de SMTP não pode
   queimar o evento para sempre.

As chaves são lógicas, e é aí que mora a inteligência:

| E-mail | Chave | Consequência |
|---|---|---|
| Boas-vindas | `welcome:<user_id>` | 1 e-mail por conta, para sempre |
| Assinatura confirmada | `subscription_created:<sub_id>:<created_at>` | assinatura **nova** manda; **renovação** do mesmo ciclo não manda (mesma chave) |
| Lembrete | `renewal_reminder:<sub_id>:<due_at>` | 1 por ciclo; quando o ciclo vira, a data muda e um novo aviso sai |
| Atraso | `overdue_notice:<sub_id>:<due_at>:<rodada>` | 1 no primeiro dia + 1 na repetição |

---

## 4. COMO PUBLICAR (ordem importa)

### Passo 1 — Banco (obrigatório antes de qualquer function)

No **SQL Editor do Supabase** (roda como `postgres`), execute nesta ordem:

1. `database/add-email-management.sql`
2. `database/add-email-cron.sql`

> O passo 1 cria as colunas `user_id`, `status`, `error`, `dedup_key` e o
> índice UNIQUE. **Sem ele a trava de duplicidade não existe** — e o job
> manda e-mail repetido.
>
> O passo 2 agenda o job diário às **09h BRT** (12h UTC).

Conferir:

```sql
-- colunas novas presentes?
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'email_logs' ORDER BY ordinal_position;

-- index único criado?
SELECT indexname FROM pg_indexes WHERE tablename = 'email_logs';

-- job agendado?
SELECT jobname, schedule, active FROM cron.job
 WHERE jobname = 'send-lifecycle-emails';

-- configurações gravadas?
SELECT key, value FROM app_settings WHERE key LIKE 'email_%' ORDER BY key;
```

### Passo 2 — Edge functions

**Duas delas são novas** (`send-lifecycle-emails` e `send-welcome-email`) e
precisam ser **criadas** no painel antes de receber o código.

#### Caminho A — painel do Supabase (o que o projeto usa hoje)

O CLI do Supabase deste projeto **não tem acesso** ao projeto DividePass (o
org foi criado pelo Vercel Marketplace, fora da conta autenticada na CLI —
erro 403). O caminho que funciona é empacotar e colar no painel:

```powershell
# 1) Empacota as functions em arquivo único (pronto para colar)
node scripts/empacotar-function-painel.mjs --todas

# 2) Confere o resultado (sintaxe + consistência dos namespaces)
node scripts/validar-arquivos-painel.mjs
```

Os arquivos saem em `.tmp-verify/painel/`. Aí, **uma função por vez**:

1. Supabase → **Edge Functions** → *New Function* (só para as duas novas)
   → nome exato → editor de código → *Deploy*.
2. Para as que já existem: clique na função → editor → **Ctrl+A** → cole o
   arquivo inteiro → *Deploy*.
3. Nas duas novas, **desligue o interruptor "Verify JWT"**.

Funções desta rodada:

| Função | Situação | Por que |
|---|---|---|
| `send-lifecycle-emails` | **nova** (criar) | job diário: boas-vindas, renovação, atraso |
| `send-welcome-email` | **nova** (criar) | boas-vindas no primeiro login |
| `manage-crons` | editar | descreve o job novo no painel de Crons |
| `process-recurring-billing` | editar | e-mail de cobrança recusada |
| `update-subscription-statuses` | editar | importa o ciclo de vida, que dispara o e-mail de cancelamento |
| webhooks (`mercado-pago`, `iopay`, …) | editar | embutem o `confirm-payment`, que ganhou o e-mail de assinatura confirmada |

> O `confirm-payment` **não é uma função** — é uma biblioteca embutida nos
> webhooks. A mudança nele chega junto dos webhooks.

#### Caminho B — CLI (se você tiver um PAT com acesso ao projeto)

```bash
npx supabase functions deploy send-lifecycle-emails      --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
npx supabase functions deploy send-welcome-email         --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
npx supabase functions deploy manage-crons               --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
npx supabase functions deploy process-recurring-billing  --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
npx supabase functions deploy update-subscription-statuses --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
npx supabase functions deploy confirm-payment            --project-ref lasoouwboxspstqvjbsv --no-verify-jwt
```

Há um helper em `.tmp-verify/deploy-email-functions.mjs` que faz o login na
CLI e sobe as seis de uma vez.

> ⚠️ `--no-verify-jwt` é obrigatório nas duas novas: o `pg_cron` manda um
> **segredo**, não um JWT. Com `verify_jwt = true` (padrão) o gateway
> responde 401 **antes** do código rodar e o job nunca acontece. A validação
> real está dentro da função (aceita `SERVICE_ROLE_KEY`, `BILLING_CRON_SECRET`
> ou o segredo em `app_settings`).

### Passo 3 — Front (Vercel)

```bash
npm run build
vercel --prod
```

---

## 5. TESTE

### Dispara o job na mão

Pelo painel: **Admin → E-mails → "Executar job agora"**.

Ou por SQL:

```sql
SELECT net.http_post(
  url := (SELECT value FROM app_settings WHERE key = 'supabase_url')
         || '/functions/v1/send-lifecycle-emails',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT value FROM app_settings WHERE key = 'email_cron_secret')
  ),
  body := '{}'::jsonb
);
```

Resposta esperada:

```json
{ "success": true,
  "welcome": { "sent": 2, "skipped": 0 },
  "renewal_reminder": { "sent": 1, "skipped": 0 },
  "overdue_notice": { "sent": 0, "skipped": 0 } }
```

### O que conferir

- [ ] **Rodar o job duas vezes** → o segundo resultado é tudo `skipped: 0`
      (ou `sent: 0`). **Esse é o teste da trava de duplicidade.**
- [ ] O cliente recebeu o e-mail **na caixa dele**, não no spam.
- [ ] A trilha em `/admin/emails` mostra o envio com situação "Enviado".
- [ ] O botão do e-mail leva ao lugar certo (dashboard do cliente).
- [ ] Cadastrar uma conta nova → e-mail de boas-vindas chega no primeiro login.
- [ ] Aprovar um pagamento de assinatura → e-mail "Assinatura confirmada".

### Teste da trava de duplicidade na mão

```sql
-- Deve falhar com unique_violation (23505)
INSERT INTO email_logs (event_type, "to", subject, status, dedup_key)
VALUES ('welcome', 'teste@dividepass.com', 'teste', 'sent', 'welcome:user-de-teste');
```

---

## 6. CONFIGURAÇÃO

Tudo em `app_settings` — o admin ajusta pelo painel, sem novo deploy.

| Chave | Padrão | O que faz |
|---|---|---|
| `email_welcome_enabled` | `true` | Liga as boas-vindas |
| `email_subscription_enabled` | `true` | Liga a assinatura confirmada |
| `email_renewal_reminder_enabled` | `true` | Liga o lembrete de renovação |
| `email_overdue_enabled` | `true` | Liga o aviso de atraso |
| `email_payment_failed_enabled` | `true` | Liga o aviso de cobrança recusada |
| `email_cancelled_enabled` | `true` | Liga o aviso de cancelamento |
| `email_renewal_reminder_days` | `3` | Dias de antecedência do lembrete |
| `email_overdue_repeat_days` | `3` | Dia da repetição do aviso de atraso (`0` desliga) |
| `email_cron_secret` | — | Segredo do job diário |

> **`email_renewal_reminder_days` vs. o card in-app:** o `RenewalReminderCard`
> da tela usa 2 dias (`RENEWAL_REMINDER_DAYS` em `src/lib/subscriptionAccess.js`).
> O e-mail usa 3 por padrão. Estão independentes de propósito — o card é
> "vou renovar agora", o e-mail é "prepare o cartão".

---

## 7. COMO O E-MAIL CHEGA NO CLIENTE

```
Front (login/cadastro)
  └─> send-welcome-email ────┐
                            │
Pagamento aprovado           │
  └─> confirm-payment ──────┤
                            ├──> sendUserEmail()
Cobrança recusada           │      ├─> INSERT email_logs (dedup_key)  ← trava
  └─> process-recurring-...─┤      ├─> SMTP (mail.dividepass.com:465)
                            │      └─> UPDATE email_logs (status)
Job diário (pg_cron 09h)    │
  └─> send-lifecycle-emails ┘
       ├─ boas-vindas (rede de segurança)
       ├─ lembrete de renovação
       └─ aviso de atraso
```

A configuração do SMTP continua onde está: `app_settings` (host, porta, usuário)
+ o segredo `SMTP_PASS` do Supabase. Nada mudou ali.

---

## 8. PROBLEMAS CONHECIDOS / CHECKLIST

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Job devolve 401 | `verify_jwt` ligado na function | Publicar com `--no-verify-jwt` |
| Cliente recebeu o mesmo e-mail 2x | Faltou o passo 1 (SQL) | Rodar `add-email-management.sql` |
| E-mail não sai | `SMTP_PASS` ausente ou SMTP fora do ar | Conferir `supabase secrets list` |
| Painel admin vazio | Tabela ainda sem as colunas novas (passo 1 do SQL não rodado) | Rodar `add-email-management.sql` |
| "não cite a tecnologia" | — | Nenhum texto de tela cita banco ou tecnologia |

---

## 9. O QUE NÃO FOI FEITO (e por quê)

- **Não** customizou o e-mail de confirmação do Supabase (o que ele manda no
  cadastro). Continua sendo o do Supabase; o de boas-vindas é **adicional**.
- **Não** criou SMS/WhatsApp. O `dispatchNotification` já tem o canal
  `whatsapp` — plugar depois é o mesmo caminho.
- **Não** criou "cancelar assinatura" por e-mail (o cliente cancela pelo
  painel). O e-mail de cancelamento é reativo, quando o acesso é encerrado.
