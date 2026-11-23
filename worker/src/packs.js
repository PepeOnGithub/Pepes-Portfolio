// Turns database rows into the pack objects the site's library renders
// (same shape as an entry in packs.json).

import { ID_OFFSET, encodeKey, safeJson, usesSiteEarnings } from './util.js';

export async function versionsFor(ctx, packIds, extraWhere) {
  const map = new Map();
  if (!packIds.length) return map;
  const marks = packIds.map(() => '?').join(',');
  const { results } = await ctx.env.DB
    .prepare(`SELECT * FROM versions WHERE pack_id IN (${marks}) ${extraWhere} ORDER BY created_at DESC, id DESC`)
    .bind(...packIds)
    .all();
  for (const v of results) {
    if (!map.has(v.pack_id)) map.set(v.pack_id, []);
    map.get(v.pack_id).push(v);
  }
  return map;
}

// Creator settings (Linkvertise id) and download totals for a set of packs.
export async function packExtras(ctx, packRows) {
  const extras = { creators: new Map(), downloads: new Map(), siteEarners: new Set() };
  if (!packRows.length) return extras;

  const owners = [...new Set(packRows.map(p => p.owner_id))];
  const { results: creators } = await ctx.env.DB
    .prepare(`SELECT user_id, linkvertise_id, loot_token IS NOT NULL AS has_loot FROM creators WHERE user_id IN (${owners.map(() => '?').join(',')})`)
    .bind(...owners).all();
  for (const c of creators) extras.creators.set(c.user_id, c);
  // The site owner's packs, and packs of creators without their own
  // accounts, earn through the site's own Linkvertise account.
  if (ctx.env.OWNER_LINKVERTISE_ID) {
    for (const id of owners) {
      if (await usesSiteEarnings(ctx.env, id, extras.creators.get(id) || null)) extras.siteEarners.add(id);
    }
  }

  const ids = packRows.map(p => p.id);
  const { results: dl } = await ctx.env.DB
    .prepare(`SELECT pack_id, version_id, SUM(downloads) AS n FROM stats_daily WHERE version_id > 0 AND pack_id IN (${ids.map(() => '?').join(',')}) GROUP BY pack_id, version_id`)
    .bind(...ids).all();
  for (const r of dl) {
    if (!extras.downloads.has(r.pack_id)) extras.downloads.set(r.pack_id, { total: 0, byVersion: new Map() });
    const e = extras.downloads.get(r.pack_id);
    e.total += r.n;
    e.byVersion.set(r.version_id, r.n);
  }
  return extras;
}

export function toSitePack(ctx, row, versionRows, { withStatus = false, withAi = false, extras = null } = {}) {
  const dl = (extras && extras.downloads.get(row.id)) || { total: 0, byVersion: new Map() };
  const creator = extras && extras.creators.get(row.owner_id);
  const versions = versionRows.map(v => {
    const out = {
      id: v.id,
      version: v.version,
      fileName: v.file_name,
      size: formatSize(v.size),
      downloadUrl: `${ctx.origin}/files/${encodeKey(v.file_key)}`,
      // Generated for the creator automatically once the version is live.
      lootUrl: v.loot_url || '',
      downloads: dl.byVersion.get(v.id) || 0,
      date: v.created_at.slice(0, 10),
      changelog: v.changelog
    };
    if (withStatus) {
      out.status = v.status;
      out.reviewNote = v.review_note || '';
    }
    if (withAi) out.aiVerdict = v.ai_verdict || null;
    return out;
  });
  const latest = versions[0] || {};
  const pack = {
    id: ID_OFFSET + row.id,
    community: true,
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    tags: safeJson(row.tags, []),
    author: row.owner_name,
    authorId: row.owner_id,
    thumbnail: row.icon_key ? `${ctx.origin}/files/${encodeKey(row.icon_key)}` : '',
    version: latest.version || '',
    size: latest.size || '',
    fileName: latest.fileName || '',
    downloadUrl: latest.downloadUrl || '',
    versions,
    downloads: dl.total,
    addedAt: row.created_at,
    updatedAt: (versionRows[0] && versionRows[0].created_at > row.updated_at) ? versionRows[0].created_at : row.updated_at,
    // The creator's Linkvertise account; the site builds the link per download.
    linkvertiseId: (creator && creator.linkvertise_id)
      || (extras && extras.siteEarners.has(row.owner_id) ? String(ctx.env.OWNER_LINKVERTISE_ID) : ''),
    showcaseUrl: row.showcase_url || ''
  };
  if (withStatus) {
    pack.status = row.status;
    pack.reviewNote = row.review_note || '';
    // True until the automatic check has an answer.
    pack.checking = (row.status === 'pending' && (!row.ai_verdict || ['error', 'skipped'].includes(row.ai_verdict)))
      || versionRows.some(v => v.status === 'pending' && (!v.ai_verdict || ['error', 'skipped'].includes(v.ai_verdict)));
    pack.aiRuns = row.ai_runs || 0;
  }
  if (withAi) {
    pack.ai = row.ai_checked_at ? {
      verdict: row.ai_verdict,
      confidence: row.ai_confidence,
      summary: row.ai_summary || '',
      issues: safeJson(row.ai_issues, []),
      checkedAt: row.ai_checked_at
    } : null;
  }
  return pack;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
