# E-MAIL GERENCIADO PELA DIVIDEPASS (com IA) — como publicar

> Data: 2026-10-31
> Roda: e-mail do grupo criado automaticamente, busca do código pela IA.

---

## 1. O QUE É

Na criação do grupo, o dono ganha uma opção nova na etapa **Credenciais**:

> **Deixar a DividePass gerenciar o e-mail do grupo com IA**
> Recomendado para plataformas que pedem confirmação por e-mail toda vez que
> alguém entra.

Com a opção ligada:

1. A DividePass cria uma **caixa de e-mail exclusiva do grupo** no servidor
   (`grupo-abc123@dividepass.com`);
2. O dono **troca o e-mail da conta da plataforma** por esse e-mail do grupo;
3. Toda vez que a plataforma manda um código de verificação, ele cai nessa
   caixa — e a **IA busca e entrega o número pronto para o membro**, a
   qualquer hora, em qualquer dia.

O membro nunca precisa abrir o e-mail dele: ele clica em **Buscar Código**.

### O que já existia (não foi reescrito)

| Peça | Onde | O que faz |
|---|---|---|
| `group_mailboxes` | banco | caixa IMAP por grupo (servidor, usuário, senha, IA) |
| `fetch-email-code` | edge function | entra no IMAP do grupo, acha o e-mail e extrai o código |
| `EmailCodeSearch` | front | botão "Buscar Código" do membro e do dono |
| `groups.email_code_enabled` | banco | liga/desliga a busca de código do grupo |

### O que é novo nesta rodada

| Peça | Arquivo |
|---|---|
| Opção no wizard + explicação | `src/components/group-creation/ManagedEmailOption.jsx` |
| Card do e-mail (membro e dono) | `src/components/ManagedEmailCard.jsx` |
| Cliente do e-mail gerenciado | `src/lib/managedGroupEmail.js` |
| Criação da caixa (cPanel) | `supabase/functions/provision-group-mailbox/index.ts` |
| Colunas + RPC de leitura | `database/add-managed-group-mailbox.sql` |
| Console do cPanel | `scripts/cpanel-email.mjs` |

---

## 2. O FLUXO

```
Dono liga a opção no wizard
        │
        ▼
Wizard publica o grupo  ──►  groups.managed_email = true
        │                            groups.email_code_enabled = true
        ▼
POST /functions/v1/provision-group-mailbox   (só o dono ou admin)
        │
        ├─► cPanel UAPI  Email::add_pop
        │      grupo-abc123@dividepass.com  + senha forte
        │
        ├─► group_mailboxes  (IMAP, usuário, senha, email_ai_enabled = true)
        │
        └─► grupo cai em "Gerenciar Grupo" com o endereço na tela
                 │
                 ▼
        Dono troca o e-mail da conta da plataforma
                 │
                 ▼
Membro abre "Meus acessos" e clica em "Buscar Código"
                 │
                 ▼
        fetch-email-code → IMAP do grupo → regex → (se falhar) IA (Groq)
                 │
                 ▼
        O código aparece na tela do membro
```

---

## 3. O QUE PUBLICAR (ordem importa)

### Passo 1 — Banco (obrigatório antes da function)

No **SQL Editor do Supabase** (roda como `postgres`):

```
database/add-managed-group-mailbox.sql
```

Ele faz três coisas:

1. cria `groups.managed_email` (a intenção do dono) e as colunas
   `managed_email` / `provisioned_at` / `managed_by` em `group_mailboxes`;
2. cria a função **`group_managed_email(group_id)`** — devolve **só o endereço**
   do grupo, e só para quem tem vínculo com ele (membro, assinante ou dono);
3. dá `GRANT EXECUTE` dessa função para `authenticated`.

> **Por que uma função e não uma policy?** A RLS filtra *linhas*, não *colunas*.
> Liberar a leitura de `group_mailboxes` para o membro entregaria a ele
> `email_imap_password` — a senha da caixa que guarda o código da assinatura
> compartilhada. É exatamente o vazamento que o `fix-p0-security.sql` travou.
> A senha continua visível só para admin e `service_role`.

Conferir:

```sql
-- colunas novas
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'group_mailboxes' ORDER BY ordinal_position;

-- a função existe?
SELECT proname FROM pg_proc WHERE proname = 'group_managed_email';

-- um grupo com e-mail gerenciado responde?
SELECT * FROM public.group_managed_email('<group_id>');
```

### Passo 2 — Segredo do cPanel

Em **Supabase → Edge Functions → Secrets**:

| Segredo | Valor |
|---|---|
| `CPANEL_TOKEN` | token de API do cPanel (comexa com `BFX3…`) |

> O token **nunca** vai para o front nem para o `app_settings`.

> ⚠️ **Estado em 31/10/2026:** o token `BFX3…` **não autentica** no
> `cpanel.dividepass.com` (nem no `flora.tdnx.net`) — o cPanel responde
> *"Token authentication allows access to UAPI or API 2 calls only"*, o que
> significa que esse token é de **outro cPanel** (a outra hospedagem). Testado
> com o usuário `dividepasscom`, com 11 formatos de URL (UAPI, API 2, `api.version`,
> GET/POST) e em 4 hosts. **Sem o `cpanel_host` certo, a criação automática não
> funciona** — e nesse caso o caminho é o do **cadastro manual** (Passo 4.1).

### Passo 3 — Configuração (painel → /admin)

Tudo em `app_settings` (chave/valor), ajustável sem deploy:

| Chave | Padrão | O que faz |
|---|---|---|
| `cpanel_host` | `cpanel.dividepass.com` | host do cPanel (sem `https://` e sem porta) |
| `cpanel_user` | — | **usuário do cPanel** (obrigatório) |
| `cpanel_domain` | `dividepass.com` | domínio das caixas dos grupos |
| `cpanel_skip_update_db` | `1` | `1` quando o servidor de e-mail é gerenciado fora do cPanel |
| `group_email_prefix` | `grupo` | prefixo da caixa (`grupo-abc123@…`) |
| `imap_server` | `mail.<dominio>` | host IMAP usado na busca do código |
| `imap_port` | `993` | porta IMAP |

Exemplo de SQL:

```sql
INSERT INTO app_settings (key, value) VALUES
  ('cpanel_host', 'cpanel.dividepass.com'),
  ('cpanel_user', 'SEU_USUARIO'),
  ('cpanel_domain', 'dividepass.com'),
  ('imap_server', 'mail.dividepass.com'),
  ('imap_port', '993')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### Passo 4 — Edge function

```powershell
# 1) empacota em arquivo único (pronto para colar no painel)
node scripts/empacotar-function-painel.mjs provision-group-mailbox

# 2) confere sintaxe e consistência
node scripts/validar-arquivos-painel.mjs
```

A saída fica em `.tmp-verify/painel/provision-group-mailbox.ts`.

No painel do Supabase → **Edge Functions → New Function**:

- nome exato: `provision-group-mailbox`;
- cole o arquivo inteiro;
- **Verify JWT ligado** (a function exige sessão: só o dono ou um admin entra);
- Deploy.

#### Passo 4.1 — Sem a automação do cPanel (cadastro manual)

Se o `CPANEL_TOKEN` não estiver configurado (ou o host estiver errado), a
feature **continua funcionando**: o dono cria a caixa no painel do servidor de
e-mail e cadastra o e-mail + senha direto no app.

Na tela **Gerenciar Grupo** do grupo:

1. clique em **Criar e-mail do grupo** (a criação automática vai falhar com um
   aviso);
2. clique em **"Já criei a caixa no painel — cadastrar aqui"**;
3. preencha o **e-mail da caixa**, a **senha** e (opcional) o **servidor IMAP**
   — `mail.dividepass.com` se for o de sempre;
4. **Cadastrar caixa do grupo**.

O app grava a caixa em `group_mailboxes` (com `managed_email = true` e a IA
ligada) e o botão **Buscar Código** passa a funcionar para os membros.

Equivalente pela edge function:

```bash
POST /functions/v1/provision-group-mailbox
Authorization: Bearer <token do dono>
{ "group_id": "<id>", "action": "register",
  "email": "grupo-abc123@dividepass.com",
  "password": "senha-da-caixa",
  "imap_server": "mail.dividepass.com" }
```

### Passo 5 — Front (Vercel)

```powershell
npm run build
vercel --prod --yes --token (Get-Content .vercel_token -Raw).Trim()
```

---

## 4. TESTE

### Na tela (o caminho do dono)

1. `dividepass.com/dashboard/my-groups/create` → etapa **Credenciais**;
2. ligue **"Deixar a DividePass gerenciar o e-mail do grupo com IA"**;
3. conclua o wizard;
4. você cai em **Gerenciar Grupo** com o e-mail do grupo e o passo a passo;
5. troque o e-mail da conta da plataforma pelo e-mail do grupo;
6. peça um código na plataforma e clique em **Buscar Código** na tela do
   membro.

### No console do cPanel

```powershell
$env:CPANEL_HOST   = 'cpanel.dividepass.com'
$env:CPANEL_USER   = 'SEU_USUARIO'
$env:CPANEL_DOMAIN = 'dividepass.com'
$env:CPANEL_TOKEN  = 'SEU_TOKEN'

node scripts/cpanel-email.mjs list-pops
node scripts/cpanel-email.mjs create --email grupo-teste@dividepass.com
```

> O `.cpanel.json` (mesma configuração, em arquivo) também funciona e está no
> `.gitignore`.

### Checklist

- [ ] O botão do cPanel responde `list-pops` sem erro
- [ ] `POST /functions/v1/provision-group-mailbox` cria a caixa e devolve o e-mail
- [ ] `group_mailboxes` tem a linha do grupo com `managed_email = true`
- [ ] `groups.email_code_enabled = true` e `groups.managed_email = true`
- [ ] A tela do membro mostra o card do e-mail do grupo
- [ ] **Buscar Código** devolve o código (regex ou IA)
- [ ] Um código de **troca de senha / alteração de e-mail** é **bloqueado**
      (a função `fetch-email-code` recusa esses casos por segurança)

---

## 5. SEGURANÇA (o que a feature NÃO faz)

| Regra | Onde |
|---|---|
| A senha IMAP do grupo nunca chega no navegador | a leitura passa por `group_managed_email` (só o endereço) |
| Só o dono ou um admin cria a caixa | `provision-group-mailbox` confere o token contra `groups.owner_id` |
| Só quem tem vínculo com o grupo vê o e-mail | a função checa membro/assinante/dono antes de devolver |
| Código de redefinição de senha não é entregue | `SENSITIVE_PATTERNS` em `fetch-email-code` |
| O dono do grupo não é dono da caixa | a senha fica no servidor; o grupo só usa o e-mail |

---

## 6. PENDÊNCIAS / LIMITES

- **Token do cPanel**: o token `BFX3…` não autentica no `cpanel.dividepass.com`.
  Enquanto o `cpanel_host`/`cpanel_user` corretos não estiverem em
  `app_settings`, use o **cadastro manual** (Passo 4.1) — a feature funciona
  igual, só o passo de criar a caixa no servidor é manual.
- **MCP do WebPros**: o servidor `webpros-mcp` já está registrado no perfil
  (`~/.minimax/mcp.json` — o arquivo estava com comentários e quebrava o
  `mcp list`; foi corrigido). As ferramentas dele só entram na próxima
  abertura do app, e o handshake OAuth abre o navegador para você entrar no
  painel WebPros. Por ele dá para criar a caixa direto, sem token na mão.
- **Vários domínios**: hoje o grupo usa sempre `cpanel_domain`. Para grupos em
  domínios diferentes, cada grupo precisaria de uma caixa própria.
- **Rotação de senha**: trocar a senha da caixa no cPanel exige atualizar
  `group_mailboxes.email_imap_password` (hoje é manual).
- **E-mail de boas-vindas do grupo**: a caixa do grupo é usada só para
  *receber* códigos; ela não é a caixa de contato com o cliente.
