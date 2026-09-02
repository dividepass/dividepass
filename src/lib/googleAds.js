const GOOGLE_ADS_CONVERSION_ID = 'AW-18327869089/EB7CCIPq2NEcEKGttKNE';
const ATTRIBUTION_KEY = 'dp_google_ads_attribution';
const CONVERSION_SENT_KEY = 'dp_google_ads_conversion_sent';

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}

export function captureGoogleAdsAttribution(search = window.location.search) {
  const params = new URLSearchParams(search);
  const gclid = params.get('gclid');
  const utmSource = (params.get('utm_source') || '').toLowerCase();
  const utmMedium = (params.get('utm_medium') || '').toLowerCase();
  const utmCampaign = params.get('utm_campaign') || '';
  const utmTerm = params.get('utm_term') || '';
  const utmContent = params.get('utm_content') || '';

  const isGoogleTraffic = !!gclid || utmSource === 'google' || (utmSource === 'googleads') || utmMedium === 'cpc' || utmMedium === 'ppc';
  if (!isGoogleTraffic) return null;

  const payload = {
    source: 'google',
    gclid,
    utm_source: utmSource || null,
    utm_medium: utmMedium || null,
    utm_campaign: utmCampaign || null,
    utm_term: utmTerm || null,
    utm_content: utmContent || null,
    captured_at: new Date().toISOString(),
  };

  writeJson(ATTRIBUTION_KEY, payload);
  return payload;
}

export function getGoogleAdsAttribution() {
  return readJson(ATTRIBUTION_KEY);
}

export function hasGoogleAdsAttribution(attribution = null) {
  const source = attribution?.source || attribution?.marketing_source || getGoogleAdsAttribution()?.source;
  return source === 'google';
}

function getConversionSet() {
  const value = readJson(CONVERSION_SENT_KEY);
  return new Set(Array.isArray(value) ? value : []);
}

function saveConversionSet(set) {
  writeJson(CONVERSION_SENT_KEY, Array.from(set));
}

export function wasGoogleAdsConversionSent(key) {
  if (!key) return false;
  return getConversionSet().has(String(key));
}

export function markGoogleAdsConversionSent(key) {
  if (!key) return;
  const set = getConversionSet();
  set.add(String(key));
  saveConversionSet(set);
}

export function reportGoogleAdsConversion({ value = 1, currency = 'BRL', transactionId = '', key = '', attribution = null } = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return false;
  if (!hasGoogleAdsAttribution(attribution)) return false;

  const dedupeKey = key || transactionId || `${value}:${currency}`;
  if (wasGoogleAdsConversionSent(dedupeKey)) return false;

  window.gtag('event', 'conversion', {
    send_to: GOOGLE_ADS_CONVERSION_ID,
    value,
    currency,
    transaction_id: transactionId || '',
    event_callback: () => {},
  });

  markGoogleAdsConversionSent(dedupeKey);
  return true;
}
