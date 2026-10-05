# Deploy no Dokploy (VPS)

App = SPA estático (React/Vite). Backend = Supabase (edge functions + Postgres).
O que sobe na VPS é **só o front**.

## Variáveis de ambiente (build)

Vite embute essas no bundle — precisam existir **no momento do build**:

| Variável | Exemplo |
|---|---|
| `VITE_SUPABASE_URL` | `https://lasoouwboxspstqvjbsv.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` |
| `VITE_SITE_URL` | `https://seu-dominio.com.br` |
| `VITE_MERCADO_PAGO_BACK_URL` | `https://seu-dominio.com.br/dashboard` |

> Só a **anon** key vai pro bundle. A `service_role` é exclusiva do backend (Supabase secrets) e **nunca** deve ir no front.

## Opção A — Dockerfile (recomendado)

No Dokploy: *Create Application → Build Type: Dockerfile*

Build Args (uma por linha):

```
VITE_SUPABASE_URL=https://lasoouwboxspstqvjbsv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_SITE_URL=https://seu-dominio.com.br
VITE_MERCADO_PAGO_BACK_URL=https://seu-dominio.com.br/dashboard
```

Build Command / Start Command: **vazio** (o Dockerfile já define).

Health check path: `/healthz`

Porta exposta: `80`. O Dokploy gerencia o proxy TLS.

## Opção B — Railpack / Heroku buildpacks

Build Command:
```
npm ci && npm run build
```

Start Command:
```
npm start
```

> `npm start` sobe `server.js` (servidor estático próprio, zero dependências, porta via `PORT`).

Sem Docker, os buildpacks estáticos do Heroku usam o `static.json`:
Build Command `npm run build` (via `heroku-postbuild`), Start Command vazio, root `dist`.

## Depois do deploy

1. Rodar a migration do banco (no SQL Editor do Supabase):
   `database/add-verification-pins-manual-action.sql`
2. Subir as edge functions atualizadas (`fetch-email-code`, `receive-email-code`)
3. Apontar o domínio no Dokploy (Proxy → domínio)
4. Conferir `https://seu-dominio.com.br/healthz` → `ok`

## Checklist de DNS / cache

- `index.html` e `sw.js`: `no-cache` — evita bundle velho após deploy
- `assets/*`: `immutable, 1 ano` (têm hash no nome)
- Se aparecer versão antiga, é o service worker: em `src/main.jsx` há registro de `sw.js`.
