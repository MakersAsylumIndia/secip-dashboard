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

const EPORTFOLIO = 'Assessment 2: Individual experiential ePortfolio Submission';
// Assessment 1A: lesson content, quiz questions, and the attempts students submit
const LESSONS = 'Assessment 1A : Pre Program';
const QUIZ = 'Lesson Quiz Questions';
const QUIZ_RESULTS = 'Lesson Quiz Results';

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
  'Assessment Overview': {
    Rubric: ['Assessment Rubric'],
  },
  'Learning Reflection': {
    Email: ['Email address (from Select Email)', 'Email address'],
    Day: ['Select Day/Day', 'Select Day', 'Date/Day'],
  },
  'Self Evaluation - Week 1': { Email: ['Email address'] },
  'Self Evaluation - Week 2': { Email: ['Email address'] },
  [EPORTFOLIO]: { Email: ['Email address'], Submission: ['Your Submission'] },
  'Open House Submission': { 'Team Number': ['Team number'] },
  [LESSONS]: { Video: ['Reference Video to be watched', 'Video', 'Link'], Minutes: ['Time (Mins)', 'Time'] },
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

// ---------- assessments ----------
// Assessment Overview keeps each assessment's due date and weighting inside its rich-text Notes
// ("**Due**: 11.55 pm ..., 29th January 2027", "**Value**: 35%"). Optional "Due date" (date) and
// "Value" fields win when a base has them; otherwise they are read from those lines.
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
const plain = s => String(s || '').replace(/\\(.)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const noteLine = (notes, label) => {
  const line = String(notes || '').split('\n').find(l => new RegExp(`^\\W*${label}\\b`, 'i').test(l));
  return line ? plain(line).replace(new RegExp(`^\\W*${label}\\s*:?\\s*`, 'i'), '').trim() : '';
};
const isoFrom = text => {
  const m = String(text || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})/i);
  const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
// What kind of assessment a row is, from its name. Decides which submissions count towards it.
const kindOf = name => {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'assessment' || /overview|summary/.test(n)) return 'summary';
  if (!/^assessment/.test(n)) return 'resource';
  if (/eportfolio|portfolio/.test(n)) return 'eportfolio';
  if (/pitch/.test(n)) return 'pitch';
  if (/participation/.test(n)) return 'participation';
  if (/forum/.test(n)) return 'forum';
  if (/lesson/.test(n)) return 'lessons';
  return 'other';
};
const files = att => (Array.isArray(att) ? att : []).filter(a => a && a.url).map(a => ({ name: a.filename || 'File', url: a.url }));
const first = v => Array.isArray(v) ? first(v[0]) : v == null ? '' : String(v);
const emailOf = r => first(r.Email).trim().toLowerCase();
const teamKey = v => (first(v).match(/\d+/) || [''])[0];

function shapeAssessments(rows) {
  const order = { summary: 0, resource: 2 };
  return (rows || []).filter(r => r.Assessment).map(r => {
    const notes = r.Notes || '', dueText = noteLine(notes, 'Due');
    return {
      name: String(r.Assessment).trim(), kind: kindOf(r.Assessment), notes, link: r.Link || '', rubric: files(r.Rubric),
      value: r.Value != null && r.Value !== '' ? String(r.Value) : noteLine(notes, 'Value'),
      dueText, due: r['Due date'] || isoFrom(dueText), purpose: noteLine(notes, 'Purpose'),
    };
  }).sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1) || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

// Only what is needed to tell a student what they have handed in: emails, team numbers, days, links.
// The answers themselves are left out, so they are never cached or sent anywhere.
function shapeSubmissions(T) {
  return {
    eportfolio: (T[EPORTFOLIO] || []).filter(emailOf).map(r => ({ email: emailOf(r), url: first(r.Submission), at: r.Created || '' })),
    teams: [...new Set((T['Open House Submission'] || []).map(r => teamKey(r['Team Number'])).filter(Boolean))],
    reflections: (T['Learning Reflection'] || []).filter(emailOf).map(r => ({ email: emailOf(r), day: first(r.Day) })),
    self1: [...new Set((T['Self Evaluation - Week 1'] || []).map(emailOf).filter(Boolean))],
    self2: [...new Set((T['Self Evaluation - Week 2'] || []).map(emailOf).filter(Boolean))],
    lessons: (T[QUIZ_RESULTS] || []).filter(r => r.Passed === true && emailOf(r)).map(r => ({ email: emailOf(r), n: lessonNum(first(r.Lesson)) })).filter(x => x.n),
  };
}

// One student's progress, worked out on the server so no one else's email reaches the browser.
function progressFor(S, student) {
  const email = first(student['Email address']).trim().toLowerCase(), team = teamKey(student['Team number']);
  if (!email) return null;
  const ep = S.eportfolio.filter(x => x.email === email).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return {
    eportfolio: ep ? { url: ep.url } : null,
    team: team ? S.teams.includes(team) : null,
    reflections: new Set(S.reflections.filter(x => x.email === email).map((x, i) => x.day || `row ${i}`)).size,
    self1: S.self1.includes(email), self2: S.self2.includes(email),
    lessons: [...new Set((S.lessons || []).filter(x => x.email === email).map(x => x.n))].sort(),
  };
}

// ---------- Assessment 1A: online lessons and quizzes ----------
// Lesson rows are named "Lesson 2" (the lesson's introduction), "Lesson 3 : Intro",
// "Lesson 2 : Part 4", and so on. Rows with the same name are joined, so extra links can be
// added as more rows. "Lesson N : Quiz" rows (the old SurveyMonkey links) are left out: the
// quiz now comes from the Lesson Quiz Questions table. "Pre Program Overview" is the summary.
const lessonNum = name => { const m = String(name || '').match(/lesson\s*(\d+)/i); return m ? Number(m[1]) : null; };
const headline = text => {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return { title: '', body: '' };
  return { title: plain(lines[i].replace(/^\s*#+\s*/, '')), body: lines.slice(i + 1).join('\n').trim() };
};
function shapeLessons(rows) {
  const lessons = {}, out = { overview: '', lessons: [] };
  const get = n => lessons[n] || (lessons[n] = { n, title: '', intro: '', minutes: null, parts: {} });
  for (const r of rows || []) {
    const name = String(r.Lesson || '').trim(), n = lessonNum(name);
    if (!n) { if (/overview/i.test(name)) out.overview = r.Description || ''; continue; }
    if (/quiz/i.test(name)) continue;
    const L = get(n), part = name.match(/part\s*(\d+)/i), intro = /intro/i.test(name);
    if (!part && !intro) {
      const hd = headline(r.Description);
      L.title = hd.title; L.intro = hd.body; if (r.Minutes) L.minutes = Number(r.Minutes) || null;
      continue;
    }
    const key = part ? Number(part[1]) : 0;
    const P = L.parts[key] || (L.parts[key] = { order: key, title: '', body: '', links: [], files: [], extra: [] });
    const text = String(r.Description || '').trim(), url = String(r.Video || '').trim();
    // A row with just a short label and a link (e.g. "Australia" + a Cultural Atlas page)
    // becomes a named button in its part, not the part's text.
    if (url && text && !text.includes('\n') && text.length <= 60) P.links.push({ url, label: plain(text) });
    else {
      if (url) P.links.push({ url, label: '' });
      // The row with the most text gives the part its heading; any others are added below it.
      if (text) P.extra.push(text);
    }
    P.files.push(...files(r.Attachments));
  }
  const finish = P => {
    const texts = P.extra.sort((a, b) => b.length - a.length), hd = headline(texts[0] || '');
    return { order: P.order, title: hd.title, body: [hd.body, ...texts.slice(1)].filter(Boolean).join('\n\n'), links: P.links, files: P.files };
  };
  out.lessons = Object.values(lessons).sort((a, b) => a.n - b.n)
    .map(L => ({ ...L, title: L.title || `Lesson ${L.n}`, parts: Object.values(L.parts).sort((a, b) => a.order - b.order).map(finish) }));
  return out;
}

// Quiz questions by lesson number. The correct answer stays on the server (see publicQuiz).
function shapeQuiz(rows) {
  const Q = {};
  for (const r of rows || []) {
    const n = lessonNum(first(r.Lesson));
    if (!n || !r.Question || r.Active !== true) continue;
    const options = ['A', 'B', 'C', 'D'].map(k => ({ k, t: String(r['Option ' + k] || '').trim() })).filter(o => o.t);
    if (options.length < 2) continue;
    (Q[n] = Q[n] || []).push({ id: r.id, q: String(r.Question).trim(), options, correct: first(r['Correct answer']).trim().toUpperCase(), explanation: r.Explanation || '', order: Number(r.Order) || 999 });
  }
  for (const n in Q) Q[n].sort((a, b) => a.order - b.order);
  return Q;
}
// The questions as students may see them: no correct answers, no explanations.
const publicQuiz = Q => Object.fromEntries(Object.entries(Q || {}).map(([n, qs]) => [n, qs.map(({ id, q, options }) => ({ id, q, options }))]));

// Takes { table: [records] } straight from Airtable and returns the shape the dashboards use.
function shape(raw) {
  const T = {};
  for (const [table, recs] of Object.entries(raw)) T[table] = (recs || []).map(r => normalise(table, r));
  T.Students = mergeStudents(T.Students || [], T['Team Survey']);
  delete T['Team Survey'];
  T.Assessments = shapeAssessments(T['Assessment Overview']);
  T.Submissions = shapeSubmissions(T);
  T.Lessons = shapeLessons(T[LESSONS]);
  T.Quiz = shapeQuiz(T[QUIZ]);
  for (const t of ['Assessment Overview', EPORTFOLIO, 'Open House Submission', 'Learning Reflection', 'Self Evaluation - Week 1', 'Self Evaluation - Week 2', LESSONS, QUIZ, QUIZ_RESULTS]) delete T[t];
  T.Agenda = (T.Agenda || []).sort((a, b) => byTime(a['Start time'], b['Start time']));
  T['SC Tasks'] = (T['SC Tasks'] || []).sort((a, b) => byTime(a['Due date'] || '9999', b['Due date'] || '9999'));
  T.Updates = (T.Updates || []).sort((a, b) => byTime(b.Date, a.Date));
  return T;
}

module.exports = { normalise, shape, mergeStudents, progressFor, publicQuiz, EPORTFOLIO, LESSONS, QUIZ, QUIZ_RESULTS };
