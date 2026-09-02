import { supabase } from './supabase';

export async function logPlatformEvent({ event_type, title, message, metadata = {}, created_by = null }) {
  try {
    const payload = {
      event_type,
      title,
      message,
      metadata: JSON.stringify(metadata),
    };

    if (created_by) {
      payload.created_by = created_by;
    }

    const { error } = await supabase.from('platform_events').insert(payload);
    if (error) {
      console.error('[platformEventLogger] insert error:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[platformEventLogger] unexpected error:', err);
    return false;
  }
}
