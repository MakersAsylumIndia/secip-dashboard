// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
//
// The dashboards read Airtable fields by name, and the programme bases name some fields
// differently ("Start time" or "Start Time", "Sessions" or "Session", a trailing space in
// "Day 6 "). This file turns every record into one shape, so the rest of the code can use
// a single set of names whichever base AIRTABLE_BASE_ID points at.
//
// Rules: field names are trimmed; for each name the code uses, the first alias present
// (matched without regard to case) fills it, unless the record already has that name.

const trimKeys = rec => {
  const out = {};
  for (const [k, v] of Object.entries(rec)) { const t = k.trim(); if (!(t in out) || out[t] === '' || out[t] == null) out[t] = v; }
  return out;
};

// name the code uses -> other names it may have in a base
const ALIASES = {
  Students: {
    'Email address': ['Email'],
  },
  'Team Survey': {
    'SDG interests': ['What Sustainable Development Goal are you most interested in?'],
    Skills: ['Please chose the skills that you think you can contribute to your team', 'Please choose the skills that you think you can contribute to your team'],
    Country: ['Nationality'],
  },
  Agenda: {
    Session: ['Sessions'],
    Date: ['Day'],
    'Day number': ['Day #'],
    'Start time': ['Start Time'],
    'End time': ['End Time'],
    'Zoom link': ['Daily Link'],
    Slides: ['Daily Slides'],
    Recording: ['Recordings', 'Session recordings'],
  },
  Mentors: {
    'Assigned teams': ['Assigned Teams'],
    'SDG focus': ['SDG Focus'],
  },
  'Steering Committee': {
    'Assigned teams': ['Team Allocation'],
  },
  Universities: {
    'Student list': ['Student List'],
    'Mentor list': ['Mentor List'],
  },
  Updates: {
    Date: ['Notes'],
  },
};

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const asList = v => Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',').map(x => x.trim()).filter(Boolean) : [];
const asText = v => Array.isArray(v) ? v.join(', ') : v;

function normalise(table, rec) {
  const r = trimKeys(rec);
  const lower = Object.fromEntries(Object.keys(r).map(k => [k.toLowerCase(), k]));
  for (const [want, alts] of Object.entries(ALIASES[table] || {})) {
    if (r[want] != null && r[want] !== '') continue;
    for (const alt of alts) {
      const key = lower[alt.toLowerCase()];
      if (key != null && r[key] != null && r[key] !== '') {
        // Updates: only a date-looking "Notes" counts as the date.
        if (table === 'Updates' && want === 'Date' && !isDate(r[key])) continue;
        r[want] = r[key]; break;
      }
    }
  }
  if (typeof r.Session === 'string') r.Session = r.Session.trim();
  // Types the front end expects, whichever base the value came from
  if (table === 'Mentors') { r['Mentor type'] = asText(r['Mentor type']); r['Assigned teams'] = asList(r['Assigned teams']); }
  if (table === 'Steering Committee') r['Assigned teams'] = asList(r['Assigned teams']);
  if (table === 'Team Survey') {
    const extra = (r['Any additional skills, knowledge or experience you would like us to know about?'] || '').trim();
    const skills = asText(r.Skills) || '';
    r.Skills = [skills, extra].filter(Boolean).join('. ');
  }
  return r;
}

const byTime = (a, b) => String(a || '').localeCompare(String(b || ''));

// Students come from the Students roster (who may sign in). In bases where profile and
// attendance live in the Team Survey, the survey answers are merged on by email address.
// A survey answer alone never grants access: only rows in Students do.
function mergeStudents(students, survey) {
  if (!survey || !survey.length) return students;
  const key = e => String(e || '').trim().toLowerCase();
  const answers = new Map(survey.filter(x => key(x['Email address'])).map(x => [key(x['Email address']), x]));
  return students.map(s => {
    const a = answers.get(key(s['Email address']));
    if (!a) return s;
    const out = { ...s };
    for (const [k, v] of Object.entries(a)) if (out[k] == null || out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) out[k] = v;
    return out;
  });
}

// Takes { table: [records] } straight from Airtable and returns the shape the dashboards use.
function shape(raw) {
  const T = {};
  for (const [table, recs] of Object.entries(raw)) T[table] = (recs || []).map(r => normalise(table, r));
  T.Students = mergeStudents(T.Students || [], T['Team Survey']);
  delete T['Team Survey'];
  T.Agenda = (T.Agenda || []).sort((a, b) => byTime(a['Start time'], b['Start time']));
  T['SC Tasks'] = (T['SC Tasks'] || []).sort((a, b) => byTime(a['Due date'] || '9999', b['Due date'] || '9999'));
  T.Updates = (T.Updates || []).sort((a, b) => byTime(b.Date, a.Date));
  return T;
}

module.exports = { normalise, shape, mergeStudents };
