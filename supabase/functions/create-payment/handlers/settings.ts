// Shared utility to get gateway credentials from app_settings

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let cachedSettings: Record<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5_000; // 5 seconds

export async function getGatewaySettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedSettings && (now - cacheTime) < CACHE_TTL) {
    return cachedSettings;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return cachedSettings || {};
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value");

    const map: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      map[row.key] = row.value;
    });

    cachedSettings = map;
    cacheTime = now;
    return map;
  } catch (err) {
    console.error("Error loading gateway settings:", err);
    return cachedSettings || {};
  }
}

export async function getGatewaySecret(gateway: string, key: string): Promise<string> {
  const settings = await getGatewaySettings();
  const settingKey = `${gateway}_${key}`;
  return settings[settingKey] || Deno.env.get(settingKey.toUpperCase()) || "";
}
