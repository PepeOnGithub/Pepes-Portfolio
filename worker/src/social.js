// Follows, direct messages and blocks between site accounts.
//
// Accounts live in the accounts worker (pepes-portfolio-api). Both workers
// share pepes-portfolio-db, so this reads its users table (read-only) for
// names and avatars instead of making one request per person.
//
// Safety: messages are text only, at most MAX_MESSAGE characters, and each
// sender can send SEND_LIMIT messages per SEND_WINDOW_MIN minutes. A block
// stops messages and follows in both directions.

import { HttpError, json, requireUser, getUser, clip } from './util.js';
import { verification, thresholds } from './verify.js';
import { notify } from './notifications.js';

const MAX_MESSAGE = 1000;
const SEND_LIMIT = 20;
const SEND_WINDOW_MIN = 10;
const LIST_LIMIT = 100;

// ===== Accounts =====

async function account(env, key) {
  const k = decodeURIComponent(String(key || '')).slice(0, 200);
  if (!k) return null;
  return env.DB.prepare(
    'SELECT id, username, name, display_name FROM users WHERE id = ? OR lower(username) = lower(?) LIMIT 1'
  ).bind(k, k).first();
}

async function requireAccount(env, key) {
  const row = await account(env, key);
  if (!row) throw new HttpError(404, 'No account found.');
  return row;
}

function summary(row) {
  return {
    id: String(row.id),
    username: row.username || '',
    name: row.display_name || row.name || row.username || 'Unknown'
  };
}

// People by id, each with verified / owner flags. `known` can pass an
// already-computed verification map.
export async function summaries(env, ids, known) {
  const map = new Map();
  if (!ids.length) return map;
  const { results } = await env.DB.prepare(
    `SELECT id, username, name, display_name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  const v = known || await verification(env, results.map(r => r.id));
  for (const r of results) {
    const x = v.get(String(r.id)) || {};
    map.set(String(r.id), { ...summary(r), verified: !!x.verified, owner: !!x.owner });
  }
  return map;
}

function notSelf(a, b, message) {
  if (a === b) throw new HttpError(400, message);
}

const pairOf = (a, b) => [a, b].sort().join('|');

// Who follows and blocks whom between the viewer (v) and someone else (o).
async function relation(env, v, o) {
  const r = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS following,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS followed_by,
      EXISTS(SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?) AS blocking,
      EXISTS(SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?) AS blocked_by,
      COALESCE((SELECT followers_only FROM dm_settings WHERE user_id = ?), 0) AS followers_only`
  ).bind(v, o, o, v, v, o, o, v, o).first();
  const open = !r.blocking && !r.blocked_by;
  return {
    isFollowing: !!r.following,
    followsYou: !!r.followed_by,
    blockedByYou: !!r.blocking,
    // canMessage = nobody blocked anybody (also gates following); canDM adds their privacy setting.
    canMessage: open,
    canDM: open && (!r.followers_only || !!r.following),
    dmFollowersOnly: !!r.followers_only
  };
}

async function approvedPackCount(env, id) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM packs WHERE owner_id = ? AND status = 'approved'").bind(id).first();
  return (r && r.n) || 0;
}

async function counts(env, id) {
  const r = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers, (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following'
  ).bind(id, id).first();
  return { followers: r.followers || 0, following: r.following || 0 };
}

// ===== Profile: counts and the viewer's relation =====

export async function socialInfo(ctx, key) {
  const target = await requireAccount(ctx.env, key);
  const id = String(target.id);
  const viewer = await getUser(ctx);
  const v = viewer ? String(viewer.id) : null;
  const stats = (await verification(ctx.env, [id])).get(id);
  const out = {
    user: { ...summary(target), verified: !!stats.verified, owner: !!stats.owner },
    ...(await counts(ctx.env, id)),
    self: v === id,
    isFollowing: false, followsYou: false, blockedByYou: false, canMessage: false, canDM: false, dmFollowersOnly: false
  };
  out.packs = await approvedPackCount(ctx.env, id);
  out.downloads = stats.downloads || 0;
  // Your own progress toward the verified tick.
  if (out.self) {
    out.verification = {
      verified: !!stats.verified, owner: !!stats.owner,
      followers: stats.followers, downloads: stats.downloads, rating: stats.rating, ratings: stats.ratings,
      need: thresholds(ctx.env)
    };
  }
  if (v && v !== id) Object.assign(out, await relation(ctx.env, v, id));
  return json(out);
}

// ===== Follows =====

export async function setFollow(ctx, key, on) {
  const user = await requireUser(ctx);
  const target = await requireAccount(ctx.env, key);
  const v = String(user.id);
  const id = String(target.id);
  notSelf(v, id, "You can't follow yourself.");
  if (on) {
    const rel = await relation(ctx.env, v, id);
    if (!rel.canMessage) throw new HttpError(403, "You can't follow this account.");
    await ctx.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
      .bind(v, id, new Date().toISOString()).run();
    await notify(ctx.env, id, { type: 'follow', actorId: v, dedupe: `follow:${v}` });
  } else {
    await ctx.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(v, id).run();
  }
  return json({ isFollowing: on, ...(await counts(ctx.env, id)) });
}

export async function followList(ctx, key, which) {
  const target = await requireAccount(ctx.env, key);
  const [match, other] = which === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
  const { results } = await ctx.env.DB.prepare(
    `SELECT f.${other} AS id FROM follows f WHERE f.${match} = ? ORDER BY f.created_at DESC LIMIT ${LIST_LIMIT}`
  ).bind(String(target.id)).all();
  const ids = results.map(r => String(r.id));
  const people = await summaries(ctx.env, ids);
  return json({ users: ids.map(id => people.get(id)).filter(Boolean) });
}

// ===== Blocks =====

export async function setBlock(ctx, key, on) {
  const user = await requireUser(ctx);
  const target = await requireAccount(ctx.env, key);
  const v = String(user.id);
  const id = String(target.id);
  notSelf(v, id, "You can't block yourself.");
  if (on) {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(v, id, new Date().toISOString()),
      ctx.env.DB.prepare('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)').bind(v, id, id, v)
    ]);
  } else {
    await ctx.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(v, id).run();
  }
  return json({ blockedByYou: on, ...(await relation(ctx.env, v, id)) });
}

// ===== Avatars =====
// Custom avatars are stored as data URLs; serving them as images keeps
// follower lists and the inbox light.

export async function avatar(ctx, key) {
  const row = await ctx.env.DB.prepare('SELECT custom_avatar_url, avatar_url FROM users WHERE id = ?')
    .bind(decodeURIComponent(key)).first();
  const src = row && (row.custom_avatar_url || row.avatar_url);
  const cache = { 'Cache-Control': 'public, max-age=300' };
  const m = src && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (m) {
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': m[1], 'X-Content-Type-Options': 'nosniff', ...cache } });
  }
  if (src && /^https:\/\//.test(src)) return new Response(null, { status: 302, headers: { Location: src, ...cache } });
  return new Response(null, { status: 404, headers: cache });
}

// The profile banner, served the same way. The column name isn't fixed by this
// worker (the accounts worker owns the users table), so it is looked up once.
let bannerColumns = null;
export async function banner(ctx, key) {
  if (!bannerColumns) {
    const { results } = await ctx.env.DB.prepare('PRAGMA table_info(users)').all();
    bannerColumns = (results || []).map(c => c.name).filter(n => /^[a-z_]*banner[a-z_]*$/i.test(n));
  }
  const cache = { 'Cache-Control': 'public, max-age=300' };
  if (!bannerColumns.length) return new Response(null, { status: 404, headers: cache });
  const row = await ctx.env.DB.prepare(`SELECT ${bannerColumns.join(', ')} FROM users WHERE id = ?`)
    .bind(decodeURIComponent(key)).first();
  const src = row && bannerColumns.map(c => row[c]).find(v => v);
  const m = src && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (m) {
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': m[1], 'X-Content-Type-Options': 'nosniff', ...cache } });
  }
  if (src && /^https:\/\//.test(src)) return new Response(null, { status: 302, headers: { Location: src, ...cache } });
  return new Response(null, { status: 404, headers: cache });
}

// ===== Messages =====

export async function unreadCount(ctx) {
  const user = await requireUser(ctx);
  const r = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL')
    .bind(String(user.id)).first();
  return json({ unread: r.n || 0 });
}

// The viewer's conversations, newest first, with the last message of each.
export async function conversations(ctx) {
  const user = await requireUser(ctx);
  const v = String(user.id);
  const { results: last } = await ctx.env.DB.prepare(
    `SELECT m.* FROM messages m
     JOIN (SELECT MAX(id) AS id FROM messages WHERE sender_id = ? OR recipient_id = ? GROUP BY pair) t ON t.id = m.id
     ORDER BY m.id DESC LIMIT ${LIST_LIMIT}`
  ).bind(v, v).all();
  const { results: unreadRows } = await ctx.env.DB.prepare(
    'SELECT sender_id, COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL GROUP BY sender_id'
  ).bind(v).all();
  const unread = new Map(unreadRows.map(r => [String(r.sender_id), r.n]));
  const otherOf = (m) => (String(m.sender_id) === v ? String(m.recipient_id) : String(m.sender_id));
  const otherIds = [...new Set(last.map(otherOf))];
  const people = await summaries(ctx.env, otherIds);
  const creators = new Set();
  if (otherIds.length) {
    const { results: owners } = await ctx.env.DB.prepare(
      `SELECT DISTINCT owner_id FROM packs WHERE status = 'approved' AND owner_id IN (${otherIds.map(() => '?').join(',')})`
    ).bind(...otherIds).all();
    owners.forEach(r => creators.add(String(r.owner_id)));
  }
  return json({
    unread: unreadRows.reduce((n, r) => n + r.n, 0),
    conversations: last.map(m => {
      const o = otherOf(m);
      return {
        user: { ...(people.get(o) || { id: o, username: '', name: 'Deleted account', verified: false, owner: false }), creator: creators.has(o) || !!(people.get(o) && people.get(o).owner) },
        last: { text: clip(m.text, 120), mine: String(m.sender_id) === v, createdAt: m.created_at },
        unread: unread.get(o) || 0
      };
    })
  });
}

// One conversation (latest 100 messages). Opening it marks it read.
export async function thread(ctx, key) {
  const user = await requireUser(ctx);
  const other = await requireAccount(ctx.env, key);
  const v = String(user.id);
  const o = String(other.id);
  notSelf(v, o, "You can't message yourself.");
  const pair = pairOf(v, o);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, sender_id, text, created_at FROM messages WHERE pair = ? ORDER BY id DESC LIMIT 100'
  ).bind(pair).all();
  await ctx.env.DB.prepare('UPDATE messages SET read_at = ? WHERE pair = ? AND recipient_id = ? AND read_at IS NULL')
    .bind(new Date().toISOString(), pair, v).run();
  return json({
    user: (await summaries(ctx.env, [o])).get(o),
    ...(await relation(ctx.env, v, o)),
    messages: results.reverse().map(m => ({ id: m.id, mine: String(m.sender_id) === v, text: m.text, createdAt: m.created_at }))
  });
}

export async function sendMessage(ctx, key) {
  const user = await requireUser(ctx);
  const other = await requireAccount(ctx.env, key);
  const v = String(user.id);
  const o = String(other.id);
  notSelf(v, o, "You can't message yourself.");
  const body = await ctx.request.json().catch(() => null);
  const text = String((body && body.text) || '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new HttpError(400, 'Write a message first.');
  if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages can be up to ${MAX_MESSAGE} characters.`);
  const rel = await relation(ctx.env, v, o);
  if (!rel.canMessage) throw new HttpError(403, "You can't message this account.");
  if (!rel.canDM) throw new HttpError(403, 'This account only takes messages from people who follow them.');

  const since = new Date(Date.now() - SEND_WINDOW_MIN * 60000).toISOString();
  const recent = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ?')
    .bind(v, since).first();
  if ((recent.n || 0) >= SEND_LIMIT) throw new HttpError(429, "You're sending messages too fast. Wait a few minutes.");

  const now = new Date().toISOString();
  const res = await ctx.env.DB.prepare(
    'INSERT INTO messages (pair, sender_id, recipient_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(pairOf(v, o), v, o, text, now).run();
  return json({ message: { id: res.meta.last_row_id, mine: true, text, createdAt: now } });
}

// ===== Messaging privacy and the blocked list =====

export async function getDmSettings(ctx) {
  const user = await requireUser(ctx);
  const r = await ctx.env.DB.prepare('SELECT followers_only FROM dm_settings WHERE user_id = ?').bind(String(user.id)).first();
  return json({ followersOnly: !!(r && r.followers_only) });
}

export async function setDmSettings(ctx) {
  const user = await requireUser(ctx);
  const body = await ctx.request.json().catch(() => null);
  const on = !!(body && body.followersOnly);
  await ctx.env.DB.prepare(
    'INSERT INTO dm_settings (user_id, followers_only) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET followers_only = excluded.followers_only'
  ).bind(String(user.id), on ? 1 : 0).run();
  return json({ followersOnly: on });
}

export async function blockedList(ctx) {
  const user = await requireUser(ctx);
  const { results } = await ctx.env.DB.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ? ORDER BY created_at DESC LIMIT 200')
    .bind(String(user.id)).all();
  const ids = results.map(r => String(r.blocked_id));
  const people = await summaries(ctx.env, ids);
  return json({ users: ids.map(id => people.get(id)).filter(Boolean) });
}
