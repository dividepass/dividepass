-- Documentação da coluna: as opções de origem cresceram (Totens, TVs
-- Publicidades). Só um COMMENT — não há CHECK nem trigger sobre esse campo,
-- então o app é quem valida a lista. Idempotente.
COMMENT ON COLUMN public.users.lead_source IS
  'Como o usuario conheceu a plataforma (Instagram, Google, Indicacao de amigo/cliente, Facebook, TikTok, YouTube, WhatsApp, LinkedIn, ChatGPT e IAs, Totens, TVs Publicidades, Outro)';
