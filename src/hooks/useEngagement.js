import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './useAuth';
import {
  fetchSponsoredOffers,
  fetchUserVotes,
  fetchVoteCounts,
  fetchUserInterests,
  fetchWatchlist,
  fetchInterestCounts,
  toggleServiceVote,
  setWatchlist,
} from '../lib/catalogEngagement';

/**
 * Estado compartilhado de engajamento (votos, lista de espera, ofertas).
 *
 * Vários componentes do dashboard e do catálogo precisam dos MESMOS dados
 * (o card "Recomendados", o card de votação e o botão "Avise-me quando houver
 * uma vaga"). Se cada um buscasse no banco, a tela faria 4x a mesma consulta.
 *
 * Por isso o estado mora num store simples de módulo, com `useSyncExternalStore`
 * para o React assinar as mudanças. Uma única busca alimenta todo mundo.
 */

const INITIAL_STATE = {
  ready: false,
  watchlist: new Set(),
  votes: new Set(),
  voteCounts: new Map(),
  interestCounts: new Map(),
  interests: [],
  sponsoredOffers: [],
};

let state = INITIAL_STATE;
const listeners = new Set();
let loadPromise = null;

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

/**
 * Carrega tudo uma vez. Chamadas concorrentes compartilham a mesma promise,
 * então dois componentes montando no mesmo tick não duplicam as requisições.
 */
function ensureLoaded(userId) {
  if (!userId) {
    if (!state.ready) emit({ ready: true });
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const [watchlist, votes, voteCounts, interests, interestCounts, sponsoredOffers] =
      await Promise.all([
        fetchWatchlist(userId),
        fetchUserVotes(userId),
        fetchVoteCounts(),
        fetchUserInterests(userId),
        fetchInterestCounts(),
        fetchSponsoredOffers(),
      ]);

    emit({
      ready: true,
      watchlist,
      votes,
      voteCounts,
      interests,
      interestCounts,
      sponsoredOffers,
    });
  })();

  return loadPromise;
}

/** Recarrega só o que mudou (usado depois de votar / salvar alerta). */
function reloadVotes(userId) {
  if (!userId) return Promise.resolve();
  return Promise.all([fetchUserVotes(userId), fetchVoteCounts()]).then(([votes, voteCounts]) => {
    emit({ votes, voteCounts });
  });
}

function reloadWatchlist(userId) {
  if (!userId) return Promise.resolve();
  return fetchWatchlist(userId).then((watchlist) => emit({ watchlist }));
}

export function useEngagement() {
  const { user } = useAuth();
  const userId = user?.id;

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    let alive = true;
    ensureLoaded(userId).then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const isWatching = useCallback(
    (serviceId) => snapshot.watchlist.has(serviceId),
    [snapshot.watchlist]
  );

  const hasVoted = useCallback(
    (serviceId) => snapshot.votes.has(serviceId),
    [snapshot.votes]
  );

  /** Liga/desliga o "Avise-me quando houver uma vaga". */
  const toggleWatch = useCallback(
    async (serviceId) => {
      if (!userId || !serviceId) return { ok: false, watching: false };
      const currentlyWatching = state.watchlist.has(serviceId);
      const previous = state.watchlist;

      // Atualidade otimista: o botão responde na hora e o banco confirma depois.
      const next = new Set(previous);
      if (currentlyWatching) next.delete(serviceId);
      else next.add(serviceId);
      emit({ watchlist: next });

      const result = await setWatchlist(serviceId, userId, !currentlyWatching);
      if (!result.ok) {
        // Falhou: volta ao estado anterior e avisa.
        emit({ watchlist: previous });
        return result;
      }
      reloadWatchlist(userId);
      return { ok: true, watching: !currentlyWatching };
    },
    [userId]
  );

  /** Vota / deixa de votar em "O que você gostaria de compartilhar?". */
  const toggleVote = useCallback(
    async (serviceId) => {
      if (!userId || !serviceId) return { ok: false, voted: false };
      const currentlyVoted = state.votes.has(serviceId);
      const previousVotes = state.votes;
      const previousCounts = state.voteCounts;

      const nextVotes = new Set(previousVotes);
      const nextCounts = new Map(previousCounts);
      const currentCount = nextCounts.get(serviceId) || 0;

      if (currentlyVoted) {
        nextVotes.delete(serviceId);
        nextCounts.set(serviceId, Math.max(0, currentCount - 1));
      } else {
        nextVotes.add(serviceId);
        nextCounts.set(serviceId, currentCount + 1);
      }
      emit({ votes: nextVotes, voteCounts: nextCounts });

      const result = await toggleServiceVote(serviceId, userId, currentlyVoted);
      if (!result.ok) {
        emit({ votes: previousVotes, voteCounts: previousCounts });
        return result;
      }
      reloadVotes(userId);
      return { ok: true, voted: !currentlyVoted };
    },
    [userId]
  );

  /**
   * Recarrega a lista de espera do banco.
   * Usado quando OUTRO fluxo (ex.: o modal "Lista de Espera" do catálogo)
   * grava na mesma tabela — aqui o estado compartilhado precisa acompanhar.
   */
  const refreshWatchlist = useCallback(async () => {
    if (!userId) return;
    await reloadWatchlist(userId);
  }, [userId]);

  return {
    ...snapshot,
    userId,
    isWatching,
    hasVoted,
    toggleWatch,
    toggleVote,
    refreshWatchlist,
  };
}

export default useEngagement;
