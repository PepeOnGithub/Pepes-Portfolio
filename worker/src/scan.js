// Fixed (non-AI) inspection of an uploaded pack.
//
// Opens the archive, walks every file and reports:
//   blockers - things that are never acceptable. The pack is rejected on the
//              spot, no AI involved.
//   signals  - things that deserve a close look. They are handed to the AI.
//
// The rules come from how real malicious packs behave, including the hidden
// script problem the Glacier team warned about (a file called content.zipe and
// scripts hidden inside resource packs).

import { unzipSync, strFromU8, decompressSync } from 'fflate';
import { clip } from './util.js';

const MAX_UNZIPPED_BYTES = 150 * 1024 * 1024;
const MAX_FILES = 6000;
const MAX_DEPTH = 3;
const TEXT_BUDGET = 70000;

const EXECUTABLE_EXT = new Set([
  'exe', 'dll', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'wsf', 'wsh', 'scr', 'msi', 'msix', 'msp', 'jar', 'class',
  'sh', 'bash', 'zsh', 'com', 'apk', 'aab', 'ipa', 'lnk', 'hta', 'reg', 'sys', 'cpl', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  'so', 'dylib', 'bin.exe', 'pif', 'gadget', 'inf', 'scf', 'url', 'jse', 'chm', 'dat.exe',
  // the hidden-payload marker from the Glacier security alert, and look-alikes
  'zipe', 'zipx', 'zip2', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso'
]);
const ARCHIVE_EXT = new Set(['mcpack', 'mcaddon', 'zip', 'mcworld', 'mctemplate']);
const SCRIPT_EXT = new Set(['js', 'mjs', 'cjs', 'ts']);
const TEXT_EXT = new Set(['json', 'lang', 'js', 'mjs', 'cjs', 'ts', 'mcfunction', 'txt', 'md', 'material', 'properties', 'mcmeta', 'fragment', 'vertex', 'geometry', 'shaderdef', 'toml', 'yml', 'yaml', 'csv', 'html', 'htm', 'xml', 'svg']);
// Normal things found in packs, addons, templates and worlds.
const KNOWN_EXT = new Set([
  ...TEXT_EXT, 'png', 'tga', 'jpg', 'jpeg', 'ogg', 'wav', 'mp3', 'fsb', 'mcstructure', 'nbt', 'bin', 'ttf', 'otf',
  'brarchive', 'ldb', 'log', 'dat', 'dat_old', 'psd', 'ico', 'webp', 'gif', 'ase', 'aseprite', 'blend', 'bbmodel', 'pdn', 'xcf', 'ics',
  ...ARCHIVE_EXT
]);
// World files have no extension (CURRENT, LOCK, MANIFEST-000004, LOG, level.dat ...).
const WORLD_FILES = /(^|\/)(db\/|level\.dat|levelname\.txt|world_icon\.jpeg|world_behavior_packs\.json|world_resource_packs\.json|world_behavior_pack_history\.json|world_resource_pack_history\.json)/i;

const BAD_HOSTS = /(discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com|api\.telegram\.org\/bot|webhook\.site|requestbin|pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev)|grabify|iplogger|2no\.co|yip\.su|ps3cfw|blasze|leakix|ipgrabber|ip-?tracker|stealer|pastebin\.com\/raw|raw\.githubusercontent\.com\/[^\s'"]*(?:payload|loader|stage))/i;
const SHORTENERS = /(?:^|[^a-z0-9.-])(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|is\.gd|rebrand\.ly|shorturl\.at|adf\.ly|ouo\.io|shrinkme|exe\.io|clk\.sh|link-to\.net|linkvertise\.com|loot-link|lootlinks?\.|lootdest|work\.ink|boost\.ink|mboost\.me|sub2unlock|rekonise\.com|bc\.vc|tiny\.cc|v\.gd)/i;

export const BLOCKED_EXTENSIONS_LABEL = [...EXECUTABLE_EXT].slice(0, 30).map(e => `.${e}`).join(', ');

// ===== Entry point =====

// versions: rows from the versions table. Returns one report per version.
export async function scanVersions(env, versions) {
  const reports = [];
  for (const v of versions) reports.push(await scanVersion(env, v));
  return reports;
}

async function scanVersion(env, version) {
  const report = {
    version: version.version,
    fileName: version.file_name,
    changelog: version.changelog || '',
    blockers: [],
    signals: [],
    manifests: [],
    entries: [],
    texts: [],
    stats: { files: 0, scripts: 0, unzippedBytes: 0 }
  };
  const obj = await env.FILES.get(version.file_key);
  if (!obj) {
    report.blockers.push('The uploaded file is missing from storage.');
    return report;
  }
  const raw = new Uint8Array(await obj.arrayBuffer());
  const name = version.file_name || '';

  if (/\.brarchive$/i.test(name)) {
    scanBrarchive(report, name, raw);
    return report;
  }

  let files;
  try {
    files = expand(raw, name, 0, report);
  } catch (e) {
    report.blockers.push(`The archive can't be opened or checked (${e.message}). Encrypted, damaged or oversized archives can't be reviewed.`);
    return report;
  }
  analyse(report, files);
  return report;
}

// ===== Opening archives =====

function unzipSafe(bytes, report) {
  let total = 0;
  let count = 0;
  const tree = unzipSync(bytes, {
    filter(file) {
      total += file.originalSize;
      count++;
      if (total > MAX_UNZIPPED_BYTES) throw new Error('it unpacks to more than 150 MB');
      if (count > MAX_FILES) throw new Error(`it holds more than ${MAX_FILES} files`);
      return true;
    }
  });
  report.stats.unzippedBytes += total;
  return tree;
}

// Returns [path, bytes][] with nested packs expanded in place (".mcaddon/Pack.mcpack/manifest.json").
function expand(bytes, label, depth, report) {
  if (depth > MAX_DEPTH) {
    report.blockers.push('Archives are nested more than three levels deep, which hides what is inside.');
    return [];
  }
  if (!isZip(bytes)) throw new Error('not a zip archive');
  const tree = unzipSafe(bytes, report);
  const out = [];
  for (const [path, data] of Object.entries(tree)) {
    const ext = extOf(path);
    if (!path.endsWith('/') && ARCHIVE_EXT.has(ext) && isZip(data) && depth < MAX_DEPTH) {
      let inner = [];
      try {
        inner = expand(data, path, depth + 1, report);
      } catch (e) {
        report.blockers.push(`${path} is inside the archive but can't be opened.`);
      }
      // Keep the archive entry itself so extension rules still see it.
      out.push([path, new Uint8Array(0), true]);
      for (const [innerPath, innerData] of inner) out.push([`${path}/${innerPath}`, innerData]);
    } else {
      out.push([path, data]);
    }
  }
  return out;
}

function isZip(b) {
  return b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);
}

function extOf(path) {
  const base = path.split('/').pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

// ===== File-level rules =====

function sniff(d) {
  if (d.length < 4) return 'tiny';
  if (d[0] === 0x4d && d[1] === 0x5a) return 'pe';
  if (d[0] === 0x7f && d[1] === 0x45 && d[2] === 0x4c && d[3] === 0x46) return 'elf';
  if ((d[0] === 0xcf || d[0] === 0xce) && d[1] === 0xfa && d[2] === 0xed && d[3] === 0xfe) return 'macho';
  if (d[0] === 0xca && d[1] === 0xfe && d[2] === 0xba && d[3] === 0xbe) return 'java';
  if (d[0] === 0x23 && d[1] === 0x21) return 'shebang';
  if (isZip(d)) return 'zip';
  if (d[0] === 0x52 && d[1] === 0x61 && d[2] === 0x72 && d[3] === 0x21) return 'rar';
  if (d[0] === 0x37 && d[1] === 0x7a && d[2] === 0xbc && d[3] === 0xaf) return '7z';
  if (d[0] === 0x1f && d[1] === 0x8b) return 'gzip';
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return 'png';
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return 'jpg';
  if (d[0] === 0x4f && d[1] === 0x67 && d[2] === 0x67 && d[3] === 0x53) return 'ogg';
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46) return 'riff';
  return 'other';
}

function looksLikeText(d) {
  const n = Math.min(d.length, 4000);
  if (!n) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = d[i];
    if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) bad++;
  }
  return bad / n < 0.02;
}

function analyse(report, files) {
  const entries = files.filter(([p]) => !p.endsWith('/'));
  report.stats.files = entries.length;
  const unusual = [];
  const hasWorld = entries.some(([p]) => /(^|\/)level\.dat$/i.test(p));

  // Pass 1: every file's name and first bytes.
  for (const [path, data, isArchiveStub] of entries) {
    const lower = path.toLowerCase();
    const base = lower.split('/').pop();
    const ext = extOf(path);
    report.entries.push(`${path}${data.length ? ` (${data.length} B)` : ' (nested archive)'}`);

    if (base === 'content.zipe' || ext === 'zipe') {
      report.blockers.push(`Contains "${path}". A file called content.zipe is the hidden-script marker from the Minecraft security warning; packs with it run hidden code.`);
      continue;
    }
    if (path.includes('..') || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\\') || /::\$/i.test(path)) {
      report.blockers.push(`"${path}" has a path that escapes the pack folder or hides data.`);
      continue;
    }
    if (/[‪-‮⁦-⁩​-‏﻿]/.test(path)) {
      report.blockers.push(`"${path}" has hidden direction or zero-width characters in its name, a trick used to disguise file types.`);
      continue;
    }
    if (/[ .]$/.test(base) || /\.(png|jpe?g|tga|json|lang|ogg|wav|txt)\.[a-z0-9]{2,5}$/i.test(base) && !/\.(png|jpe?g|tga|json|lang|ogg|wav|txt)\.(bak|old|orig|license)$/i.test(base)) {
      report.blockers.push(`"${path}" has a double extension or trailing dot, a disguise trick.`);
      continue;
    }
    if (EXECUTABLE_EXT.has(ext)) {
      report.blockers.push(`Contains a program or archive-in-disguise file: ${path}.`);
      continue;
    }
    if (isArchiveStub || !data.length) continue;

    const kind = sniff(data);
    if (['pe', 'elf', 'macho', 'java'].includes(kind)) {
      report.blockers.push(`"${path}" is a ${kind === 'pe' ? 'Windows' : kind === 'elf' ? 'Linux' : kind === 'macho' ? 'macOS' : 'Java'} program, whatever its name says.`);
      continue;
    }
    if (kind === 'shebang') {
      report.blockers.push(`"${path}" is an executable script (starts with #!).`);
      continue;
    }
    if (['zip', 'rar', '7z', 'gzip'].includes(kind) && !ARCHIVE_EXT.has(ext)) {
      report.blockers.push(`"${path}" is an archive hidden under a ${ext ? `.${ext}` : 'plain'} name. Hidden archives are how malicious packs smuggle payloads.`);
      continue;
    }
    if (ext === 'png' && kind !== 'png' || (ext === 'jpg' || ext === 'jpeg') && kind !== 'jpg' || ext === 'ogg' && kind !== 'ogg') {
      report.signals.push(`"${path}" is named .${ext} but its contents don't match that format.`);
    }
    if ((TEXT_EXT.has(ext)) && !looksLikeText(data)) {
      report.signals.push(`"${path}" should be text but contains binary data.`);
    }
    if (!KNOWN_EXT.has(ext) && !(hasWorld && WORLD_FILES.test(path)) && !(hasWorld && !ext)) {
      unusual.push(path);
    }
    if (SCRIPT_EXT.has(ext)) report.stats.scripts++;
  }
  if (unusual.length) {
    report.signals.push(`Unusual file types (not normal for Minecraft packs): ${unusual.slice(0, 15).join(', ')}${unusual.length > 15 ? ` and ${unusual.length - 15} more` : ''}.`);
  }

  // Pass 2: manifests and what each pack folder is allowed to contain.
  const manifests = [];
  for (const [path, data] of entries) {
    if (!/(^|\/)manifest\.json$/i.test(path) || !data.length) continue;
    const parsed = parseJsonLoose(strFromU8(data));
    const root = path.replace(/manifest\.json$/i, '');
    if (!parsed) {
      report.signals.push(`${path} could not be read as JSON.`);
      manifests.push({ path, root, types: new Set(), unreadable: true });
      continue;
    }
    const modules = Array.isArray(parsed.modules) ? parsed.modules : [];
    const types = new Set(modules.map(m => String(m && m.type || '').toLowerCase()));
    manifests.push({ path, root, types });
    report.manifests.push({
      path,
      name: clip(parsed.header && parsed.header.name, 80),
      description: clip(parsed.header && parsed.header.description, 160),
      uuid: parsed.header && parsed.header.uuid,
      version: parsed.header && parsed.header.version,
      minEngine: parsed.header && parsed.header.min_engine_version,
      modules: modules.map(m => ({ type: m && m.type, language: m && m.language, entry: m && m.entry })),
      dependencies: (Array.isArray(parsed.dependencies) ? parsed.dependencies : []).map(d => d && (d.module_name ? `${d.module_name}@${d.version}` : d.uuid)).slice(0, 12)
    });
    if (types.has('script') && ![...types].some(t => t === 'data')) {
      report.signals.push(`${path} declares a script module without a data module (behavior packs normally have both).`);
    }
    for (const m of modules) {
      if (m && typeof m.entry === 'string' && /^(https?:|\/\/|\.\.)/i.test(m.entry)) {
        report.blockers.push(`${path} points its script entry at "${m.entry}", outside the pack.`);
      }
    }
  }
  if (!manifests.length && !hasWorld && !entries.some(([p]) => ARCHIVE_EXT.has(extOf(p)))) {
    report.signals.push('No manifest.json anywhere, so this may not be a working pack.');
  }

  // Encrypted packs hide their contents from review.
  const contents = entries.find(([p]) => /(^|\/)contents\.json$/i.test(p));
  if (contents && contents[1].length && !looksLikeText(contents[1])) {
    report.blockers.push('This is an encrypted pack (contents.json is not readable). Encrypted packs hide their contents, so they cannot be reviewed.');
  }

  // Pass 3: scripts. A pack folder only runs scripts if its manifest has a
  // script module; scripts anywhere else are hidden code.
  const scriptFiles = entries.filter(([p]) => SCRIPT_EXT.has(extOf(p)));
  for (const [path, data] of scriptFiles) {
    const owner = manifests
      .filter(m => path.startsWith(m.root))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (owner && !owner.unreadable && !owner.types.has('script')) {
      report.blockers.push(`"${path}" is a script inside a pack that doesn't declare scripts (${[...owner.types].join(', ') || 'no modules'}). Resource packs can't legitimately contain scripts; this is the hidden-script trick.`);
      continue;
    }
    if (!owner && manifests.length) {
      report.signals.push(`"${path}" is a script outside any pack folder.`);
    }
    scanScript(report, path, strFromU8(data));
  }
  if (!scriptFiles.length && manifests.some(m => m.types.has('script'))) {
    report.signals.push('A manifest declares a script module but no script file was found in the archive.');
  }

  // Pass 4: links and tokens hiding in any text file.
  for (const [path, data] of entries) {
    const ext = extOf(path);
    if (!TEXT_EXT.has(ext) || SCRIPT_EXT.has(ext) || !data.length) continue;
    const text = strFromU8(data.subarray(0, 400000));
    const bad = text.match(BAD_HOSTS);
    if (bad) report.blockers.push(`"${path}" references ${bad[0]}, a webhook, tracker or stealer address.`);
    if (/<script\b|javascript:|onerror\s*=|onload\s*=/i.test(text) && ['html', 'htm', 'svg', 'xml'].includes(ext)) {
      report.blockers.push(`"${path}" contains active web script, which has no place in a Minecraft pack.`);
    }
    if (ext === 'mcfunction' || ext === 'json') {
      const cmds = text.match(/\b(?:\/?)(?:ban|kick|op|deop|whitelist|stop|reload)\s+(?:@a|@e|@p|\w+)/gi);
      if (cmds && ext === 'mcfunction') report.signals.push(`"${path}" runs server commands: ${[...new Set(cmds)].slice(0, 4).join(', ')}.`);
    }
  }

  collectText(report, entries);
}

function parseJsonLoose(text) {
  const clean = text.replace(/^﻿/, '');
  try { return JSON.parse(clean); } catch (e) { /* try again without comments */ }
  try {
    return JSON.parse(clean.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1'));
  } catch (e) {
    return null;
  }
}

// ===== Script rules =====

function scanScript(report, path, text) {
  const hit = (re) => { const m = text.match(re); return m ? m[0] : null; };
  const block = (why) => report.blockers.push(`"${path}": ${why}`);

  let m;
  if ((m = hit(/\beval\s*\(/))) block('uses eval(), which runs hidden code built at run time.');
  if ((m = hit(/\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/))) block(`builds code from a string (${clip(m, 40)}).`);
  if ((m = hit(/\bimport\s*\(\s*(?:['"`]https?:|[^'"`)\s])/)) ) block('imports code from outside the pack at run time.');
  if ((m = hit(/from\s+['"]https?:\/\/|require\s*\(\s*['"]https?:/))) block('loads code from a web address.');
  if ((m = hit(/@minecraft\/server-net\b/))) block('imports @minecraft/server-net, which lets scripts talk to the internet. Community packs are not allowed network access.');
  if ((m = hit(/@minecraft\/server-admin\b/))) block('imports @minecraft/server-admin (server secrets and variables), which player packs never need.');
  if ((m = hit(/\b(?:child_process|powershell|cmd\.exe|certutil|bitsadmin|mshta|regsvr32|rundll32|wscript|cscript)\b/i))) block(`mentions ${m}, a way to run programs on the device.`);
  if ((m = hit(/\brequire\s*\(|\bprocess\.(?:env|binding|mainModule)|\bglobalThis\.process\b|\b__dirname\b/))) block(`uses ${clip(m, 30)}, which is Node.js code, not a Minecraft script.`);
  if ((m = text.match(BAD_HOSTS))) block(`contains ${m[0]}, a webhook, tracker or stealer address.`);
  if ((m = hit(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*[(.]/))) block(`uses ${clip(m, 30)} to send data over the network.`);
  const shortLink = (text.match(/\bhttps?:\/\/[^\s'"`)]+/gi) || []).find(u => SHORTENERS.test(u));
  if (shortLink) block(`links to a shortener or ad-gate (${clip(shortLink, 60)}).`);

  const sig = (s) => report.signals.push(`"${path}": ${s}`);
  const lines = text.split('\n');
  const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
  if (longest > 1500 || (text.length > 6000 && lines.length <= 4)) sig(`unreadable: minified or packed into very long lines (${longest} characters on one line). Code that can't be read can't be audited.`);
  const b64 = text.match(/[A-Za-z0-9+/=]{220,}/g);
  if (b64) sig(`contains ${b64.length} very long encoded string(s) (base64-like), often used to hide payloads.`);
  if ((text.match(/\batob\s*\(|\bbtoa\s*\(|Buffer\.from\s*\(/g) || []).length) sig('decodes encoded text at run time (atob/Buffer.from).');
  if ((text.match(/String\.fromCharCode/g) || []).length >= 3) sig('assembles text from character codes, a common obfuscation.');
  if ((text.match(/\\x[0-9a-f]{2}/gi) || []).length > 20 || (text.match(/\\u[0-9a-f]{4}/gi) || []).length > 40) sig('is full of hex/unicode escapes, a common obfuscation.');
  if ((text.match(/\b_0x[0-9a-f]{4,6}\b/g) || []).length > 5) sig('uses obfuscator-style variable names (_0x....).');
  if ((m = text.match(/\.(?:kick|ban|setOp|disconnect)\s*\(/g))) sig(`calls ${[...new Set(m)].slice(0, 3).join(', ')} on players.`);
  if ((m = text.match(/runCommand(?:Async)?\s*\(\s*[`'"]\/?(?:ban|kick|op|deop|whitelist|stop|reload|tickingarea|structure\s+(?:load|delete)|kill\s+@e|clear\s+@a|tp\s+@a|gamemode\s+\w+\s+@a|effect\s+@a|execute[^`'"]*run\s+(?:kick|ban|op))[^`'"]*/gi))) sig(`runs sweeping commands: ${[...new Set(m)].slice(0, 3).map(s => clip(s, 70)).join(' | ')}.`);
  if ((m = hit(/\b(?:localStorage|sessionStorage|document\.|window\.|navigator\.)/))) sig(`uses ${clip(m, 25)} (browser APIs do not exist in Minecraft scripts).`);
  if (/\bxuid\b|\bplayer\.(?:name|id)\b[^\n]{0,80}(?:send|post|upload|http)/i.test(text)) sig('reads player identity details near sending/storing code.');
  const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(x => x[1]);
  const odd = imports.filter(i => !/^(@minecraft\/(server|server-ui|server-gametest|common|vanilla-data|debug-utilities|server-editor)|\.{1,2}\/)/.test(i));
  if (odd.length) sig(`imports unusual modules: ${[...new Set(odd)].slice(0, 5).join(', ')}.`);
}

// ===== .brarchive =====

function scanBrarchive(report, name, raw) {
  report.entries.push(`${name} (${raw.length} B, .brarchive)`);
  const kind = sniff(raw);
  if (['pe', 'elf', 'macho', 'java', 'shebang'].includes(kind) || kind === 'rar' || kind === '7z') {
    report.blockers.push('The .brarchive is really a program or archive, not packed JSON.');
    return;
  }
  const text = brarchiveText(raw);
  if (text) {
    const bad = text.match(BAD_HOSTS);
    if (bad) report.blockers.push(`The .brarchive references ${bad[0]}, a webhook, tracker or stealer address.`);
    report.texts.push({ name, text: clip(text, 20000) });
  } else {
    report.signals.push("Couldn't read any text inside the .brarchive, so its contents can't be checked.");
  }
}

// Text out of a .brarchive: try the usual compressions, else pull out the
// readable runs of characters (JSON keys and values survive that way).
export function brarchiveText(bytes) {
  const readable = (u8) => {
    const s = strFromU8(u8.subarray(0, 200000), true);
    const printable = s.replace(/[^\x20-\x7e\n\r\t]/g, '').length;
    return s.length && printable / s.length > 0.85 ? s : '';
  };
  const starts = [0];
  for (let i = 1; i < Math.min(256, bytes.length - 2); i++) {
    if ((bytes[i] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[i + 1])) || (bytes[i] === 0x1f && bytes[i + 1] === 0x8b)) starts.push(i);
  }
  for (const start of starts.slice(0, 12)) {
    try {
      const text = readable(decompressSync(bytes.subarray(start)));
      if (text) return clip(text, 20000);
    } catch (e) { /* not a compressed stream at this offset */ }
  }
  const runs = strFromU8(bytes.subarray(0, 400000), true).match(/[\x20-\x7e]{6,}/g) || [];
  return clip(runs.join('\n'), 20000);
}

// ===== Text for the AI =====

function collectText(report, entries) {
  const rank = (n) => (/manifest\.json$/i.test(n) ? 0 : SCRIPT_EXT.has(extOf(n)) ? 1 : /\.mcfunction$/i.test(n) ? 2 : /\.lang$/i.test(n) ? 3 : 4);
  const textFiles = entries
    .filter(([n, d]) => d.length && TEXT_EXT.has(extOf(n)) && !/^(.*\/)?(contents|sound_definitions|sounds|textures_list|item_texture|terrain_texture|flipbook_textures)\.json$/i.test(n))
    .sort((a, b) => rank(a[0]) - rank(b[0]));
  let budget = TEXT_BUDGET;
  for (const [name, data] of textFiles) {
    if (budget <= 0) break;
    const limit = rank(name) <= 2 ? 24000 : 3000;
    const text = clip(strFromU8(data.subarray(0, limit * 2)), Math.min(limit, budget));
    budget -= text.length;
    report.texts.push({ name, text });
  }
  for (const [name, data] of entries) {
    if (/\.brarchive$/i.test(name) && data.length) {
      const text = brarchiveText(data);
      if (text) report.texts.push({ name, text: clip(text, 8000) });
    }
  }
  report.entries = report.entries.slice(0, 500);
}

// ===== Text checks used for descriptions and profiles =====

export function textProblems(text) {
  const out = [];
  if (BAD_HOSTS.test(text)) out.push('links to a webhook, IP tracker or stealer address');
  if (SHORTENERS.test(text)) out.push('links to a URL shortener or ad-gate');
  return out;
}
