# Running the v0.5 closed beta

The v0.5 "Beta" milestone (`docs/ROADMAP.md`) is a closed beta with about 50 learners. It has two
jobs: find the exercises that are wrong, unclear, too hard or too easy and fix them, and check that
people keep learning. It is done when both exit criteria hold:

| Exit criterion | Target | Where it is measured |
| --- | --- | --- |
| 4-week retention | ≥ 35% | `npm run beta:report`, "Exit criteria" and "Retention by cohort week" |
| Items flagged as wrong, after fixes | < 1% of the items learners saw | `npm run beta:report -- --since <fixed content version>` |

All beta data is opt-in and anonymous. The privacy notice that learners see is
[`docs/PRIVACY.md`](PRIVACY.md); the server is [`services/collector`](../services/collector/README.md);
the contract between them is [`packages/beta-schema`](../packages/beta-schema/src/index.ts).
Keep the promises in `PRIVACY.md`: no names or emails in the collector, ever.

## Timeline (4–6 weeks)

Week-4 retention needs five weeks after a learner joins (the join week plus weeks 1–4), so recruit
early and close invitations after two weeks.

| When | What |
| --- | --- |
| Week −1 | Deploy the collector, build the beta app, test the pipeline with `beta:fixture`, write the invite. Recruit. |
| Week 0 | Send invites in two waves (about 30, then about 20 a few days later). Check `/v1/health` and the first uploads. |
| Weeks 1–2 | Weekly report. Fix crashes first, then items reported as wrong. Late joiners still welcome. Close invites at the end of week 2. |
| Weeks 3–4 | Weekly report and fix cycles. Ship content fixes as new content versions. First cohorts complete week 4. |
| Week 5 | All cohorts that joined in weeks 0–1 are complete. Check both exit criteria on the fixed content (`--since`). |
| Week 6 (if needed) | Cohorts from week 2 complete; a last fix cycle for anything still flagged as wrong. Decide: exit, or extend by two weeks. |

## Recruiting 50 learners

- **Who.** English speakers who are beginning German: complete beginners (A1 unit 1) and false
  beginners, and at least ten who live in or are moving to German-speaking Switzerland (the Swiss
  lane needs its own reports). Aim for a device mix of roughly a third each iOS Safari, Android
  Chrome and desktop; speaking exercises behave differently on each (`docs/QA.md`).
- **How many.** Invite about 65 to end up with 50 active learners. Only learners who switch on
  "item statistics" count for retention; tell people that this is the one switch that helps most.
- **Placement check (v0.2 exit).** If a teacher can assess some testers (ten is enough), note the
  teacher's level next to the app's placement for them, outside the collector. The roadmap target
  is 80% within one unit.
- **Where.** Language schools and conversation groups, expat groups in Zürich, Bern and Basel,
  university language centres, friends of the team. No paid panels.
- **Contact list.** Keep the list of names and emails of invited people in the team's own mail or
  a private sheet, **never** in the collector, the repo or a report. The beta app has no accounts,
  so nothing in the data links back to it.

### Invite

The invite is a link to the beta build and a few lines:

> You're invited to the Doppelpunkt beta: an app for learning German, with Swiss German alongside.
> Use it for four weeks, as little or as much as you like. It works offline and keeps your progress
> on your phone.
>
> Two things help us most: in the beta section of **Settings**, switch on **item statistics**
> (anonymous counts per exercise), and tap **Report a problem** whenever an exercise seems wrong
> or unclear.
> Everything is off until you switch it on; what we collect and keep is in the privacy notice in
> the app. Questions or problems: reply to this email.

Send a short reminder in week 2 and week 4 ("what was the most annoying exercise?"), from the same
address. Don't send reminders that depend on usage: we don't know who uses the app, and that is
by design.

## Setup

1. **Collector.** Deploy `services/collector` as described in its README: EU D1 location,
   `INSTALL_SECRET`, `RATE_SALT`, `EXPORT_TOKEN`, and `ALLOWED_ORIGINS` set to the beta app's
   origin. Check `GET /v1/health` shows `configured: true`. Keep `INSTALL_SECRET` stable for the
   whole beta: a new one makes every install a new cohort and breaks the retention table.
2. **Beta build.** Build the app with the collector URL baked in. Without it the app sends nothing
   and the beta switches explain that they are not active.

   ```sh
   VITE_COLLECTOR_URL=https://doppelpunkt-collector.<you>.workers.dev npm run build
   ```

   The URL must be `https` (plain `http` only for `localhost`). Deploy `apps/web/dist/` to its own
   origin, for example `beta.doppelpunkt.example.org` (`docs/DEPLOY.md`), so that the public build
   never talks to the collector.
3. **Smoke test.** On one phone: switch on all three beta switches, do a few exercises, report one
   as wrong, then export (next section) and run `beta:report`. The item and the report must appear.
   Then switch statistics off and check the install is forgotten (`/v1/forget`).
4. **Dry run of the reports** with synthetic data, so that the team knows what to expect:

   ```sh
   npm run beta:fixture -- --out beta/fixture.json
   npm run beta:report -- --in beta/fixture.json --out beta/fixture-report.md
   ```

   The fixture is deterministic (same content and `--seed`, same file), has 50 simulated learners
   (`--learners`), and plants known problems: an item reported as wrong, a too-hard, a too-easy and a
   slow item, two removed ids, an item with reports but too few attempts to judge, and three crash
   groups. It is marked `"synthetic": true`, its app version is `0.5.0-synthetic`, and the report
   says **SYNTHETIC DATA** at the top. Never mix it with real exports.

## Weekly routine

Every Monday (one person, about an hour, plus fixes):

1. **Export** everything (retention is always complete; don't use `?since` for the weekly report):

   ```sh
   curl -fsS -H "Authorization: Bearer $EXPORT_TOKEN" https://doppelpunkt-collector.<you>.workers.dev/v1/export > beta/export-2026-W45.json
   ```

2. **Report** against the current content:

   ```sh
   npm run beta:report -- --in beta/export-2026-W45.json --out beta/report-2026-W45.md
   npm run beta:report -- --in beta/export-2026-W45.json --json --out beta/report-2026-W45.json   # for scripts and comparisons
   ```

   Paths are relative to where you run the command. Links in the Markdown point to the YAML file
   and line of each item, relative to the report's folder, so open the report in the repo
   (an editor or the GitHub preview) and click through. The command fails with a list of problems
   when the file isn't a valid export.
3. **Crashes first** ("Crashes": grouped by message with numbers and ids replaced). Anything with
   more than one report or on a main route (`/unit/:id`, exercises, `/exam/...`) is a bug for this
   week, with a test.
4. **Triage the flagged items** (next section), most urgent first, as the table is ordered.
5. **Fix, lint, ship.** Change the YAML, run `npm run content:lint` and `npm test`, bump the
   version in the root `package.json` (the packs carry it as the content version), note the fixes
   in `CHANGELOG.md`, and deploy the beta build.
6. **Check the fixes** the following week with `--since <that version>`: only statistics and
   reports from the fixed content count, so old reports on the old wording drop out.
7. **Post a short summary** to the team: the exit-criteria table, the number of flagged items, what
   was fixed.

**Handle exports and reports as personal data** (comments and attached answers may contain some
by accident): keep them in a private place or an untracked folder (`beta/` above; don't commit it,
add it to your local `.git/info/exclude`), don't paste comments into public issues, and delete
the exports when the beta ends. Reports keep at most five comments per item in the Markdown; the
JSON has all of them.

## Reading the report

The report joins the export with the current content by item id: unit exercises and mock-exam
items by their `id`, pronunciation drill items by the ids the app uses (`pron-<drill>-word-<i>`,
`pron-<drill>-pair-<n>`, `pron-<drill>-sentence-<i>`, and `<drill>-mp-<pair>-<a|b>` for the "which
did you hear?" quiz).

| Column / rule | Meaning |
| --- | --- |
| attempts | All attempts, including retries. |
| facility | Weighted first-try score from the buckets: [0, 0.5) counts 0, [0.5, 0.8) counts 0.5, [0.8, 1] counts 1. |
| time | Seconds per attempt (rounded to 5 s on the device), with the median of the item's type. |
| reports | "This is wrong / unclear" reports by reason, and reports ÷ attempts. |
| **too hard** | Facility < 0.3, with ≥ 30 attempts. |
| **too easy** | Facility > 0.95, with ≥ 30 attempts, only after A1 unit 3 (early items are meant to be easy). Mock exams count as after unit 3; pronunciation drills never count. |
| **often reported** | Reports ≥ 2% of attempts with ≥ 30 attempts, or ≥ 3 'wrong-answer' reports at any count. |
| **slow** | Time > 3× the median of its type (median over at least three items of that type with ≥ 30 attempts). |
| **wrong** | ≥ 3 'wrong-answer' reports, or 'wrong-answer' reports ≥ 2% of attempts with ≥ 30 attempts. This is what the "< 1% flagged as wrong" exit criterion counts. |
| Unknown item ids | Ids in the export that are not in the content: renamed or deleted items, or learners on an older build. |
| Units | Per unit, mock exam and drill: items seen, attempts, facility, reports, flagged and wrong items. A unit whose facility is far below its neighbours is worth a look as a whole. |
| Retention | Per cohort week (ISO week of the first upload): installs, and the share active in weeks 1–4 after. Week-4 retention is the sum over complete cohorts (at least five weeks old); younger ones are marked incomplete. |

Items with fewer than 30 attempts are not judged on facility, time or report rate: with 50
learners the later units will stay below that, and that is expected. Three 'wrong-answer' reports
are worth a look at any count.

## Triage: from flagged item to content fix

For each flagged item, open the linked YAML, read the comments ("What learners wrote"), and do the
exercise yourself in the beta app. Then:

| Flag | Usually means | Fix |
| --- | --- | --- |
| **wrong** / 'wrong-answer' | The stored solution is wrong, or a correct answer is not accepted. | Correct the solution, or add the learner's answer to the accepted alternatives (`answers`) when it is right. Update the `explanation`. Check the same pattern in the unit's other items. |
| 'swiss-form' | A Swiss German spelling or word the learner knows differently. | Language expert decides: add the variant as an accepted alternative (Dieth-style spelling, `gsw-zh` vs `gsw-be`), or explain the regional difference in the explanation or Swiss notes. Keep the variety tag right. |
| 'unclear' | The prompt or options can be read two ways. | Rewrite the prompt; make the distractors clearly wrong; add the English gloss. |
| 'typo' / 'audio' | Text or recording problem. | Fix the text; for audio, re-record or mark for re-recording (`docs/AUDIO.md`) and check the transcript matches. |
| **too hard** | Uses grammar or words not taught yet, too many gaps, or a misleading distractor. | Check `grammar` refs and vocab against the unit; split into two items; add a hint to the explanation; move it to a later unit if it belongs there. |
| **too easy** | The answer is guessable (one option obviously different, answer copied from the prompt). | Strengthen the distractors or turn it into a gap/transform item. If it is a deliberate confidence builder, leave it and note why in the commit. |
| **slow** | Long audio, many tokens, or a confusing interface for that type. | Shorten or split; check on a phone; if it is the interface, file a frontend bug instead. |
| Unknown ids | An item was renamed. | **Don't rename ids of items learners have seen**: statistics and reports are keyed by id. Rename back, or accept that the history is lost. Ids that are old builds disappear on their own. |

Rules for fixes during the beta:

- Every exercise keeps a stored solution and an explanation; closed items never need AI to grade
  (`CLAUDE.md`). Tag every German sentence with its variety.
- Change items in place and keep the id when the item is still the same exercise. Use a new id
  only when it becomes a different exercise; then the old statistics no longer apply anyway.
- Swiss German changes go through the Swiss reviewer, Standard German changes through the German
  reviewer (`docs/NATIVE_REVIEW.md`).
- One content version per weekly fix batch keeps `--since` meaningful.

## Exit criteria

- **Retention ≥ 35%**: week-4 retention over complete cohorts, in the "Exit criteria" table of the
  weekly report. If it is below target at week 5, look at where people stop (the week 1–3 columns and
  the units with the fewest attempts compared with the unit before), ask the testers in the week-4
  reminder, and decide with the team whether to extend the beta with a second recruitment wave.
- **< 1% of items flagged as wrong, after fixes**: run the report with `--since` set to the content
  version of the last fix batch. The criterion counts items that learners saw in that version and
  that are still "wrong" by the rule above. Run it once at least one week of data on that version
  exists, or the denominator is too small to mean anything.
- Write the final numbers, the date and the content version into the v0.5 section of
  `docs/ROADMAP.md` and `CHANGELOG.md` when both are met.

## Reference

```text
npm run beta:report -- --in <export.json> [--out <report.md|report.json>] [--json]
                       [--since <content version>] [--content <content dir>]
npm run beta:fixture -- --out <fixture.json> [--seed <text>] [--learners 50]
                        [--start 2026-09-07] [--weeks 8] [--content <content dir>]
```

`beta:report` exits 1 when the input is not a valid `ExportDump`, 2 on a usage error, and 0
otherwise, also when exit criteria are not met. Code: `tools/src/beta-report.ts`,
`tools/src/beta-catalog.ts`, `tools/src/beta-fixture.ts`; tests in `tools/test/beta.test.ts`.
