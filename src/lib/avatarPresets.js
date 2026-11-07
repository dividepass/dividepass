/**
 * Galeria de avatares prontos do DividePass.
 *
 * GERADO por scripts/generate-avatars.mjs — não edite à mão.
 * Para mudar a galeria, edite o script e rode `node scripts/generate-avatars.mjs`.
 */
export const AVATAR_PRESETS = [
  {
    "id": "avatar-01",
    "url": "/avatars/avatar-01.svg",
    "label": "Cabelo curto"
  },
  {
    "id": "avatar-02",
    "url": "/avatars/avatar-02.svg",
    "label": "Cachos"
  },
  {
    "id": "avatar-03",
    "url": "/avatars/avatar-03.svg",
    "label": "Coque"
  },
  {
    "id": "avatar-04",
    "url": "/avatars/avatar-04.svg",
    "label": "Rabo de cavalo"
  },
  {
    "id": "avatar-05",
    "url": "/avatars/avatar-05.svg",
    "label": "Chanel"
  },
  {
    "id": "avatar-06",
    "url": "/avatars/avatar-06.svg",
    "label": "Cabelo longo"
  },
  {
    "id": "avatar-07",
    "url": "/avatars/avatar-07.svg",
    "label": "Barba e óculos"
  },
  {
    "id": "avatar-08",
    "url": "/avatars/avatar-08.svg",
    "label": "Gorro"
  },
  {
    "id": "avatar-09",
    "url": "/avatars/avatar-09.svg",
    "label": "Bone"
  },
  {
    "id": "avatar-10",
    "url": "/avatars/avatar-10.svg",
    "label": "Hijab"
  },
  {
    "id": "avatar-11",
    "url": "/avatars/avatar-11.svg",
    "label": "Boné"
  },
  {
    "id": "avatar-12",
    "url": "/avatars/avatar-12.svg",
    "label": "Fone de ouvido"
  },
  {
    "id": "avatar-13",
    "url": "/avatars/avatar-13.svg",
    "label": "Afro"
  },
  {
    "id": "avatar-14",
    "url": "/avatars/avatar-14.svg",
    "label": "Cabelo grisalho"
  },
  {
    "id": "avatar-15",
    "url": "/avatars/avatar-15.svg",
    "label": "Cachecol"
  },
  {
    "id": "avatar-16",
    "url": "/avatars/avatar-16.svg",
    "label": "Óculos escuros"
  },
  {
    "id": "avatar-17",
    "url": "/avatars/avatar-17.svg",
    "label": "Cabelo cacheado ruivo"
  },
  {
    "id": "avatar-18",
    "url": "/avatars/avatar-18.svg",
    "label": "Batom"
  },
  {
    "id": "avatar-19",
    "url": "/avatars/avatar-19.svg",
    "label": "Cabelo azul"
  },
  {
    "id": "avatar-20",
    "url": "/avatars/avatar-20.svg",
    "label": "Cabelo verde"
  },
  {
    "id": "avatar-21",
    "url": "/avatars/avatar-21.svg",
    "label": "Cabelo branco"
  },
  {
    "id": "avatar-22",
    "url": "/avatars/avatar-22.svg",
    "label": "Moicano"
  },
  {
    "id": "avatar-23",
    "url": "/avatars/avatar-23.svg",
    "label": "Sorriso de orelha"
  },
  {
    "id": "avatar-24",
    "url": "/avatars/avatar-24.svg",
    "label": "Cabelo cacheado claro"
  },
  {
    "id": "dividepass",
    "url": "/avatars/dividepass.png",
    "label": "Logo DividePass"
  }
];

/** Caminho de um preset pelo id (ou null se não existir). */
export function getPresetById(id) {
  return AVATAR_PRESETS.find((p) => p.id === id) || null;
}

/** true quando a URL guardada é um avatar pronto (e não uma foto enviada). */
export function isPresetAvatar(url) {
  return typeof url === 'string' && url.startsWith('/avatars/');
}
