// Creator tools: earnings settings, public profile, statistics.

import { HttpError, json, requireUser, publicUser, displayName, safeJson, clip, today, sha256Hex, ID_OFFSET } from './util.js';
import { versionsFor, packExtras, toSitePack } from './packs.js';
import { encryptToken, ensureLootForCreator, clearLootLinks } from './loot.js';
import { reviewProfile } from './ai.js';
import { verification } from './verify.js';

const MAX_SOCIALS = 8;
const MAX_VIDEOS = 3;
const BIO_MAX = 500;

// ===== Link rules =====

const HANDLE = '[A-Za-z0-9_.\\-]{1,60}';
const SOCIAL_RULES = [
  { type: 'discord', host: /^(discord\.gg|discord\.com|discordapp\.com)$/, test: /^\/(?:invite\/)?([A-Za-z0-9-]{2,32})$/, hostPath: (h, m) => (h === 'discord.gg' ? true : /^\/invite\//.test(m.input)), build: m => `https://discord.gg/${m[1]}` },
  { type: 'youtube', host: /^(youtube\.com|m\.youtube\.com)$/, test: /^\/(@[A-Za-z0-9_.\-]{2,60}|channel\/UC[A-Za-z0-9_\-]{20,24}|c\/[^/]{1,60}|user\/[^/]{1,60})$/, build: m => `https://www.youtube.com/${m[1]}` },
  { type: 'x', host: /^(x\.com|twitter\.com|mobile\.twitter\.com)$/, test: new RegExp(`^/(${HANDLE})$`), build: m => `https://x.com/${m[1]}` },
  { type: 'tiktok', host: /^tiktok\.com$/, test: /^\/(@[A-Za-z0-9_.]{2,40})$/, build: m => `https://www.tiktok.com/${m[1]}` },
  { type: 'twitch', host: /^twitch\.tv$/, test: /^\/([A-Za-z0-9_]{3,30})$/, build: m => `https://www.twitch.tv/${m[1]}` },
  { type: 'instagram', host: /^instagram\.com$/, test: /^\/([A-Za-z0-9_.]{1,40})$/, build: m => `https://www.instagram.com/${m[1]}` },
  { type: 'github', host: /^github\.com$/, test: /^\/([A-Za-z0-9\-]{1,39})$/, build: m => `https://github.com/${m[1]}` },
  { type: 'patreon', host: /^patreon\.com$/, test: new RegExp(`^/(${HANDLE})$`), build: m => `https://www.patreon.com/${m[1]}` },
  { type: 'kofi', host: /^ko-fi\.com$/, test: new RegExp(`^/(${HANDLE})$`), build: m => `https://ko-fi.com/${m[1]}` },
  { type: 'mcpedl', host: /^mcpedl\.com$/, test: /^\/(user\/[A-Za-z0-9_.\-]{1,40}|author\/[A-Za-z0-9_.\-]{1,40})$/, build: m => `https://mcpedl.com/${m[1]}/` },
  { type: 'bluesky', host: /^bsky\.app$/, test: /^\/(profile\/[A-Za-z0-9_.\-]{3,80})$/, build: m => `https://bsky.app/${m[1]}` }
];

const BAD_SITE = /(bit\.ly|tinyurl|t\.co|cutt\.ly|is\.gd|rebrand\.ly|shorturl|adf\.ly|ouo\.io|link-to\.net|linkvertise|loot-?link|lootdest|work\.ink|grabify|iplogger|2no\.co|yip\.su|blasze|webhook\.site|ngrok|pastebin|mediafire|mega\.nz|drive\.google|dropbox|anonfiles|gofile|workupload|sendspace)/i;

// Returns {type, url} or throws HttpError with a message for the creator.
export function normalizeSocial(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch (e) { throw new HttpError(400, `"${clip(input, 60)}" isn't a valid link.`); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'Links must start with https://');
  if (u.username || u.password) throw new HttpError(400, 'Links can\'t contain a username or password.');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');

  for (const rule of SOCIAL_RULES) {
    if (!rule.host.test(host)) continue;
    const m = path.match(rule.test);
    if (!m || (rule.type === 'discord' && host !== 'discord.gg' && !/^\/invite\//.test(path))) {
      throw new HttpError(400, `That ${rule.type} link doesn't look like a profile or invite link: ${clip(input, 80)}`);
    }
    return { type: rule.type, url: rule.build(m) };
  }

  // Anything else is a personal website.
  if (BAD_SITE.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.') || host.length > 80) {
    throw new HttpError(400, `Links to ${host} aren't allowed. Use your own website or one of the supported social sites.`);
  }
  return { type: 'website', url: `https://${host}${path || ''}` };
}

export function videoId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  if (!m) throw new HttpError(400, `"${clip(s, 60)}" isn't a YouTube video link.`);
  return m[1];
}

function normalizeProfile(body) {
  const bio = String(body.bio == null ? '' : body.bio)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩​-‏﻿]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (bio.length > BIO_MAX) throw new HttpError(400, `Your bio can be up to ${BIO_MAX} characters.`);
  if (/https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]+\.(?:com|net|gg|io|xyz|tv|me|ly|co)\b/i.test(bio)) {
    throw new HttpError(400, 'Keep links out of your bio and add them in the Links section instead.');
  }

  const socials = [];
  const seen = new Set();
  const perType = {};
  for (const item of Array.isArray(body.socials) ? body.socials : []) {
    const link = normalizeSocial(typeof item === 'string' ? item : item && item.url);
    if (!link || seen.has(link.url)) continue;
    perType[link.type] = (perType[link.type] || 0) + 1;
    if (perType[link.type] > 2) throw new HttpError(400, `You can add up to 2 ${link.type} links.`);
    seen.add(link.url);
    socials.push(link);
  }
  if (socials.length > MAX_SOCIALS) throw new HttpError(400, `You can add up to ${MAX_SOCIALS} links.`);

  const videos = [];
  for (const item of Array.isArray(body.videos) ? body.videos : []) {
    const id = videoId(typeof item === 'string' ? item : item && (item.id || item.url));
    if (id && !videos.includes(id)) videos.push(id);
  }
  if (videos.length > MAX_VIDEOS) throw new HttpError(400, `You can feature up to ${MAX_VIDEOS} videos.`);
  return { bio, socials, videos };
}

// ===== Rows =====

export async function ensureCreator(env, user) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO creators (user_id, username, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username`
  ).bind(String(user.id), displayName(user), now).run();
}

async function creatorRow(ctx, user) {
  await ensureCreator(ctx.env, user);
  return ctx.env.DB.prepare('SELECT * FROM creators WHERE user_id = ?').bind(String(user.id)).first();
}

function settingsView(row, user, env) {
  const publicProfile = safeJson(row.public_json, { bio: '', socials: [], videos: [] });
  const draft = safeJson(row.draft_json, null) || publicProfile;
  // The site owner's packs use the site's own Linkvertise and LootLabs
  // accounts, so the page doesn't ask them for either and shows those.
  const site = !!(user && user.isOwner);
  return {
    siteEarnings: site,
    linkvertiseId: row.linkvertise_id || (site && env.OWNER_LINKVERTISE_ID ? String(env.OWNER_LINKVERTISE_ID) : ''),
    hasLootToken: !!row.loot_token || (site && !!env.OWNER_LOOT_TOKEN),
    lootStatus: row.loot_status || '',
    profile: {
      status: row.profile_status,
      note: row.profile_note || '',
      draft,
      public: publicProfile
    }
  };
}

// ===== Settings =====

export async function getSettings(ctx) {
  const user = await requireUser(ctx);
  const row = await creatorRow(ctx, user);
  return json({ settings: settingsView(row, user, ctx.env) });
}

export async function saveSettings(ctx) {
  const user = await requireUser(ctx);
  const body = await ctx.request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid request.');
  const env = ctx.env;
  const userId = String(user.id);
  let row = await creatorRow(ctx, user);
  const now = new Date().toISOString();

  // Any change to whose accounts the downloads earn for rebuilds the
  // creator's LootLabs links: with their own token, with the site's (no
  // accounts of their own), or none (Linkvertise only).
  let earningsChanged = false;

  if ('linkvertiseId' in body) {
    const id = String(body.linkvertiseId == null ? '' : body.linkvertiseId).trim();
    if (id && !/^\d{1,12}$/.test(id)) throw new HttpError(400, 'Your Linkvertise user id is a number, like 123456.');
    if ((id || null) !== (row.linkvertise_id || null)) {
      await env.DB.prepare('UPDATE creators SET linkvertise_id = ?, updated_at = ? WHERE user_id = ?').bind(id || null, now, userId).run();
      earningsChanged = true;
    }
  }

  if ('lootToken' in body) {
    const token = String(body.lootToken == null ? '' : body.lootToken).trim();
    if (!token) {
      await env.DB.prepare('UPDATE creators SET loot_token = NULL, loot_status = NULL, updated_at = ? WHERE user_id = ?').bind(now, userId).run();
    } else {
      if (!/^[A-Za-z0-9_\-:.=+/]{16,300}$/.test(token)) throw new HttpError(400, "That doesn't look like a LootLabs API token. Copy it from LootLabs → Advanced.");
      if (!env.TOKEN_KEY) throw new HttpError(503, "Saving LootLabs tokens isn't set up on the server yet.");
      const stored = await encryptToken(env, token);
      await env.DB.prepare("UPDATE creators SET loot_token = ?, loot_status = 'untested', updated_at = ? WHERE user_id = ?").bind(stored, now, userId).run();
    }
    earningsChanged = true;
  }

  if (earningsChanged) {
    await clearLootLinks(env, userId);
    const job = ensureLootForCreator(env, userId).catch(e => console.error('loot setup failed', e));
    if (ctx.exec && ctx.exec.waitUntil) ctx.exec.waitUntil(job); else await job;
  }

  if (body.profile && typeof body.profile === 'object') {
    const draft = normalizeProfile(body.profile);
    const current = safeJson(row.public_json, { bio: '', socials: [], videos: [] });
    const same = draft.bio === current.bio
      && JSON.stringify(draft.socials.map(s => s.url)) === JSON.stringify((current.socials || []).map(s => s.url))
      && JSON.stringify(draft.videos) === JSON.stringify((current.videos || []).map(v => v.id));
    if (!same) {
      await env.DB.prepare(
        "UPDATE creators SET draft_json = ?, profile_status = 'pending', profile_note = NULL, updated_at = ? WHERE user_id = ?"
      ).bind(JSON.stringify(draft), now, userId).run();
      const job = reviewProfile(env, userId).catch(e => console.error('profile review crashed', e));
      if (ctx.exec && ctx.exec.waitUntil) ctx.exec.waitUntil(job); else await job;
    }
  }

  row = await env.DB.prepare('SELECT * FROM creators WHERE user_id = ?').bind(userId).first();
  return json({ settings: settingsView(row, user, ctx.env) });
}

// ===== Public profile =====

export async function publicCreator(ctx, key) {
  const env = ctx.env;
  const k = decodeURIComponent(key).slice(0, 80);
  let row = await env.DB.prepare('SELECT * FROM creators WHERE user_id = ? OR lower(username) = lower(?) LIMIT 1').bind(k, k).first();
  const owner = row ? row.user_id : (await env.DB.prepare('SELECT owner_id FROM packs WHERE owner_id = ? OR lower(owner_name) = lower(?) LIMIT 1').bind(k, k).first() || {}).owner_id;
  if (!owner) throw new HttpError(404, 'No creator found.');

  const { results: packs } = await env.DB
    .prepare("SELECT * FROM packs WHERE owner_id = ? AND status = 'approved' ORDER BY updated_at DESC")
    .bind(owner).all();
  const versions = await versionsFor(ctx, packs.map(p => p.id), "AND status = 'approved'");
  const extras = await packExtras(ctx, packs);
  const sitePacks = packs.map(p => toSitePack(ctx, p, versions.get(p.id) || [], { extras })).filter(p => p.versions.length);
  const profile = safeJson(row && row.public_json, { bio: '', socials: [], videos: [] });
  const downloads = sitePacks.reduce((n, p) => n + (p.downloads || 0), 0);
  const badge = (await verification(env, [owner])).get(String(owner));
  return json({
    creator: {
      id: owner,
      verified: !!(badge && badge.verified),
      owner: !!(badge && badge.owner),
      username: (row && row.username) || (packs[0] && packs[0].owner_name) || '',
      bio: profile.bio || '',
      socials: profile.socials || [],
      videos: profile.videos || [],
      packCount: sitePacks.length,
      downloads
    },
    packs: sitePacks
  }, 200, { 'Cache-Control': 'public, max-age=30' });
}

// ===== Counting =====

async function firstTimeToday(ctx, key) {
  const ip = ctx.request.headers.get('CF-Connecting-IP') || ctx.request.headers.get('X-Forwarded-For') || 'local';
  const hash = (await sha256Hex(`${key}|${ip}`)).slice(0, 24);
  const res = await ctx.env.DB.prepare('INSERT OR IGNORE INTO seen (key, day) VALUES (?, ?)').bind(hash, today()).run();
  return res.meta && res.meta.changes > 0;
}

async function bump(env, packId, versionId, col) {
  await env.DB.prepare(
    `INSERT INTO stats_daily (pack_id, version_id, day, ${col}) VALUES (?, ?, ?, 1)
     ON CONFLICT(pack_id, version_id, day) DO UPDATE SET ${col} = ${col} + 1`
  ).bind(packId, versionId, today()).run();
}

export async function recordView(ctx, siteId) {
  const packId = siteId - ID_OFFSET;
  const pack = await ctx.env.DB.prepare("SELECT id FROM packs WHERE id = ? AND status = 'approved'").bind(packId).first();
  if (!pack) throw new HttpError(404, 'That pack no longer exists.');
  if (await firstTimeToday(ctx, `view|${packId}|${today()}`)) await bump(ctx.env, packId, 0, 'views');
  return json({ ok: true });
}

// A real file fetch of an approved version (called from serveFile).
export async function recordDownload(ctx, packId, versionId) {
  if (await firstTimeToday(ctx, `dl|${versionId}|${today()}`)) await bump(ctx.env, packId, versionId, 'downloads');
}

// ===== Statistics =====

export async function creatorStats(ctx) {
  const user = await requireUser(ctx);
  const env = ctx.env;
  const owner = String(user.id);
  const days = [7, 30, 90].includes(Number(ctx.url.searchParams.get('days'))) ? Number(ctx.url.searchParams.get('days')) : 30;

  const { results: packs } = await env.DB.prepare('SELECT id, name, slug, status, category, icon_key, created_at FROM packs WHERE owner_id = ? ORDER BY created_at DESC').bind(owner).all();
  const ids = packs.map(p => p.id);
  const empty = {
    days, series: [], totals: { views: 0, downloads: 0, prevViews: 0, prevDownloads: 0, allTimeDownloads: 0, allTimeViews: 0 },
    packs: [], rank: null, creators: 0
  };
  if (!ids.length) return json(empty);

  const marks = ids.map(() => '?').join(',');
  const start = today(-(days - 1));
  const prevStart = today(-(days * 2 - 1));
  const { results: rows } = await env.DB
    .prepare(`SELECT pack_id, version_id, day, views, downloads FROM stats_daily WHERE pack_id IN (${marks}) AND day >= ?`)
    .bind(...ids, prevStart).all();
  const { results: allTime } = await env.DB
    .prepare(`SELECT pack_id, version_id, SUM(views) AS v, SUM(downloads) AS d FROM stats_daily WHERE pack_id IN (${marks}) GROUP BY pack_id, version_id`)
    .bind(...ids).all();

  const dayMap = new Map();
  for (let i = days - 1; i >= 0; i--) dayMap.set(today(-i), { day: today(-i), views: 0, downloads: 0 });
  const perPack = new Map(packs.map(p => [p.id, { views: 0, downloads: 0, prevViews: 0, prevDownloads: 0, totalViews: 0, totalDownloads: 0, byVersion: {} }]));
  const totals = { views: 0, downloads: 0, prevViews: 0, prevDownloads: 0, allTimeDownloads: 0, allTimeViews: 0 };
  for (const r of rows) {
    const p = perPack.get(r.pack_id);
    if (r.day >= start) {
      const d = dayMap.get(r.day);
      if (d) { d.views += r.views; d.downloads += r.downloads; }
      p.views += r.views; p.downloads += r.downloads;
      totals.views += r.views; totals.downloads += r.downloads;
    } else {
      p.prevViews += r.views; p.prevDownloads += r.downloads;
      totals.prevViews += r.views; totals.prevDownloads += r.downloads;
    }
  }
  for (const r of allTime) {
    const p = perPack.get(r.pack_id);
    p.totalViews += r.v; p.totalDownloads += r.d;
    if (r.version_id) p.byVersion[r.version_id] = r.d;
    totals.allTimeViews += r.v; totals.allTimeDownloads += r.d;
  }

  const versions = await versionsFor(ctx, ids, '');
  const outPacks = packs.map(p => {
    const s = perPack.get(p.id);
    return {
      id: ID_OFFSET + p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      category: p.category,
      views: s.views, downloads: s.downloads, prevViews: s.prevViews, prevDownloads: s.prevDownloads,
      totalViews: s.totalViews, totalDownloads: s.totalDownloads,
      versions: (versions.get(p.id) || []).map(v => ({ id: v.id, version: v.version, status: v.status, downloads: s.byVersion[v.id] || 0, hasLoot: !!v.loot_url }))
    };
  });

  // Where this creator stands among everyone with live packs.
  const { results: board } = await env.DB.prepare(
    `SELECT p.owner_id AS o, SUM(s.downloads) AS d FROM packs p JOIN stats_daily s ON s.pack_id = p.id
     WHERE p.status = 'approved' AND s.version_id > 0 GROUP BY p.owner_id HAVING d > 0 ORDER BY d DESC`
  ).all();
  const at = board.findIndex(r => r.o === owner);

  return json({
    days,
    series: [...dayMap.values()],
    totals,
    packs: outPacks,
    rank: at >= 0 ? at + 1 : null,
    creators: board.length
  });
}

export { publicUser };
