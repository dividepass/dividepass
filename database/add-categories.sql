-- Create categories enum and add to services
DO $$ BEGIN
  CREATE TYPE service_category AS ENUM (
    'streaming', 'musica', 'ia', 'cursos', 'produtividade',
    'ferramentas', 'leitura', 'games', 'saude', 'seguranca'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.streaming_services
  ADD COLUMN IF NOT EXISTS category service_category NOT NULL DEFAULT 'streaming';

-- Seed categories for existing services
UPDATE streaming_services SET category = 'streaming' WHERE name IN (
  'Netflix', 'Disney+', 'HBO Max', 'Prime Video', 'YouTube Premium',
  'Globoplay', 'Paramount+', 'Apple TV+', 'Crunchyroll', 'MUBI'
);
UPDATE streaming_services SET category = 'musica' WHERE name IN (
  'Spotify', 'Deezer', 'YouTube Music', 'Tidal', 'Audible'
);
UPDATE streaming_services SET category = 'ia' WHERE name IN (
  'ChatGPT Plus', 'Claude Pro', 'Gemini Advanced', 'Midjourney',
  'Perplexity Pro', 'Cursor Pro', 'ElevenLabs', 'Runway'
);
UPDATE streaming_services SET category = 'cursos' WHERE name IN (
  'Alura', 'Udemy', 'Coursera', 'Domestika', 'Duolingo', 'Rocketseat'
);
UPDATE streaming_services SET category = 'produtividade' WHERE name IN (
  'Microsoft 365', 'Google Workspace', 'Notion', 'Trello', 'ClickUp', 'Slack'
);
UPDATE streaming_services SET category = 'ferramentas' WHERE name IN (
  'Canva Pro', 'Adobe Creative Cloud', 'Figma', 'SEMrush', 'Envato', 'Grammarly'
);
UPDATE streaming_services SET category = 'leitura' WHERE name IN (
  'Kindle Unlimited', 'Scribd', 'Readly'
);
UPDATE streaming_services SET category = 'games' WHERE name IN (
  'Xbox Game Pass', 'PlayStation Plus', 'Nintendo Switch Online', 'GeForce Now'
);
UPDATE streaming_services SET category = 'saude' WHERE name IN (
  'Wellhub', 'Strava', 'Headspace', 'Calm'
);
UPDATE streaming_services SET category = 'seguranca' WHERE name IN (
  'NordVPN', 'Surfshark', 'Bitwarden', '1Password'
);

-- Add category display helper view
CREATE OR REPLACE VIEW category_info AS
SELECT
  category,
  CASE category
    WHEN 'streaming' THEN '📺 Streaming'
    WHEN 'musica' THEN '🎵 Música'
    WHEN 'ia' THEN '🤖 IA'
    WHEN 'cursos' THEN '🎓 Cursos'
    WHEN 'produtividade' THEN '💼 Produtividade'
    WHEN 'ferramentas' THEN '🛠 Ferramentas'
    WHEN 'leitura' THEN '📚 Leitura'
    WHEN 'games' THEN '🎮 Games'
    WHEN 'saude' THEN '🏋️ Saúde'
    WHEN 'seguranca' THEN '🔒 Segurança'
  END AS label,
  CASE category
    WHEN 'streaming' THEN 'Filmes, séries e esportes'
    WHEN 'musica' THEN 'Música, podcasts e audiobooks'
    WHEN 'ia' THEN 'Ferramentas de inteligência artificial'
    WHEN 'cursos' THEN 'Plataformas de ensino e capacitação'
    WHEN 'produtividade' THEN 'Trabalho e colaboração'
    WHEN 'ferramentas' THEN 'Design, marketing e edição'
    WHEN 'leitura' THEN 'Livros e conteúdo digital'
    WHEN 'games' THEN 'Assinaturas para jogos'
    WHEN 'saude' THEN 'Fitness e qualidade de vida'
    WHEN 'seguranca' THEN 'VPN, senhas e proteção'
  END AS description
FROM (SELECT unnest(enum_range(NULL::service_category)) AS category) sub;
