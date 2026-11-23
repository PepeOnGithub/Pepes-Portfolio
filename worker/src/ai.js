// Automatic review of community uploads and creator profiles.
//
// Uploads:
//   1. scan.js opens the archive. Hard blockers (programs, content.zipe, hidden
//      archives, scripts inside resource packs, webhooks, eval, network ...)
//      reject immediately, no AI involved.
//   2. A fast Gemini model reviews everything it can see. Only "approve" moves on.
//   3. A stronger model, told to think like an attacker, audits it again.
//      Approved only if BOTH approve with enough confidence.
//   4. The result is applied straight away: live, or rejected with a reason the
//      creator can read and fix. If Gemini is unreachable the upload waits and a
//      cron job retries it.
// Profiles: bio, links and videos are checked item by item; what passes is
// published, the rest is removed with an explanation.

import { notifyReview } from './notifications.js';
import { scanVersions } from './scan.js';
import { textProblems } from './scan.js';
import { isOwnerOrAdminId, clip, safeJson } from './util.js';
import { ensureLootForVersion } from './loot.js';
import {
  REVIEWER_PROMPT, REDTEAM_PROMPT, PROFILE_PROMPT, RESPONSE_SCHEMA, PROFILE_SCHEMA
} from './knowledge.js';

const MIN_APPROVE_CONFIDENCE = 0.7;
const MAX_AI_RUNS = 8;
const IMPERSONATION = /\b(pepe'?s?|glacier|mojang|microsoft|xbox|minecraft\s+(?:official|marketplace)|official|realms|hive\s*games|cubecraft|lifeboat)\b/i;

// ===== Uploads =====

export async function runAiReview(env, packId, { force = false } = {}) {
  const pack = await env.DB.prepare('SELECT * FROM packs WHERE id = ?').bind(packId).first();
  if (!pack) return;
  const { results: versions } = await env.DB
    .prepare("SELECT * FROM versions WHERE pack_id = ? AND status = 'pending' ORDER BY created_at DESC, id DESC")
    .bind(packId).all();
  const todo = force ? versions : versions.filter(v => !v.ai_verdict || v.ai_verdict === 'error' || v.ai_verdict === 'skipped');
  const packPending = pack.status === 'pending' && (force || !pack.ai_verdict || pack.ai_verdict === 'error' || pack.ai_verdict === 'skipped');
  if (!packPending && !todo.length) return;
  if ((pack.ai_runs || 0) >= MAX_AI_RUNS && !force) return;

  await env.DB.prepare('UPDATE packs SET ai_runs = ai_runs + 1 WHERE id = ?').bind(packId).run();
  const targets = todo.length ? todo : (packPending ? versions : []);

  try {
    const owner = pack.owner_id;
    const ownerIsAdmin = await isOwnerOrAdminId(env, owner);

    // ---- 1. Fixed rules ----
    const blockers = [];
    const tags = safeJson(pack.tags, []);
    const wording = textProblems([pack.name, pack.description, ...tags, ...targets.map(v => v.changelog || '')].join('\n'));
    if (wording.length) blockers.push(`The name or description ${wording.join(' and ')}.`);
    if (!ownerIsAdmin && IMPERSONATION.test(pack.name)) {
      blockers.push('The pack name uses a protected name (Pepe, Glacier, Mojang, Microsoft, "official" ...), which could make people think it comes from them.');
    }
    const reports = await scanVersions(env, targets);
    for (const r of reports) blockers.push(...r.blockers.map(b => `v${r.version}: ${b}`));

    if (blockers.length) {
      await decide(env, pack, targets, {
        verdict: 'reject', confidence: 1, category: 'malware_risk',
        summary: blockers.slice(0, 3).join(' '),
        issues: blockers.slice(0, 10),
        uploaderMessage: `${blockers[0]} Please fix this and upload again.`
      });
      return;
    }

    // ---- 2 and 3. The models ----
    if (!env.GEMINI_API_KEY) {
      await markOnly(env, pack, targets, 'skipped', 'The AI reviewer is not set up (no GEMINI_API_KEY), so this waits for a person.');
      return;
    }

    const parts = await buildParts(env, pack, reports, ownerIsAdmin);
    const first = await askModel(env, env.GEMINI_MODEL || 'gemini-flash-lite-latest', REVIEWER_PROMPT, parts);
    let final = first;
    if (first.verdict === 'approve' && first.confidence >= MIN_APPROVE_CONFIDENCE) {
      const second = await askModel(env, env.GEMINI_MODEL_STRICT || 'gemini-flash-latest', REDTEAM_PROMPT, parts);
      if (second.verdict === 'approve' && second.confidence >= MIN_APPROVE_CONFIDENCE) {
        final = {
          verdict: 'approve',
          confidence: Math.min(first.confidence, second.confidence),
          category: 'clean',
          summary: `${first.summary} Second check agreed.`.trim(),
          issues: [...new Set([...(first.issues || []), ...(second.issues || [])])],
          uploaderMessage: ''
        };
      } else {
        final = {
          ...second,
          verdict: 'reject',
          summary: `Passed the first review but the security audit declined it: ${second.summary}`,
          uploaderMessage: second.uploaderMessage || second.summary
        };
      }
    } else if (first.verdict === 'approve') {
      final = {
        ...first, verdict: 'reject', category: 'unverifiable',
        summary: `The reviewer was not confident enough to approve (${Math.round(first.confidence * 100)}%). ${first.summary}`,
        uploaderMessage: first.uploaderMessage || "The automatic check couldn't be sure this pack is safe. Please make sure the files are readable, nothing is hidden or unusual, and the description matches the content, then upload again."
      };
    }

    // Signals the scan raised are always shown to the site owner with the verdict.
    final.issues = [...reports.flatMap(r => r.signals.slice(0, 6).map(s => `Scan: ${s}`)), ...(final.issues || [])].slice(0, 14);
    await decide(env, pack, targets, final);
  } catch (err) {
    console.error('AI review failed', err);
    await markOnly(env, pack, targets, 'error', `The automatic check hit a problem and will retry: ${clip(String(err && err.message || err), 240)}`);
  }
}

async function buildParts(env, pack, reports, ownerIsAdmin) {
  const submission = {
    pack: {
      name: pack.name,
      category: pack.category,
      description: pack.description,
      tags: safeJson(pack.tags, []),
      uploader: pack.owner_name,
      uploaderIsSiteOwner: ownerIsAdmin,
      showcaseVideo: pack.showcase_url || null,
      isAlreadyLive: pack.status === 'approved'
    },
    versionsToReview: reports.map(r => ({
      version: r.version,
      fileName: r.fileName,
      changelog: r.changelog,
      fileCount: r.stats.files,
      scriptFiles: r.stats.scripts,
      manifests: r.manifests,
      automaticScanWarnings: r.signals,
      files: r.entries
    }))
  };
  const parts = [{ text: `Review this upload. Submitted data (JSON):\n${JSON.stringify(submission, null, 1)}` }];
  for (const r of reports) {
    for (const t of r.texts) parts.push({ text: `--- v${r.version} file: ${t.name} ---\n${t.text}` });
  }
  if (!reports.length) parts.push({ text: 'Only the name, description, tags, video or icon changed; there are no new files.' });
  if (pack.icon_key) {
    const icon = await env.FILES.get(pack.icon_key);
    if (icon) {
      const mime = (icon.httpMetadata && icon.httpMetadata.contentType) || 'image/png';
      parts.push({ text: 'The pack icon (check it for inappropriate or misleading imagery):' });
      parts.push({ inlineData: { mimeType: mime, data: toBase64(new Uint8Array(await icon.arrayBuffer())) } });
    }
  }
  return parts;
}

async function askModel(env, model, system, parts) {
  const data = await callGemini(env, { model, system, parts, schema: RESPONSE_SCHEMA });
  if (!data || !['approve', 'reject'].includes(data.verdict)) throw new Error('Gemini gave an answer the site could not read.');
  return {
    verdict: data.verdict,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    category: data.category || (data.verdict === 'approve' ? 'clean' : 'unverifiable'),
    summary: clip(data.summary, 600),
    issues: Array.isArray(data.issues) ? data.issues.map(i => clip(i, 300)).slice(0, 10) : [],
    uploaderMessage: clip(data.uploaderMessage, 480)
  };
}

export async function callGemini(env, { model, system, parts, schema, timeoutMs = 40000 }) {
  const base = env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema }
      })
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Gemini returned ${res.status}`);
  const cand = data && data.candidates && data.candidates[0];
  if (!cand || !cand.content) {
    const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'no answer';
    throw new Error(`Gemini gave no answer (${why}).`);
  }
  return safeJson((cand.content.parts || []).map(p => p.text || '').join(''), null);
}

// ===== Applying a decision =====

async function decide(env, pack, versions, d) {
  const approve = d.verdict === 'approve';
  if (approve && env.AI_AUTO_APPROVE === '0') return markOnly(env, pack, versions, 'approve', d.summary, d);
  if (!approve && env.AI_AUTO_REJECT === '0') return markOnly(env, pack, versions, 'reject', d.summary, d);

  const now = new Date().toISOString();
  const note = approve ? null : clip(`Automatic review: ${d.uploaderMessage || d.summary}`, 500);
  const stmts = [
    env.DB.prepare(
      'UPDATE packs SET ai_verdict = ?, ai_confidence = ?, ai_summary = ?, ai_issues = ?, ai_checked_at = ?, updated_at = ? WHERE id = ?'
    ).bind(d.verdict, d.confidence, d.summary || '', JSON.stringify(d.issues || []), now, now, pack.id)
  ];
  if (pack.status === 'pending') {
    stmts.push(env.DB.prepare('UPDATE packs SET status = ?, review_note = ? WHERE id = ?').bind(approve ? 'approved' : 'rejected', note, pack.id));
  }
  for (const v of versions) {
    stmts.push(env.DB.prepare('UPDATE versions SET status = ?, review_note = ?, ai_verdict = ? WHERE id = ?')
      .bind(approve ? 'approved' : 'rejected', note, d.verdict, v.id));
  }
  await env.DB.batch(stmts);
  if (pack.status === 'pending' || versions.length) {
    await notifyReview(env, pack, approve, note, { first: approve && pack.status === 'pending' });
  }

  if (approve) {
    for (const v of versions) await ensureLootForVersion(env, v.id).catch(e => console.error('loot link failed', e));
  }
}

// Records the AI's answer without changing the pack's state (errors, or auto-decisions switched off).
async function markOnly(env, pack, versions, verdict, summary, d = {}) {
  const stmts = [
    env.DB.prepare('UPDATE packs SET ai_verdict = ?, ai_confidence = ?, ai_summary = ?, ai_issues = ?, ai_checked_at = ? WHERE id = ?')
      .bind(verdict, d.confidence || 0, summary || '', JSON.stringify(d.issues || []), new Date().toISOString(), pack.id)
  ];
  for (const v of versions) stmts.push(env.DB.prepare('UPDATE versions SET ai_verdict = ? WHERE id = ?').bind(verdict, v.id));
  await env.DB.batch(stmts);
}

// ===== Creator profiles =====

export async function reviewProfile(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM creators WHERE user_id = ?').bind(String(userId)).first();
  if (!row || row.profile_status !== 'pending') return;
  const draft = safeJson(row.draft_json, null) || { bio: '', socials: [], videos: [] };
  const now = new Date().toISOString();

  // Nothing to publish: clear it.
  if (!draft.bio && !draft.socials.length && !draft.videos.length) {
    await env.DB.prepare("UPDATE creators SET public_json = ?, profile_status = 'approved', profile_note = NULL, updated_at = ? WHERE user_id = ?")
      .bind(JSON.stringify({ bio: '', socials: [], videos: [] }), now, row.user_id).run();
    return;
  }
  if (!env.GEMINI_API_KEY) return; // stays pending; cron retries once a key exists

  try {
    const removed = [];
    const ok = { bio: draft.bio || '', socials: [], videos: [] };

    // Deterministic checks first.
    const bioProblems = textProblems(draft.bio || '');
    if (bioProblems.length) {
      removed.push(`Bio ${bioProblems.join(' and ')}.`);
      ok.bio = '';
    }
    if (draft.bio && IMPERSONATION.test(draft.bio) && !(await isOwnerOrAdminId(env, row.user_id))) {
      removed.push('Bio mentions a protected name (Pepe, Glacier, Mojang, Microsoft, "official" ...).');
      ok.bio = '';
    }

    const socials = [];
    for (const s of draft.socials) {
      const info = { url: s.url, type: s.type };
      if (s.type === 'discord') Object.assign(info, await discordInfo(env, s.url));
      const problems = textProblems(s.url);
      if (problems.length) { removed.push(`${s.url}: ${problems.join(' and ')}.`); continue; }
      if (s.type === 'discord' && info.valid === false) { removed.push(`${s.url}: this Discord invite is expired or doesn't exist.`); continue; }
      if (s.type === 'discord' && info.nsfw) { removed.push(`${s.url}: this Discord server is marked age-restricted.`); continue; }
      socials.push(info);
    }
    const videos = [];
    for (const id of draft.videos) {
      const info = await youtubeInfo(env, id);
      if (!info.valid) { removed.push(`Video ${id}: it's private, removed or doesn't exist.`); continue; }
      videos.push(info);
    }

    let summary = 'Nothing to review beyond fixed checks.';
    let message = '';
    if (ok.bio || socials.length || videos.length) {
      const data = await callGemini(env, {
        model: env.GEMINI_MODEL || 'gemini-flash-lite-latest',
        system: PROFILE_PROMPT,
        schema: PROFILE_SCHEMA,
        parts: [{
          text: `Review this creator profile. Creator: ${row.username || 'unnamed'}\nData (JSON):\n${JSON.stringify({ bio: ok.bio, links: socials, videos }, null, 1)}`
        }]
      });
      if (!data) throw new Error('Gemini gave an answer the site could not read.');
      summary = clip(data.summary, 300);
      message = clip(data.uploaderMessage, 400);
      if (data.bio === 'reject' && ok.bio) { removed.push(`Bio: ${message || 'it breaks the profile rules.'}`); ok.bio = ''; }
      const linkVerdict = new Map((data.links || []).map(l => [String(l.url), l]));
      for (const s of socials) {
        const v = linkVerdict.get(String(s.url));
        if (v && v.decision === 'reject') removed.push(`${s.url}: ${clip(v.reason, 160) || 'not allowed.'}`);
        else ok.socials.push(publicLink(s));
      }
      const videoVerdict = new Map((data.videos || []).map(v => [String(v.id), v]));
      for (const v of videos) {
        const d = videoVerdict.get(String(v.id));
        if (d && d.decision === 'reject') removed.push(`Video "${clip(v.title, 60)}": ${clip(d.reason, 160) || 'not allowed.'}`);
        else ok.videos.push({ id: v.id, title: v.title, author: v.author });
      }
    }

    const note = removed.length ? `Some items were removed: ${removed.join(' ')}` : null;
    await env.DB.prepare("UPDATE creators SET public_json = ?, profile_status = 'approved', profile_note = ?, profile_ai = ?, updated_at = ? WHERE user_id = ?")
      .bind(JSON.stringify(ok), note ? clip(note, 900) : null, summary, now, row.user_id).run();
  } catch (err) {
    console.error('profile review failed', err);
    // Stays pending; the cron job tries again.
  }
}

function publicLink(s) {
  const out = { type: s.type, url: s.url };
  if (s.name) out.label = s.name;
  if (s.members) out.members = s.members;
  return out;
}

async function discordInfo(env, url) {
  const code = (String(url).match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/i) || [])[1];
  if (!code) return { valid: false };
  try {
    const base = env.DISCORD_API_BASE || 'https://discord.com/api/v10';
    const res = await fetch(`${base}/invites/${code}?with_counts=true`, { headers: { 'User-Agent': 'PepesPortfolioReview/1.0' } });
    if (res.status === 404) return { valid: false };
    if (!res.ok) return { valid: null }; // couldn't check; the AI judges what it can see
    const d = await res.json();
    const g = d.guild || {};
    return {
      valid: true,
      name: clip(g.name, 80),
      description: clip(g.description, 200),
      members: d.approximate_member_count || 0,
      nsfw: !!g.nsfw || g.nsfw_level === 3
    };
  } catch (e) {
    return { valid: null };
  }
}

async function youtubeInfo(env, id) {
  try {
    const base = env.YOUTUBE_OEMBED_BASE || 'https://www.youtube.com/oembed';
    const res = await fetch(`${base}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
    if (!res.ok) return { id, valid: false };
    const d = await res.json();
    return { id, valid: true, title: clip(d.title, 120), author: clip(d.author_name, 80) };
  } catch (e) {
    return { id, valid: true, title: '', author: '' }; // couldn't check; don't punish the creator
  }
}

// ===== Cron =====

export async function retryStuck(env) {
  const cutoff = new Date(Date.now() - Number(env.RETRY_AFTER_SECONDS ?? 90) * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.id FROM packs p
     LEFT JOIN versions v ON v.pack_id = p.id AND v.status = 'pending'
     WHERE (p.status = 'pending' OR v.id IS NOT NULL)
       AND (p.ai_verdict IS NULL OR p.ai_verdict IN ('error', 'skipped') OR v.ai_verdict IS NULL OR v.ai_verdict IN ('error', 'skipped'))
       AND COALESCE(p.ai_runs, 0) < ? AND p.updated_at < ? LIMIT 15`
  ).bind(MAX_AI_RUNS, cutoff).all();
  for (const row of results) await runAiReview(env, row.id).catch(e => console.error('retry failed', e));

  const { results: profiles } = await env.DB.prepare(
    "SELECT user_id FROM creators WHERE profile_status = 'pending' AND updated_at < ? LIMIT 15"
  ).bind(cutoff).all();
  for (const row of profiles) await reviewProfile(env, row.user_id).catch(e => console.error('profile retry failed', e));
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
