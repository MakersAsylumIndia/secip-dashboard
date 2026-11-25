// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { verify, readCookie, json } = require('../../lib/util');
const { snapshot } = require('../../lib/store');
const { QUIZ_RESULTS } = require('../../lib/schema');

// Marks one Assessment 1A lesson quiz. The correct answers never leave the server: the
// response says which questions are wrong, and reveals answers and explanations only once
// every question is right. Each attempt by an enrolled student is saved to Lesson Quiz Results.
// Committee members trying the student view are marked but not saved.
const same = (a, b) => String(a || '').trim().toLowerCase() === b;

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });

  let lesson = 0, answers = {};
  try { const b = JSON.parse(event.body || '{}'); lesson = Number(b.lesson); answers = b.answers && typeof b.answers === 'object' ? b.answers : {}; } catch {}
  if (!Number.isInteger(lesson) || lesson < 1 || lesson > 50) return json(400, { error: 'bad-lesson' });

  try {
    const { value: T } = await snapshot(event);
    const questions = (T.Quiz || {})[lesson] || [];
    if (!questions.length) return json(404, { error: 'no-quiz' });
    const student = T.Students.find(x => same(x['Email address'], s.email));
    if (!student && s.role !== 'sc') return json(401, { error: 'signed-out' });

    const wrong = questions.filter(q => String(answers[q.id] || '').toUpperCase() !== q.correct).map(q => q.id);
    const score = questions.length - wrong.length, passed = !wrong.length;
    const out = { lesson, score, total: questions.length, passed, wrong, saved: false };
    if (passed) out.review = Object.fromEntries(questions.map(q => [q.id, { correct: q.correct, explanation: q.explanation }]));

    if (student) {
      const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(QUIZ_RESULTS)}`;
      const fields = {
        Email: s.email, Name: student.Name || '', University: String(student.University || ''),
        Lesson: `Lesson ${lesson}`, Score: score, 'Out of': questions.length, Passed: passed, Submitted: new Date().toISOString(),
      };
      const w = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ fields }], typecast: true }) });
      if (w.ok) out.saved = true;
      else console.error(`Saving a quiz attempt: Airtable returned ${w.status}`);
    }
    return json(200, out);
  } catch (err) {
    if (err.busy) return json(503, { error: 'busy' });
    console.error(err);
    return json(502, { error: 'Could not mark the quiz' });
  }
};
