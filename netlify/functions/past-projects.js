// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { verify, readCookie, json } = require('../../lib/util');
const { shared } = require('../../lib/store');

// Past SECIP cohorts. Each base needs an "Open House Submission" table, and the
// AIRTABLE_TOKEN must have read access to the base. Override with PAST_BASES,
// e.g. "appXXXX:July 2025,appYYYY:Jan 2026".
const DEFAULT_BASES = [
  ['appzvTLfZ1yckRaK1', 'July 2026'], ['app8SU7rKoGrIiH9l', 'Jan 2026'],
  ['app5FQrFimArlEjQx', 'June 2025'], ['apppYdAtvxiSAGpc2', 'Jan 2025'],
  ['appLmzOE013gqQ0QG', 'July 2024'], ['appvnAcfxaC1ndVBK', 'Jan 2024'],
  ['appJIucNuST7nQcd5', 'July 2023'], ['appW45o4us5Vy46xG', 'Jan 2023'],
  ['appg6Yd2HTnBn78Jl', 'July 2022'], ['app3EmnsAeRAJRiQK', 'Jan 2022'],
  ['appdWjpKngSdLzij2', 'July 2021'], ['appYYgqHU41ORwoxP', 'Jan 2021'],
];
const bases = () => process.env.PAST_BASES
  ? process.env.PAST_BASES.split(',').map(x => x.trim().split(':')).filter(x => /^app\w{14}$/.test(x[0]))
  : DEFAULT_BASES;
const TABLES = ['Open House Submission', 'Open House Submissions', 'Open House'];

async function get(base, table, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let out = [], offset;
  do {
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
    if (!r.ok) { const e = new Error(`${base}/${table} ${r.status}`); e.status = r.status; throw e; }
    const j = await r.json();
    out = out.concat(j.records);
    offset = j.offset;
  } while (offset);
  return out;
}

// Column names differ between cohorts, so find columns by what they're called.
const pick = (keys, ...tests) => { for (const t of tests) { const k = keys.find(k => t.test(k)); if (k) return k; } return null; };
const isFiles = v => Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && v[0].url;
const isLinks = v => Array.isArray(v) && v.length && typeof v[0] === 'string' && /^rec\w{14}$/.test(v[0]);
const text = v => Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? (v.name || '') : (v ?? ''));
const sdgNums = v => [...new Set((Array.isArray(v) ? v : [v]).flatMap(s => String(s || '').match(/\b(1[0-7]|[1-9])\b/g) || []).map(Number))];

async function loadBase([base, cohort]) {
  let recs = null;
  for (const t of TABLES) {
    try { recs = await get(base, t); break; }
    catch (e) {
      if (e.status === 404 || e.status === 422) continue;
      console.error('Past projects', cohort, e.message);
      // Busy or unreachable (null) is worth another try soon; no access is not.
      return !e.status || e.status === 429 || e.status >= 500 ? null : [];
    }
  }
  if (!recs || !recs.length) return [];
  const keys = [...new Set(recs.flatMap(r => Object.keys(r.fields)))];
  const kName = pick(keys, /team name|project name|name of (your )?(team|project|solution|venture)|venture name|solution name/i, /^name$/i, /title/i);
  const kTeam = pick(keys, /^team( ?(number|no\.?|#))?$/i);
  const kProb = pick(keys, /problem/i, /how might we/i, /challenge/i);
  const kSol = pick(keys.filter(k => k !== kProb), /solution|idea|venture|what (did|have) you (build|create)/i);
  const kSdg = pick(keys, /sdg|sustainable development|goal/i);
  const kMem = pick(keys, /^name \(from .*(member|student|participant)/i, /member|student|participant|team mates?/i);
  const kDoc = pick(keys, /documentation|doc(s)? link|drive link|website/i);
  // Linked team members come back as record IDs: look their names up in Students.
  let names = {};
  if (kMem && recs.some(r => isLinks(r.fields[kMem]))) {
    try { (await get(base, 'Students')).forEach(s => { names[s.id] = s.fields.Name || s.fields['Full name'] || s.fields['Full Name'] || ''; }); } catch {}
  }
  return recs.map(r => {
    const f = r.fields;
    const files = keys.filter(k => isFiles(f[k])).flatMap(k => f[k].map(a => ({ name: a.filename || 'File', url: a.url, type: a.type || '', thumb: a.thumbnails?.large?.url || '', col: k })));
    const deck = files.filter(a => /pitch|deck|present|slide|poster/i.test(a.name + ' ' + a.col) || /pdf|presentation|powerpoint/i.test(a.type));
    const docUrls = kDoc ? [...new Set(String(text(f[kDoc])).match(/https?:\/\/[^\s)\]>"']+/g) || [])].map(u => ({ name: 'Project documentation', url: u })) : [];
    const members = kMem ? (isLinks(f[kMem]) ? f[kMem].map(id => names[id]).filter(Boolean) : String(text(f[kMem])).split(/[,\n]/).map(s => s.trim()).filter(Boolean)) : [];
    return {
      id: `${base}:${r.id}`, cohort,
      name: text(kName && f[kName]) || text(kTeam && f[kTeam]) || 'Untitled project',
      team: text(kTeam && f[kTeam]), sdg: text(kSdg && f[kSdg]), sdgNums: sdgNums(kSdg && f[kSdg]),
      problem: text(kProb && f[kProb]), solution: text(kSol && f[kSol]), members,
      // Cards only need a thumbnail; the full files are linked from the project's own page.
      image: (img => img && (img.thumb || img.url))(files.find(a => /^image\//.test(a.type))) || (files.find(a => a.thumb) || {}).thumb || '',
      deck: deck.map(({ name, url }) => ({ name, url })),
      files: [...docUrls, ...files.filter(a => !deck.includes(a)).map(({ name, url }) => ({ name, url }))],
    };
  }).filter(p => p.problem || p.solution);
}

// Attachment links from Airtable expire after a couple of hours, so the list is kept for
// 1 hour (in the shared cache, so the 12 cohort bases are read once, not once per visitor).
// If Airtable was busy for a cohort (null), show its last good copy while that is under
// 90 minutes old, and try again in 5 minutes.
const HOUR = 36e5, KEEP_MS = 1.5 * HOUR, RETRY_MS = 5 * 60 * 1000;

async function loadAll(prev) {
  const now = Date.now(), list = bases(), byBase = {}, old = (prev && prev.byBase) || {};
  const loaded = await Promise.all(list.map(b => loadBase(b).catch(e => { console.error('Past projects', b[1], e.message); return []; })));
  list.forEach(([base], i) => {
    byBase[base] = loaded[i] ? { at: now, data: loaded[i] } : old[base] && now - old[base].at < KEEP_MS ? old[base] : { at: 0, data: [] };
  });
  return { value: { projects: list.flatMap(([base]) => byBase[base].data), byBase }, ttl: loaded.includes(null) ? RETRY_MS : HOUR };
}

exports.handler = async event => {
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });
  try {
    const { value } = await shared(event, 'past-projects', { maxAge: HOUR, staleAge: KEEP_MS, load: loadAll });
    // The browser may reuse the list for 10 minutes, so moving between pages doesn't call this again.
    return json(200, { projects: value.projects }, { 'Cache-Control': 'private, max-age=600' });
  } catch (err) {
    if (!err.busy) console.error(err);
    return json(200, { projects: [] }); // not cached by the browser, so the next visit tries again
  }
};
