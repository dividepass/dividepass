# Woovi — Pix com Pagamento Automático (recorrência real)

> **Estado: LIGADA NO CHECKOUT V2 (escopo `v2`), com credencial de produção pendente.**
> O checkout normal (`/checkout`) continua intacto: ele **não** usa a divisão.
> O que falta para a Woovi valer em produção é o **AppID da conta real**
> (ver seção 13).

## Situação em 2026-11-07

| Item | Estado |
|---|---|
| Código da integração | ✅ pronto (handler, webhook, polling, front, admin) |
| Migration do banco | ✅ **executada em produção** (Woovi, divisão por método e **AppID por ambiente**) |
| Interruptor produção x sandbox | ✅ pronto (Admin + `AMBIENTE` + env) — **só move a Woovi**; a IO Pay tem o `iopay_env` dela |
| **AppID por ambiente** | ✅ **separado** (`woovi_app_id_sandbox` / `woovi_app_id_production`) — o 401 "appID inválido" não acontece mais por conta trocada (seção 13) |
| **Teste de credencial pelo painel** | ✅ **novo** — edge function `woovi-teste-conexao` + botão "Testar" na tela do Admin |
| **Teste contra a API real (sandbox)** | ✅ **23/23 passando** — `scripts/test-woovi-api.ts` |
| Escopos do AppID | ✅ `CUSTOMER_POST`, `CHARGE_POST`, `SUBSCRIPTION_POST`, `WEBHOOK_POST` liberados (`COMPANY_GET`/`ACCOUNT_GET_LIST` não — e não são usados) |
| Publicação do frontend (Vercel) | ✅ **publicado em 2026-11-07** (`dividepass.com`) — tela de Configurações **reformulada** (menu lateral, barra de salvar, credenciais por ambiente) + checkout V2 (`/v2/checkout/:groupSlug`) |
| Credenciais no `app_settings` | ✅ `woovi_app_id_sandbox` gravado · ⚠️ `woovi_app_id_production` **vazio** (falta o AppID da conta real) · `woovi_retry_policy=THREE_RETRIES_7_DAYS` · `woovi_day_due=3` |
| Gateway ativo | ✅ segue `iopay` — o checkout normal não muda |
| Gateway por método (PIX / cartão em gateways diferentes) | ✅ **ligado** — PIX = `woovi` · cartão = `iopay` · escopo = `v2` |
| Publicação das edge functions | ✅ **13 publicadas em 2026-11-07** (incluindo a nova `woovi-teste-conexao` e todas as dependentes de `handlers/settings.ts`) |
| Webhooks na Woovi | ✅ **9 cadastrados em 2026-11-06** (sandbox) — a `woovi-webhook` responde HTTP 200 |

> ✅ **Instalação concluída em 2026-11-06**: código publicado, banco migrado,
> functions no ar e webhooks registrados.
> Em **2026-11-07** a divisão foi **ligada** (PIX = Woovi, cartão = IO Pay,
> escopo = V2) e o roteamento do V2 foi **provado em produção** (6/6).
> O único passo que falta é **cadastrar o AppID da conta real da Woovi**
> (seção 13) para as cobranças de produção deixarem de dar 401.

### Como LIGAR (1 passo, pelo painel)

1. Abra `https://dividepass.com/admin/settings`.
2. Em **"Gateway por método de pagamento"**, ligue o interruptor
   **"Usar um gateway diferente por método"**.
3. **Gateway do PIX** → `Woovi` · **Gateway do cartão de crédito** → `IOPay`.
4. Em **"Onde a divisão vale"**, deixe **"Só no checkout V2 (teste)"**.
5. **Salvar Configurações**.

Daí em diante: `https://dividepass.com/v2/checkout/<slug>` cobra o **PIX na
Woovi** (com Pix Automático) e o **cartão na IO Pay**. O checkout normal
(`/checkout`) continua idêntico até o escopo virar "Em todos os checkouts".

### Verificação feita em produção (2026-11-06)

| O que | Resultado |
|---|---|
| Edge functions no ar | 10 publicadas — `woovi-webhook` responde **HTTP 200** |
| Webhooks na Woovi (sandbox) | **9 cadastrados**, 0 falhas |
| `create-payment` no ar | ✅ é a **versão nova** (o bundle publicado contém `resolverGatewayParaPagamento`, `splitAplicavel`, `split_gateway_scope`) |
| Banco | `split_gateway_scope='v2'` criado · policy do usuário logado com as 7 chaves · `anon` intacto · `active_gateway=iopay` |
| Frontend | `dividepass.com` publicado · `/v2/checkout/:slug` com banner de teste |
| QA visual do V2 e do Admin | ✅ **21/21** — banner, rota, wizard até o pagamento, V1 idêntico ao V2 com a divisão desligada, Admin com interruptor + 2 selects + 2 opções de escopo, **nenhuma escrita** no banco |
| Decisão por método (dados reais) | desligado: V1 = pix/iopay · cartao/iopay — ligado: **V2 = pix/woovi · cartao/iopay**, V1 = iopay/iopay |


> ⚠️ O `verify_jwt = false` do `woovi-webhook` não é opcional: a Woovi chama a
> URL direto do servidor deles, sem JWT. Sem isso no `config.toml`, toda
> confirmação de pagamento levaria 401.

---

## 1. O problema

Hoje o DividePass cobra recorrência **por cartão** (IO Pay). Quem paga **por Pix**
não tem renovação automática: o `process-recurring-billing` tenta cobrar, não
encontra cartão salvo e a assinatura fica para trás.

A **Woovi** tem **Pix Automático** (`type: PIX_RECURRING`): o pagador autoriza
um *mandato* uma vez no app do banco e a Woovi cobra sozinha, nos ciclos
seguintes, com **retentativa automática** se o banco recusar.

---

## 2. O que foi construído

**Núcleo da integração**

| Arquivo | O que faz |
|---|---|
| `supabase/functions/_shared/woovi.ts` | Cliente HTTP da Woovi (auth, URL, erros) + regras de data e de ciclo. **Único** lugar que sabe falar com a Woovi. |
| `supabase/functions/_shared/woovi-api.ts` | Camada de API **pura** (sem Supabase): criar cliente, achar cliente por CPF, criar cobrança, criar mandate, listar parcelas. Testável em Node. |
| `supabase/functions/_shared/woovi-confirm.ts` | A regra de confirmação (o que fazer quando o pagamento foi aprovado). Compartilhada entre webhook e polling. |
| `supabase/functions/_shared/ambiente.ts` | O interruptor **produção x sandbox**. Fonte única (env `AMBIENTE` > banco `app_settings.ambiente` > padrão produção). |
| `supabase/functions/_shared/gateway-por-metodo.ts` | A regra de **gateway por método** (PIX e cartão em gateways diferentes). O backend é a autoridade. |
| `supabase/functions/create-payment/handlers/woovi.ts` | Handler do gateway: cria cliente, cobrança Pix e mandato de Pix Automático. |
| `supabase/functions/woovi-webhook/index.ts` | Recebe os eventos da Woovi e confirma o pagamento. |
| `supabase/functions/check-woovi-tx/index.ts` | Polling do status (usado pelo checkout enquanto a aba está aberta). |

**Banco**

| Arquivo | O que faz |
|---|---|
| `database/add-woovi-gateway.sql` | Colunas novas + endereço padrão. **Idempotente.** |
| `database/configurar-woovi-sandbox.sql` | Prepara o sandbox: deixa `ambiente='sandbox'` e cria o campo do AppID **vazio**. Sem credencial no arquivo. |
| `database/add-split-gateway.sql` | Cria as **4 chaves** da **divisão por método** (`split_gateway_enabled`, `split_gateway_pix`, `split_gateway_card`, `split_gateway_scope`) e libera a leitura delas para o usuário logado. Não liga nada (padrão: desligada). |

**Frontend**

| Arquivo | O que faz |
|---|---|
| `src/pages/user/Checkout.jsx` | Integra o gateway no checkout (Pix só, segundo QR do mandato). |
| `src/pages/admin/Settings.jsx` | Tela de configuração do gateway no Admin + o toggle de ambiente + a **divisão por método**. |
| `src/lib/gatewayPorMetodo.js` | Espelho JS da regra do backend (o frontend precisa saber o gateway antes de criar a cobrança). |
| `src/hooks/useGatewayPorMetodo.js` | Carrega a configuração de gateway do `app_settings`. |

**Scripts**

| Arquivo | O que faz |
|---|---|
| `scripts/configurar-webhook-woovi.mjs` | Cadastra o webhook na Woovi (respeita o toggle). |
| `scripts/publicar-edge-functions.mjs` | Publica as edge functions (aceita PAT via `SUPABASE_ACCESS_TOKEN`). |
| `scripts/test-woovi-api.ts` | Teste de **integração real** contra a API da Woovi (23 asserções). |
| `scripts/test-woovi-datas.ts` | Testes das regras de data (virada de mês, ano bissexto, etc). |
| `scripts/test-ambiente.ts` | Testes do interruptor de ambiente. |
| `scripts/checa-sintaxe-funcoes.mjs` | Sintaxe de todas as edge functions, **sobre o fonte**. |
| `scripts/deno-check-funcoes.mjs` | Type-check por arquivo com `deno check` (o gate válido para Deno). |
| `scripts/diagnostico-functions.mjs` | Estado do ar: o que está publicado e o que está ausente. |
| `scripts/ler-settings-producao.mjs` | Lê as configurações do gateway direto do banco de produção. |
| `scripts/supabase-sql.mjs` | Roda SQL pela Management API usando o token da CLI. É o que permite ler o AppID do `app_settings` sem pedir o `service_role`. |
| `scripts/test-gateway-por-metodo.ts` | Testes da divisão de gateway por método (inclui uma **checagem de paridade** entre o módulo do backend e o espelho do frontend). |
| `PUBLICAR-WOOVI.cmd` | **Um duplo clique** e a integração inteira sobe: login → deploy → webhooks → diagnóstico. |

Alterações em arquivos existentes:

- `supabase/functions/create-payment/index.ts` — registra `"woovi"` como gateway válido.
- `supabase/functions/process-recurring-billing/index.ts` — **pula** as assinaturas `woovi` (a Woovi cobra sozinha; sem isso o cliente pagaria duas vezes).
- `supabase/functions/confirm-payment/index.ts` — **corrige um bug**: o cupom nunca era registrado no fluxo combinado (`coupon_uses` não recebia a linha, `used_count` não subia, prêmio de campanha não era liberado).

---

## 3. Ambiente de operação: o interruptor produção x sandbox

Um único interruptor decide se a operação acontece em **produção** ou em
**sandbox**.

| Onde | Chave | Precedência |
|---|---|---|
| Variável de ambiente | `AMBIENTE` | **1ª** (a VPS se declara assim) |
| Banco | `app_settings.ambiente` | 2ª (o toggle do Admin) |
| Padrão | — | 3ª: **produção** |

Valores aceitos: `production` (padrão) e `sandbox` — com aliases
(`test`, `staging`, `homolog`, `dev`). **O que não for reconhecidamente
sandbox é produção**: errar para produção é perigoso, errar para sandbox só
custa um retrabalho.

### O que o interruptor troca

| | Produção | Sandbox |
|---|---|---|
| API da Woovi | `https://api.woovi.com` | `https://api.woovi-sandbox.com` |
| Webhook | apontado para a API de produção | apontado para a API de sandbox |
| Dinheiro | real | nenhum |

**O que ele NÃO troca: o banco.** O toggle muda *para onde a cobrança é
enviada*, não onde os dados moram. Para ter as duas pontas de verdade — uma
de teste e uma real — cada uma precisa do seu próprio banco:

```
VPS de staging  →  banco de staging  +  AMBIENTE=sandbox
VPS de produção →  banco de produção →  AMBIENTE=production
```

O **código é o mesmo** nas duas: é o mesmo arquivo, o mesmo caminho de
cobrança, a mesma confirmação. O que muda é a configuração do processo.

### No Admin

**Configurações → Ambiente de Operação**: dois cartões (Produção / Sandbox) e
um aviso em vermelho quando está em sandbox. Salvar leva até 5 segundos para
valer em todas as edge functions (cache do `app_settings`).

### Preparação para a VPS

`getGatewaySettings()` (em `create-payment/handlers/settings.ts`) já lê a
configuração de **duas fontes**:

1. `app_settings` (o banco) — quem roda no Supabase;
2. **variáveis de ambiente** (como reserva) — quem roda na VPS.

A chave em minúsculas no banco vira a variável em maiúsculas no ambiente
(`woovi_app_id` → `WOOVI_APP_ID`). O banco tem precedência; o ambiente
completa o que faltar. Na VPS, onde não existe `app_settings`, basta
exportar as variáveis.

O cliente da Woovi (`_shared/woovi.ts`) não conhece Supabase: é `fetch` +
um mapa de configurações. É o mesmo código na Supabase e na VPS.

---

## 4. Gateway por método de pagamento (o PIX e o cartão em gateways diferentes)

### O problema

O `active_gateway` é **um** gateway para tudo. Com ele, o checkout oferece
"Cartão | PIX" mas os dois métodos vão para o **mesmo** provedor. Isso
impede, por exemplo, cobrar o PIX na Woovi (com Pix Automático) e o cartão
de crédito na IO Pay.

### O modelo

Cinco chaves em `app_settings`:

| Chave | Valor | O que faz |
|---|---|---|
| `active_gateway` | `iopay` | O gateway padrão (o de sempre) |
| `split_gateway_enabled` | `false` | **A DIVISÃO** — desligada por padrão |
| `split_gateway_pix` | `iopay` | Gateway que recebe a cobrança de PIX |
| `split_gateway_card` | `iopay` | Gateway que recebe a cobrança de cartão |
| `split_gateway_scope` | `v2` | **ONDE** a divisão vale: `v2` (só no checkout de teste) ou `all` (em todos) |

> **Regra de ouro:** com `split_gateway_enabled` diferente de `'true'`, o
> checkout se comporta **exatamente como hoje** — um gateway só, o
> `active_gateway`. Só o valor literal `true` liga a divisão (erro para o
> lado seguro: configuração ambígua não vira cobrança no gateway errado).

### O ESCOPO: o checkout de produção não se mexe

O checkout `/checkout` (o que está em produção e **funciona**) não pode
mudar de comportamento enquanto a integração está sendo testada. Por isso a
divisão tem **dois lugares**:

| Rota | O que é |
|---|---|
| `/checkout/:groupSlug` | **V1 — produção.** A divisão **não** se aplica (enquanto o escopo for `v2`). |
| `/v2/checkout/:groupSlug` | **V2 — teste.** É aqui que a Woovi é validada. Tem uma faixa laranja no topo da tela dizendo que é o ambiente de teste, e um link para voltar ao checkout normal. |
| `/dashboard/v2/checkout/:groupSlug` | O mesmo V2, dentro do painel do cliente. |

As duas rotas usam o **mesmo componente** (`src/pages/user/Checkout.jsx`) —
o que muda é a prop `variante`. Sem duplicar 2.800 linhas de tela.

Quando a integração estiver validada, no Admin o escopo passa de "Só no
checkout V2 (teste)" para "Em todos os checkouts" — e aí a divisão passa a
valer também no V1, sem mexer em código.

### Como o checkout decide

```
método escolhido ──► gateway daquele método ──► cobrança
     PIX                   split_gateway_pix      (ex.: Woovi)
   Cartão               split_gateway_card        (ex.: IO Pay)
```

O botão de um método **continua aparecendo** mesmo quando o outro está
selecionado — é o par configurado que decide o que a tela oferece, não o
método escolhido. (Detalhe que importa: a Woovi é Pix-only, então usar o
`activeGateway` — que muda conforme o clique — esconderia o botão de
cartão justamente quando o usuário clicasse em PIX.)

### Quem decide: o BANCO, não o navegador

O `create-payment` lê as 4 chaves e **ignora** o `gateway` que o frontend
manda. Motivo: um cliente desatualizado (ou adulterado) não pode escolher
o gateway da cobrança. O frontend calcula o mesmo valor para desenhar a
tela certa — e há um teste de **paridade** entre os dois módulos
(`scripts/test-gateway-por-metodo.ts`) para os dois nunca divergirem.

### A RENOVAÇÃO não troca de gateway

Uma assinatura já tem `gateway_subscription_id` no gateway original. Se a
renovação mudasse de gateway, ficariam **duas cobranças vivas** (a antiga
no gateway antigo e a nova no gateway novo) e o dinheiro do usuário iria
para o lugar errado. Então:

- o backend lê o `gateway` da assinatura quando `renewal: true` e **ignora**
  a divisão;
- o modal de renovação (`SubscriptionRenewalModal`) também usa o gateway da
  assinatura, não o global.

### A renovação automática já funciona

Cada assinatura guarda o seu `gateway` na coluna `user_subscriptions.gateway`.
O cron (`process-recurring-billing`) pula as assinaturas da Woovi (é ela
que cobra sozinha, pelo Pix Automático) e cobra as da IO Pay normalmente.
Ou seja: a divisão não precisa de nada especial na recorrência — ela já
segue o gateway que criou a assinatura.

### Como ligar

1. Rodar `database/add-split-gateway.sql` no SQL Editor (cria as chaves e
   libera a leitura delas para o usuário logado — sem isso o checkout não
   enxerga a configuração).
2. **Admin → Configurações → Gateway por método de pagamento** → ligar o
   interruptor e escolher o gateway do PIX e do do cartão.
3. Salvar.

> ⚠️ **Só faça isso depois de a integração Woovi estar no ar.** Com a
> divisão ligada e o PIX apontando para a Woovi, qualquer checkout por PIX
> vai para a Woovi — se a função não estiver publicada, a cobrança falha.

---

## 5. O que a API real exige (armadilhas)

Nada aqui está na documentação da Woovi. Tudo foi descoberto chamando a API
de sandbox de verdade — e está coberto por `scripts/test-woovi-api.ts`, que
roda contra a API real e falha se alguma dessas regras deixar de valer.

### 5.1 O AppID é case-sensitive no `clientId`

O AppID é o Base64 de `clientId:clientSecret`:

```js
const appID = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
```

A API resolve a application pelo `clientId` de forma **case-sensitive**. A
conta usa `Client_Id_` (I maiúsculo); uma chave copiada com `Client_id_` (i
minúsculo) é recusada com **401 "appID inválido"** — e o erro não dá nenhuma
pista de que é uma letra de diferença.

| Valor | Resultado |
|---|---|
| `base64("Client_Id_…:Client_Secret_…")` | **200** |
| `base64("Client_id_…:Client_Secret_…")` | 401 appID inválido |
| `Client_Id_…:Client_Secret_…` (sem base64) | 401 appID inválido |

Por isso `normalizarAppId()` (em `_shared/woovi.ts`) corrige o prefixo
sozinho. Sem ela, a integração jamais funciona — e o erro parece "credencial
errada".

### 5.2 `POST /api/v1/charge` NÃO aceita `type`

A API aceita `DYNAMIC` (cobranças regulares) e `OVERDUE`. O valor
`PIX_CREDIT` **não** é válido ali: ele aciona o "Woovi Parcelado" e a
empresa sem essa feature recebe

```
400 {"error":"Empresa não possui a feature para criação de Woovi Parcelado"}
```

Sem `type` no corpo, a API usa o padrão — que é a cobrança Pix avulsa que
queremos.

### 5.3 `dayGenerateCharge` é validado pela API

| Jornada | Valor | Regra da API |
|---|---|---|
| `PAYMENT_ON_APPROVAL` | dia do mês de **hoje** | "must be today" |
| `ONLY_RECURRENCY` | data **≥ 3 dias** no futuro | "must be at least 3 days from today" |

A API aceita dia do mês ou ISO date — nos dois casos ela ecoa o **dia do
mês** (`dayGenerateCharge: 4`). É por isso que o código manda a data ISO do
próximo vencimento: o dia do mês fica travado na data em que a renovação
deve cair.

### 5.4 O cliente é único por CPF — e a criação NÃO é idempotente

`POST /api/v1/customer` com dados que já existem devolve:

```
400 {"error":"Há outro cliente com esses dados"}
```

Mesmo com o **mesmo** `correlationID`. E `GET /api/v1/customer` **ignora
qualquer query param** (não existe filtro por taxID na API).

Sem tratamento, a **segunda compra do mesmo usuário trava** — sempre que o
`users.customer_id_woovi` não tivesse sido gravado, ou se o cadastro tivesse
sido feito na mão no painel da Woovi.

O que o código faz: trata o 400 como "já existe" e localiza o cliente
listando e filtrando pelo CPF (`findCustomerByTaxID`). O cliente também não
tem `id` — o que o identifica é o `correlationID`, e
`GET /api/v1/customer/{correlationID}` funciona.

### 5.5 O bloco do mandate se chama `pixRecurring`

O OpenAPI diz `pixRecurringOptions`; a resposta real manda `pixRecurring`. O
código lê os dois.

### 5.6 O status do mandate não vem na criação

A assinatura responde `status: "ACTIVE"` — que quer dizer "a assinatura
existe", **não** "o pagador autorizou". A autorização chega pelo webhook
(`PIX_AUTOMATIC_APPROVED` / `PIX_AUTOMATIC_REJECTED`). Por isso o estado
inicial guardado no banco é `CREATED`.

---

## 6. Como funciona

### Cliente
Criado na primeira compra, guardado em `users.customer_id_woovi`. O
`correlationID` do cliente é `dp-user-<user_id>`, o que torna a criação
idempotente na Woovi.

> O **Pix Automático exige endereço** do pagador. O app ainda não coleta
> endereço, então usamos um padrão configurável
> (`woovi_default_address_*`, inserido pela migration — igual ao que o handler
> da IO Pay já faz).

### Os três artefatos, por tipo de pagamento

| `payment_type` | Artefato de PAGAMENTO | Artefato de RECORRÊNCIA |
|---|---|---|
| `entrance` | 1 charge Pix (taxa de adesão) | — |
| `invoice` | 1 charge Pix (fatura) | — |
| `subscription` | **Pix Automático, Jornada 3** | o mesmo artefato |
| `combined` | 1 charge Pix (adesão + 1º ciclo) | **Pix Automático, Jornada 2** (1 QR a mais) |

**Jornada 3 (`PAYMENT_ON_APPROVAL`)** — usada no fluxo `subscription`:
o pagador escaneia UM QR e, ao aprovar, **paga o 1º ciclo e registra o
mandato** ao mesmo tempo.

**Jornada 2 (`ONLY_RECURRENCY`)** — usada no fluxo `combined`:
a cobrança já aconteceu (foi o charge), então o mandato serve só para
**autorizar** a cobrança do próximo ciclo. A primeira cobrança automática só
sai na data de início (que precisa estar **≥ 3 dias** no futuro).

### Por que o `combined` tem dois QR Codes

A **taxa de adesão é única** e a **mensalidade é recorrente**. Se o mandato
valesse (adesão + mensalidade), a Woovi voltaria a cobrar a taxa todo mês. Se
valesse só a mensalidade, o primeiro QR da Jornada 3 pagaria só a mensalidade
e a taxa ficaria de fora. Separando os dois artefatos, **cada um cobra
exatamente o que deve** — e o segundo QR não cobra nada: ele só registra a
autorização do Pix Automático.

No checkout esse segundo QR aparece logo abaixo do primeiro, com o texto
*"Autorize a cobrança automática"* e a promessa explícita de que **autorizar
não cobra nada agora**.

### A data da cobrança

`dayGenerateCharge` (o dia do mês que a Woovi cobra) e `next_charge_at` (a
data no banco) são calculados para **cair no mesmo dia**. O cálculo limita o
dia ao último dia do mês: 31 de janeiro renova em 28 de fevereiro, não em 3
de março (que é o que o `setMonth` do JavaScript faria). Isso está coberto
pelos testes em `scripts/test-woovi-datas.ts`.

### Ciclo × frequência do Pix Automático

| Ciclo do DividePass | Frequência na Woovi |
|---|---|
| `monthly` | `MONTHLY` |
| `quarterly` | `QUARTERLY` |
| `semiannual` | `SEMIANNUALLY` |
| `annual` | `ANNUALLY` |
| `custom` (N meses) | **sem equivalente** |
| `days` | **sem equivalente** |

Nos dois últimos **não existe Pix Automático**: o ciclo continua no cron
`process-recurring-billing` (que, para esses ciclos, gera uma cobrança Pix
avulsa a cada vencimento — o cliente paga manualmente, como na IO Pay).

> `BIMONTHLY` (bimestral) não é suportado pela Woovi.

---

## 7. Como ativar

> ### Atalho: um duplo clique
>
> Os passos 1 e 2 **já estão feitos** (2026-11-04). Sobrou o passo 3, e ele é
> um arquivo:
>
> ```
> PUBLICAR-WOOVI.cmd      ← duplo clique na raiz do projeto
> ```
>
> Ele faz tudo em sequência: `npx supabase login` (abre o navegador — clique em
> **Authorize CLI** na conta que tem o projeto DividePass) → publica as edge
> functions → cadastra os 9 webhooks na Woovi → mostra o estado final.
>
> O AppID **não é digitado** nesse script: ele é lido do `app_settings` pela
> Management API (o mesmo token do login), e o ambiente vem do toggle do Admin.

### Passo 1 — Banco de dados

Abra o **SQL Editor** do seu projeto Supabase, cole o arquivo inteiro
`database/add-woovi-gateway.sql` e rode. É idempotente.

> **Já foi executado** (verificado em 2026-11-04: as três colunas de
> `user_subscriptions` respondem 200 e `users.customer_id_woovi` responde 401
> — que é o resultado correto, já que o papel `anon` não pode ler coluna de
> credencial). Se for rodar de novo, não faz mal.

O que ele faz:
- `users.customer_id_woovi`
- `user_subscriptions.woovi_subscription_id`, `.woovi_recurrency_id`, `.woovi_recurrence_status`
- 7 chaves de endereço padrão em `app_settings`

> A migration **não mexe em GRANT/REVOKE**. O `fix-p0-security.sql` já fez
> `REVOKE SELECT ON TABLE public.users` e concede acesso coluna a coluna —
> então a coluna nova nasce inacessível ao usuário logado (só o `service_role`
> lê), igual aos outros `customer_id_*`.

### Passo 2 — Credenciais no Admin

**Admin → Configurações → Woovi**:

| Campo | Valor |
|---|---|
| AppID | o AppID copiado em **Woovi → API/Plugins → Nova API/Plugin** |
| Política de retentativa | `THREE_RETRIES_7_DAYS` (recomendado) |
| Dias para expirar a cobrança | `3` |

> ✅ **Feito em 2026-11-04.** AppID do sandbox gravado, política `THREE_RETRIES_7_DAYS`,
> `woovi_day_due=3` e **Ambiente de Operação = Sandbox**. O gateway ativo
> continua `iopay` — nada foi ativado.
>
> **Uma mudança de tela foi feita junto:** as credenciais passaram a ter **abas**
> (Mercado Pago · Stripe · Asaas · IOPay · Pagar.me · Woovi). Antes o campo do
> AppID só aparecia se a Woovi **já fosse o gateway ativo** — ou seja, era
> impossível configurar sem ativar. Agora dá para editar as credenciais de um
> gateway sem mexer no gateway ativo.

> O AppID do **sandbox** é diferente do de produção. Trocar de ambiente
> significa trocar o AppID também — e o interruptor fica em
> **Configurações → Ambiente de Operação** (seção 3), não aqui.

### Passo 3 — Publicar as edge functions

```
node scripts/publicar-edge-functions.mjs
```

Publica: `woovi-webhook`, `check-woovi-tx`, `create-payment`, `confirm-payment`,
`process-recurring-billing` (+ as pendentes que já estavam na lista).

O script usa a CLI do Supabase, que precisa estar logada na conta que tem o
projeto DividePass (`lasoouwboxspstqvjbsv`). Duas formas:

```bash
# 1. pelo navegador (abre o navegador e pede confirmação)
npx supabase login

# 2. headless, com Personal Access Token
#    crie em https://supabase.com/dashboard/account/tokens
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
node scripts/publicar-edge-functions.mjs
```

Para conferir o que está no ar a qualquer momento:

```
node scripts/diagnostico-functions.mjs
```

> `404` = não publicada · `401` = viva, mas exige sessão (normal) ·
> `5xx` = viva e **quebrada**.

> **O que o deploy toca (e o que NÃO toca).** O script publica uma **lista
> fechada** de 10 funções, não o diretório inteiro:
>
> | Publica | Não publica (seguem como estão em produção) |
> |---|---|
> | `woovi-webhook`, `check-woovi-tx`, `create-payment`, `confirm-payment`, `process-recurring-billing`, `notify-service-watchers`, `reconcile-payments`, `provision-group-mailbox`, `send-welcome-email`, `delete-account` | `check-iopay-tx`, `iopay-webhook`, `force-confirm-payment` |
>
> Ou seja: as mudanças pendentes de sessões anteriores em `check-iopay-tx`,
> `handlers/iopay.ts`, `iopay-webhook` e `force-confirm-payment` **não vão junto**.
> `create-payment`, `confirm-payment` e `process-recurring-billing` vão — e é o
> que a Woovi precisa.

### Passo 4 — Cadastrar o webhook na Woovi

```
node scripts/configurar-webhook-woovi.mjs            # lista o que já existe
node scripts/configurar-webhook-woovi.mjs --criar     # cadastra
```

Isso cria **9 webhooks** (um por evento) apontando para
`{VITE_SUPABASE_URL}/functions/v1/woovi-webhook`.

> ⚠️ **A Woovi valida a URL antes de aceitar**: o endpoint tem que responder
> HTTP 200. Se a `woovi-webhook` ainda não estiver no ar, a API recusa com
> *"Seu endpoint de webhook precisa retornar o código de status 200"*.
> **Então: publique a função primeiro, depois cadastre o webhook.**
>
> O AppID vem do `app_settings` (via Management API, usando o token da CLI) ou
> da variável `WOOVI_APP_ID`. O ambiente vem do toggle do Admin, salvo
> `--ambiente=` na linha de comando.

> Dá para fazer pela mão no painel da Woovi, mas o script garante o nome e a
> URL certinhos.

### Passo 5 — Ativar o gateway

**Admin → Configurações → gateway ativo → Woovi**.

E confira o **Ambiente de Operação**: em sandbox, cadastre o AppID de sandbox
e rode o script do webhook com o mesmo ambiente:

```
node scripts/configurar-webhook-woovi.mjs --ambiente=sandbox --criar
```

> Recomendo strongly: teste primeiro com o interruptor em **sandbox** e o
> gateway ativo em Woovi, num grupo de teste. O sandbox da Woovi é
> `https://api.woovi-sandbox.com` e precisa de um AppID de sandbox.

---

## 8. Testes

```bash
# regras de data, ciclo, dinheiro e correlationID (roda em Node ou Deno)
node scripts/test-woovi-datas.ts

# interruptor de ambiente (produção x sandbox)
node scripts/test-ambiente.ts

# INTEGRAÇÃO REAL com a API da Woovi (sandbox) — 23 asserções
$env:WOOVI_APP_ID = "..."
$env:WOOVI_ENV = "sandbox"
node scripts/test-woovi-api.ts

# sintaxe de todas as edge functions
node scripts/checa-sintaxe-funcoes.mjs

# type-check por arquivo (precisa do Deno)
DENO_BIN=<caminho>\deno.cmd node scripts/deno-check-funcoes.mjs

# o que está no ar em produção
node scripts/diagnostico-functions.mjs
```

> O `test-woovi-api.ts` **cria dados no sandbox**: um cliente, uma cobrança
> de R$ 1,00 e dois mandates de Pix Automático de R$ 10,00. Nenhum dinheiro
> real é movimentado (quem paga é o pagador, no app do banco).

> **Atenção ao `node --check`**: ele dá **falso negativo** em identificadores
> com hífen (o `node --check` passa, mas o Deno — que é o runtime real das
> Edge Functions — reprova). Foi assim que o `enviarE-mailsDoCliente` passou
> batter no checker antigo e quebraria o deploy de `confirm-payment` e de todas
> as funções que o importam. Hoje o identificador se chama
> `enviarEmailsDoCliente`.

### Checklist manual (sandbox)

1. Grupo de teste sem taxa de adesão → assinar por Pix → confirmar que o QR
   aparece e que o `Pix Automático` é habilitado.
2. Grupo de teste **com** taxa de adesão → confirmar que aparecem **dois QR**
   (um de pagamento, um de autorização) e que o valor do primeiro é
   `adesão + 1º ciclo`.
3. Aprovar o pagamento → conferir que a pessoa entra no grupo, recebe os dois
   e-mails e que `user_subscriptions.status = 'active'`.
4. Conferir que o `coupon_uses` foi registrado se havia cupom.
5. Forçar uma renovação (ou esperar o ciclo) → conferir que o
   `PIX_AUTOMATIC_COBR_COMPLETED` chega, que o `payments` foi gravado com o
   id da **parcela** e que o `next_charge_at` avançou.

---

## 9. Limitações conhecidas

- **Só Pix.** Cartão na Woovi é outro fluxo (smartform) e não foi implementado.
- **Ciclos `custom` e `days` não têm Pix Automático** (a Woovi não tem
  frequência equivalente).
- **O endereço do pagador é um padrão**, não o endereço real dele. É uma
  exigência do Pix Automático, e o app ainda não coleta endereço.
- **O mandatar é o pagador**: quem paga precisa ser quem autorizou o Pix
  Automático no app do banco.
- **Só renewal automática para quem autorizou o mandato.** Sem autorização, a
  assinatura continua válida mas a renovação precisa ser paga na mão.
- **Valor da recorrência é fixo no mandato.** Mudar o preço do grupo depois
  não muda o valor do Pix Automático já criado — seria preciso cancelar e
  recriar o mandato.

---

## 10. Rollback

A integração é **standby**, então o rollback é trivial:

1. **Admin → Configurações → gateway ativo → IOPay**.
2. (Opcional) Apague os webhooks na Woovi:
   `node scripts/configurar-webhook-woovi.mjs` para ver os ids, e apague no
   painel.

Nada em `active_gateway` muda sozinho, e as assinaturas antigas da Woovi
continuam com `gateway = 'woovi'` — o que significa que o cron **não** as
cobra (a Woovi continua cobrando por conta própria). Se você quiser voltar a
cobrar essas assinaturas pela via antiga, é preciso atualizar
`user_subscriptions.gateway` delas para `iopay` e recriar o cartão do
usuário.

---

## 11. Os 5 recursos da Woovi no escopo (mapa da API)

Fontes: OpenAPI oficial (`https://api.woovi.com/api/openapi.json`, 143
endpoints, 52 eventos de webhook) + doc oficial
(`developers.woovi.com/docs/...`). Estudado em **06/11/2026**.

| Recurso | Endpoints | Onde usamos | Situação |
|---|---|---|---|
| **customer** | `POST /api/v1/customer` · `GET /api/v1/customer/{correlationID}` | `_shared/woovi.ts` (criar/buscar o pagador) | ✅ em uso |
| **charge** | `POST /api/v1/charge` | cobrança avulsa: adesão, fatura, 1ª parcela | ✅ em uso (`type` = `DYNAMIC` → Pix) |
| **subscription** | `POST /api/v1/subscriptions` · `GET /api/v1/subscriptions/{id}/payment-book` | Pix Automático (mandato) | ✅ em uso (`type` = `PIX_RECURRING`) |
| **webhook** | `POST /api/v1/webhook` + 52 eventos | `woovi-webhook/index.ts` | ✅ **9 de 52** cadastrados |
| **boleto** | `POST /api/v1/charge` com `type: BOLETO` · `POST /api/v1/boleto/validate` · `GET /api/v1/boleto-transaction` | — | ❌ **não implementado** |
| **pixQrCode** | `POST /api/v1/qrcode-static` · `GET /api/v1/qrcode-static[/{id}]` | — | ❌ **não implementado** |

### O que a doc acrescenta (atualizada em 06/11/2026)

**1. Boleto e Pix saem da MESMA cobrança.** Com `"type": "BOLETO"`, o
`charge` volta em `paymentMethods` com **os dois**: `boleto` (`boletoBarcode`,
`boletoDigitable`, `barcodeImage`) e `pix` (`brCode`, `qrCodeImage`, `txId`).
O pagador escolhe qual pagar. O webhook é o mesmo
(`OPENPIX:CHARGE_COMPLETED`), com `paymentMethods.boleto` preenchido.

**2. Pagamento ≠ liquidação.** O webhook diz que o boleto foi *pago*, não que
o dinheiro está disponível (a Woovi liquida ~D+3). A liquidação vem no
`BOLETO_SETTLED`; o extrato sai de `GET /api/v1/boleto-transaction`
(`BOLETO_IN`/`BOLETO_OUT`, `settledAt`, `finesValue`, `interestsValue`,
`discountValue`).

**3. Assinatura com boleto.** `POST /api/v1/subscriptions` com
`"type": "RECURRENT"` + `"chargeType": "BOLETO"` gera, a cada ciclo, uma
cobrança do tipo boleto (que também aceita Pix). O
`GET /api/v1/subscriptions/{id}/payment-book` devolve o **carnê**.

**4. QR Pix estático (`pixQrCode`).** `POST /api/v1/qrcode-static` cria um QR
Pix **fixo**, com `pixKey`, `value` (centavos), `correlationID`,
`paymentLinkUrl` e `qrCodeImage`. No `charge` dá para reaproveitar o mesmo QR
(`fixedLocation: true` + `paymentLinkID`).

**5. `charge.type` decide o que a cobrança aceita:** `DYNAMIC` (Pix, o que
usamos), `BOLETO`, `OVERDUE` (juros/multa), `CREDIT_CARD`, `PIX_CREDIT`
(parcelado — a Woovi não liberou essa feature na nossa conta).

### Eventos de webhook que ainda faltam

Relevantes e **não cadastrados** (de 52):

- `OPENPIX:CHARGE_CREATED` — a cobrança foi criada (andonamento).
- `OPENPIX:TRANSACTION_RECEIVED` — Pix recebido sem vínculo de cobrança
  (para conciliação / valor errado).
- `OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER` — pagou com CPF
  diferente do titular (**alerta de fraude**).
- `PIX_AUTOMATIC_COBR_TRY_REQUESTED` — a Woovi **tentou** a cobrança do ciclo.
- `OPENPIX:DISPUTE_CREATED|ACCEPTED|REJECTED|CANCELED` — contestação.
- `BOLETO_SETTLED` — liquidação do boleto.
- `PIX_AUTH_COMPLETED|EXPIRED` — autenticação da autorização do Pix Automático.

### O que isso muda no nosso plano

- A divisão por método de hoje é **PIX / cartão**. Se o checkout V2 passar a
  oferecer **boleto**, o segundo eixo deixa de ser cartão e vira
  `split_gateway_boleto` — e a Woovi passa a ter **dois** métodos (Pix e
  Boleto), o que muda a regra de "disponibilidade do método".
- O `pixQrCode` **estático** não serve para a cota do grupo (o valor muda por
  grupo): o caminho certo continua sendo o QR **dinâmico** do `charge`
  (`charge.brCode` + `charge.qrCodeImage`), que já usamos.

---

## 12. Referências

- API: <https://developers.woovi.com/docs/apis/api-getting-started>
- Pix Automático: <https://developers.woovi.com/docs/pix-automatic/pix-automatic-how-to-create>
- Webhooks do Pix Automático: <https://developers.woovi.com/docs/pix-automatic/webhooks/pix-automatic-webhooks>
- OpenAPI: <https://api.woovi.com/api/openapi.json>

---

## 13. AppID POR AMBIENTE (07/11/2026)

### O problema

A Woovi tem **duas contas**: a de **teste** (`api.woovi-sandbox.com`) e a
**real** (`api.woovi.com`). Cada uma tem o seu **AppID** — e o AppID de uma é
**recusado** pela outra com `401 appID inválido`.

O projeto guardava **um AppID só** (`woovi_app_id`) e trocava apenas a URL da
API. Resultado: com o interruptor em "produção", a API real recebia o AppID
do sandbox e recusava **toda** requisição — com um erro que não dava nenhuma
pista de que o problema era o par (AppID, URL) errado.

Verificado na API (2026-11-07), com o AppID do sandbox:

| Chamada | Resultado |
|---|---|
| `GET api.woovi-sandbox.com/api/v1/customer` | **200** (a conta tem 5 clientes) |
| `GET api.woovi.com/api/v1/customer` | **401 `appID inválido`** |

### A correção

Cada ambiente tem o seu AppID, e a escolha é feita **pelo ambiente** — nunca
"o AppID de um ambiente com a URL do outro".

| Chave no `app_settings` | Para quê |
|---|---|
| `woovi_app_id_sandbox` | AppID da conta de **teste** (`api.woovi-sandbox.com`) |
| `woovi_app_id_production` | AppID da conta **real** (`api.woovi.com`) |
| `woovi_app_id` | **legada** — continua espelhando o AppID do sandbox (o script do webhook e a reserva do backend ainda leem ela) |

- **Sandbox**: usa `woovi_app_id_sandbox`; se estiver vazia, cai na legada
  `woovi_app_id` (que sempre guardou o AppID de teste).
- **Produção**: usa **só** `woovi_app_id_production`. **Sem reserva** — cair no
  AppID do sandbox aqui reproduziria o 401 e poderia mandar uma cobrança
  para a conta errada.

A separação mora em `supabase/functions/_shared/woovi.ts`
(`appIdDoAmbiente` / `getWooviConfig`).

> O interruptor `app_settings.ambiente` continua sendo o "global" do sistema,
> mas **na prática ele só move a Woovi**: a IO Pay tem o seu próprio
> (`iopay_env`). É por isso que dá para testar o checkout V2 na Woovi de
> sandbox **com o cartão da IO Pay em produção ao mesmo tempo**.

### A mensagem de erro agora diz o que fazer

Quando falta o AppID do ambiente ativo, a resposta é:

```json
{
  "error": "Credenciais da Woovi (produção) não configuradas. Cadastre o AppID em Admin → Configurações → Woovi (campo \"AppID de Produção\").",
  "code": "woovi_app_id_missing",
  "ambiente": "production"
}
```

### A edge function `woovi-teste-conexao`

Nova função **só de admin** que testa um AppID sem precisar salvar:

```
POST /functions/v1/woovi-teste-conexao
{ "app_id": "Client_Id_...", "ambiente": "sandbox" | "production" }
```

Ela faz **uma leitura simples** (`GET /api/v1/customer`) na URL do ambiente
escolhido e devolve:

- **200** → credencial aceita (diz quantos clientes a conta tem);
- **401** → credencial recusada, com a dica de **qual** AppID usar;
- o AppID **nunca** volta na resposta, nem em parte.

Quem pode chamar: só o admin (`users.role = 'admin'`), com o JWT da sessão.

### A tela de Configurações (reformulada em 07/11/2026)

`/admin/settings` foi refeita:

- **menu lateral fixo** com as 9 seções (a seção ativa é destacada);
- cada seção é um **card** próprio;
- **barra de salvar fixa** no rodapé, que diz quantas alterações estão
  pendentes ("3 alterações não salvas") e avisa antes de sair da página;
- **olho** para revelar/ocultar qualquer credencial;
- **credenciais da Woovi por ambiente** com o AppID de Sandbox e o de Produção
  lado a lado, a etiqueta **"em uso agora"** no que corresponde ao ambiente
  ativo e o botão **"Testar"** em cada um;
- o cabeçalho resume o estado real (ambiente, gateway ativo, gateway do PIX e
  do cartão) e avisa quando falta o AppID do ambiente ativo.

### Estado em 2026-11-07

| Item | Estado |
|---|---|
| `woovi_app_id_sandbox` | ✅ gravado (o AppID de teste que já existia) |
| `woovi_app_id_production` | ⚠️ **vazio** — falta o AppID da conta real |
| Divisão por método | ✅ **ligada**: PIX = Woovi · cartão = IO Pay · escopo = `v2` |
| Roteamento do V2 | ✅ **provado em produção** (6/6): V2+PIX → Woovi · V1+PIX → IO Pay · V2+cartão → IO Pay |
| Tela do checkout V2 | ✅ **9/9**: o seletor mostra "Cartão · IOPay" e "PIX · Woovi"; ao escolher o PIX o texto do Pagamento Automático aparece. O checkout normal (V1) mostra só "Cartão" e "PIX" — **sem nome de provedor** |
| QA da tela nova | ✅ **20/20** em `dividepass.com/admin/settings` |

**O que falta para a produção**: o AppID da conta real da Woovi. Ele só pode
ser gerado no painel da Woovi (conta de produção → API/Plugins → Nova
API/Plugin) e colado em **Admin → Configurações → Credenciais → Woovi →
"AppID de Produção"** (botão **"Testar"** valida antes de salvar).

**Migration**: `database/add-woovi-app-id-por-ambiente.sql` (idempotente,
já executada em produção).

