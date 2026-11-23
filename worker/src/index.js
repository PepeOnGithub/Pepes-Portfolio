// Community uploads API.
//
// Anyone signed in on the site can upload a pack. Every upload is checked by an
// automatic reviewer (fixed rules, then two Gemini passes, see ai.js) that
// approves or rejects it on its own; the site owner only steps in if the
// reviewer is unreachable. Approved packs are public.
//
// Revenue: creators save their Linkvertise user id and/or LootLabs API token
// once (Creator tools). The site builds Linkvertise links per download and this
// worker generates a LootLabs link per version, so nobody pastes links.
// 100% of the ad revenue goes to the creator's own account.

import { runAiReview, retryStuck } from './ai.js';
import {
  ID_OFFSET, HttpError, json, safeJson, encodeKey, randomId, today,
  getUser, requireUser, isAdmin, publicUser, displayName
} from './util.js';
import { versionsFor, packExtras, toSitePack } from './packs.js';
import {
  ensureCreator, getSettings, saveSettings, publicCreator, creatorStats, recordView, recordDownload
} from './creator.js';
import { ensureLootForVersion, retryMissingLoot } from './loot.js';
import {
  socialInfo, setFollow, followList, setBlock, avatar, unreadCount, conversations, thread, sendMessage,
  getDmSettings, setDmSettings, blockedList
} from './social.js';
import { listNotifications, notificationsUnread, markNotificationsRead, notifyReview } from './notifications.js';

// The version of the terms (the "Last updated" date on terms.html) that the
// upload form asks people to agree to. Change it in upload.js too whenever
// the terms change in a way people should agree to again.
const TERMS_VERSION = '2026-11-23';

const CATEGORIES = ['packs', 'cosmetics', 'utility', 'addons', 'other'];
// .brarchive is Minecraft's own packed-JSON archive; everything else is a zip.
const PACK_EXTENSIONS = ['.mcpack', '.mcaddon', '.brarchive', '.mcworld', '.mctemplate', '.zip'];
const MAX_PACK_BYTES = 50 * 1024 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_OWNER_RECHECKS = 6;

export default {
  async fetch(request, env, exec) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      response = await route(request, env, exec);
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.message }, err.status);
      } else {
        console.error(err);
        response = json({ error: 'Something went wrong on the server.' }, 500);
      }
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },

  // Cron: retry reviews that couldn't finish, make missing LootLabs links, tidy up.
  async scheduled(event, env, exec) {
    exec.waitUntil((async () => {
      await retryStuck(env).catch(e => console.error('retryStuck', e));
      await retryMissingLoot(env).catch(e => console.error('retryMissingLoot', e));
      await env.DB.prepare('DELETE FROM seen WHERE day < ?').bind(today(-2)).run().catch(() => {});
    })());
  }
};

async function route(request, env, exec) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const ctx = { request, env, exec, url, origin: url.origin, _user: undefined };

  if (method === 'GET' && path.startsWith('/files/')) return serveFile(ctx, decodeURIComponent(path.slice(7)));
  // Stable "newest approved file" link.
  let dl;
  if (method === 'GET' && (dl = path.match(/^\/dl\/(\d+)$/))) return latestFile(ctx, toRowId(dl[1]));

  if (path === '/api/community/me' && method === 'GET') {
    const user = await getUser(ctx);
    return json({ user: user ? publicUser(user) : null, isAdmin: isAdmin(ctx, user) });
  }
  if (path === '/api/community/packs' && method === 'GET') return listApproved(ctx);
  if (path === '/api/community/packs' && method === 'POST') return createPack(ctx);
  if (path === '/api/community/mine' && method === 'GET') return listMine(ctx);
  if (path === '/api/community/queue' && method === 'GET') return listQueue(ctx);

  // Creator tools
  if (path === '/api/community/creator' && method === 'GET') return getSettings(ctx);
  if (path === '/api/community/creator' && (method === 'PUT' || method === 'POST')) return saveSettings(ctx);
  if (path === '/api/community/creator/stats' && method === 'GET') return creatorStats(ctx);

  let m;
  if ((m = path.match(/^\/api\/community\/creators\/([^/]+)$/)) && method === 'GET') return publicCreator(ctx, m[1]);

  // Follows, blocks, avatars and direct messages (social.js)
  if ((m = path.match(/^\/api\/community\/users\/([^/]+)\/social$/)) && method === 'GET') return socialInfo(ctx, m[1]);
  if ((m = path.match(/^\/api\/community\/users\/([^/]+)\/follow$/)) && (method === 'POST' || method === 'DELETE')) return setFollow(ctx, m[1], method === 'POST');
  if ((m = path.match(/^\/api\/community\/users\/([^/]+)\/(followers|following)$/)) && method === 'GET') return followList(ctx, m[1], m[2]);
  if ((m = path.match(/^\/api\/community\/users\/([^/]+)\/block$/)) && (method === 'POST' || method === 'DELETE')) return setBlock(ctx, m[1], method === 'POST');
  if ((m = path.match(/^\/api\/community\/avatars\/([^/]+)$/)) && method === 'GET') return avatar(ctx, m[1]);
  if (path === '/api/community/messages' && method === 'GET') return conversations(ctx);
  if (path === '/api/community/messages/unread' && method === 'GET') return unreadCount(ctx);
  if (path === '/api/community/messages/settings') {
    if (method === 'GET') return getDmSettings(ctx);
    if (method === 'PUT') return setDmSettings(ctx);
  }
  if (path === '/api/community/blocks' && method === 'GET') return blockedList(ctx);
  if (path === '/api/community/notifications' && method === 'GET') return listNotifications(ctx);
  if (path === '/api/community/notifications/unread' && method === 'GET') return notificationsUnread(ctx);
  if (path === '/api/community/notifications/read' && method === 'POST') return markNotificationsRead(ctx);
  if ((m = path.match(/^\/api\/community\/messages\/([^/]+)$/))) {
    if (method === 'GET') return thread(ctx, m[1]);
    if (method === 'POST') return sendMessage(ctx, m[1]);
  }

  if ((m = path.match(/^\/api\/community\/packs\/(\d+)$/))) {
    const id = toRowId(m[1]);
    if (method === 'PATCH') return updatePack(ctx, id);
    if (method === 'DELETE') return deletePack(ctx, id);
  }
  if ((m = path.match(/^\/api\/community\/packs\/(\d+)\/versions$/)) && method === 'POST') return addVersion(ctx, toRowId(m[1]));
  if ((m = path.match(/^\/api\/community\/packs\/(\d+)\/view$/)) && method === 'POST') return recordView(ctx, toRowId(m[1]));
  if ((m = path.match(/^\/api\/community\/packs\/(\d+)\/review$/)) && method === 'POST') return reviewPack(ctx, toRowId(m[1]));
  if ((m = path.match(/^\/api\/community\/packs\/(\d+)\/(?:recheck|ai-review)$/)) && method === 'POST') return recheckPack(ctx, toRowId(m[1]));
  if ((m = path.match(/^\/api\/community\/versions\/(\d+)$/)) && method === 'DELETE') return deleteVersion(ctx, Number(m[1]));
  if ((m = path.match(/^\/api\/community\/versions\/(\d+)\/review$/)) && method === 'POST') return reviewVersion(ctx, Number(m[1]));

  throw new HttpError(404, 'Not found');
}

// ===== Listing =====

async function listApproved(ctx) {
  const { results: packs } = await ctx.env.DB
    .prepare("SELECT * FROM packs WHERE status = 'approved' ORDER BY updated_at DESC")
    .all();
  const versions = await versionsFor(ctx, packs.map(p => p.id), "AND status = 'approved'");
  const extras = await packExtras(ctx, packs);
  const out = packs
    .map(p => toSitePack(ctx, p, versions.get(p.id) || [], { extras }))
    .filter(p => p.versions.length > 0);
  return json({ packs: out }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function listMine(ctx) {
  const user = await requireUser(ctx);
  const { results: packs } = await ctx.env.DB
    .prepare('SELECT * FROM packs WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(String(user.id))
    .all();
  const versions = await versionsFor(ctx, packs.map(p => p.id), '');
  const extras = await packExtras(ctx, packs);
  return json({ packs: packs.map(p => toSitePack(ctx, p, versions.get(p.id) || [], { withStatus: true, extras })) });
}

async function listQueue(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx, user)) throw new HttpError(403, 'Only reviewers can see the queue.');
  // Anything still waiting (the automatic reviewer was unreachable or switched off),
  // plus the latest automatic decisions so the owner can see what it did.
  const { results: packs } = await ctx.env.DB.prepare(
    `SELECT * FROM packs WHERE status = 'pending'
       OR id IN (SELECT pack_id FROM versions WHERE status = 'pending')
       OR ai_checked_at > ?
     ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, COALESCE(ai_checked_at, updated_at) DESC LIMIT 60`
  ).bind(new Date(Date.now() - 3 * 86400000).toISOString()).all();
  const versions = await versionsFor(ctx, packs.map(p => p.id), '');
  const extras = await packExtras(ctx, packs);
  return json({ packs: packs.map(p => toSitePack(ctx, p, versions.get(p.id) || [], { withStatus: true, withAi: true, extras })) });
}

// ===== Create / edit =====

async function createPack(ctx) {
  const user = await requireUser(ctx);
  const ownerId = String(user.id);
  checkBodySize(ctx.request, MAX_PACK_BYTES + MAX_ICON_BYTES + 64 * 1024);

  const form = await readForm(ctx.request);
  if (String(form.get('terms') || '') !== TERMS_VERSION) {
    throw new HttpError(400, 'Please reload the page, agree to the terms and upload again.');
  }
  await ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO consents (user_id, kind, version, accepted_at) VALUES (?, 'upload-terms', ?, ?)"
  ).bind(ownerId, TERMS_VERSION, new Date().toISOString()).run();
  const meta = readMeta(form, { requireAll: true });
  const version = readVersion(form);
  const file = await readPackFile(form.get('file'));
  const icon = await readIcon(form.get('icon'), false);

  await ensureCreator(ctx.env, user);
  const now = new Date().toISOString();
  const slug = await uniqueSlug(ctx, `${slugify(meta.name)}-by-${slugify(displayName(user))}`);
  const insert = await ctx.env.DB.prepare(
    `INSERT INTO packs (owner_id, owner_name, name, slug, category, description, tags,
       showcase_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    ownerId, displayName(user), meta.name, slug, meta.category, meta.description, JSON.stringify(meta.tags),
    meta.showcaseUrl, now, now
  ).run();
  const packId = insert.meta.last_row_id;

  try {
    if (icon) {
      const iconKey = `icons/${packId}-${randomId()}.${icon.ext}`;
      await ctx.env.FILES.put(iconKey, icon.bytes, { httpMetadata: { contentType: icon.type } });
      await ctx.env.DB.prepare('UPDATE packs SET icon_key = ? WHERE id = ?').bind(iconKey, packId).run();
    }
    await storeVersion(ctx, packId, version, file, now);
  } catch (err) {
    await removePack(ctx, packId);
    throw err;
  }
  queueAi(ctx, packId);

  return json({ pack: await loadOwnPack(ctx, packId) }, 201);
}

async function updatePack(ctx, rowId) {
  const user = await requireUser(ctx);
  const row = await getPackRow(ctx, rowId);
  const admin = isAdmin(ctx, user);
  if (row.owner_id !== String(user.id) && !admin) throw new HttpError(403, 'You can only edit your own packs.');
  checkBodySize(ctx.request, MAX_ICON_BYTES + 64 * 1024);

  const form = await readForm(ctx.request);
  const meta = readMeta(form, { requireAll: false });
  const icon = await readIcon(form.get('icon'), false);

  const next = {
    name: meta.name ?? row.name,
    category: meta.category ?? row.category,
    description: meta.description ?? row.description,
    tags: meta.tags ? JSON.stringify(meta.tags) : row.tags,
    showcase_url: meta.showcaseUrl !== undefined ? meta.showcaseUrl : row.showcase_url
  };

  // Anything a visitor judges the pack by goes through the automatic review again.
  const changed = next.name !== row.name || next.description !== row.description || next.tags !== row.tags
    || next.showcase_url !== row.showcase_url || !!icon;
  const needsReview = !admin && row.status === 'approved' && changed;
  const status = row.status === 'rejected' && !admin ? 'pending' : (needsReview ? 'pending' : row.status);

  let iconKey = row.icon_key;
  if (icon) {
    iconKey = `icons/${row.id}-${randomId()}.${icon.ext}`;
    await ctx.env.FILES.put(iconKey, icon.bytes, { httpMetadata: { contentType: icon.type } });
    if (row.icon_key) await ctx.env.FILES.delete(row.icon_key);
  }

  await ctx.env.DB.prepare(
    `UPDATE packs SET name = ?, category = ?, description = ?, tags = ?,
       showcase_url = ?, icon_key = ?, status = ?, review_note = CASE WHEN ? = status THEN review_note ELSE NULL END,
       updated_at = ? WHERE id = ?`
  ).bind(
    next.name, next.category, next.description, next.tags,
    next.showcase_url, iconKey, status, status, new Date().toISOString(), row.id
  ).run();

  if (status === 'pending' && !admin) {
    await ctx.env.DB.prepare('UPDATE packs SET ai_verdict = NULL WHERE id = ?').bind(row.id).run();
    queueAi(ctx, row.id);
  }

  return json({ pack: await loadOwnPack(ctx, row.id), sentForReview: status === 'pending' && row.status !== 'pending' });
}

async function addVersion(ctx, rowId) {
  const user = await requireUser(ctx);
  const row = await getPackRow(ctx, rowId);
  if (row.owner_id !== String(user.id) && !isAdmin(ctx, user)) throw new HttpError(403, 'You can only update your own packs.');
  checkBodySize(ctx.request, MAX_PACK_BYTES + 64 * 1024);

  const form = await readForm(ctx.request);
  const version = readVersion(form);
  const file = await readPackFile(form.get('file'));
  await storeVersion(ctx, row.id, version, file, new Date().toISOString());
  queueAi(ctx, row.id);
  return json({ pack: await loadOwnPack(ctx, row.id) }, 201);
}

async function storeVersion(ctx, packId, version, file, now) {
  const key = `packs/${packId}/${randomId()}-${file.safeName}`;
  await ctx.env.FILES.put(key, file.bytes, {
    httpMetadata: {
      contentType: 'application/octet-stream',
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
    }
  });
  await ctx.env.DB.prepare(
    `INSERT INTO versions (pack_id, version, changelog, file_key, file_name, size, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(packId, version.version, version.changelog, key, file.name, file.bytes.byteLength, now).run();
}

// ===== Delete =====

async function deletePack(ctx, rowId) {
  const user = await requireUser(ctx);
  const row = await getPackRow(ctx, rowId);
  if (row.owner_id !== String(user.id) && !isAdmin(ctx, user)) throw new HttpError(403, 'You can only delete your own packs.');
  await removePack(ctx, row.id);
  return json({ ok: true });
}

async function removePack(ctx, packId) {
  const row = await ctx.env.DB.prepare('SELECT icon_key FROM packs WHERE id = ?').bind(packId).first();
  const { results } = await ctx.env.DB.prepare('SELECT file_key FROM versions WHERE pack_id = ?').bind(packId).all();
  const keys = results.map(v => v.file_key);
  if (row && row.icon_key) keys.push(row.icon_key);
  if (keys.length) await ctx.env.FILES.delete(keys);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM versions WHERE pack_id = ?').bind(packId),
    ctx.env.DB.prepare('DELETE FROM packs WHERE id = ?').bind(packId)
  ]);
}

async function deleteVersion(ctx, versionId) {
  const user = await requireUser(ctx);
  const v = await ctx.env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(versionId).first();
  if (!v) throw new HttpError(404, 'That version no longer exists.');
  const row = await getPackRow(ctx, v.pack_id + ID_OFFSET);
  if (row.owner_id !== String(user.id) && !isAdmin(ctx, user)) throw new HttpError(403, 'You can only delete your own versions.');
  const { n } = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE pack_id = ?').bind(v.pack_id).first();
  if (n <= 1) throw new HttpError(400, 'A pack needs at least one version. Delete the whole pack instead.');
  await ctx.env.FILES.delete(v.file_key);
  await ctx.env.DB.prepare('DELETE FROM versions WHERE id = ?').bind(versionId).run();
  return json({ pack: await loadOwnPack(ctx, v.pack_id) });
}

// ===== Review =====

// Owner override of the automatic reviewer.
async function reviewPack(ctx, rowId) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx, user)) throw new HttpError(403, 'Only reviewers can do that.');
  const row = await getPackRow(ctx, rowId);
  const { action, note } = await readReview(ctx.request);
  const status = action === 'approve' ? 'approved' : 'rejected';
  const now = new Date().toISOString();
  const statements = [
    ctx.env.DB.prepare('UPDATE packs SET status = ?, review_note = ?, updated_at = ? WHERE id = ?').bind(status, note, now, row.id)
  ];
  // Overriding a pack also settles the versions that were waiting or turned down with it.
  statements.push(ctx.env.DB.prepare(
    "UPDATE versions SET status = ?, review_note = ? WHERE pack_id = ? AND status IN ('pending', 'rejected')"
  ).bind(status, note, row.id));
  await ctx.env.DB.batch(statements);
  if (action === 'approve') queueLoot(ctx, row.id);
  if (row.status !== status) await notifyReview(ctx.env, row, action === 'approve', note, { first: action === 'approve' && row.status === 'pending' });
  return json({ pack: await loadOwnPack(ctx, row.id, { withAi: true }) });
}

async function reviewVersion(ctx, versionId) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx, user)) throw new HttpError(403, 'Only reviewers can do that.');
  const v = await ctx.env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(versionId).first();
  if (!v) throw new HttpError(404, 'That version no longer exists.');
  const { action, note } = await readReview(ctx.request);
  await ctx.env.DB.prepare('UPDATE versions SET status = ?, review_note = ? WHERE id = ?')
    .bind(action === 'approve' ? 'approved' : 'rejected', note, versionId).run();
  if (action === 'approve') {
    await ctx.env.DB.prepare('UPDATE packs SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), v.pack_id).run();
    queueLoot(ctx, v.pack_id);
  }
  return json({ pack: await loadOwnPack(ctx, v.pack_id, { withAi: true }) });
}

function queueLoot(ctx, packId) {
  const job = (async () => {
    const { results } = await ctx.env.DB.prepare("SELECT id FROM versions WHERE pack_id = ? AND status = 'approved' AND loot_url IS NULL").bind(packId).all();
    for (const v of results) await ensureLootForVersion(ctx.env, v.id);
  })().catch(err => console.error('loot job failed', err));
  if (ctx.exec && ctx.exec.waitUntil) ctx.exec.waitUntil(job);
}

// The upload response goes back straight away; the check runs afterwards.
function queueAi(ctx, packId, opts) {
  const job = runAiReview(ctx.env, packId, opts).catch(err => console.error('AI review crashed', err));
  if (ctx.exec && ctx.exec.waitUntil) ctx.exec.waitUntil(job);
}

// Creators can ask for another automatic check of a rejected pack after fixing it;
// the owner can force one at any time.
async function recheckPack(ctx, rowId) {
  const user = await requireUser(ctx);
  const row = await getPackRow(ctx, rowId);
  const admin = isAdmin(ctx, user);
  if (row.owner_id !== String(user.id) && !admin) throw new HttpError(403, 'You can only re-check your own packs.');
  if (!admin && (row.ai_runs || 0) >= MAX_OWNER_RECHECKS) {
    throw new HttpError(429, 'This pack has been checked several times already. Change something in it (a new version or edited details) and it will be checked again.');
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE packs SET status = 'pending', review_note = NULL, ai_verdict = NULL WHERE id = ? AND status = 'rejected'").bind(row.id),
    ctx.env.DB.prepare("UPDATE versions SET status = 'pending', review_note = NULL, ai_verdict = NULL WHERE pack_id = ? AND status = 'rejected'").bind(row.id)
  ]);
  if (admin) {
    await runAiReview(ctx.env, row.id, { force: true });
  } else {
    queueAi(ctx, row.id);
  }
  return json({ pack: await loadOwnPack(ctx, row.id, { withAi: admin }) });
}

async function readReview(request) {
  let body;
  try { body = await request.json(); } catch (e) { throw new HttpError(400, 'Send JSON with an action.'); }
  const action = body && body.action;
  if (action !== 'approve' && action !== 'reject') throw new HttpError(400, 'Action must be approve or reject.');
  const note = String(body.note || '').trim().slice(0, 500) || null;
  if (action === 'reject' && !note) throw new HttpError(400, 'Say why it was rejected so the uploader can fix it.');
  return { action, note };
}

// ===== Files =====

async function serveFile(ctx, key) {
  if (!/^(packs\/\d+\/|icons\/\d+-)[A-Za-z0-9._\-]+$/.test(key)) throw new HttpError(404, 'File not found');
  const isIcon = key.startsWith('icons/');

  // Public only once approved; the uploader and reviewers can fetch pending
  // files with their session token.
  let visible;
  if (isIcon) {
    visible = await ctx.env.DB.prepare("SELECT owner_id, status FROM packs WHERE icon_key = ?").bind(key).first();
  } else {
    visible = await ctx.env.DB.prepare(
      `SELECT v.id AS version_id, p.id AS pack_id, p.owner_id,
         CASE WHEN p.status = 'approved' AND v.status = 'approved' THEN 'approved' ELSE 'pending' END AS status
       FROM versions v JOIN packs p ON p.id = v.pack_id WHERE v.file_key = ?`
    ).bind(key).first();
  }
  if (!visible) throw new HttpError(404, 'File not found');
  const isPublic = visible.status === 'approved';
  const hasToken = (ctx.request.headers.get('Authorization') || '').startsWith('Bearer ');
  // Icons load in plain <img> tags (no token), and a pending pack's icon URL
  // is only ever handed to its owner and reviewers, so icons skip the check.
  let viewer = null;
  if (!isIcon && (!isPublic || hasToken)) {
    viewer = await getUser(ctx);
    if (!isPublic && (!viewer || (String(viewer.id) !== visible.owner_id && !isAdmin(ctx, viewer)))) {
      throw new HttpError(404, 'File not found');
    }
  }

  const obj = await ctx.env.FILES.get(key);
  if (!obj) throw new HttpError(404, 'File not found');

  // Count real downloads (not the owner or reviewers testing their own files).
  if (!isIcon && isPublic) {
    const own = viewer && (String(viewer.id) === visible.owner_id || isAdmin(ctx, viewer));
    if (!own) {
      const job = recordDownload(ctx, visible.pack_id, visible.version_id).catch(e => console.error('count failed', e));
      if (ctx.exec && ctx.exec.waitUntil) ctx.exec.waitUntil(job);
    }
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', !isPublic ? 'private, no-store' : isIcon ? 'public, max-age=86400' : 'no-cache');
  return new Response(obj.body, { headers });
}

async function latestFile(ctx, rowId) {
  const v = await ctx.env.DB.prepare(
    `SELECT v.file_key FROM versions v JOIN packs p ON p.id = v.pack_id
     WHERE p.id = ? AND p.status = 'approved' AND v.status = 'approved'
     ORDER BY v.created_at DESC, v.id DESC LIMIT 1`
  ).bind(rowId - ID_OFFSET).first();
  if (!v) throw new HttpError(404, 'This pack has no download right now.');
  return new Response(null, {
    status: 302,
    headers: { Location: `${ctx.origin}/files/${encodeKey(v.file_key)}`, 'Cache-Control': 'no-store' }
  });
}

// ===== Input parsing =====

function checkBodySize(request, max) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > max) throw new HttpError(413, `That upload is too big. Pack files can be up to ${MAX_PACK_BYTES / 1024 / 1024} MB.`);
}

async function readForm(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid request.');
    return { get: (k) => (body[k] === undefined ? null : body[k]), has: (k) => body[k] !== undefined };
  }
  try {
    return await request.formData();
  } catch (e) {
    throw new HttpError(400, 'Invalid upload.');
  }
}

function field(form, name) {
  if (!form.has(name)) return undefined;
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function readMeta(form, { requireAll }) {
  const out = {};
  const name = field(form, 'name');
  if (name !== undefined || requireAll) {
    if (!name || name.length < 3 || name.length > 60) throw new HttpError(400, 'Name must be 3 to 60 characters.');
    out.name = name.replace(/\s+/g, ' ');
  }
  const category = field(form, 'category');
  if (category !== undefined || requireAll) {
    if (!CATEGORIES.includes(category)) throw new HttpError(400, `Pick a category: ${CATEGORIES.join(', ')}.`);
    out.category = category;
  }
  const description = field(form, 'description');
  if (description !== undefined || requireAll) {
    if (!description || description.length < 10 || description.length > 2000) {
      throw new HttpError(400, 'Description must be 10 to 2000 characters.');
    }
    out.description = description;
  }
  const tags = field(form, 'tags');
  if (tags !== undefined) {
    const list = [...new Set(tags.split(',').map(t => t.trim()).filter(Boolean))];
    if (list.length > 6) throw new HttpError(400, 'Use up to 6 tags.');
    if (list.some(t => t.length > 20)) throw new HttpError(400, 'Each tag can be up to 20 characters.');
    out.tags = list;
  } else if (requireAll) {
    out.tags = [];
  }

  const showcase = field(form, 'showcaseUrl');
  if (showcase !== undefined) {
    if (showcase) {
      const u = httpsUrl(showcase, 'Showcase video');
      const host = new URL(u).hostname.replace(/^www\./, '');
      if (!['youtube.com', 'youtu.be', 'm.youtube.com'].includes(host)) throw new HttpError(400, 'Showcase video must be a YouTube link.');
      out.showcaseUrl = u;
    } else out.showcaseUrl = null;
  } else if (requireAll) out.showcaseUrl = null;

  return out;
}

function readVersion(form) {
  const version = (field(form, 'version') || '').replace(/^v/i, '');
  if (!/^[0-9A-Za-z][0-9A-Za-z.\-+]{0,19}$/.test(version)) throw new HttpError(400, 'Version should look like 1.0.0.');
  const changelog = (field(form, 'changelog') || '').slice(0, 2000);
  return { version, changelog };
}

function httpsUrl(value, label) {
  let u;
  try { u = new URL(value); } catch (e) { throw new HttpError(400, `${label} must be a full https:// link.`); }
  if (u.protocol !== 'https:' || value.length > 500) throw new HttpError(400, `${label} must be a full https:// link.`);
  return u.toString();
}

async function readPackFile(file) {
  if (!file || typeof file === 'string') throw new HttpError(400, 'Choose a pack file to upload.');
  const name = String(file.name || 'pack.mcpack').slice(-120);
  const lower = name.toLowerCase();
  if (!PACK_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    throw new HttpError(400, `Pack files must be ${PACK_EXTENSIONS.join(', ')}.`);
  }
  if (file.size > MAX_PACK_BYTES) throw new HttpError(413, `Pack files can be up to ${MAX_PACK_BYTES / 1024 / 1024} MB.`);
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (lower.endsWith('.brarchive')) {
    // Not a zip; just make sure it isn't a renamed program or empty.
    if (bytes.byteLength < 8 || (head[0] === 0x4d && head[1] === 0x5a) || isZip) {
      throw new HttpError(400, "That file isn't a valid .brarchive.");
    }
  } else if (!isZip) {
    throw new HttpError(400, "That file isn't a valid pack archive.");
  }
  const safeName = name.replace(/[^A-Za-z0-9._\-]+/g, '_').replace(/^_+/, '') || 'pack.mcpack';
  return { name, safeName, bytes };
}

async function readIcon(file, required) {
  if (!file || typeof file === 'string' || file.size === 0) {
    if (required) throw new HttpError(400, 'Choose an icon.');
    return null;
  }
  if (file.size > MAX_ICON_BYTES) throw new HttpError(413, 'Icons can be up to 1 MB.');
  const bytes = await file.arrayBuffer();
  const b = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  let type = null;
  let ext = null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { type = 'image/png'; ext = 'png'; }
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { type = 'image/jpeg'; ext = 'jpg'; }
  else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) { type = 'image/webp'; ext = 'webp'; }
  if (!type) throw new HttpError(400, 'Icons must be PNG, JPG or WebP.');
  return { bytes, type, ext };
}

// ===== Helpers =====

async function getPackRow(ctx, rowId) {
  const row = await ctx.env.DB.prepare('SELECT * FROM packs WHERE id = ?').bind(rowId - ID_OFFSET).first();
  if (!row) throw new HttpError(404, 'That pack no longer exists.');
  return row;
}

async function loadOwnPack(ctx, packId, { withAi = false } = {}) {
  const row = await ctx.env.DB.prepare('SELECT * FROM packs WHERE id = ?').bind(packId).first();
  const versions = await versionsFor(ctx, [packId], '');
  const extras = await packExtras(ctx, [row]);
  return toSitePack(ctx, row, versions.get(packId) || [], { withStatus: true, withAi, extras });
}

function toRowId(siteId) {
  const n = Number(siteId);
  if (!Number.isInteger(n) || n <= ID_OFFSET) throw new HttpError(404, 'That pack no longer exists.');
  return n;
}

async function uniqueSlug(ctx, base) {
  const root = base.slice(0, 70).replace(/-+$/, '') || 'pack';
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const hit = await ctx.env.DB.prepare('SELECT 1 FROM packs WHERE slug = ?').bind(candidate).first();
    if (!hit) return candidate;
  }
  return `${root}-${randomId()}`;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pack';
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export { safeJson };
