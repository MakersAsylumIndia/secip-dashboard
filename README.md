# SECIP 2027 dashboards

One website with two views. Students and steering committee members sign in with their email (a one-time link, no passwords), and the site shows them the right dashboard. Everything comes live from the **SECIP Jan 2027** Airtable base, so editing Airtable updates the site within a minute or two.

## What you need (all have free tiers)

| Service | What it does |
|---|---|
| Netlify | Hosts the site and runs the small server functions |
| Resend | Sends the sign-in emails from your domain |
| Airtable | The data (already set up) |
| Your domain | The web address, e.g. `secip.yourdomain.com` |

## Setup, step by step

1. **Airtable token.** Airtable > Builder hub > Personal access tokens > Create. Scopes: `data.records:read`, plus `data.records:write` if you want committee checklist ticks shared (see *Shared checklist* below). Access: the *SECIP Jan 2027* base (and past cohort bases, read-only use, for the Past projects page). Copy the token.
2. **Resend.** Sign up, add your domain under *Domains*, and add the DNS records it shows you at your domain registrar. Wait until it says *Verified*, then create an API key.
3. **Netlify.** Add new site > *Deploy manually* and drag this whole folder in (or connect a GitHub repo containing it).
4. **Environment variables.** Netlify > Site configuration > Environment variables. Add the six values from `.env.example`. For `SESSION_SECRET`, use a long random string (40+ characters).
5. **Domain.** Netlify > Domain management > Add your domain, then follow its DNS instructions. Netlify turns on HTTPS automatically. Set `SITE_URL` to the final address and redeploy.
6. **Test.** Add your own email to the *Steering Committee* table, open the site, request a link and sign in.

## Who can sign in

* Anyone in **Steering Committee** with an email gets the committee view. They can also open the student view with **See the student view** in the sidebar (and come back the same way). If they are in **Students** too, they see their own student record there; otherwise a stand-in profile.
* Set a committee row's **Role** to *Maker's Asylum team* to give that person the committee view without listing them on the site: they are left out of the committee list and the contacts students see, but can still sign in and tick tasks.
* Anyone in **Students** with an email address gets the student view.
* Anyone else gets the same "check your inbox" message but no email, so the form can't be used to find out who is registered.

Sign-in links last 15 minutes. Sessions last 14 days. **Sign out** is in the sidebar. Each address can be sent at most two sign-in links every 30 minutes (this limits emails, not devices: one link works on a phone and a laptop).

## Where each part of the site comes from

| Site section | Airtable table |
|---|---|
| Morning brief, to-dos, timeline, agenda | Agenda (Students to-do / Steering Committee to-do) |
| Important links | Important Links (shown by the *Order* number, lowest first; links with no Order come last, A to Z) |
| Community map | Universities (latitude/longitude) + Students |
| Mentor gallery (with photos) | Mentors (Photo, Expertise, Sessions, Confirmed…) |
| Partner tiles | Partners (upload each Logo) |
| Committee checklist and road to launch | SC Tasks (tick *Milestone* to show on the road; *Done by* lists the universities that have finished a task) |
| University status | Universities |
| Updates | Updates |
| Attendance | Students (Day 1 to Day 10) |
| Assessments (student view) | Assessment Overview, plus each student's own submissions (see *Assessments* below) |
| Online lessons and quizzes (student view) | Assessment 1A : Pre Program, Lesson Quiz Questions, Lesson Quiz Results |

## Privacy

Student emails are never sent to anyone's browser. They stay on the server side: in Airtable, and in the site's private Netlify Blobs cache (see *Speed and Airtable limits*). Other students see only name, university, country, team and goals. Committee-only fields (committee to-dos, notes, attendance, task list) are only sent to committee sessions. The Airtable token stays on the server.

## Assessments

Students get an **Assessments** page (and a "next deadline" line on Home) built from the **Assessment Overview** table:

* A row called *Assessment* is shown first, as the summary. Rows whose name starts with *Assessment* get a card each; anything else (Discord instructions, teamwork resources) is listed under *Resources*.
* The due date, weighting and purpose are read from the **Due**, **Value** and **Purpose** lines in *Notes*. To set them directly, add a *Due date* (date) or *Value* field: those win when filled in.
* *Link* becomes the card's main button, and files in *Assessment Rubric* become rubric links. *Notes* show under *Full instructions*.

Each student also sees what they have handed in, matched by their email address:

| On the card | Comes from |
|---|---|
| ePortfolio: Submitted / Not submitted yet | Assessment 2: Individual experiential ePortfolio Submission (*Email*). Monash students are told to submit on Moodle instead. |
| Team pitch: Team documents in | Open House Submission (*Team Number*, matched to the student's team) |
| Participation: daily reflections, self-evaluations | Learning Reflection, Self Evaluation - Week 1 and Week 2 (*Email*) |

Only email addresses, team numbers and days are kept from those forms, and each student's status is worked out on the server, so no one sees anyone else's submissions. Any of these tables can be missing from a base: that part is simply left out.

### Online lessons (Assessment 1A)

Students do Assessment 1A on the **Online lessons** page instead of following links to Airtable and SurveyMonkey.

* **Lesson content** comes from the *Assessment 1A : Pre Program* table. Name rows *Lesson 2* (the lesson's introduction, with *Time (Mins)*), *Lesson 2 : Intro*, *Lesson 2 : Part 1*, *Lesson 2 : Part 2* and so on. The first line of *Description* is the heading. YouTube links in *Reference Video to be watched* play inside the page; other links and *Attachments* become buttons. Rows with the same name are shown together, so a part can have several links. *Lesson N : Quiz* rows (the old SurveyMonkey links) are ignored, and *Pre Program Overview* is not shown as a lesson.
* **Questions** come from **Lesson Quiz Questions**: *Lesson*, *Order*, *Option A* to *D* (leave unused ones empty), *Correct answer*, an optional *Explanation*, and *Active* (only ticked questions are shown).
* **Marking** happens on the server (`/api/quiz`), so the correct answers are never sent to students' browsers. A lesson is complete when every answer is right; students can try as often as they need, and see which questions to look at again. Answers and explanations are shown once they get everything right.
* **Results**: every attempt is saved to **Lesson Quiz Results** (email, name, university, lesson, score, passed, time). The 1A card on the Assessments page shows "2 of 4 lessons" from the passed attempts. This needs the `data.records:write` scope on the token.
* **Monash** students can read the lessons but see a note that they complete 1A on Moodle, and get no quiz.

## Shared checklist

Each task in **SC Tasks** has a **Done by** field listing the universities (and Maker's Asylum) that have finished it. When a committee member ticks a task on the dashboard, their own university (from their row in **Steering Committee**) is added to that list, so colleagues at the same university see the same ticks on any device, and everyone sees who has done what. You can also edit **Done by** by hand in Airtable.

This needs the Airtable token to have the `data.records:write` scope. With a read-only token the dashboard still works; a tick is then kept only on the device where it was made, and the dashboard says so.

## Speed and Airtable limits

Airtable allows 5 requests a second per base, and a whole cohort opening the dashboard at the same minute would go past that. So the site reads the tables once, keeps that snapshot for a minute in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) (private storage that comes with the site, nothing to set up), and serves everyone from it. An edit in Airtable therefore takes a minute or two to show. Past projects are kept for an hour.

If Netlify Blobs is ever unavailable, the functions fall back to reading Airtable directly. To check which path served a page, look at the `X-Data-Source` response header of `/api/me`: `memory` or `shared` (cache), `airtable` (this request refreshed it), or `stale` (an older copy, because a refresh was under way or Airtable could not be reached).

## Known limits

* Students' to-do ticks are saved in each person's browser, not in Airtable.
* A sign-in link can be reused until it expires (15 minutes).

## Past projects gallery

Students (and the committee) get a **Past projects** page and a "Past projects on your goals" card on Home.
It reads each previous cohort's **Open House Submission** table directly from Airtable, so nothing is copied.

For it to work, the Airtable token in `AIRTABLE_TOKEN` must have **data.records:read** access to every
past SECIP base, not just SECIP Jan 2027. Any base the token can't read is skipped quietly.

Cohorts included by default (edit `netlify/functions/past-projects.js`, or set a `PAST_BASES`
environment variable like `appXXXX:July 2027,appYYYY:Jan 2028` to override):
July 2026, Jan 2026, June 2025, Jan 2025, July 2024, Jan 2024, July 2023, Jan 2023, July 2022, Jan 2022, July 2021, Jan 2021.

Columns are found by name (team name, problem, solution, SDG, team members, slides/poster, documentation link),
so slightly different layouts in older cohorts still work. Results are cached for an hour.

## Code of conduct

Everyone taking part in this project is expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1). Report concerns to info@makersasylum.com.

## Licence

The code in this repository is licensed under the [Apache License 2.0](LICENSE) (SPDX: `Apache-2.0`). See [NOTICE](NOTICE) for attribution. You may use, change and redistribute it, including commercially, as long as you keep the copyright and licence notices and mark files you change. The licence grants no rights to the "SECIP", "Maker's Asylum" or "Maker's Asylum Foundation" names.

What is not covered:

- **Programme data.** Student, mentor and committee records, past project submissions, pitch decks and files live in Airtable and are not part of this repository or this licence. They stay private to SECIP.
- **Secrets.** Tokens and keys are set as Netlify environment variables and are never committed (see `.env.example`).
