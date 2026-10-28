import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { isSubscriptionVisible } from '../lib/subscriptionAccess';

/**
 * Status que a listagem do usuário busca.
 *
 * 'active' é o normal. 'expired' é o legado que o job de faturas gravava para
 * "atrasada": se a query só pedisse 'active', a assinatura atrasada ficaria
 * invisível até o job das 03h normalizá-la — e o card de renovação (que é o
 * que convence o usuário a pagar) sumiria junto. O estado exibido é sempre o
 * derivado pelo módulo de domínio, nunca o status cru.
 */
const USER_SUBSCRIPTION_STATUSES = ['active', 'expired'];

const getActiveMembers = (group) =>
  group.members?.filter(m => m.status === 'active' || m.status === 'pending').length || 0;

const getMaxSize = (group, service) =>
  group.max_size || service?.max_group_size;

const getAvailableSpots = (group, service) => {
  if (group.has_slot_limit === false) return Infinity;
  const maxSize = getMaxSize(group, service);
  if (!maxSize) return Infinity;
  return Math.max(0, maxSize - getActiveMembers(group));
};

const isGroupFull = (group, service) =>
  getAvailableSpots(group, service) === 0;

export function useAppData() {
  const { user } = useAuth();
  const [streamingServices, setStreamingServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeSubscriptions, setActiveSubscriptions] = useState([]);
  const [servicePlans, setServicePlans] = useState([]);
  const [cancelledIds, setCancelledIds] = useState(new Set());
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const currentUser = useMemo(() => {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name || user.email
    };
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [servicesRes, groupsRes, subscriptionsRes, plansRes] = await Promise.all([
        supabase.from('streaming_services').select('*').eq('status', 'active').order('name'),
        supabase.from('groups').select(`
          *,
          service:service_id (*),
          members:group_members (*),
          credential:group_credentials (*)
        `).in('status', ['open', 'forming']),
        supabase.from('user_subscriptions').select(`
          *,
          group:group_id (*, members:group_members(*)),
          service:service_id (*),
          plan:plan_id (*)
        `).eq('user_id', user.id).in('status', USER_SUBSCRIPTION_STATUSES),
        supabase.from('service_plans').select('*').eq('is_active', true).order('service_id').order('official_price')
      ]);

      if (servicesRes.error) throw servicesRes.error;
      if (groupsRes.error) throw groupsRes.error;
      if (subscriptionsRes.error) {
        // Coluna plan_id pode não existir antes da migration — usa dados sem plano
        console.warn('[useAppData] Erro em subscriptions (plan_id pode não existir):', subscriptionsRes.error.message);
      }

      setStreamingServices(servicesRes.data || []);
      setGroups(groupsRes.data || []);
      setActiveSubscriptions(subscriptionsRes.data || []);
      setServicePlans(plansRes.error ? [] : (plansRes.data || []));
    } catch (err) {
      console.error('Error fetching app data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) setLoading(true);

      try {
        const [servicesRes, groupsRes, subscriptionsRes, announcementsRes, plansRes] = await Promise.all([
          supabase.from('streaming_services').select('*').eq('status', 'active').order('name'),
          supabase.from('groups').select(`
            *,
            service:service_id (*),
            members:group_members (*),
            credential:group_credentials (*),
            owner:owner_id (id, name, email, avatar_url, role)
          `).in('status', ['open', 'forming']),
          supabase.from('user_subscriptions').select(`
            *,
            group:group_id (*, credential:group_credentials (*), profiles:group_profiles(*), owner:owner_id (id, name, avatar_url, role), members:group_members(*)),
            service:service_id (*),
            plan:plan_id (*)
          `).eq('user_id', user.id).in('status', USER_SUBSCRIPTION_STATUSES),
          supabase.from('announcements').select('*').eq('is_active', true).or(`target_user_id.is.null,target_user_id.eq.${user.id}`).order('created_at', { ascending: false }),
          supabase.from('service_plans').select('*').eq('is_active', true).order('service_id').order('official_price')
        ]);

        if (servicesRes.error) throw servicesRes.error;
        if (groupsRes.error) throw groupsRes.error;
        if (subscriptionsRes.error) {
          // Coluna plan_id pode não existir antes da migration — usa dados sem plano
          console.warn('[useAppData] Erro em subscriptions (plan_id pode não existir):', subscriptionsRes.error.message);
        }

        if (!cancelled) {
          setStreamingServices(servicesRes.data || []);
          setGroups(groupsRes.data || []);
          setActiveSubscriptions(subscriptionsRes.data || []);
          setServicePlans(plansRes.error ? [] : (plansRes.data || []));
          setAnnouncements(announcementsRes.data || []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  const getServiceById = useCallback((id) => {
    return streamingServices.find(s => s.id === id);
  }, [streamingServices]);

  /**
   * Assinaturas que o usuário ainda vê.
   *
   * A query busca as linhas `active` e o legado `expired` (a "atrasada" antiga
   * — sem ele a atrasada ficaria invisível até o job das 03h normalizá-la). O
   * que muda aqui é a DERIVAÇÃO: assinatura cancelada (carência de 7 dias
   * vencida ou cancelada no banco) não aparece mais em "Meus Grupos" /
   * "Assinaturas Ativas" — ela só existe no histórico. Atrasada continua
   * visível: o grupo some do alcance da pessoa, mas ela ainda tem como renovar.
   */
  const visibleSubscriptions = useMemo(
    () => activeSubscriptions.filter(sub => isSubscriptionVisible(sub)),
    [activeSubscriptions]
  );

  const getActiveServices = useCallback(() => {
    return visibleSubscriptions.filter(sub => {
      if (!sub.group) return false;
      if (cancelledIds.has(sub.id)) return false;
      return true;
    }).map(sub => ({
      ...sub,
      service: sub.service,
      group: {
        ...sub.group,
        credentials: sub.group?.credential || [],
        profiles: sub.group?.profiles || [],
        owner: sub.group?.owner || null
      }
    }));
  }, [visibleSubscriptions, cancelledIds, user?.id]);

  const getAvailableServices = useCallback(() => {
    return streamingServices.map(service => {
      const serviceGroups = groups.filter(g => g.service_id === service.id);
      return {
        ...service,
        groups: serviceGroups,
        availableGroups: serviceGroups.filter(g =>
          !isGroupFull(g, service) && !g.members?.some(m => m.user_id === user?.id && m.status === 'active')
        )
      };
    });
  }, [streamingServices, groups, user?.id]);

  const getServiceGroups = useCallback((serviceIdOrSlug) => {
    const service = streamingServices.find(s => s.id === serviceIdOrSlug || s.slug === serviceIdOrSlug);
    const serviceGroups = groups.filter(g => g.service_id === service?.id);
    return { service, groups: serviceGroups };
  }, [streamingServices, groups]);

  const getGroupDetails = useCallback((groupId) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    const service = getServiceById(group.service_id);
    return {
      group: {
        ...group,
        credentials: group.credential || {}
      },
      service,
      spots: getAvailableSpots(group, service)
    };
  }, [groups, getServiceById]);

  const getGroupBySlug = useCallback((slug) => {
    const group = groups.find(g => g.slug === slug || g.id === slug);
    if (!group) return null;
    const service = getServiceById(group.service_id);
    return {
      group: {
        ...group,
        credentials: group.credential || {}
      },
      service,
      spots: getAvailableSpots(group, service)
    };
  }, [groups, getServiceById]);

  const isSubscribedToService = useCallback((serviceIdOrSlug) => {
    const service = streamingServices.find(s => s.id === serviceIdOrSlug || s.slug === serviceIdOrSlug);
    return visibleSubscriptions.some(sub => sub.service_id === service?.id && !cancelledIds.has(sub.id));
  }, [visibleSubscriptions, cancelledIds, streamingServices]);

  const getUserSubscriptionForService = useCallback((serviceIdOrSlug) => {
    const service = streamingServices.find(s => s.id === serviceIdOrSlug || s.slug === serviceIdOrSlug);
    return visibleSubscriptions.find(sub => sub.service_id === service?.id);
  }, [visibleSubscriptions, streamingServices]);

  const joinGroup = useCallback(async (groupId) => {
    if (!user) return { error: 'Usuário não autenticado' };

    try {
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select(`
          *,
          service:service_id (max_group_size),
          members:group_members (*)
        `)
        .eq('id', groupId)
        .single();

      if (groupError) throw groupError;

      const maxSize = groupData.max_size || groupData.service?.max_group_size;
      const activeMembers = groupData.members?.filter(m => m.status === 'active').length || 0;
      const pendingMembers = groupData.members?.filter(m => m.status === 'pending').length || 0;
      const totalOccupied = activeMembers + pendingMembers;

      if (groupData.has_slot_limit !== false && maxSize && totalOccupied >= maxSize) {
        throw new Error('Grupo está cheio');
      }

      const alreadySubscribed = visibleSubscriptions.some(
        sub => sub.service_id === groupData.service_id
      );

      const hasEntranceFee = Number(groupData.entrance_fee || 0) > 0;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: user.id,
          profile_name: 'Membro',
          status: 'pending',
          payment_status: 'first_attempt',
        });

      if (memberError) throw memberError;

      await fetchData();
      return { error: null, needsCheckout: true, groupId };
    } catch (err) {
      console.error('Error joining group:', err);
      return { error: err.message };
    }
  }, [user, visibleSubscriptions, fetchData]);

  const getUnviewedAnnouncements = useCallback(() => {
    if (!user) return [];
    try {
      const dismissed = JSON.parse(localStorage.getItem('dismissed_announcements') || '[]');
      return announcements.filter(a => !dismissed.includes(a.id));
    } catch {
      return announcements;
    }
  }, [announcements, user]);

  const dismissAnnouncement = useCallback(async (announcementId) => {
    if (!user) return;
    const dismissed = JSON.parse(localStorage.getItem('dismissed_announcements') || '[]');
    if (!dismissed.includes(announcementId)) {
      dismissed.push(announcementId);
      localStorage.setItem('dismissed_announcements', JSON.stringify(dismissed));
    }
    await supabase.from('user_announcement_views').upsert(
      { announcement_id: announcementId, user_id: user.id },
      { onConflict: 'announcement_id,user_id' }
    );
  }, [user]);

  return {
    streamingServices,
    groups,
    // Lista já derivada: canceladas ficam de fora (só no histórico).
    activeSubscriptions: visibleSubscriptions,
    servicePlans,
    announcements,
    currentUser,
    loading,
    error,
    getActiveServices,
    getAvailableServices,
    getServiceGroups,
    getGroupDetails,
    getGroupBySlug,
    isSubscribedToService,
    getUserSubscriptionForService,
    joinGroup,
    getUnviewedAnnouncements,
    dismissAnnouncement,
    markCancelled: (id) => setCancelledIds(prev => new Set([...prev, id])),
    refresh: fetchData
  };
}
