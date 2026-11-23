// Automatic earning links for creators.
//
// Linkvertise: the site builds the link in the browser from the creator's user
// id (same as for Pepe's packs), so nothing is stored per download.
// LootLabs: links must be made through the LootLabs API with the creator's own
// API token. The token is stored encrypted (AES-GCM, key from the TOKEN_KEY
// secret) and never sent back to the browser. Whenever a version goes live, the
// worker makes the link for it. Same settings as Pepe's own packs
// (generator.py): tier 1, 3 tasks, theme 1.

import { base64UrlJson, encodeKey, publicOrigin, clip, usesSiteEarnings } from './util.js';

const LOOT_API = 'https://creators.lootlabs.gg/api/public/content_locker';
const MAX_TRIES = 6;

// ===== Token storage =====

async function aesKey(env) {
  const secret = env.TOKEN_KEY;
  if (!secret) throw new Error('TOKEN_KEY is not set, so LootLabs tokens cannot be stored.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pepe-loot:${secret}`));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text) {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

export async function encryptToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(token));
  return `${toB64(iv)}.${toB64(new Uint8Array(data))}`;
}

export async function decryptToken(env, stored) {
  if (!stored) return null;
  try {
    const [iv, data] = stored.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await aesKey(env), fromB64(data));
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;
  }
}

// ===== Link generation =====

// The page that finishes the download after the ad steps (see script.js,
// showDownloadGate): /download/<token> holding the real file address.
export function gateUrl(env, rawFileUrl) {
  const site = String(env.SITE_URL || 'https://pepe.glacierclient.xyz').replace(/\/+$/, '');
  return `${site}/download/${base64UrlJson({ u: rawFileUrl, t: 0 })}`;
}

export async function createLootLink(env, token, title, targetUrl) {
  const params = new URLSearchParams({
    api_token: token,
    title: clip(title, 30),
    url: targetUrl,
    tier_id: '1',
    number_of_tasks: '3',
    theme: '1'
  });
  const base = env.LOOT_API_BASE || LOOT_API;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}?${params}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    const msg = data && data.message;
    const url = msg && !Array.isArray(msg) ? msg.loot_url : Array.isArray(msg) && msg[0] ? msg[0].loot_url : null;
    if (!res.ok || !url) {
      const why = typeof msg === 'string' ? msg : `LootLabs answered ${res.status}`;
      throw new Error(clip(why, 160));
    }
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// Makes (or remakes) the LootLabs link for one approved version.
// Returns {ok, error?}. Safe to call repeatedly.
export async function ensureLootForVersion(env, versionId) {
  const v = await env.DB.prepare(
    `SELECT v.*, p.name AS pack_name, p.owner_id, p.status AS pack_status
     FROM versions v JOIN packs p ON p.id = v.pack_id WHERE v.id = ?`
  ).bind(versionId).first();
  if (!v || v.status !== 'approved' || v.pack_status !== 'approved') return { ok: false, error: 'not live' };
  const creator = await env.DB.prepare('SELECT user_id, loot_token, linkvertise_id FROM creators WHERE user_id = ?').bind(v.owner_id).first();
  let token = null;
  let siteToken = false;
  if (creator && creator.loot_token) {
    token = await decryptToken(env, creator.loot_token);
    if (!token) {
      await setLootStatus(env, v.owner_id, 'failed: the stored token could not be read. Save it again.');
      return { ok: false, error: 'token unreadable' };
    }
  } else if (env.OWNER_LOOT_TOKEN && await usesSiteEarnings(env, v.owner_id, creator)) {
    // The site owner and creators without their own accounts use the site's
    // LootLabs account, the same token generator.py uses for library packs.
    token = env.OWNER_LOOT_TOKEN;
    siteToken = true;
  } else {
    return { ok: false, error: 'no token' };
  }

  const rawUrl = `${publicOrigin(env)}/files/${encodeKey(v.file_key)}`;
  try {
    const link = await createLootLink(env, token, `${v.pack_name} ${v.version}`, gateUrl(env, rawUrl));
    await env.DB.batch([
      env.DB.prepare('UPDATE versions SET loot_url = ?, loot_tries = loot_tries + 1 WHERE id = ?').bind(link, versionId),
      env.DB.prepare("UPDATE creators SET loot_status = 'ok' WHERE user_id = ?").bind(v.owner_id)
    ]);
    return { ok: true };
  } catch (err) {
    await env.DB.prepare('UPDATE versions SET loot_tries = loot_tries + 1 WHERE id = ?').bind(versionId).run();
    const msg = String(err && err.message || err);
    // Only mark the creator's own token as bad, and only when LootLabs itself
    // says so; a problem with the site's token isn't theirs to fix.
    if (!siteToken && /token|auth|api|invalid|unauthor|forbidden|key/i.test(msg)) {
      await setLootStatus(env, v.owner_id, `failed: ${clip(msg, 120)}`);
    }
    return { ok: false, error: msg };
  }
}

async function setLootStatus(env, userId, status) {
  await env.DB.prepare('UPDATE creators SET loot_status = ? WHERE user_id = ?').bind(status, userId).run();
}

// All of one creator's live versions that still lack a link (after they add a token).
export async function ensureLootForCreator(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT v.id FROM versions v JOIN packs p ON p.id = v.pack_id
     WHERE p.owner_id = ? AND p.status = 'approved' AND v.status = 'approved' AND v.loot_url IS NULL AND v.loot_tries < ?`
  ).bind(String(userId), MAX_TRIES).all();
  let last = { ok: false, error: 'nothing to do' };
  for (const row of results.slice(0, 20)) last = await ensureLootForVersion(env, row.id);
  return { count: results.length, last };
}

// Cron: retry links that failed earlier.
export async function retryMissingLoot(env) {
  const { results } = await env.DB.prepare(
    `SELECT v.id FROM versions v
     JOIN packs p ON p.id = v.pack_id
     JOIN creators c ON c.user_id = p.owner_id
     WHERE c.loot_token IS NOT NULL AND p.status = 'approved' AND v.status = 'approved'
       AND v.loot_url IS NULL AND v.loot_tries < ? LIMIT 25`
  ).bind(MAX_TRIES).all();
  for (const row of results) await ensureLootForVersion(env, row.id);

  // Creators without their own token whose links use the site's account.
  if (!env.OWNER_LOOT_TOKEN) return;
  const { results: owners } = await env.DB.prepare(
    `SELECT DISTINCT p.owner_id, c.linkvertise_id FROM versions v
     JOIN packs p ON p.id = v.pack_id
     LEFT JOIN creators c ON c.user_id = p.owner_id
     WHERE c.loot_token IS NULL AND p.status = 'approved' AND v.status = 'approved'
       AND v.loot_url IS NULL AND v.loot_tries < ? LIMIT 50`
  ).bind(MAX_TRIES).all();
  for (const o of owners) {
    if (await usesSiteEarnings(env, o.owner_id, o)) await ensureLootForCreator(env, o.owner_id);
  }
}

export async function clearLootLinks(env, userId) {
  await env.DB.prepare(
    `UPDATE versions SET loot_url = NULL, loot_tries = 0
     WHERE pack_id IN (SELECT id FROM packs WHERE owner_id = ?)`
  ).bind(String(userId)).run();
}
