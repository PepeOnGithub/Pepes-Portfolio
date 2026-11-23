// In-site notifications: new followers, your pack going live or being turned down,
// and new packs from creators you follow. (Messages have their own unread count.)
//
// Rows are written by notify() / notifyFollowers() from the places the events
// happen (follows, the automatic reviewer, the owner's review override). Failures
// here never break the action that caused them.

import { json, requireUser, clip } from './util.js';
import { summaries } from './social.js';

const LIST_LIMIT = 50;
const KEEP_DAYS = 90;
const FANOUT_LIMIT = 500;

export async function notify(env, userId, n) {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (user_id, type, actor_id, pack_slug, pack_name, note, dedupe, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(String(userId), n.type, n.actorId ? String(n.actorId) : null, n.packSlug || null, n.packName || null,
      n.note ? clip(n.note, 300) : null, n.dedupe, new Date().toISOString()).run();
  } catch (e) {
    console.error('notify failed', e);
  }
}

// One "published a new pack" row for each follower of the creator (capped).
export async function notifyFollowers(env, creatorId, pack) {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (user_id, type, actor_id, pack_slug, pack_name, dedupe, created_at)
       SELECT follower_id, 'new_pack', ?, ?, ?, 'new_pack:' || ?, ? FROM follows WHERE followee_id = ? LIMIT ${FANOUT_LIMIT}`
    ).bind(String(creatorId), pack.slug, pack.name, pack.slug, new Date().toISOString(), String(creatorId)).run();
  } catch (e) {
    console.error('notifyFollowers failed', e);
  }
}

// Your pack was approved or rejected (and, the first time, tell followers).
export async function notifyReview(env, pack, approved, note, { first = false } = {}) {
  await notify(env, pack.owner_id, {
    type: approved ? 'pack_approved' : 'pack_rejected',
    packSlug: pack.slug, packName: pack.name, note: approved ? null : note,
    dedupe: `${approved ? 'approved' : 'rejected'}:${pack.id}:${Date.now()}`
  });
  if (approved && first) await notifyFollowers(env, pack.owner_id, pack);
}

export async function listNotifications(ctx) {
  const user = await requireUser(ctx);
  const v = String(user.id);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  await ctx.env.DB.prepare('DELETE FROM notifications WHERE user_id = ? AND created_at < ?').bind(v, cutoff).run();
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, type, actor_id, pack_slug, pack_name, note, created_at, read_at FROM notifications
     WHERE user_id = ? ORDER BY id DESC LIMIT ${LIST_LIMIT}`
  ).bind(v).all();
  const actors = await summaries(ctx.env, [...new Set(results.map(r => r.actor_id).filter(Boolean))]);
  const unread = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(v).first();
  return json({
    unread: (unread && unread.n) || 0,
    notifications: results.map(r => ({
      id: r.id, type: r.type, packSlug: r.pack_slug, packName: r.pack_name, note: r.note,
      createdAt: r.created_at, read: !!r.read_at,
      actor: r.actor_id ? (actors.get(r.actor_id) || { id: r.actor_id, username: '', name: 'Someone', verified: false, owner: false }) : null
    }))
  });
}

export async function notificationsUnread(ctx) {
  const user = await requireUser(ctx);
  const r = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .bind(String(user.id)).first();
  return json({ unread: (r && r.n) || 0 });
}

export async function markNotificationsRead(ctx) {
  const user = await requireUser(ctx);
  await ctx.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .bind(new Date().toISOString(), String(user.id)).run();
  return json({ unread: 0 });
}
