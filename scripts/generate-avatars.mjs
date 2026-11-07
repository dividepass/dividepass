/**
 * Gerador da galeria de avatares do DividePass.
 *
 * Desenha rostos em SVG (vetorial, leve e nítido em qualquer tamanho) e
 * escreve:
 *   - public/avatars/avatar-01.svg ... avatar-24.svg
 *   - src/lib/avatarPresets.js  (a lista que o front consome)
 *
 * Para mudar a galeria: edite os personagens lá embaixo e rode
 *   node scripts/generate-avatars.mjs
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/avatars');

// ─────────────────────────────────────────────────────────────
// Paletas
// ─────────────────────────────────────────────────────────────
const SKIN = {
  clara: { base: '#F8D9C4', shade: '#EFBE9E' },
  media: { base: '#EFC3A0', shade: '#DDA47C' },
  morena: { base: '#D79B6E', shade: '#BF7E52' },
  brown: { base: '#A96B44', shade: '#8E5333' },
  escura: { base: '#7A4A2C', shade: '#613820' },
  negra: { base: '#4E2D1B', shade: '#3B2013' },
};

const HAIR = {
  preto: '#231A17',
  castanho: '#4A2F1E',
  chocolate: '#6B3F21',
  caramelo: '#B9793A',
  loiro: '#E3B657',
  ruivo: '#C4552B',
  grisalho: '#8C8C99',
  branco: '#D9D6E0',
  cacheado: '#2E2119',
  castanhoClaro: '#8A5A33',
  azul: '#3E3A63',
  rosa: '#D96A9A',
  verde: '#3F7A5B',
};

const BG = {
  lavanda: '#E9E7FD',
  verde: '#DEF3E7',
  pessego: '#FDE7DF',
  azul: '#E3EDFD',
  creme: '#FFF3D6',
  lilás: '#F2E4FF',
  ciano: '#DDF3F6',
  rosa: '#FBE6EE',
  sálvia: '#E7F1E1',
  areia: '#FCEEDF',
  gelo: '#E8F4F6',
  damasco: '#FDEBD2',
};

const SHIRT = {
  indigo: '#4F46E5',
  violeta: '#7C3AED',
  rosa: '#DB2777',
  laranja: '#EA580C',
  verde: '#059669',
  teal: '#0D9488',
  azul: '#2563EB',
  vinho: '#9F1239',
  ambar: '#D97706',
  cinza: '#475569',
  preto: '#1F2937',
  ciano: '#0891B2',
};

// ─────────────────────────────────────────────────────────────
// Desenho
// ─────────────────────────────────────────────────────────────

/** Cabelo: desenho por cima da cabeça. */
function hairFront(style, color) {
  const c = color;
  switch (style) {
    case 'curto':
      return `<path d="M38 54C35 30 48 18 64 18C80 18 93 30 90 54C86 40 78 34 64 34C50 34 42 40 38 54Z" fill="${c}"/>`;
    case 'buzz':
      return `<path d="M40 52C38 32 50 21 64 21C78 21 90 32 88 52C85 40 77 35 64 35C51 35 43 40 40 52Z" fill="${c}"/>`;
    case 'cachos':
      return `<g fill="${c}">
        <circle cx="44" cy="30" r="10"/><circle cx="55" cy="22" r="11"/><circle cx="69" cy="21" r="11"/>
        <circle cx="81" cy="28" r="10"/><circle cx="39" cy="40" r="8"/><circle cx="89" cy="39" r="8"/>
      </g>`;
    case 'coque':
      return `<g fill="${c}">
        <circle cx="64" cy="12" r="12"/>
        <path d="M38 54C35 30 48 18 64 18C80 18 93 30 90 54C86 40 78 34 64 34C50 34 42 40 38 54Z"/>
      </g>`;
    case 'rabo':
      return `<g fill="${c}">
        <path d="M38 54C35 30 48 18 64 18C80 18 93 30 90 54C86 40 78 34 64 34C50 34 42 40 38 54Z"/>
        <circle cx="94" cy="34" r="10"/>
        <path d="M92 40C100 46 100 58 94 66C88 58 88 46 92 40Z"/>
      </g>`;
    case 'chanel':
      return `<g fill="${c}">
        <path d="M36 56C32 28 46 16 64 16C82 16 96 28 92 56L92 76L84 76L84 48C80 36 72 32 64 32C56 32 48 36 44 48L44 76L36 76Z"/>
      </g>`;
    case 'longo':
      return `<g fill="${c}">
        <path d="M34 58C30 28 46 14 64 14C82 14 98 28 94 58L94 80L85 80L85 46C81 34 73 30 64 30C55 30 47 34 43 46L43 80L34 80Z"/>
      </g>`;
    case 'pontas':
      return `<path d="M38 54C35 30 48 18 64 18C80 18 93 30 90 54C86 38 78 30 64 30C50 30 42 38 38 54Z" fill="${c}"/>
        <g fill="${c}"><path d="M36 46L30 30L46 40Z"/><path d="M92 46L98 30L82 40Z"/></g>`;
    case 'gorro':
      return `<g>
        <path d="M36 48C36 26 48 16 64 16C80 16 92 26 92 48L92 50L36 50Z" fill="${c}"/>
        <rect x="33" y="44" width="62" height="12" rx="6" fill="${c}" opacity="0.85"/>
        <circle cx="64" cy="12" r="7" fill="${c}"/>
      </g>`;
    case 'bone':
      return `<path d="M36 50C34 26 48 15 64 15C80 15 94 26 92 50C88 34 78 29 64 29C50 29 40 34 36 50Z" fill="${c}"/>
        <path d="M36 50C38 44 44 41 52 41L52 50C44 50 40 52 36 56Z" fill="${c}"/>`;
    case 'nenhum':
    default:
      return '';
  }
}

/** Cabelo/roupa que fica ATRÁS do rosto (volume, hijab, franja lateral). */
function hairBack(style, color) {
  switch (style) {
    case 'afro':
      return `<circle cx="64" cy="50" r="40" fill="${color}"/>`;
    case 'hijab':
      return `<path d="M24 128C22 70 34 16 64 16C94 16 106 70 104 128Z" fill="${color}"/>
        <ellipse cx="64" cy="52" rx="25" ry="29" fill="#F8D9C4"/>`;
    case 'longo':
      return `<path d="M34 128C32 66 40 24 64 24C88 24 96 66 94 128Z" fill="${color}"/>`;
    case 'chanel':
      return `<path d="M36 128C34 68 42 26 64 26C86 26 94 68 92 128Z" fill="${color}"/>`;
    default:
      return '';
  }
}

function eyes(style, browColor) {
  const eye = (cx) => {
    switch (style) {
      case 'feliz':
        return `<path d="M${cx - 7} 52Q${cx} 45 ${cx + 7} 52" stroke="#2B2118" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      case 'fechado':
        return `<path d="M${cx - 7} 51Q${cx} 57 ${cx + 7} 51" stroke="#2B2118" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 'bolinha':
        return `<circle cx="${cx}" cy="52" r="4.2" fill="#2B2118"/>`;
      default:
        return `<g>
          <ellipse cx="${cx}" cy="52" rx="7.5" ry="8.5" fill="#FFFFFF"/>
          <circle cx="${cx}" cy="52.5" r="4.4" fill="#2B2118"/>
          <circle cx="${cx + 1.8}" cy="49.8" r="1.6" fill="#FFFFFF"/>
        </g>`;
    }
  };
  return eye(52) + eye(76);
}

function brows(style, color) {
  if (style === 'sem') return '';
  const y = 40;
  const shape = style === 'tranquila'
    ? `<path d="M44 ${y + 2}Q52 ${y - 3} 60 ${y + 1}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<path d="M44 ${y}Q52 ${y - 4} 60 ${y}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return shape + `<path d="M68 ${y}Q76 ${y - 4} 84 ${y}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}

function mouth(style) {
  switch (style) {
    case 'aberta':
      return `<path d="M54 70Q64 84 74 70Q64 74 54 70Z" fill="#8E3B45"/>`;
    case 'sorriso':
      return `<path d="M52 68Q64 80 76 68" stroke="#8E3B45" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    case 'discreta':
      return `<path d="M58 70Q64 75 70 70" stroke="#8E3B45" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M50 66Q64 82 78 66Q64 70 50 66Z" fill="#8E3B45"/>`;
  }
}

function glasses(type, color) {
  if (type === 'nenhum') return '';
  if (type === 'quadrado') {
    return `<g fill="none" stroke="${color}" stroke-width="2.6">
      <rect x="42" y="44" width="20" height="16" rx="5"/>
      <rect x="66" y="44" width="20" height="16" rx="5"/>
      <path d="M62 50H66"/>
    </g>`;
  }
  if (type === 'escuro') {
    return `<g fill="#1F2937" stroke="#1F2937" stroke-width="2">
      <rect x="41" y="43" width="21" height="17" rx="7"/>
      <rect x="66" y="43" width="21" height="17" rx="7"/>
      <path d="M62 49H66" stroke="#1F2937" stroke-width="3"/>
    </g>`;
  }
  return `<g fill="none" stroke="${color}" stroke-width="2.6">
    <circle cx="52" cy="52" r="9.5"/><circle cx="76" cy="52" r="9.5"/>
    <path d="M61.5 50Q64 48 66.5 50"/>
  </g>`;
}

function beard(type, color) {
  switch (type) {
    case 'por.make':
      return `<path d="M42 62C44 82 54 90 64 90C74 90 84 82 86 62C82 74 74 80 64 80C54 80 46 74 42 62Z" fill="${color}" opacity="0.9"/>`;
    case 'bigode':
      return `<path d="M55 64Q64 60 73 64Q64 70 55 64Z" fill="${color}"/>`;
    case 'por.make':
      return `<ellipse cx="64" cy="72" rx="20" ry="16" fill="${color}" opacity="0.18"/>`;
    default:
      return '';
  }
}

function extras(kind, color) {
  switch (kind) {
    case 'boina':
      return `<path d="M34 46C34 24 47 14 64 14C81 14 94 24 94 46Z" fill="#1F2937"/>
        <circle cx="64" cy="12" r="6" fill="#1F2937"/>`;
    case 'chapeu':
      return `<g>
        <path d="M36 44C36 24 48 16 64 16C80 16 92 24 92 44Z" fill="${color}"/>
        <path d="M30 44C42 40 86 40 98 44C98 49 86 52 64 52C42 52 30 49 30 44Z" fill="${color}"/>
        <path d="M30 44C42 40 86 40 98 44C92 46 36 46 30 44Z" fill="#000" opacity="0.12"/>
      </g>`;
    case 'fone':
      return `<g fill="none" stroke="#334155" stroke-width="4" stroke-linecap="round">
        <path d="M34 56V50C34 30 48 20 64 20C80 20 94 30 94 50V56"/>
      </g>
      <rect x="28" y="50" width="12" height="20" rx="6" fill="#334155"/>
      <rect x="88" y="50" width="12" height="20" rx="6" fill="#334155"/>`;
    case 'brinco':
      return `<g fill="#E5A93D">
        <circle cx="39" cy="60" r="3.4"/><circle cx="89" cy="60" r="3.4"/>
      </g>`;
    case 'cachecol':
      return `<path d="M40 128C42 100 52 90 64 90C76 90 86 100 88 128Z" fill="${color}"/>
        <path d="M46 100C52 112 76 112 82 100C78 110 70 114 64 114C58 114 50 110 46 100Z" fill="#000" opacity="0.08"/>`;
    case 'sardas':
      return `<g fill="#C98A5E" opacity="0.75">
        <circle cx="47" cy="62" r="1.5"/><circle cx="53" cy="64" r="1.5"/><circle cx="75" cy="64" r="1.5"/><circle cx="81" cy="62" r="1.5"/>
      </g>`;
    default:
      return '';
  }
}

/**
 * Monta o SVG de um personagem.
 */
function buildAvatar(cfg) {
  const skin = SKIN[cfg.skin] || SKIN.clara;
  // As paletas são tabelas: o elenco usa a CHAVE ("loiro", "lavanda"...).
  // Aqui cada chave vira a cor final; literal continua valendo.
  const hair = HAIR[cfg.hair] || cfg.hair;
  const bg = BG[cfg.bg] || cfg.bg;
  const shirt = SHIRT[cfg.shirt] || cfg.shirt;
  const back = hairBack(cfg.hairBack, cfg.hairBackColor || hair);
  const headBack = `<ellipse cx="64" cy="52" rx="25" ry="29" fill="${skin.base}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Avatar ${cfg.label}">
  <defs><clipPath id="c"><circle cx="64" cy="64" r="64"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="128" height="128" fill="${bg}"/>
    ${back}
    <path d="M14 128C14 102 36 90 64 90C92 90 114 102 114 128Z" fill="${shirt}"/>
    ${cfg.hairBack === 'hijab' ? '' : `<rect x="55" y="70" width="18" height="22" rx="9" fill="${skin.shade}"/>`}
    ${headBack}
    <circle cx="39" cy="56" r="5.6" fill="${skin.base}"/>
    <circle cx="89" cy="56" r="5.6" fill="${skin.base}"/>
    ${cfg.hairBack === 'hijab' ? `<path d="M40 44C44 30 52 22 64 22C76 22 84 30 88 44C80 36 72 32 64 32C56 32 48 36 40 44Z" fill="${hair}"/>` : hairFront(cfg.hairStyle, hair)}
    ${brows(cfg.brows, hair)}
    ${eyes(cfg.eyes, hair)}
    ${cfg.blush ? `<g fill="#F49AA8" opacity="0.5"><ellipse cx="46" cy="63" rx="6" ry="3.6"/><ellipse cx="82" cy="63" rx="6" ry="3.6"/></g>` : ''}
    ${beard(cfg.beard, hair)}
    ${mouth(cfg.mouth)}
    ${glasses(cfg.glasses, cfg.glassesColor || '#334155')}
    ${extras(cfg.extra, cfg.extraColor || hair)}
  </g>
</svg>
`;
}

// ─────────────────────────────────────────────────────────────
// Elenco
// ─────────────────────────────────────────────────────────────
const CHARACTERS = [
  { label: 'Cabelo curto', bg: BG.lavanda, skin: 'clara', hair: 'castanho', hairStyle: 'curto', shirt: SHIRT.indigo, eyes: 'bolinha', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cachos', bg: BG.creme, skin: 'negra', hair: 'cacheado', hairStyle: 'cachos', shirt: SHIRT.verde, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Coque', bg: BG.rosa, skin: 'morena', hair: 'preto', hairStyle: 'coque', shirt: SHIRT.violeta, eyes: 'aberto', mouth: 'feliz', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Rabo de cavalo', bg: BG.azul, skin: 'media', hair: 'caramelo', hairStyle: 'rabo', shirt: SHIRT.rosa, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'brinco' },
  { label: 'Chanel', bg: BG.salvia, skin: 'clara', hair: 'loiro', hairStyle: 'chanel', shirt: SHIRT.laranja, eyes: 'aberto', mouth: 'discreta', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo longo', bg: BG.lilas, skin: 'media', hair: 'ruivo', hairStyle: 'longo', shirt: SHIRT.teal, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Barba e óculos', bg: BG.pessego, skin: 'brown', hair: 'preto', hairStyle: 'curto', shirt: SHIRT.cinza, eyes: 'aberto', mouth: 'sorriso', glasses: 'quadrado', brows: 'sim', beard: 'barba', extra: 'nenhum' },
  { label: 'Gorro', bg: BG.gelo, skin: 'clara', hair: 'castanhoClaro', hairStyle: 'gorro', shirt: SHIRT.winho, eyes: 'feliz', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Bone', bg: BG.salvia, skin: 'morena', hair: 'chocolate', hairStyle: 'bone', shirt: SHIRT.violeta, eyes: 'aberto', mouth: 'discreta', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Hijab', bg: BG.lavanda, skin: 'media', hair: '#8E7CC3', hairStyle: 'hijab', hairBack: 'hijab', shirt: SHIRT.violeta, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Boné', bg: BG.damasco, skin: 'morena', hair: 'preto', hairStyle: 'nenhum', shirt: SHIRT.indigo, eyes: 'bolinha', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'por.make', extra: 'chapeu', extraColor: SHIRT.verde },
  { label: 'Fone de ouvido', bg: BG.ciano, skin: 'media', hair: 'preto', hairStyle: 'curto', shirt: SHIRT.azul, eyes: 'fechado', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'fone' },
  { label: 'Afro', bg: BG.creme, skin: 'negra', hair: 'preto', hairStyle: 'nenhum', hairBack: 'afro', shirt: SHIRT.laranja, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo grisalho', bg: BG.areia, skin: 'clara', hair: 'grisalho', hairStyle: 'curto', shirt: SHIRT.cinza, eyes: 'aberto', mouth: 'sorriso', glasses: 'redondo', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cachecol', bg: BG.rosa, skin: 'brown', hair: 'preto', hairStyle: 'pontas', shirt: SHIRT.cinza, eyes: 'aberto', mouth: 'discreta', glasses: 'nenhum', brows: 'sim', beard: 'bigode', extra: 'cachecol', extraColor: SHIRT.violeta },
  { label: 'Óculos escuros', bg: BG.azul, skin: 'media', hair: 'castanho', hairStyle: 'curto', shirt: SHIRT.preto, eyes: 'bolinha', mouth: 'discreta', glasses: 'escuro', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo cacheado ruivo', bg: BG.lilas, skin: 'clara', hair: 'ruivo', hairStyle: 'cachos', shirt: SHIRT.rosa, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'sardas' },
  { label: 'Batom', bg: BG.pessego, skin: 'media', hair: 'rosa', hairStyle: 'chanel', shirt: SHIRT.rosa, eyes: 'aberto', mouth: 'aberta', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'brinco' },
  { label: 'Cabelo azul', bg: BG.gelo, skin: 'clara', hair: 'azul', hairStyle: 'curto', shirt: SHIRT.ciano, eyes: 'bolinha', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo verde', bg: BG.salvia, skin: 'brown', hair: 'verde', hairStyle: 'coque', shirt: SHIRT.verde, eyes: 'aberto', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo branco', bg: BG.lavanda, skin: 'clara', hair: 'branco', hairStyle: 'longo', shirt: SHIRT.teal, eyes: 'feliz', mouth: 'sorriso', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Moicano', bg: BG.areia, skin: 'media', hair: 'preto', hairStyle: 'pontas', shirt: SHIRT.indigo, eyes: 'bolinha', mouth: 'discreta', glasses: 'nenhum', brows: 'sim', beard: 'por.make', extra: 'nenhum' },
  { label: 'Sorriso de orelha', bg: BG.creme, skin: 'brown', hair: 'preto', hairStyle: 'buzz', shirt: SHIRT.violeta, eyes: 'feliz', mouth: 'aberta', glasses: 'nenhum', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
  { label: 'Cabelo cacheado claro', bg: BG.damasco, skin: 'media', hair: 'caramelo', hairStyle: 'cachos', shirt: SHIRT.winho, eyes: 'aberto', mouth: 'sorriso', glasses: 'redondo', brows: 'sim', beard: 'nenhum', extra: 'nenhum' },
];

// ─────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

const presets = [];

CHARACTERS.forEach((cfg, index) => {
  const id = `avatar-${String(index + 1).padStart(2, '0')}`;
  const file = `${id}.svg`;
  writeFileSync(resolve(OUT_DIR, file), buildAvatar(cfg), 'utf8');
  presets.push({ id, url: `/avatars/${file}`, label: cfg.label });
});

// A marca entra como opção: quem prefere não usar um rosto usa o logo.
const brandSrc = resolve(ROOT, 'public/logo.png');
if (existsSync(brandSrc)) {
  copyFileSync(brandSrc, resolve(OUT_DIR, 'dividepass.png'));
  presets.push({ id: 'dividepass', url: '/avatars/dividepass.png', label: 'Logo DividePass' });
}

const js = `/**
 * Galeria de avatares prontos do DividePass.
 *
 * GERADO por scripts/generate-avatars.mjs — não edite à mão.
 * Para mudar a galeria, edite o script e rode \`node scripts/generate-avatars.mjs\`.
 */
export const AVATAR_PRESETS = ${JSON.stringify(presets, null, 2)};

/** Caminho de um preset pelo id (ou null se não existir). */
export function getPresetById(id) {
  return AVATAR_PRESETS.find((p) => p.id === id) || null;
}

/** true quando a URL guardada é um avatar pronto (e não uma foto enviada). */
export function isPresetAvatar(url) {
  return typeof url === 'string' && url.startsWith('/avatars/');
}
`;
writeFileSync(resolve(ROOT, 'src/lib/avatarPresets.js'), js, 'utf8');

console.log(`[avatars] ${presets.length} avatares gerados em public/avatars`);
console.log(`[avatars] src/lib/avatarPresets.js atualizado`);
