// Shared helpers for the uploads worker.

// Community pack ids sit far above the ids in packs.json so the two never collide.
export const ID_OFFSET = 100000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}

export function safeJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    const value = JSON.parse(text);
    return value == null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

export function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function today(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

// Same encoding the site uses for /download/<token> (see script.js).
export function base64UrlJson(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ===== Auth =====
// Accounts live in the existing pepes-portfolio-api worker; we only ask it who
// the visitor is.

export async function getUser(ctx) {
  if (ctx._user !== undefined) return ctx._user;
  ctx._user = null;
  const header = ctx.request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  // Local testing only: .dev.vars sets DEV_FAKE_AUTH=1 so "dev:<id>:<name>"
  // tokens work without the real accounts worker. Never set it in production.
  if (ctx.env.DEV_FAKE_AUTH === '1' && token.startsWith('dev:')) {
    const [, id, name] = token.split(':');
    ctx._user = { id, username: name || id, name: name || id };
    return ctx._user;
  }

  try {
    // Workers on the same account can't reach each other with a plain fetch
    // (Cloudflare answers with error 1042), so use the AUTH service binding
    // when it exists. The URL's host is ignored by the binding; plain fetch
    // is only for local dev.
    const url = `${ctx.env.AUTH_API}/api/session`;
    const init = { headers: { Authorization: `Bearer ${token}` } };
    const res = ctx.env.AUTH ? await ctx.env.AUTH.fetch(url, init) : await fetch(url, init);
    if (!res.ok) {
      console.error('session check failed: status', res.status, ctx.env.AUTH ? '(service binding)' : '(plain fetch)');
      return null;
    }
    const data = await res.json();
    if (data && data.user && data.user.id != null) {
      ctx._user = data.user;
      ctx._user.isOwner = await isSiteOwner(ctx.env, data.user.id);
    }
  } catch (e) {
    console.error('session check failed', e);
  }
  return ctx._user;
}

export async function requireUser(ctx) {
  const user = await getUser(ctx);
  if (!user) throw new HttpError(401, 'Sign in to do that.');
  return user;
}

export function adminIds(env) {
  return String(env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function isAdmin(ctx, user) {
  return !!user && (user.isOwner === true || adminIds(ctx.env).includes(String(user.id)));
}

// Is this account the site owner? The accounts worker already knows (its
// OWNER_USER_ID drives the verified badge and shows as isAuthor on
// /api/users/<id>), so ask it instead of keeping a second copy of the id.
// Works in cron jobs too. Answers are cached per isolate for 10 minutes;
// failed lookups aren't cached and count as "not the owner".
const ownerCache = new Map();
export async function isSiteOwner(env, userId) {
  if (userId == null || userId === '') return false;
  const id = String(userId);
  const hit = ownerCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.owner;
  try {
    const url = `${env.AUTH_API}/api/users/${encodeURIComponent(id)}`;
    const res = env.AUTH ? await env.AUTH.fetch(url) : await fetch(url);
    if (!res.ok && res.status !== 404) {
      console.error('owner check failed: status', res.status);
      return false;
    }
    const data = res.ok ? await res.json().catch(() => null) : null;
    // Lookups match a username too, so make sure it's this exact account.
    const owner = !!(data && data.user && String(data.user.id) === id && data.user.isAuthor);
    ownerCache.set(id, { owner, at: Date.now() });
    return owner;
  } catch (e) {
    console.error('owner check failed', e);
    return false;
  }
}

// Whose accounts a creator's downloads earn for. The site owner, and any
// creator who hasn't added Linkvertise or LootLabs, use the site's own
// accounts (OWNER_LINKVERTISE_ID / OWNER_LOOT_TOKEN). `creator` is their
// creators row, or null if they have none yet.
export async function usesSiteEarnings(env, userId, creator) {
  const hasOwn = !!(creator && (creator.linkvertise_id || creator.loot_token || creator.has_loot));
  return !hasOwn || isSiteOwner(env, userId);
}

// Owner or someone listed in ADMIN_IDS, for code that only has a user id.
export async function isOwnerOrAdminId(env, userId) {
  return adminIds(env).includes(String(userId)) || isSiteOwner(env, userId);
}

export function publicUser(user) {
  return { id: String(user.id), username: user.username || '', name: user.name || user.username || '' };
}

export function displayName(user) {
  return String(user.username || user.name || 'Unknown').slice(0, 40);
}

// Where the files are served from, for links that get stored or handed to
// other services (the request origin isn't available in cron jobs).
export function publicOrigin(env, ctx) {
  return (env.PUBLIC_ORIGIN || (ctx && ctx.origin) || 'https://pepes-portfolio-uploads.pepeoncloudeflare.workers.dev').replace(/\/+$/, '');
}
