-- Banco de teste da limpeza: reproduz os casos que derrubaram a v1.
--
--   auth.users                  (id, email)
--   auth.identities             -> auth.users (CASCADE)
--   auth.audit_log              -> public.users (NO ACTION)  [FK em outro schema]
--   public.users                -> auth.users (NO ACTION)    [FK MUTUA]
--   public.platform_events      -> public.users (NO ACTION)  [o que trava o DELETE]
--   public.group_members        -> public.users (CASCADE)
--   public.groups               -> public.users (SET NULL)
--   public.composite_ref        -> public.users(id, email)   [FK COMPOSTA]
DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.composite_ref, public.group_members, public.groups,
                     public.platform_events, public.users CASCADE;

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id    uuid PRIMARY KEY,
  email text
);

CREATE TABLE auth.identities (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id),  -- FK MUTUA
  email      text,
  name       text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (id, email)
);

-- FK em outro schema (o schema `auth` referenciando `public`)
CREATE TABLE auth.audit_log (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id)   -- NO ACTION
);

CREATE TABLE public.platform_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  created_by uuid REFERENCES public.users(id)   -- NO ACTION: trava o DELETE
);

CREATE TABLE public.groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  owner_id   uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE public.group_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.composite_ref (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email   text,
  FOREIGN KEY (user_id, email) REFERENCES public.users(id, email)  -- FK COMPOSTA
);

-- ── contas ───────────────────────────────────────────────────
-- 6 de teste + 1 conta QA que tem que SOBREVIVER
INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111','probe-limpeza-1@divteste.com'),
  ('a2222222-2222-2222-2222-222222222222','probe-reset-1@divteste.com'),
  ('a3333333-3333-3333-3333-333333333333','mapa-mavis-1@divteste.com'),
  ('a4444444-4444-4444-4444-444444444444','qa.rodape.1@t.com'),
  ('a5555555-5555-5555-5555-555555555555','onb.1@gmail.com'),
  ('a6666666-6666-6666-6666-666666666666','regrinhas.e2e.1@divteste.com'),
  ('a7777777-7777-7777-7777-777777777777','qa.mavis@divteste.com');

INSERT INTO public.users (id, email, name) VALUES
  ('a1111111-1111-1111-1111-111111111111','probe-limpeza-1@divteste.com','Probe Limpeza'),
  ('a2222222-2222-2222-2222-222222222222','probe-reset-1@divteste.com','Probe Reset'),
  ('a3333333-3333-3333-3333-333333333333','mapa-mavis-1@divteste.com','Mapa Mavis'),
  ('a4444444-4444-4444-4444-444444444444','qa.rodape.1@t.com','QA Rodapé'),
  ('a5555555-5555-5555-5555-555555555555','onb.1@gmail.com','Onb'),
  ('a6666666-6666-6666-6666-666666666666','regrinhas.e2e.1@divteste.com','Regrinhas'),
  ('a7777777-7777-7777-7777-777777777777','qa.mavis@divteste.com','QA Mavis');

-- linhas-filhas que travam o DELETE do perfil
INSERT INTO public.platform_events (event_type, created_by)
SELECT 'user_login', id FROM public.users;

INSERT INTO auth.audit_log (user_id) SELECT id FROM public.users;

INSERT INTO public.composite_ref (user_id, email) SELECT id, email FROM public.users;

INSERT INTO public.group_members (user_id) SELECT id FROM public.users;

INSERT INTO public.groups (name, owner_id) SELECT 'Grupo QA', id FROM public.users;

INSERT INTO auth.identities (user_id) SELECT id FROM auth.users;

SELECT 'antes' AS etapa,
       (SELECT count(*) FROM public.users) AS perfis,
       (SELECT count(*) FROM auth.users) AS logins,
       (SELECT count(*) FROM public.platform_events) AS eventos,
       (SELECT count(*) FROM auth.audit_log) AS auditoria,
       (SELECT count(*) FROM public.composite_ref) AS compostos,
       (SELECT count(*) FROM public.group_members) AS membros;
