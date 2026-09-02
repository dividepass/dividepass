import webpush from "https://esm.sh/web-push@3.6.7";

function asObject(value: any) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function getRecipients(supabaseAdmin: any, audience: any): Promise<string[]> {
  if (!audience?.type) return [];

  if (audience.type === 'group' && audience.group_id) {
    const { data } = await supabaseAdmin
      .from('group_members')
      .select('user_id')
      .eq('group_id', audience.group_id)
      .in('status', ['active', 'pending']);
    return uniq((data || []).map((row: any) => row.user_id));
  }

  if (audience.type === 'users' && Array.isArray(audience.user_ids)) {
    return uniq(audience.user_ids);
  }

  if (audience.type === 'role' && audience.role) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('role', audience.role);
    return uniq((data || []).map((row: any) => row.id));
  }

  if (audience.type === 'all') {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .neq('status', 'deleted');
    return uniq((data || []).map((row: any) => row.id));
  }

  return [];
}

async function sendPushToRecipients(supabaseAdmin: any, recipients: string[], payload: any) {
  if (recipients.length === 0) return { attempted: 0, sent: 0 };

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, subscription, is_active')
    .in('user_id', recipients)
    .eq('is_active', true);

  if (!subs?.length) return { attempted: 0, sent: 0 };

  const body = JSON.stringify(payload);
  const attempted = subs.length;
  let sent = 0;

  await Promise.allSettled(subs.map(async (row: any) => {
    try {
      const subscription = asObject(row.subscription);
      await webpush.sendNotification(subscription, body);
      sent += 1;
    } catch (err: any) {
      const statusCode = err?.statusCode || err?.status;
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id);
      } else {
        await supabaseAdmin.from('push_subscriptions').update({ is_active: false, last_seen_at: new Date().toISOString() }).eq('id', row.id);
      }
    }
  }));

  return { attempted, sent };
}

export async function dispatchNotification(supabaseAdmin: any, params: any) {
  const {
    title,
    message,
    event_type = 'info',
    metadata = {},
    audience,
    channels = ['in_app', 'push'],
    url = '/dashboard',
    created_by = null,
  } = params;

  const recipients = await getRecipients(supabaseAdmin, audience);
  if (!recipients.length) {
    return { recipients: 0, notifications: 0, push: { attempted: 0, sent: 0 } };
  }

  const shouldInsert = channels.includes('in_app') || channels.includes('both');
  const shouldPush = channels.includes('push') || channels.includes('both');

  let notificationsInserted = 0;
  if (shouldInsert) {
    const rows = recipients.map((user_id: string) => ({
      user_id,
      title,
      message,
      event_type,
      metadata: asObject(metadata),
      read: false,
      created_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) throw error;
    notificationsInserted = rows.length;
  }

  let push = { attempted: 0, sent: 0 };
  if (shouldPush) {
    const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT') || 'mailto:support@dividepass.com';
    const vapidPublicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY') || '';
    const vapidPrivateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY') || '';

    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error('Push keys not configured');
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    push = await sendPushToRecipients(supabaseAdmin, recipients, {
      title,
      body: message,
      message,
      event_type,
      metadata: asObject(metadata),
      url,
    });
  }

  if (created_by) {
    await supabaseAdmin.from('platform_events').insert({
      event_type,
      title,
      message,
      metadata: asObject(metadata),
      created_by,
    });
  }

  return {
    recipients: recipients.length,
    notifications: notificationsInserted,
    push,
  };
}
