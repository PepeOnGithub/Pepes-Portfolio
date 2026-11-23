// Verified creators.
//
// A creator earns the verified tick (the same one the site owner has) when
// ALL of these are true:
//   - followers        >= VERIFY_FOLLOWERS
//   - downloads        >= VERIFY_DOWNLOADS     (all their live packs together)
//   - average rating   >= VERIFY_RATING        (across all ratings on their live packs)
//   - number of ratings >= VERIFY_MIN_RATINGS  (so a single 5-star can't qualify)
// The numbers are set in wrangler.toml [vars]; the defaults are below. The
// tick is worked out on every request from the live counts, so it appears as
// soon as the numbers are met and goes away if they drop.
//
// The site owner always has the tick.

import { ownerId } from './util.js';

const DEFAULTS = { followers: 50, downloads: 1000, rating: 4, ratings: 5 };
const CHUNK = 90; // D1 allows up to 100 bound values per query

export function thresholds(env) {
  const num = (v, d) => (v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    followers: num(env.VERIFY_FOLLOWERS, DEFAULTS.followers),
    downloads: num(env.VERIFY_DOWNLOADS, DEFAULTS.downloads),
    rating: num(env.VERIFY_RATING, DEFAULTS.rating),
    ratings: num(env.VERIFY_MIN_RATINGS, DEFAULTS.ratings)
  };
}

// Map of user id -> { verified, owner, followers, downloads, rating, ratings }
// (plus a private `avg`, the unrounded rating the check uses).
export async function verification(env, userIds) {
  const ids = [...new Set((userIds || []).filter(id => id != null && id !== '').map(String))];
  const out = new Map(ids.map(id => [id, { followers: 0, downloads: 0, rating: 0, ratings: 0 }]));
  if (!ids.length) return out;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const marks = part.map(() => '?').join(',');
    const [followers, downloads, ratings] = await Promise.all([
      env.DB.prepare(`SELECT followee_id AS id, COUNT(*) AS n FROM follows WHERE followee_id IN (${marks}) GROUP BY followee_id`)
        .bind(...part).all().catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT p.owner_id AS id, SUM(s.downloads) AS n FROM stats_daily s JOIN packs p ON p.id = s.pack_id
         WHERE p.owner_id IN (${marks}) AND p.status = 'approved' AND s.version_id > 0 GROUP BY p.owner_id`
      ).bind(...part).all().catch(() => ({ results: [] })),
      // Ratings live in the accounts worker's table, keyed by the pack's slug.
      env.DB.prepare(
        `SELECT p.owner_id AS id, COUNT(*) AS n, AVG(r.rating) AS avg FROM ratings r JOIN packs p ON p.slug = r.pack_id
         WHERE p.owner_id IN (${marks}) AND p.status = 'approved' GROUP BY p.owner_id`
      ).bind(...part).all().catch(() => ({ results: [] }))
    ]);
    for (const r of followers.results) out.get(String(r.id)).followers = r.n || 0;
    for (const r of downloads.results) out.get(String(r.id)).downloads = r.n || 0;
    for (const r of ratings.results) {
      const v = out.get(String(r.id));
      v.ratings = r.n || 0;
      v.avg = r.avg || 0; // exact, for the check; `rating` is rounded for display
      v.rating = r.avg ? Math.round(r.avg * 10) / 10 : 0;
    }
  }

  const t = thresholds(env);
  const owner = await ownerId(env);
  for (const [id, v] of out) {
    v.owner = owner != null && id === owner;
    v.verified = v.owner
      || (v.followers >= t.followers && v.downloads >= t.downloads && v.ratings >= t.ratings && (v.avg || 0) >= t.rating);
  }
  return out;
}
