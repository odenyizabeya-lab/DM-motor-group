/* =============================================================================
 * Settings key normalisation.
 *
 * The database was seeded (supabase/migrations/00001_schema.sql) with short key
 * names (dealership_name, phone, phone_alt, email, address, opening_hours, ...)
 * while the website, admin dashboard and AI assistant were written against
 * longer canonical names (company_name, phone_main, phone_sales, email_sales,
 * address_primary, hours, ...).  Without this layer the admin form renders
 * blank fields and the public contact page shows nothing even when values are
 * stored.
 *
 * Both spellings are still written/read so nothing that used the old keys can
 * silently break.
 * ========================================================================== */

/* canonical name -> legacy database column key */
export const SETTINGS_ALIASES = {
  company_name: 'dealership_name',
  phone_main: 'phone',
  phone_sales: 'phone_alt',
  email_sales: 'email',
  address_primary: 'address',
  hours: 'opening_hours',
  social_instagram: 'instagram',
  social_facebook: 'facebook',
  social_youtube: 'youtube',
  social_linkedin: 'linkedin',
  social_tiktok: 'tiktok',
};

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * Accept either PostgREST rows ([{key,value}]) or a plain object and return a
 * plain object containing the canonical keys with legacy values copied over.
 */
export function normalizeSettings(input) {
  const raw = Array.isArray(input)
    ? Object.fromEntries((input || []).map((r) => [r.key, r.value]))
    : { ...(input || {}) };

  const out = { ...raw };

  for (const [canon, legacy] of Object.entries(SETTINGS_ALIASES)) {
    if (!str(out[canon])) out[canon] = str(out[legacy]) ? out[legacy] : '';
  }

  /* Build a display address when only its parts are stored. */
  if (!str(out.address_primary)) {
    const parts = [out.address, out.city, out.country].map(str).filter(Boolean);
    if (parts.length) out.address_primary = [...new Set(parts)].join(', ');
  }

  if (!str(out.company_name)) out.company_name = 'DM Motor Group';
  return out;
}

/**
 * Keys that are safe and useful to publish. Everything else (internal flags,
 * future credentials mistakenly added to the settings table) stays server-side.
 */
export const PUBLIC_SETTINGS_KEYS = [
  'company_name', 'dealership_name',
  'phone_main', 'phone', 'phone_sales', 'phone_alt', 'whatsapp',
  'email_sales', 'email',
  'address_primary', 'address', 'address_secondary', 'city', 'country',
  'hours', 'opening_hours',
  'social_instagram', 'instagram', 'social_facebook', 'facebook',
  'social_youtube', 'youtube', 'social_linkedin', 'linkedin', 'social_tiktok', 'tiktok',
  'currency', 'tagline', 'trade_license', 'inspection_note', 'payment_info',
];

/** Normalise settings and drop anything that is not meant for the public. */
export function publicSettings(input) {
  const all = normalizeSettings(input);
  const out = {};
  for (const k of PUBLIC_SETTINGS_KEYS) if (k in all) out[k] = all[k];
  return out;
}

/**
 * Convert a submitted patch of canonical keys into the keys the `settings`
 * table already uses, so existing rows are updated instead of duplicated.
 * Keys without an alias (e.g. currency, payment_info) are stored as-is.
 */
export function toDbSettingsPatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (typeof v !== 'string') continue;
    out[SETTINGS_ALIASES[k] || k] = v;
  }
  /* An explicit canonical value always wins over its legacy spelling. */
  for (const [canon, legacy] of Object.entries(SETTINGS_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, canon)) {
      out[legacy] = String(patch[canon]);
    }
  }
  return out;
}
