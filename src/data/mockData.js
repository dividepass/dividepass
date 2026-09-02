export const STREAMING_SERVICES = [
  {
    id: 'netflix',
    name: 'Netflix',
    fullName: 'Netflix Premium',
    color: '#E50914',
    icon: 'N',
    description: 'Plano Premium Ultra HD',
    maxGroupSize: 4
  },
  {
    id: 'spotify',
    name: 'Spotify',
    fullName: 'Spotify Family',
    color: '#1DB954',
    icon: 'S',
    description: 'Plano Família',
    maxGroupSize: 6
  },
  {
    id: 'disney',
    name: 'Disney+',
    fullName: 'Disney+ Premium',
    color: '#113CCF',
    icon: 'D',
    description: 'Disney+ sem anúncios',
    maxGroupSize: 4
  },
  {
    id: 'max',
    name: 'Max',
    fullName: 'Max (HBO Max)',
    color: '#002BE7',
    icon: 'M',
    description: 'Max Padrão',
    maxGroupSize: 4
  },
  {
    id: 'prime',
    name: 'Prime Video',
    fullName: 'Prime Video',
    color: '#00A8E1',
    icon: 'P',
    description: 'Amazon Prime Video',
    maxGroupSize: 3
  },
  {
    id: 'youtube',
    name: 'YouTube Premium',
    fullName: 'YouTube Premium',
    color: '#FF0000',
    icon: 'Y',
    description: 'YouTube sem anúncios',
    maxGroupSize: 5
  },
  {
    id: 'globoplay',
    name: 'Globoplay',
    fullName: 'Globoplay + Canais',
    color: '#ED1C24',
    icon: 'G',
    description: 'Globoplay com canais',
    maxGroupSize: 4
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    fullName: 'Crunchyroll Mega Fan',
    color: '#F47521',
    icon: 'C',
    description: 'Crunchyroll Mega Fan',
    maxGroupSize: 4
  }
];

export const INITIAL_GROUPS = [
  {
    id: 'netflix-g1',
    serviceId: 'netflix',
    name: 'Netflix - Grupo A',
    price: 12.90,
    members: ['joao.rateio@dividepass.com', 'maria@email.com', 'pedro@email.com', 'ana@email.com'],
    credentials: {
      email: 'netflix.grupo.a@dividepass.com',
      password: 'NxGroupA2026!',
      profile: 'Tela 2'
    }
  },
  {
    id: 'netflix-g2',
    serviceId: 'netflix',
    name: 'Netflix - Grupo B',
    price: 12.90,
    members: ['carlos@email.com'],
    credentials: {
      email: 'netflix.grupo.b@dividepass.com',
      password: 'NxGroupB2026!',
      profile: 'Tela 1'
    }
  },
  {
    id: 'spotify-g1',
    serviceId: 'spotify',
    name: 'Spotify - Família 1',
    price: 8.90,
    members: ['joao.rateio@dividepass.com', 'carlos@email.com'],
    credentials: {
      email: 'spotify.familia1@dividepass.com',
      password: 'SpotFam1!',
      profile: 'João (Convite)'
    }
  },
  {
    id: 'disney-g1',
    serviceId: 'disney',
    name: 'Disney+ - Grupo 1',
    price: 9.90,
    members: [],
    credentials: {
      email: 'disney.grupo1@dividepass.com',
      password: 'DsnGroup1!',
      profile: 'Perfil 1'
    }
  },
  {
    id: 'max-g1',
    serviceId: 'max',
    name: 'Max - Grupo A',
    price: 11.90,
    members: ['usuario1@email.com', 'usuario2@email.com', 'usuario3@email.com'],
    credentials: {
      email: 'max.grupo.a@dividepass.com',
      password: 'MaxGroupA!',
      profile: 'Perfil 4'
    }
  },
  {
    id: 'prime-g1',
    serviceId: 'prime',
    name: 'Prime - Grupo 1',
    price: 10.90,
    members: ['joao.rateio@dividepass.com'],
    credentials: {
      email: 'prime.grupo1@dividepass.com',
      password: 'PrimeG1!',
      profile: 'Perfil 1'
    }
  },
  {
    id: 'youtube-g1',
    serviceId: 'youtube',
    name: 'YouTube - Grupo 1',
    price: 8.90,
    members: [],
    credentials: {
      email: 'youtube.grupo1@dividepass.com',
      password: 'YtGroup1!',
      profile: 'Perfil 1'
    }
  },
  {
    id: 'globoplay-g1',
    serviceId: 'globoplay',
    name: 'Globoplay - Grupo 1',
    price: 9.90,
    members: ['usuario@email.com'],
    credentials: {
      email: 'globoplay.grupo1@dividepass.com',
      password: 'GloboG1!',
      profile: 'Perfil 1'
    }
  },
  {
    id: 'crunchyroll-g1',
    serviceId: 'crunchyroll',
    name: 'Crunchyroll - Grupo 1',
    price: 7.90,
    members: ['otaku1@email.com', 'otaku2@email.com'],
    credentials: {
      email: 'crunchy.grupo1@dividepass.com',
      password: 'CrunchG1!',
      profile: 'Perfil 1'
    }
  }
];

export const CURRENT_USER = {
  email: 'joao.rateio@dividepass.com',
  name: 'João da Silva'
};

export const INITIAL_ACTIVE_SUBSCRIPTIONS = [
  {
    groupId: 'netflix-g1',
    serviceId: 'netflix',
    joinedAt: '2026-06-01'
  },
  {
    groupId: 'spotify-g1',
    serviceId: 'spotify',
    joinedAt: '2026-05-15'
  },
  {
    groupId: 'prime-g1',
    serviceId: 'prime',
    joinedAt: '2026-06-10'
  }
];

export const getServiceById = (id) => STREAMING_SERVICES.find(s => s.id === id);

export const getGroupsByService = (serviceId, groups) =>
  groups.filter(g => g.serviceId === serviceId);

export const getAvailableSpots = (group, service) =>
  service.maxGroupSize - group.members.length;

export const isGroupFull = (group, service) =>
  getAvailableSpots(group, service) <= 0;

export const isUserInGroup = (group, userEmail = CURRENT_USER.email) =>
  group.members.includes(userEmail);

export const getActiveSubscriptions = (subscriptions) => subscriptions;
