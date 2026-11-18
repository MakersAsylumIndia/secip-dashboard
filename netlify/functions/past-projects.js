// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { verify, readCookie, json } = require('../../lib/util');

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
    catch (e) { if (e.status !== 404 && e.status !== 422) { console.error('Past projects', cohort, e.message); return []; } }
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
      image: (files.find(a => /^image\//.test(a.type)) || {}).url || (files.find(a => a.thumb) || {}).thumb || '',
      deck: deck.map(({ name, url }) => ({ name, url })),
      files: [...docUrls, ...files.filter(a => !deck.includes(a)).map(({ name, url }) => ({ name, url }))],
    };
  }).filter(p => p.problem || p.solution);
}

// Attachment links from Airtable expire after a couple of hours, so cache for 1 hour.
let cache = { at: 0, data: null };

exports.handler = async event => {
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });
  if (!cache.data || Date.now() - cache.at > 36e5) {
    const all = (await Promise.all(bases().map(loadBase))).flat();
    cache = { at: Date.now(), data: all };
  }
  return json(200, { projects: cache.data });
};
