# korbat sub-project 3d: transparency and automation

Date: 2026-10-09. Status: design, written without the user with the lighter process of the 3e and 3f designs: an index of the scope and the gaps, three research files, one architect's model with its labs, three drafters, one review round by three reviewers (the ledger, SQL and files; the people, the law and the words; fit to the code, the adapters and the tasks: 62 findings, all applied, five of them in the form a ruling gave), a consistency pass and a last settling of four points. It expands the model `korbat-scratch/research-3d/model-3d.md`, which is decided; what the owner or counsel may overturn is flagged in section 2 and gathered in section 17. What the review round did not find is found when the code is built; the dry run's amendments will be added at the end as 3c's were.

It is the last design of sub-project 3 and builds on the three before it: the 3c design (`docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`, cited as "3c" or "C" with its section), the 3e design (`docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`, "3e" or "E") and the 3f design (`docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md`, "3f" or "F"); "M" with a line number is the main design (`docs/superpowers/specs/2026-09-03-korbat-design.md`). It changes none of their migrations. **Every part that needs a third party or a fetched artefact is behind an adapter that is off by default** (the edge cache's purge, the matching of uploads against a list of known material, the classifier for rule R1, an outside witness for the audit log's head): with all of them off, 3d still builds the public pages and counts, the quarantine of sealed image files, their release with its replay, the automated decision as a kind of its own, and the signals; what the owner must obtain, decide and sign before any adapter is switched on is section 17.

Research, in `korbat-scratch/research-3d/`: `inputs.md` (scope items D1 to D28, where the designs overtook the earlier research P3-1 to P3-24, gaps X1 to X18); `gap-X-transparency.md`, `gap-X-automation.md`, `gap-X-known-material.md`; the lab `lab-3d/` on PostgreSQL 18.6. The reviews, the rulings and the editors' logs are beside them.

## 1. Context

3c gave korbat cases, decisions that are the statement of reasons, a ledger from which every restriction is derived, and a freeze and a seal for suspected child sexual abuse material that nobody at korbat opens. 3e added the measures on an account. 3f added authorities' orders, the alert channel, the records of what korbat tells an authority, and the daily copy with its restore. Each of the three left the same things to 3d, and this design builds them.

**What is missing today**, in the scratch clone at `aab8345` and in the three designs:

- **Nothing is public.** The app has no `/rules` and no `/transparency` (`apps/app/src/app/` holds `explore/about.tsx`, `terms.tsx`, `report.tsx` and `notice/`). The rules are read only inside the report form and the terms. Migration 0014 dropped the old `transparency_log`, and no count of anything leaves the database. The audit log's head leaves the server only in the keeper's hands (3f).
- **A sealed image has no end and no safe place.** A seal for good ends only by a reversal (`measures_in_force`, `0015_greedy_zuras.sql:679`), so the files stay in `media-store`, which the API mounts and the worker writes. An API under an attacker's control can read any stored file and ask for any file's deletion (`apps/api/src/media/files.ts:178`, `:181`; C 11). After a restore nothing says which sealed images had been released, because nothing can release one.
- **A hidden image stays at the edge.** A public image is served with `public, max-age=300` (`apps/api/src/media/flows/serve.ts:6`), and no code tells a cache when a measure, an order or a deletion ends that.
- **No program can act, and none may.** `decisions.decided_by` is NOT NULL (`0015:136`), `decisions_record` forces `automated_decision` to `not_automated` (`0017_appeals.sql:169`), a finding needs a staff account, and `post_media.nsfw_score` has existed since migration 0000 with no writer. An upload on no post is never reached by the freeze, and the sweeper deletes it after a day (C 17).
- **Nothing counts the recipients** (DSA Art. 24(3)), and nothing flags a wave of linked reports (M 147).

**What binds 3d.** korbat's promise is that every removal cites a public rule, shows the author what happened and can be put before a person, and that there is no silent reach reduction. An automated step is where that promise is easiest to break, so the owner's rulings (section 2) bound the model before it was written: a program acts at most temporarily and protectively, says so at once, and never has the last word; nobody at korbat opens a matched image; no public figure points at a person; every part that needs a third party is a mechanism behind an adapter that is off. The law that applies to a micro platform is met without the parts that do not bind it: the statement of automated means (DSA Art. 17(3)(c)), the terms' description of each tool (Art. 14(1)), the recipients' figure that Art. 24(3) obliges korbat to give on request, the yearly report of TCO Art. 7(2) in a year with an order. The Art. 15 report, the publication of Art. 24(2) and the Transparency Database do not bind a micro or small enterprise (Art. 15(2), 19(1); GT X3.3): the first and the last are not built (rows 4 and 6), and the recipients' figure is published by choice (row 8).

**This design delivers**, with every adapter off:

1. the quarantine: sealed files out of the store and out of the API's and the worker's reach, moved by a one-shot service that has no network and no database;
2. the release: a one-way end of a seal for good on a recorded leave or instruction to destroy, never on an authority's assessment alone, with its proof of destruction and its replay after a restore;
3. an outbox row for every image that stops being public, drained to an edge adapter, and cache headers that bound a copy without it;
4. the public pages `/rules` and `/transparency`, with yearly banded counts, the recipients' figure and the audit head's daily value;
5. the automated decision: a decision without a person that is always interim, holds one protective measure, is tied at commit to the system's audit row and its signal, is capped, is stated at once, and is open to "Ask for a person";
6. the mechanisms of two automated tools, each reachable only through its test adapter until the owner acts: the scorer for rule R1 and the matcher against known material for rule R2, with the hold of an upload on no post that the source reports as an exact match of what it classifies as child sexual abuse material, and a flag for a person for every other match;
7. the flag "possible coordinated reporting", shown to staff and read by nothing else.

After 3d, sub-project 3 is complete. The going-public gate (C 17) is met by Tasks 1 and 2 of this design together with 3f's order path and the owner's list (section 17).

**Short names**, used in every section: C, E and F are the 3c, 3e and 3f designs (`docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`, `2026-10-09-account-sanctions-3e-design.md`, `2026-10-09-authorities-orders-3f-design.md`), each with its section; M is the main design, by line. GT, GA and GK are the gap research `korbat-scratch/research-3d/gap-X-transparency.md`, `gap-X-automation.md` and `gap-X-known-material.md`; IN is `inputs.md` there (scope items D1 to D28, disagreements P3-1 to P3-24, gaps X1 to X18); LAB is `lab-3d/` there, with its runs A, C, D and E (section 3). "Row N" is row N of section 2. "The system" is the system actor, `SYSTEM_ACTOR_ID` (`apps/api/src/auth/admin.ts:7`), which has no profile and no key.

## 2. Decisions taken without the user

The owner asked for 3d to be designed without them and ruled seven points before the model was written; the model's architect decided the rest, and the orchestrator ruled the model's six open points. This section records all of it. The mechanics are stated once, in the section each row names; a row gives the decision, the alternative and its cost, and what it rests on.

**One list, not three.** Section 17 is the list the owner works through and the README prints: it holds every line of the two lists below with its steps. The two lists here are its index by row. A row that the table flags `(owner)` or `(counsel)` and that has no line in section 17 is a fault of this design, since a line that is missing there is a thing nobody does.

**For the owner**, before anything is switched on:

- *The facts every "does not bind" rests on:* the Member State; the operator's legal form, staff and turnover (a micro or small enterprise); how backups are made, since the quarantine is outside them (row 40).
- *The pages:* yearly banded counts and no public row of a decision (rows 1 to 3); one yearly edition and no report in the DSA's template (row 4); the recipients' method and whether signed-out readers are counted, `RECIPIENTS_SIGNED_OUT`, default `on` (row 8); where the audit head's value stands (row 9); the amendments to the main design's promises (row 10).
- *The edge:* the zone, the token, the zone's four settings and the check (row 11, section 5); the new headers (row 12).
- *Rule R1:* leave to fetch the weights; native or WebAssembly runtime (row 50); whether a score only flags, `AUTOMATION_R1_ACTS`, default `off`, or also withholds (row 19); the caps and the two limits on unanswered measures (row 18); the published target of 24 hours, and who answers a request for a person within it when the one admin is away, or the tool stays off (row 25); no composer warning (row 21).
- *Known material:* whether a hash-only query is inside "no moderation SaaS" and which source to apply to (row 32); whether the source lets korbat name it on the rules page and in a statement (row 36); whether a match seals by itself, `AUTOMATION_R2_ACTS`, default `on` once a matcher is on (row 27); which matches act and which are only a flag for a person (row 28); nothing new for the account (row 29); an unanswered check lets the upload through (row 34); a refused upload stays refused, and the limit on refusals an hour (row 35); Cloudflare's tool stays off (row 31).
- *The quarantine and the release:* who moves the files and when (row 38); no backup of it (row 40); at the registration with the national intake, whether the authority answers with an assessment, whether it says when it has the evidence it needs, and whether and in what form it instructs a host to delete (row 41); who records a leave or an instruction to destroy, and from which paper (row 41); whether a second person witnesses a destruction (row 42).
- *The signals:* what "defer" may do (row 48).
- *Who answers an objection to the processing* (GDPR Art. 21), which the terms offer at the contact address (rows 8 and 33).
- *Before a tool is switched on, and again before its measure is:* the impact assessment for that tool, whose dates are the four settings of row 49.

**For counsel**, in the order of how much waits on the answer:

1. The period and the basis for keeping sealed images, and the backups (rows 41 and 46). On an answer that the material is illegal: must korbat destroy its copies, when, and does it need the authority's or a court's word to do so; and may korbat destroy before the authority has taken or declined the evidence, and what does it risk if it does (GK X13.4, counsel 2 and 4). Until the answer the design waits both ways: nothing is destroyed without a recorded leave or instruction to destroy, and nothing is released by time, since `release_rules().silence_days` is null.
2. Whether a match obliges a report, on a post and on an upload that is on no post, for an exact match and for one that is only flagged; whether a held upload is lawful possession; and whether korbat may keep the uploader's address for seven days as it does for a seal (rows 27 and 35).
3. GDPR Art. 22 for the automatic seal, for the refusal of an upload, for the withhold on a score, and for a confirmation by a person who cannot look; the exception of Art. 22(2) that an automatic seal needs; Art. 22(4) for R1; solely automated decisions about users of 16 and 17 (recital 71) (rows 19, 25, 27 and 35).
4. GDPR Art. 10 for the match record and the transfer of a hash abroad; whether korbat may act on a classification made under another country's definition; whether hashing public uploads is outside the ePrivacy Directive's transposition, so that Art. 6(1)(f) suffices (rows 28, 33 and 37).
5. Whether an order under a non-disclosure decision may be counted, and which gives way, the report's date or the hold; whether the order section's exact numbers stand (rows 3, 4 and 5).
6. The basis of the daily digest of signed-out readers, and whether a figure given as two bounds meets Art. 24(3) (row 8); whether a copy at the edge or in a browser counts against the TCO hour (row 13); what the author is told at a release, and what a release does to a waiting appeal (row 44); the quarantine's single copy (row 40); the period of a match record (row 37); Cloudflare's tool (row 31); a match and the account (row 29); whether a statement may name the source's list (row 36).

**The owner's rulings** (2026-10-09), cited in the table as "ruling N":

1. Mechanisms now, providers by the owner: every part that needs a third party or a fetched artefact is behind an adapter that is off by default and has a test adapter. The Transparency Database is not fed.
2. No dependency is added by a model, and none that needs an install script or native code without the reason stated; korbat's own small implementation where no package qualifies.
3. Nobody at korbat opens an image reported or matched as child sexual abuse material. No text says more of a match or a score than is known.
4. An automated step never has the last word: at most temporary and protective, stated at once with the sentence on automated means, with a simple way to a person from the first minute; the fallback "only raise an urgent item" is a setting.
5. The public pages point at no person; an order under a non-disclosure decision is never countable from outside while its hold runs.
6. The release is a one-way end recorded with the authority's reference; its periods are constants, and the destructive step waits for a recorded authority's answer and an admin's confirmed action.
7. 3d changes no migration of 3c, 3e or 3f.

**The orchestrator's rulings on the model's open points**, cited as O1 to O6:

- **O1.** The 3f design is amended so that `seal_report` also returns the answer's word and the time the report was sent (section 15). For the release, two reads of 3f's records remain in 3d's own definer functions, a hand-over's day (6.2) and a held upload's record (6.7); the edition's order section reads 3f's rows as `tco-counts` does (6.4). Since the review, two more reads and one write of 3f's tables are added: whether an authority asked that the person is not told (`release_tellable`, 6.2, row 44); a refusal's setting of the uploader's row of `auth.report_holds`; and, before `upload_hold_end` releases that row, whether a record of the account is still owed (6.7, row 35).
- **O2.** The release's mark is keyed on the post (row 43), with a dated note in C 17.
- **O3.** 3f's target of 55 minutes stays (row 13), with a dated note in F 16.
- **O4.** A task that replaces a function begins by running the lab again on the built code. The lab's scripts were written against migrations 0016 and 0017 and cannot run against the built code as they are, so "again" means: each case the lab accepted and each refusal it measured becomes a test on the built code, with the same code (section 6, "Replacing a function").
- **O5.** A held upload is a record of its own, not a case (row 35).
- **O6.** The three defaults stand: `AUTOMATION_R1_ACTS=off`, `AUTOMATION_R2_ACTS=on`, `RECIPIENTS_SIGNED_OUT=on`. Each is flagged for the owner, and no tool runs, and none takes a measure, before the owner has set the date of row 49 that covers it.

**The review round's rulings** (2026-10-09, `korbat-scratch/research-3d/review-3d-rulings.md`), cited as "review ruling N" under that file's numbers. The first six are invariants that sections 6, 7 and 11 hold:

1. **Destruction needs leave, not an assessment.** An authority's recorded answer `illegal` is an assessment: by itself it changes nothing about the files, which stay sealed and in the quarantine. Sealed files are destroyed only on a recorded leave or instruction to destroy, from the authority or a court, with its reference, recorded from the command line as a fact of its own, and on an admin's confirmed action. `not_illegal` supports the unsealing; no answer supports nothing. The terms promise no destruction and no period. The author is not mailed an authority's assessment (rows 41, 44 and 46).
2. **An image found by a match is never opened by staff, whatever the answer.** The one function that serves staff an image refuses an image that an unerased match record names, on every case, also after an admin has answered without a seal (rows 26 and 27).
3. **Only what the source classifies as child sexual abuse material acts.** A match of any other class refuses nothing, holds nothing, seals and freezes nothing and cites no rule: it is recorded and shown to a person as a flag (row 28).
4. **Only what the source calls an exact match acts by itself.** A `near` match, or any answer short of exact, is a flag for a person (rows 27 and 28).
5. **A held or refused upload is in no reader and no export** (row 35).
6. **What a refused upload leaves behind agrees with what the person is told** (rows 35 and 37).
7. The console instructs nothing about reporting: the two ends of a hold are worded neutrally, none is preselected, and what counsel advises is in the runbook (row 35).
8. A handled match is marked on the match record itself, so nothing the retention job deletes makes the sweep act twice (6.7, 6.8).
9. The quarantine's receipt is taken line by line; one bad line never stops a run, and no file is left in the quarantine without a record (6.1, row 38).

Rulings 10 to 12 are about the wiring, the tasks and the names, and are applied in sections 5, 10, 12 and 13.

**The table.** Flags: `(owner)` the owner may overturn; `(counsel)` rests on a reading of law that counsel must confirm. A row without a flag follows from a ruling, from the three designs or from a measurement. Every number is a constant of one SQL function (`automation_rules()`, `release_rules()`, `transparency_rules()`, section 6) mirrored in the contracts. "Cautious" means: among the choices a source supports, the one that never exposes, never destroys and never tells more than is known.

| # | Decision | Chosen | Alternatives and their cost | Rests on |
|---|---|---|---|---|
| 1 | What the transparency page shows | Counts only, in yearly editions; no row of a decision, no `puid`, no day. A table by ground (each rule, "the law"), a table by kind of measure, never their cross; notices and reports received; appeals answered in the year with their outcomes; account measures (E); automated findings; refused uploads. `(owner)` | Rows without a date (GT X5.4 option 2): 1 to 7 % of rows stay linkable. Rows with a day, as the Transparency Database has them: most rows are then a statement about a known person. Cost of the choice: M 110's "public copy of every case" is withdrawn (row 10). | GT X5.3; IN P3-18; ruling 5 |
| 2 | Period and delay | The calendar year in UTC. An edition is computed once, on or after 1 March of the next year, as of that day, stored and never changed; a correction is a new version beside it, marked and dated. A version that only adds an order whose hold ended copies the stored tables and replaces the order section alone, so two versions of a year never differ by what happened to a few people in between; only a correction computes the tables again, as of the same 1 March, and its line on the page says so. Nothing on the page moves when one decision is taken; the running year shows no figure. `(owner)` | Months or quarters: at some hundreds of accounts most cells are under ten (GT X5.2 (d)). A longer delay until every appeal is final: appeals are counted by the year of their answer instead, so nothing waits. | GT X5.5; TCO Art. 7(2) for the date |
| 3 | The small-number rule | A count prints as `0`, as `1 to 9`, or rounded to the nearest ten ("about 60"). A row under ten is folded into "other grounds" (or "other measures") before printing. A rate prints only as two such counts and only when its base is ten or more. The floor 10 is the most cautious of the values the research names (3, 5, 10). The one exception is the order section's figures, which the Regulation asks for as numbers (row 4): the page, the terms and the rule itself name that exception. `(owner)` | Exact counts with suppressed cells: one suppressed cell is subtracted back from the total (LAB E4 shows the rounded rows do not sum to the rounded total). | GT X5.2, `practice.md` 4.4; LAB E |
| 4 | Which yearly reports | One: the edition. In a year that triggers TCO Art. 7(2) the edition carries F's report under F W.9's headings with the figures of `tco-counts` as numbers (the Regulation asks for numbers), without the issuing state. No Art. 15 report in the Commission's template, no CSV, no five-year promise. `(owner)` `(counsel)` for exact order figures | The template (GT X3.4 option 3): its fixed granularity forbids rows 2 and 3, and its accuracy indicators need an error rate korbat cannot measure. | GT X3.3; F 16 |
| 5 | An order under a non-disclosure decision | Not counted in any public figure while its notice is held (F's hold). The edition is published on time without it, with the standing sentence "orders whose disclosure an authority's decision forbids are counted after it ends"; when the hold ends, a marked second version of that year's edition adds it. The command line's `tco-counts` still prints all, for the authority. `(counsel)` | Count it on time: a public "1" in a year with one order is information on the removal (TCO Art. 11(3)). Hold the whole report: the date of Art. 7(2) is missed for every year with a held order. | GT X3.4; ruling 5; LAB E5 |
| 6 | The Transparency Database | Not fed. No route, no credential, no queue, no export file. Decisions stay as 3c stores them. If korbat outgrows Art. 19(1)'s exemption, a later design must build: sentences composed from enumerated fields for `decision_facts` and the ground texts (no moderator's text is ever sent); the mapping of measures to `decision_visibility` and `decision_account`, `content_type`, `content_date` from the snapshot's `post_created_at`, `application_date` from `decided_at`, `territorial_scope` as EEA codes; `end_date_account_restriction` from E's ledger; the filter that leaves out decisions of the kind `order`; a submitter idempotent by `puid` that sends nothing an appeal can still reverse; onboarding through the coordinator. | Build the export now: the database does not collect a small enterprise's statements and offers no voluntary onboarding; a sent statement can never be withdrawn. | Ruling 1; GT X1.3, X1.5 |
| 7 | The rules page | `/rules`, public: rulebook version 4; the numbers of `STANDING_RULES` and `ORDER_RULES`; a section "Automation" that prints, from `GET /api/public/facts`, for each tool whether it is on today, what it does, and for R1 the model's name, digest and threshold (row 23); a change log, one dated sentence a version, from the constant `RULES_CHANGES`. The terms keep their lists; a table test holds both to the same constants. | A static page: it would say "matches uploads" while no source exists (GK X2.3 item 5). | IN D3, D10; GA X6.3 (d) |
| 8 | The recipients' count | Method version 1. Per month: A, the signed-in accounts that made an authenticated request, counted in a HyperLogLog sketch in Valkey keyed by the month (a sketch cannot list who was counted; until it is deleted at the month's end it could still be asked whether one given account was probably counted, and the page says so); B, the sum over the month's days of signed-out readers of the API's read routes, each day's sketch fed with a keyed digest of the network address and user agent under a salt that lives 26 hours in Valkey and is written nowhere else. A crawler is left out only by its own user agent. At the month's end the two numbers are stored and the sketches deleted. The figure is the average of the last six full months, given as "between A and A + B". Printed by `staff.js recipients`; published in the edition, rounded, where it is the average of the six stored months before that edition's due day, for every version of it, so a later version never prints a later year's readers under an earlier year. `RECIPIENTS_SIGNED_OUT=off` leaves B out and the figure says "at least". `(owner)` `(counsel)` for the basis of B | A last-access date on the device: a stored value on every reader's device and a consent question. Requests times a ratio: unsubstantiated. A column on the account: a new fact about a person. | GT X4.3, X4.5 |
| 9 | The audit head's publication | Daily at the dispatch hour. The public value is `sha256("korbat.head.v2" LF day LF seq LF hash)`: it shows neither the place nor a row's hash, so nobody counts staff actions or tests a guessed row from it; and the day is part of it, so two days never show the same value and nobody reads off the days on which no audit row was written. The keeper's mail holds the day, the place and the hash, which is all the check needs. It is written to `head_publications`, shown on `/transparency`, and mailed to the keeper with seq and hash. With `HEAD_WITNESS` on, the value first gets an RFC 3161 token, stored and offered for download with the words to verify it (`openssl ts -verify`). The page says in words that a value on korbat's own page alone proves nothing against korbat's operator. A restore is a public dated row naming the last value that still verifies. `(owner)` for the place | A public log (Rekor, OpenTimestamps): a client to pin (LGPL, or a 2021 package) and a service built for another purpose. A repository host: an account. | GT X10.3, X10.5 |
| 10 | The main design's promises | Amended in words: M 110 and M 187 (yearly banded counts, no public copy of a case); M 171 (a score flags, and withholds only where the owner has set it); M 172 (an exact match of what its source classifies as child sexual abuse material seals while an admin decides, and any other match is a flag for a person; nothing is removed by a program; no report to NCMEC; no automatic suspension); M 203 (no composer warning). `(owner)` | Leave them: the design would promise what rows 1, 19, 21 and 27 refuse. | GT X5.5; IN P3-12, P3-15 |
| 11 | What is purged at the edge, and when | Every image whose file stops being public for any reason: an AFTER trigger on `post_media` and on `posts` writes one outbox row an image id in the transaction that hides it, whoever the writer is (`moderation_apply` for every measure of 3c, E and F; an author's deletion; a purge; the release). A job drains the outbox after the commit: one request by prefix (`<host>/api/media/<id>/`), up to 30 prefixes a request, at most 4 requests a minute, retried with backoff for 24 hours. A purge never delays, blocks or undoes a measure; its outcome (`accepted`, `failed`, `off`) shows on the case. | Purge by bare URL: a stranger's `?x` variant survives (GA X9.3 item 4). Call sites in each route: the next writer forgets. | GA X9.3, X9.5; IN D8 |
| 12 | The headers | Public images: `public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`. Every other answer of the API stays `no-store` (`middleware/security-headers.ts:20`), but for the three public routes, whose own headers are section 10's, and an image that is not public, as its author is served it, stays `private, no-store` (`media/flows/serve.ts:7`). The bound korbat prints is the header's: an edge copy up to five minutes without an accepted purge, a browser's copy up to one minute. `(owner)` | Today's `max-age=300`: a browser keeps five minutes no purge reaches, and stale serving is not forbidden. `max-age=0`: what the edge does with it beside `s-maxage` is documented two ways (GA X9.4), so it needs a lab on the owner's zone. | GA X9.3 items 6, 7 |
| 13 | F's 55 minutes | Stays 55. The purge is fast, unconfirmed and can fail; the honest bound is the header's. The order's screen shows whether its purge was accepted. `(counsel)` whether a copy in its last minutes counts against the hour | 60 "with the purge" (F 16): true only for a purge that was accepted and propagated, which nothing guarantees. | GA X9.3 item 8 |
| 14 | The automated decision's decider | `decisions.decided_by` loses NOT NULL; a system decision has it null and `automated_decision = 'fully'`, each implying the other by CHECK. No profile stands for the system (a profile can be followed, reported and named). `staff_texts` is untouched: a system decision has no text. | A system profile: every reader of profiles must then hide it. A column `decider`: a second fact that can disagree with the first. | C 17; LAB A1, A3 |
| 15 | Its kind | Always `interim`: no new value of `decision_kind`. So 3c's rules apply as built: it holds only measures that end by themselves (with the case's final decision; a seal with the answer to its suspect items), never a final measure, and a person's correction lifts it at once. It holds exactly one measure. | A kind `automated`: `measures_in_force`, `decision_actions_check`, `decisions_apply` and every reader of "interim" would gain a branch, for the same behaviour. | Ruling 4; LAB A2, A5 to A7, C6 |
| 16 | What ties it at commit | In place of a key's confirmation: the transaction's last audit row is `automated_decided` by the system actor, without a step-up or key, naming the decision and its one signal; its params equal the decision's columns and its one ledger row; the signal is about an image of the case's post and of the kind its rule needs, and a seal's signal names a match record that is acting, so "a flag cannot seal" is a fact of the database. `audit-verify` checks that every decision without a decider has that row in the chain. | Nothing: a decision without a person would be the one row of the ledger no record explains. | C 17; IN X15; LAB A2 |
| 17 | What an API under an attacker's control gains | It can write a signal, so it can make the system hide one image or seal one post's images at a time, up to the cap, each with a statement to the author, a line on the console's home and an audit row. It cannot take a final measure, touch an account, or exceed the cap as the system. This residual is stated in the design's section 11. | A signed result from the worker checked in the database: a key to manage in a container that has none, and the matcher's answer would stay unsigned. | LAB A2, A8; IN X15 (a) |
| 18 | The caps | Counted by rule: 20 system decisions an hour and 100 a day under R1, and the same two numbers, counted apart, under R2, so that a burst of scores never uses up the budget of a known match (the most cautious figures that still cover a burst on a service of this size; no source). Two more limits stop new measures when no person answers, and end nothing: no new measure under a rule while 20 measures of system decisions under that rule stand in force (`unanswered_max`), or, under either rule, while a request for a person has waited longer than 72 hours (`unanswered_hours`). Over any of them the step is refused `automation_capped`, the finding stands without a measure, which is the fallback of the owner's ruling 4 reached by the database when no person is there to set it, and the alert `automation_capped` goes to every staff account and says which limit was met. A refusal of an upload is no decision, so it has a limit of its own, 20 an hour (`refusals_per_hour`, row 35). `(owner)` for each of the seven numbers | No cap: a worker that scores everything high hides every new image (IN X15 (e), T24). One cap for both rules: twenty withheld images switch off the automatic seal for the hour. No limit on unanswered measures: while the one admin is away, a program's word is the only one. | LAB A8 |
| 19 | What a score may do | By itself: open a finding citing R1 (intake kind `automated`, lane 2) with `automated_detection`, shown in the queue with the chip "Found by a program". With `AUTOMATION_R1_ACTS=on`: also withhold that image until a moderator decides. The default is `off`: R1 content is lawful, a less intrusive means exists, and a score may rest on an image of a person's sex life (GDPR Art. 22(4)). `(owner)` `(counsel)` | Withhold by default (M 171): an automated decision whose lawfulness nobody has confirmed. No finding: the score would do nothing. | GA X6.3, X6.4; ruling 4 |
| 20 | Image or post | The image (`withhold_media`), never the post: no program hides text (M 180). | The post (`withhold`): hides lawful words on a picture's score. | IN P3-13 |
| 21 | The composer warning (M 203) | Not built: a score before posting is an oracle for getting past the classifier, and the author learns of a measure with its statement at once. `(owner)` | A yes/no warning counted per day: still an oracle, and a new counter about a person. | IN P3-15, `threats.md` T25 |
| 22 | When an automated step runs | After the commit that made the image public or brought the signal, in a transaction of its own that takes the author's profile, then the case, as every deciding transaction does. A sweep each minute takes signals a crash left unhandled. An image can so be public for seconds before a measure. | Inside the post's transaction: 3c's lock order (profile, then case) would meet the post's own locks, unmeasured. | IN X15 (c); E 5 "The lock order" |
| 23 | What is published about the R1 check | The model's name, the digest of its weights, the threshold and its version, the publisher's own accuracy claim in its words, that the training data is not disclosed, that no outside bias evaluation was found; in the edition, the banded counts of automated R1 findings and of those a person then restricted. No error rate is claimed. The threshold is a constant of `automation_rules()` with a version, set at the build task that measures on benign fixtures. | A calibration table: needs volumes korbat will not have for years. | GA X8.3, X8.5 |
| 24 | The automated decision's statement | Rendered from enumerated fields alone. Its automation sentence says two things apart: the image was found by automated means, and the measure was taken by automated means with no person involved yet. For a match it says only what is known (row 36). It names the rule, says that the measure lasts until a person decides, and carries "Ask for a person". Sent at once (`author_mail` pending, as any measure taken while deciding). | A moderator's fixed text in `staff_texts`: a text nobody wrote, under a person's name. | DSA Art. 17(3)(c); GA X6.5 |
| 25 | Its redress | "Ask for a person": while the measure is in force its subject may send one text of up to 2000 characters. It is stored with the decision, shown at the top of the case, sorts the case first inside its lane, and raises the alert `automated_objection`. Any moderator may then lift an automated withhold by a correction or decide the case; a seal is answered by an admin. Target: a person answers within 24 hours (published as a target, as 3c's lanes are; no source for the number; the owner accepts and staffs it, or leaves the tool off). No lapse by time; when no person answers, the two limits of row 18 stop the program from taking new measures. A suspended account, and a terminated one whose termination is not yet final, may still ask for a person and may still object to a refused upload: the two routes join the writes that E's suspension leaves, as the reply and an appeal do (E 7.3). 3c's rule that a measure taken while deciding is not appealed stands in form: the open case is the human intervention, and the final decision is appealable. `(owner)` for the target `(counsel)` | An automatic lapse after N hours: a second automated writer. An appeal of the interim decision: `appeals_check` and the different-reviewer rule compare staff accounts. | GA X6.3 (c), X6.5; ruling 4 |
| 26 | A person's decision after a signal | `decisions_record` forces `automated_detection` true when a considered item is an automated finding. `automated_decision` is `partially` when the decision restricts, is suspect and considers a match (the person cannot look, so the match is the fact it draws on), and `not_automated` otherwise; the update to whoever reported carries the same value, so it never says "no automated means" of such a decision. For R1 the moderator may open the image and is shown the words "over the threshold", never a score as a verdict. For a match no person looks, before the answer or after it (review ruling 2; note 26). `(owner)` `(counsel)` | `not_automated` for an unseen seal on a match: says less than is true. 3c's look the same day for a matched image: a person at korbat opens what a list of such material matched, hours after the author was told that nobody does. | Ruling 3; review ruling 2; GA X6.5; LAB A5, C7 |
| 27 | What a match may do | Only an acting match (row 28) lets a program do anything to anyone. On a post it opens a finding citing R2 on the post that holds the image (intake kind `automated`), which is suspect and so freezes the post by 3c's rule, and raises `moderation_urgent`: that is the design's fallback, "a match only raises an urgent item", and all that `AUTOMATION_R2_ACTS=off` leaves. With `AUTOMATION_R2_ACTS=on` (the default once a matcher is on) it also seals the post's images by an automated decision, until an admin answers. Then an admin, who cannot look, seals for good or answers without a seal, as for a report (row 26). The setting is `on` only with the owner's impact assessment for the measure and counsel's word (note 27). A match that is not acting is a flag and takes no measure under either setting (row 28). Never an account measure, never a seal of an account's other posts. `(owner)` `(counsel)` | Alert only as the default: a known image stays served until a person wakes (DSA Art. 6(1)(b); GK X11.5). A seal for good by the program: ruling 4 forbids it; it would also start E's protective basis without a person. | Ruling 4; review rulings 3 and 4; C 17; GA X6.3; LAB C1, C6, C7 |
| 28 | Which matches act, and which are a flag | Two closed lists for each source: `MATCH_LISTED`, the classifications by which that source itself names child sexual abuse material, and `MATCH_ACTING`, the part of it on which a program may act (entries the source says were verified). A match is **acting** only when its classification is on both and the source reports it as `exact`: for a cryptographic hash of the uploaded bytes (SHA-256, SHA-1 or MD5), or for a perceptual hash (PDQ) where the source itself reports an exact match. Every other match is **a flag for a person**: no program refuses, holds or seals anything on it. A flag of a listed class (a `near` match, any answer short of exact) is put before an admin as a finding citing R2 without a measure. A flag of any other class cites no rule, freezes nothing and alerts nobody: it is recorded and shown in the queue (review ruling 3). Each default here is the owner's to overturn with counsel (note 28). `(owner)` `(counsel)` | Let `near` act: targeted collisions exist (GK X7), and nobody at korbat can check one. Let a wider class refuse or freeze under R2: a restriction under a rule whose text does not reach the case (GK X7.3: such a class is "not a claim of illegality at all"). Act on SHA-256 alone: the lists hold MD5 and SHA-1 first (GA X17.3). | Review rulings 3 and 4; GK X7.2, X7.3, X7.5; GA X17.3 |
| 29 | A match and the account | Nothing new. E's protective suspension rests on an admin's seal for good, as E built it (E 17's first way); 3d adds no second basis and no ground for a termination under R2. The admin's screen shows the match's record (row 37) so that the person weighs more than a blind yes. `(owner)` `(counsel)` | "A confirmed match" as a second basis: what a person who cannot look confirms is counsel's question first (GK X7.4). | E 17; IN P3-1, P3-5 |
| 30 | A list of korbat's own removals | Not built: korbat never learns that a sealed image is such material, and a list fed by seals would let one false report block a picture for everyone. | A list fed only by an authority's answer `illegal`: a design of its own; nobody asked. | IN P3-9 |
| 31 | Cloudflare's scanning tool | Not switched on by 3d. The README says what switching it on does: Cloudflare files its own report with NCMEC about korbat's content, which korbat's designs say korbat does not make, and a match arrives as a path in a daily mail, which a person turns into a finding citing R2 by hand. `(owner)` `(counsel)` | Make it the R2 mechanism (M 172): a disclosure no law requires, decided by nobody at korbat. | GK X2.3, X11.3 item 6 |
| 32 | The matcher's seam | One interface that takes hashes and nothing else, so no adapter can send an image, an address or an account. 3d ships `off` and `test`. No adapter for a real source is written: every source needs an agreement before its interface can be read. The adapter for the source the owner obtains is a later task of a few files against this seam. `(owner)` for whether a hash-only query is inside "no moderation SaaS" | Write against Arachnid Shield's public schema now: an account in Canada the owner has not chosen. | Ruling 1; GK X2.3, X2.5 |
| 33 | Which hash, when, from which bytes, how long | Only while `MEDIA_MATCH` is not `off`. Of the upload as received, by the API while it streams the file to the uploads volume: SHA-256, SHA-1 and MD5 (the lists hold the last two). Of the pixels the worker decodes: PDQ with its quality, by korbat's own implementation in the worker, pinned by the reference's published vectors; under quality 50 no PDQ is stored. All four are computed before the original bytes are discarded, so a cryptographic match is a match of the file as it was uploaded (review ruling 4). They sit in `media_hashes`, one row an image, deleted with the image row; no hash outlives its image except the one value a match record holds. When the matcher is switched off again the retention job deletes every row of `media_hashes`, and when the classifier is switched off it sets every stored R1 score null: "only while the check is switched on" is then true of what korbat holds, and the retention list names the score as it names the hashes (6.8, 6.10). `(counsel)` | Hash every upload from the first day: a fingerprint of every image for good, for a matcher that may never come. A package: none qualifies (GA X17.3). | Ruling 2; GA X17.3, X17.5 |
| 34 | When the check runs, and an unanswered check | When the worker's result is taken in (`finalize`), with one call of at most 3 seconds. Answered: `clear` or `matched`. Unanswered: `unchecked`; the upload may be posted, the check is retried for 24 hours, and `matcher_down` alerts staff after 15 minutes without an answer. A match that arrives after posting meets row 27. An upload that its owner removes while its check is still out is not deleted in those seconds: the composer forgets it at once, and the row goes only after `finalize` has given it a verdict, so "an acting match is held" is true of every upload that was checked. `(owner)` | Block posting until answered: a third party's outage stops every image on korbat. Pass silently: nobody learns the matcher is dead. | GK X2.5 |
| 35 | A matching upload on no post | With an acting match (row 28): refused and held. The database refuses to attach it (`upload_refused`); no reader, export, list or count hands the file or its existence to anyone but the admin's screen (review ruling 5); no timer ends the hold, so the sweeper leaves the row; the uploader is told at once what the notice says and no more, with the sentence on automated means and "Object"; `moderation_urgent` goes to staff. An admin ends the hold, unseen, one of two ways, worded neutrally and with none preselected (review ruling 7): "Report" (the files go to the quarantine, the operator opens F's notification record from the command line, and the end is row 41's release) or "No report" with a reason from a closed list (the hold ends and the sweeper deletes the upload a day later). The refusal itself is the program's and stays; what it leaves behind agrees with the notice (review ruling 6); a match that is not acting is a flag, and its upload is accepted (note 35). `(owner)` `(counsel)` | Refuse and delete at once: destroys what a notification is expected to carry. Let the sweeper take it: a deletion with knowledge. Wait until it is posted: a known image goes public first. Hold any match, acting or not: a lawful picture refused under a rule whose text does not reach it. | C 17; GK X18.3, X18.5; review rulings 3 to 7; "fail closed where a mistake destroys" |
| 36 | The words about a match or a score | A statement, a notice and rule R2's text speak only of an acting match (review ruling 3). They say: an automated comparison found that an image has the same fingerprint as one that the source, by name, has classified as child sexual abuse material; korbat's staff do not open an image that is found this way, and korbat has not assessed it. "The same fingerprint" is said of a cryptographic hash alone; of a perceptual hash, whatever the source called the match, the words are "a similar fingerprint, which can also happen to different images", so the statement carries the hash type and not only the kind of match. No text says the image "is" such material, that korbat "confirmed" it, that the account "posted" such material, that nobody has seen the image, or that a person looked at it where no view is on record (row 26). A flag (row 28) is worded for staff alone: the source, its class and the kind of match. A score's sentence says that a program rated the image as likely within rule R1. The source is named only once it has allowed that. `(owner)` `(counsel)` for naming the source | | Ruling 3; review rulings 3 and 4; GK X7.5, X18.4 |
| 37 | The match record | `media_matches`: the image id, the case when there is one, the source, its list version, the hash type, the kind of match, the classification as returned, the hash value, the time, and the time the program was done with it (review ruling 8). No account column, no text. Staff see it on the case; the author sees the source's name in the statement. Erased 180 days after its case closed, its post was released, or its upload's hold ended without a report or was released, unless a seal for good on a post that is not released or a held upload still rests on it; a record that has neither a case nor a refusal, which is a flagged upload that was never posted, 180 days after it was made. Erasing sets the hash and the classification null and takes the account and the objection from the record's refusal: what stays says that an upload was refused on a day, by which source and kind of match, and how its hold ended, and it names nobody (review ruling 6). The count "other refused uploads of the same uploader" that an admin is shown never counts a hold that ended without a report, so a mistake of the source does not weigh on the next decision. `(counsel)` for the period and for GDPR Art. 10 | On the account: a marker that outlives a mistake (GK X7.5). | GK X11.5, X7.5 |
| 38 | The quarantine: where, who, when | A volume `media-quarantine` mounted by a one-shot service `quarantine` (no network, no database, Compose profile `quarantine`) and by F's `handover`, never by the API or the worker. The files of every image row sealed **for good** are moved there by the operator: `staff.js quarantine-list` prints the names from the ledger, the service copies, verifies by SHA-256, renames and unlinks, and `staff.js quarantine-record` stores each file's size and digest, line by line (review ruling 9; note 38). `quarantine_due` alerts daily from the seal for good until the record exists. A seal taken while deciding, a person's or the program's, leaves its files in the store: it is meant to end within hours either way. `(owner)` | Every seal, moved by the worker on a request file: the decoder of untrusted images would mount the quarantine, and bringing files back would be an API's request. A service with a database role: a new role and network for a job that runs a few times a year. | C 17; F 7.14; IN X12 |
| 39 | What the API can still do, and the way back | It reads the row and its state and nothing of the file; a deletion request for a quarantined file finds nothing; no request of the API brings a file back. An `unseal_media` (an admin's correction or review) makes the state `visible` at once; the files return by the same three steps in the other direction, and until then the image answers 404 and the console says "files to return" with the daily alert `quarantine_due`. | An automatic return: needs the mover to trust the API or the database. | C 11 line 594; IN X12 (c) |
| 40 | The quarantine's disk and backup | On the host's encrypted volume, owned by uid 1000, mode 0700. It is in no ordinary backup: a restore never brings a destroyed file back, and no backup keeps such material for 30 days. The price is stated: a lost disk loses the sealed files, and an image that an unsealing was to return is then recorded as lost and its author is told so (row 38). The API's image creates the mount path with that owner and mode, so a new volume takes them (section 5). `(owner)` `(counsel)` | A second encrypted copy off the server: more copies of material korbat may hold only for its duty (GK X13.3). | GK X13.5 |
| 41 | The release: who, on what | An admin's confirmed action (step-up `seal_released`), on a seal for good that is in force, reported (`seal_report`), wholly in the quarantine by record, and not preserved for an order. Ground `leave`: a leave or an instruction to destroy is on record for that seal, from the authority or from a court, with its reference and its day, recorded from the command line as a fact of its own (`staff.js release-leave`, the table `release_leaves`); the release names it. The authority's answer is no ground, whatever its word (review ruling 1; note 41). Ground `period`: `release_rules().silence_days` have passed since the hand-over or, without one, the report, the author was told the day 30 days before and has no objection unanswered; the constant ships **null**, so nothing is released by time until counsel sets it. The terms promise no destruction and no period. `(counsel)` | Release on the answer `illegal`: destroys what the authority may be about to ask for, on a word that is no leave to destroy (GK X13.3 item 2, X13.4). Release on any answer: destroys content nobody assessed. A program releases: ruling 6. | Ruling 6; review ruling 1; C 17; F 17; GK X13.3, X13.4; LAB D1 |
| 42 | What is destroyed and what is kept | Destroyed: the quarantined files, by the one-shot service on the `destroy` lines of `staff.js quarantine-list`, each with its digest taken before the unlink and recorded by `quarantine-record`; for a `destroy` line the service unlinks the file in the quarantine and, when the store holds one under the same name, there too, and prints where it found it; the image rows, which the release marks `erased_at` and 3c's disposal then drops; the post's snapshots' images by reference, through gate E as built. Kept: the release's record with the reference of the leave it rests on, the digests, the decision and its ledger rows, F's records. A hand-over archive is F's to destroy. Every staff account, the actor included, is alerted when an admin releases (`seal_released`) and when a hold ends without a report (`hold_ended_unreported`), and the console's home lists both for 30 days, as 3c does for the milder act of lifting a seal. `release_undestroyed` alerts daily while a released file is still recorded in the quarantine. `(owner)` for whether a second person witnesses a destruction | Destroy inside the confirmed action: the API would need the quarantine. | C 17; GK X13.5 |
| 43 | The release's mark | Keyed on the **post**, not on `seal_posts`' key: `release_posts (post_id primary key)`. The seal arm reads "a seal in force lists the post, and the post is not released". C 17 sketched a mark per seal row; the lab showed why that is not enough: after a restore the seal for good is taken again under a new row, lists the erased image rows, carries no mark and freezes the post again for good (LAB D3). A released post has no live image and can gain none, so "by post" loses nothing. | C 17's key with a trigger that marks every later seal row: two writers for one fact. | LAB D2 to D4; IN X14 (c) |
| 44 | The author, the appeal and the suspension at a release | The author gets a notice (not a new decision) that says what korbat did and no more: it has released the images, will not show them again or give them back, has erased its record of them and destroys the files; its ground is a leave or an instruction to destroy them, given by an authority or a court that is named by its role and never by its reference; and a backup that is deleted on time may hold them until a day it names. It does not say that korbat "no longer holds" the images, which is false until the operator has destroyed the files, and it never carries an authority's assessment (review ruling 1). Nothing is sent while a rule of non-disclosure holds it: as long as the leave's own "not to the person" runs or is open, an event of the report's record carries F's mark with an end that is open or ahead, or a decision about a post of the release is untold under F's hold, the notice is `held`, no mail goes out and no reader lists the release (`release_tellable`, 6.2); the console says so before the admin confirms. A waiting appeal of the seal is then reviewed by an admin, who alone may close it; the release closes nothing by itself. E's protective suspension is untouched: it ends by its own days. A post preserved for an order is never released (row 41), so no notice of a release meets F's hold. `(counsel)` | Close the appeal in the same act: an appeal answered by nobody. | GK X13.5; C 2 line 37 |
| 45 | The replay after a restore | Every release writes its facts into its audit row (`seal_released`: the posts' ids, the ground, who gave the leave and its reference; `upload_released` and `upload_hold_ended`: the refusal and its image's id), so the keeper's copy holds them. `staff.js restore-import` (F) writes one gap of the class `release` for each such line above the restored head, and is followed by `staff.js release-replay`, which reads the keeper's files on standard input as the import does: for each recorded release the restored database lacks, it marks the posts released, sets `erased_at` (for a held upload on its one image row, also when the restore lost the refusal), and lists the files to destroy again if a restored store or quarantine holds them. It is idempotent, runs as the migrator, and replays only a release that an open gap names, so only a line the import checked against the chain can erase an image row. `RestoreView.mayOpen` stays false while a gap of the class `release` is open. A lost end of a hold is such a gap, closed by the admin's new end of that hold; a program's lost measure (`automated_decided`) is a lost decision under F's own classes and keeps the site closed as F's rule does. A lost seal that a person takes again finds its post already released. | A confirmed action for each replay: the original release was confirmed and is in the chain the keeper verifies. | C 17; F 7.17; LAB D2 to D4 |
| 46 | Backups and the period | A backup of the store taken before a file moved to the quarantine holds it until that backup is `RETENTION.backupDays` (30) old: the release's record prints the day after which no backup that is deleted on time holds a released file; a backup that korbat keeps for an authority is outside that day and is destroyed by hand (README, Restoring), and the README's step "on an instruction to destroy, destroy the backups too" stays. How long sealed images are kept while an authority is silent, or has assessed them and given no leave, is `silence_days`, null. The terms promise no destruction and no period (review ruling 1): they say that sealed images stay sealed and kept, that an authority may never answer, and that korbat destroys them only on an authority's or a court's leave or instruction, or after a period it will publish once counsel has set one. `(counsel)` | A period korbat picks: no source binds one (benchmarks of 6 and 12 months, GK X13.3). | C 6.6; GK X13.3, X13.5 |
| 47 | The signals | One flag on a case, computed at read from rows 3c already keeps: at least 5 unanswered items from at least 5 distinct signed-in reporters arrived within 60 minutes, and at least half of those reporters follow or are followed by another of them. Shown as "Possible coordinated reporting" with the counts, never the reporters. No table, nothing new kept about a person; it goes dark when retention forgets the reporters. Signed-out notices are not in it (no account, no graph). | Shared device or network facts: a bridge into the auth schema for a hint (IN P3-16). | M 147; IN X16; C 15 line 694 |
| 48 | What "defer" may do | Nothing new. A flag never orders the queue, never closes an item, never touches the reporters, and no decision reads it; the only deferral stays 3c's published switch `MODERATION_DEFER_UNPROVEN`. No batch across cases: E's mark "manifestly unfounded" and its restriction of reporting answer one reporter's many items; the case shows only "N other open items from this source". `(owner)` | Defer flagged cases inside their lane: an Art. 16 notice waits because others reported too (Art. 16(6)). | C 2 lines 26, 40; IN P3-17 |
| 49 | The switches that guard the tools | Four dates, one for each tool and one for each tool's measure. `AUTOMATION_DPIA_R1` and `AUTOMATION_DPIA_MATCH` hold the day of the owner's impact assessment for that tool: the API refuses to start with `R1_CLASSIFIER` or `MEDIA_MATCH` other than `off` or `test` while that tool's date is empty. `AUTOMATION_DPIA_R1_ACTS` and `AUTOMATION_DPIA_MATCH_ACTS` hold the day on which the assessment covered the measure: the API refuses to start with a real classifier and `AUTOMATION_R1_ACTS=on`, or with a real matcher and `AUTOMATION_R2_ACTS=on`, while that measure's date is empty. `/rules` prints each date in its own tool's block. So the second tool is never passed on the first tool's assessment, nor the step from flagging to acting on the assessment of flagging. `test` adapters are refused when `APP_SITE` is open, in the API and in the worker, from the task that builds the first of them. `(owner)` | A README line: nothing fails when it is forgotten. One date for everything: the gate passes the second tool and the switch to acting, and a public sentence becomes false. | GA X6.3 (e); GK X11.5 |
| 50 | Dependencies | None is added. Named for the owner's later choice, as the research read them on 2026-10-09: the classifier `Marqo/nsfw-image-detection-384` through ICIJ's ONNX export (Apache-2.0 by card tag, one file of 22,450,955 bytes pinned by digest) on `onnxruntime-node` 1.30.0 (MIT, native, needs a glibc base such as `node:24.21.0-bookworm-slim`, install script to stay unrun) or on the WebAssembly runtime (no base change, about 3.7 times the CPU); PDQ: no package (`pdq-wasm` unmaintained, the other compiles Rust at install). A build-time check confirms age over 7 days, licence, digest and the worker's allow-list. | | Ruling 2; GA X8.3, X17.3 |

**Notes to the rows.** A note is part of its row: it holds what the review round added and a table line would not carry.

- **Note 26.** The statement says that a moderator looked at the image only when the case's access log holds that person's view of it before the decision, and otherwise that the moderator decided without opening it. The one function that serves staff an image (gate V, `MediaForCases.staffImage`) refuses an image that an unerased match record names, an acting match or a flag, on every case. After an admin's answer without a seal the image is served to everyone as before and stays closed to staff; 3c's rule that whoever is on duty opens the images the same day does not apply to it (section 15 amends C 6.1 and 7.5), and the mail `moderation_csam_lifted` and the console say so for a case whose finding came from a match. An answer without a seal on a case whose match is acting asks for a reason from a closed list (`source_withdrew`, `counsel`, `other`), which the admin's key signs and the decision's row keeps (6.7); a flag's answer needs none. The cost is stated in section 11: after such an answer a matched image is public and no person at korbat has seen it.
- **Note 27.** In the research's terms the automatic seal is a decision "based solely on automated processing" with a significant effect: "Art. 22(1) applies" and "an exception of Art. 22(2) is needed" (GA X6.3: the EDPB's reading, for counsel as to a court's). So the API refuses to start with `AUTOMATION_R2_ACTS=on` while the date of row 49 for that measure is empty. The seal's row opens F's record of a report and the hold on the account's address, as any seal's does, so no text says that a program "does nothing to your account": the texts say that it does not suspend, limit or end the account, and that korbat keeps what a report would need. A finding without a measure tells the author nothing and still keeps the post's images against deletion until an admin has answered: the terms and the rules page say so, and they promise "told at once" of a measure, not of everything a program does.
- **Note 28.** Three defaults that the owner may weigh differently, each `(owner)` `(counsel)`: an exact MD5 or SHA-1 match acts although both are broken for collisions, so that a file with the same hash as a listed one can be made on purpose by whoever makes both; an exact perceptual match acts although an equal perceptual hash says only that two pictures resemble each other; and a `near` match of the source's own class refuses no upload and seals nothing, while its finding, citing R2 like a moderator's own, freezes the post by 3c's built rule and raises `moderation_urgent`, until an admin has answered. That last one is where review ruling 4, which calls a `near` match "a flag", can be read two ways: the design keeps the finding, because of the two it is the reading that destroys nothing and leaves the decision to a person, and the owner decides. A flag's case is a person's to answer without the image: a flagged image stays closed to staff like any matched image (row 26), and a moderator may open a finding of their own under a rule, as 3c allows. The words never call a perceptual match "the same" fingerprint (row 36), and the console tells the admin what an MD5 or SHA-1 match is worth.
- **Note 35.** The refusal sets the hold on the uploader's address that a seal sets (F's `auth.report_holds`, seven days), so that telling at once does not let the uploader erase who uploaded before an admin has read the alert; when the account is gone all the same, a report carries the file's facts and times alone. "No report" deletes the upload 24 hours after the end and not at once, so that a second admin who reads the alert `hold_ended_unreported`, which goes to every staff account, can still end the hold as "Report". The uploader may object once, for as long as korbat holds the file and the hold has not ended without a report: also after "Report". The refusal stays: nobody opens the image, so no person at korbat can accept it; a person decides only what happens to the held file, and the notice, the rules page and the terms say so. The refusal's record keeps the account until its match record is erased (row 37) and then names nobody. No more than 20 uploads an hour are refused (`refusals_per_hour`, row 18): over that nothing is written of the match, the upload waits unposted as "being checked", nobody is told, staff are alerted at once, and the check is asked again later, so that a source gone wrong does not tell every uploader that their file matched such a list. An upload that was accepted with a flag and is then posted meets row 28: the finding follows the posting.
- **Note 38.** Every well-formed line of a receipt is a fact about where a file now is and gets its record, also when the ledger has moved since the list was printed; such a line is reported, and the next list moves the file back. A file found in neither place is printed as `missing` and the run goes on; only a run with the flag `--lost` records it as lost, which is a file's third end beside returned and destroyed: its image is then no longer "being restored", its author is told that korbat lost it, and staff are alerted (`quarantine_lost`).
- **Note 41.** `illegal` is an assessment, which is the reason an authority may want the evidence kept: by itself it changes nothing about the files, which stay sealed and in the quarantine. `not_illegal` is refused as a ground here, since its path is `unseal_media`. `no_assessment`, `other` and silence end nothing. The leave is recorded against F's record of the report, with who gave it, its reference, the day it bears and, when the authority forbids telling the person, until when; the admin's confirmed action names it by its id, so the proof of a destruction names the word it rests on and no leave can be typed into the console. A seal that lists more than 1000 unreleased posts is released in parts of 1000, the lowest ids first, each part confirmed by itself.

## 3. Research (facts the design depends on)

Each fact has its source. The gap files hold the options that were not chosen and the questions for counsel in full.

**The code** (scratch clone at `aab8345`: 3c's Tasks 1 to 8; `0018_retention.sql` uncommitted in its working tree; nothing of 3e or 3f built).

- **Files.** The store holds, for an image, `files/<aa>/<id>/small.webp` and `large.webp`, and, until the API has taken the result in, `results/<id>.json` (`packages/media-protocol/src/layout.ts:46`): the worker deletes the result and the attempt marker once the API has discarded the upload (`apps/worker/src/loop.ts:123` to `:130`). The API mounts `media-store` read-only and `media-uploads` read-write; the worker the reverse, with `network_mode: none`, no credential, 768 MB (`infra/compose.yml:142` to `:144`, `:158` to `:178`). The uploaded original is deleted once processed (`compose.yml:239`), so what korbat holds of an image is its two re-encodes.
- **The API's two levers on a stored file** are `openImage` and `requestDeletion`, an empty file named after the id, which the worker obeys without a database (`apps/api/src/media/files.ts:178`, `:181`).
- **Three readers that the review found.** Staff are served an image by one function, `staffImage` (gate V, `apps/api/src/media/cases.ts:78`), which reads the row through `staffAccess`. The data export takes every ready image of the account "on a post or not" (`EXPORTABLE`, `apps/api/src/media/repo.ts:66`; `readyImages`, `:246`; `isExportable`, `:262`). The owner's delete removes an unposted row in any status (`deleteUnattached`, `repo.ts:151`). 3d changes all three (section 5).
- **No image file is in the repository.** Every image the suites and the smoke test use is encoded when the test runs (`apps/worker/test/fixtures.ts:7`), and an encoder's bytes differ between machines, so a digest written as a constant must be of bytes written as a constant (section 5, the `test` matcher).
- **Who writes what on an image row.** `moderation_state`, `hold_until` and `erased_at` are written by migrator-owned functions alone; the API's role holds UPDATE on nine other columns, `nsfw_score` among them (`0015_greedy_zuras.sql:419`, `:420`). An insert is born on no post, visible, unheld and unerased (`post_media_insert`, `0015:494`).
- **Gate K's first test** keeps an image row on no post while `hold_until > now()` and reads nothing else (`post_media_keep`, `0015:740`). A case's hold is placed only on rows that are on a post (`hold`, `apps/api/src/media/repo.ts:335` to `:350`, an inner join on `posts`), so `media_holds_apply` (`0015:797`) never recomputes the `hold_until` of an upload on no post. This is what lets a held upload's `infinity` stand (6.7).
- **The disposal** takes a row whose `erased_at` is set, whose hold has passed and whose post is not frozen (`DISPOSABLE`, `repo.ts:85`), and asks the worker for its files. For a file that is in the quarantine that request finds nothing.
- **The served header** is `public, max-age=300` for a visible image of a visible post and `private, no-store` otherwise; the ETag is the id and the size (`apps/api/src/media/flows/serve.ts:6`, `:46`).
- **The result file** is a strict object with `v: 1` (`packages/media-protocol/src/result.ts:12`): an unknown member or version is refused, so a new version ships in the API and the worker together.
- **The decision's triggers.** `decisions_record` forces the two automation columns at its top and reads the decider's role and cap by `decided_by` (`0017_appeals.sql:169`, `:282`, `:309`); `decision_holds` asks for a step-up and the decider as the audit row's actor (`0016_decisions_and_ledger.sql:782`, `:785`); `append_confirmed_audit` writes three actions and no other (`0016:886`); the audit head is one row, `seq` and `hash`, readable by the API's role (`0012:139`, `:148`).
- **An adapter chosen by one setting, refused in the wrong environment,** exists: `VERIFY_PROVIDER` (`off`, `dev`, `vonage`; `apps/api/src/config.ts:168`, `:223`).

**The labs** (`lab-3d/`, PostgreSQL 18.6, one throwaway container, 2026-10-09; `RUN.txt` first). The schema was the clone's migrations 0000 to 0017, then a prototype that patches 3c's own `decisions_record` and `decision_holds` by exact text replacement (`make_proto.py`) and adds 3d's tables, loaded in one transaction. Every decision was made as `korbat_api` through the real triggers and deferred checks.

- **A, the system decider** (`out-A.txt`). A1: an automated R1 withhold commits with `decided_by` null, `fully`, `automated_detection` true, `needs_admin` false, `author_mail` pending and the system's audit row without a step-up; the image reads `withheld` and the post stays `visible`. A2: nine faults are refused and leave nothing (a final kind; no audit row; a staff key's `case_decided` row; no signal; two measures; a final measure; rule R3; an automated intake citing R3; a seal on an R1 finding). A3: a person's decision cannot carry `fully`. A5 to A7: a moderator's final decision reads `automated_detection` true and `not_automated` and ends the measure; a correction lifts it at once; "no breach" ends it with the case. A8: the decision over the cap is refused `automation_capped`.
- **C, the automatic seal** (`out-C.txt`). C1: a match on one of two images seals both, lists the post in `seal_posts` with 2 images, and freezes the post; the API's role deletes none of its rows. C6: a moderator cannot answer (`admin_required`); an admin's "no breach" ends the seal and the freeze. C7: an admin's seal for good replaces the automatic one and reads `partially`. C3, C4: **the built code accepts a second seal while one stands**, in either order, hence `already_protected` (6.6).
- **D, the release and its replay** (`out-D.txt`, `out-D2.txt`). D1: refused when not reported, without an answer, on `not_illegal`, by period while unset, on a seal taken while deciding, and a second time. After a release the rows read erased, the post is not frozen, and a new suspect item freezes it again (D4). The API's role can write neither the mark nor `erased_at`. D2: a replay on a backup taken after the seal for good writes one mark and erases two rows, and a second run answers `present`. D3: on a backup taken before the seal for good, with the mark keyed on `seal_posts`' key as C 17 sketched it, the seal for good that an admin took again afterwards froze the released post for good. Keyed on the post it does not (D4), at about 0.04 ms a call.
- **E, the counts** (`out-E.txt`). 216 synthetic restrictions in seven cells (4, 61, 3, 94, 35, 12, 7) print as five rows and a total: the three cells under ten fold into "other grounds, about 10", and the printed rows (210) do not give the printed total (about 220), so a folded cell cannot be subtracted back (E4). An edition asked for before 1 March, or for the running year, is refused (E3). Of two orders, one under a hold, the public figure sees one (E5). 21 ms for an edition over 20,000 decisions (E7).
- **Not measured:** lock contention and the automated step under concurrency; the release's audit tie and `audit-verify`; 3e's and 3f's branches in the replaced functions; the files, the mover, the worker, the edge, the sketches, a timestamp authority. Each is a test of section 12 or a first step of a task (O4).
- **Measured, and since changed by the review round:** the lab released on the ground `answer` with the word `illegal`; that ground is withdrawn and the ground is `leave` (row 41). The lab's signals had the open unique index alone, its cap was one count for both rules, and its `acting` did not enter `decision_holds`. The refusals of D1 other than "without an answer" stand as measured; each changed rule is a test of section 12 on the built code.

**The rule for a new enum value** (E 6, F 6; the prototype loaded under it). A value added by `ALTER TYPE ... ADD VALUE` cannot be used as an enum literal before the migrating transaction commits (`55P04`). 6 states the rule 3d's two values follow.

**Transparency** (GT).

- The Transparency Database "will not collect" the statements of micro and small enterprises and offers no voluntary onboarding; its interface is append-only, with no update and no delete (GT X1.3). An Art. 9 order is never a statement of reasons (DSA Art. 17(5); GT X1.3 (e)).
- Not owed by a micro or small enterprise: the Art. 15 report, the template, the Art. 24(2) publication. Owed: the TCO Art. 7(2) report in a year that triggers it, before 1 March, and the Art. 24(3) figure on request (GT X3.3). TCO Art. 11(3) forbids disclosing information on a removal while a non-disclosure decision runs; a public "1" in a year with one order is such information (GT X3.3 (b), for counsel).
- At some hundreds of accounts a row with a day, a rule and a measure is a statement about a known person for most rows, and monthly cells are mostly under ten; the sources name floors of 3, 5 and 10 (GT X5.2, X5.3; `research-3/practice.md` 4.4).
- Recipients can be counted without storing an identifier: a HyperLogLog sketch cannot list its members (though, while it exists, it can be asked whether one given value was probably added), and a daily keyed digest under a salt that is never written to disk cannot be linked across days (GT X4.3). Art. 3(p) counts signed-out readers (C 4).
- A value on korbat's own page proves nothing against korbat's operator; an RFC 3161 token from an outside authority does, and is verified with `openssl ts -verify`. The public logs read need a client package or an account (GT X10.3).

**The edge and the two tools** (GA).

- Every plan of the provider purges by URL, prefix, tag or host; by prefix the documented limits are 100 a request and 5 requests a minute. A purge by bare URL leaves a stranger's `?x` copy; a prefix does not depend on the cache key. An accepted purge is no proof of eviction, so the header stays the bound, and it is the bound only when stale serving is forbidden and the zone respects the origin's headers (GA X9.3).
- The classifier the research names is a 22,450,955-byte ONNX file under an Apache-2.0 card tag; the native runtime needs a glibc base image, the WebAssembly runtime costs about 3.7 times the CPU; its training data is not disclosed and no outside bias evaluation was found (GA X8.3). No measurement of `research-3/automation.md` can be repeated under the rule that no weights are fetched (IN P3-20).
- PDQ is the one perceptual hash korbat can compute itself and match against an outside list; no npm package qualifies, and its reference's hashing code is BSD. The lists hold MD5 and SHA-1 first (GA X17.3).
- A measure taken by a program alone is a decision "based solely on automated processing" when it significantly affects the person; what makes it defensible is that it is temporary, stated, and open to human intervention at once, and Art. 22(4) limits it where the data are of a special category (GA X6.3, X6.5; for counsel).

**Known material and sealed files** (GK).

- No source's interface can be read without an agreement; the sources a small EU service may apply to are named in section 5 (GK X2.3). A hash-only query sends no image (GK X2.5).
- An exact SHA-256 match of a verified list entry is strong evidence of the same file. MD5 and SHA-1, which the lists hold first, are "both broken for collisions": two files with one such hash can be made on purpose by whoever makes both, and the published collisions were not re-read (GA X17.3 item 4; GK X7.2 (d)). An equal or a near perceptual hash says that two pictures resemble each other, and targeted collisions exist. A classification that is not the source's own for child sexual abuse material is "not a claim of illegality at all" (GK X7.3 item 2). Nobody at korbat can check any of it (GK X7.3, X7.5).
- A match on an upload that is on no post is the same kind of fact as one on a post. Refusing is always allowed; letting the sweeper delete it is a deletion with knowledge; holding is defensible only as part of reporting (GK X18.3).
- A sealed file has three ends: destruction fits the answer `illegal`, giving back fits `not_illegal`, and for no assessment or silence the law gives none. No period binds; the benchmarks are six and twelve months; proof of destruction is owed per file (GK X13.3).
- But an assessment is not a leave to destroy: "no text read tells a host to destroy its copy, and none tells it to keep it"; a host's own deletion is "safest after the authority has said it has what it needs or has told korbat to delete", recorded with that word and its reference (GK X13.3 item 2). Whether korbat may destroy before the authority has taken or declined the evidence, and what it risks, is counsel's question (GK X13.4), and a release is refused while anything else holds the files (GK X13.5).
- "Anything a match starts must be undone without delay and without trace when it proves wrong", and "a match is about a file, not a person" (GK X7.5): hence what a refusal leaves behind (row 37).

**Corrections between the sources and the designs.**

- C 17 keys the release's mark on `seal_posts`' key: LAB D3 shows why that fails after a restore, and row 43 keys it on the post (O2).
- F 16 says 55 minutes become 60 with the purge: GA X9.3 item 8 shows the purge guarantees nothing, and row 13 keeps 55 (O3).
- F 16 says that 3d's release does not read `post_preserved`: row 41 refuses to release a post that is preserved for an order, so `release_facts` calls that function, and F 6.7's pin on its callers gains one (6.2).
- F gives `APP_SITE` to Caddy alone (F 5). Row 49's guard on the test adapters needs it in the API and in the worker, so Compose passes the same variable to both (section 5).
- F's `alert_outbox.kind` carries a CHECK written from `ALERT_KINDS` (F 10.1). Each of 3d's migrations that adds an alert adds its kinds to that CHECK (6).
- M 110, 171, 172, 187 and 203 promise a public copy of every case, a withhold on a score, a removal on a match and a composer warning: row 10 amends them.
- C 6.1 and 7.5 have whoever is on duty open a case's images the same day after an answer without a seal, and the mail `moderation_csam_lifted` says so. For an image that a match record names this is withdrawn: such an image is never opened by staff (review ruling 2, row 26; section 15).
- 3c's update to whoever reported prints "No automated means were used to decide" from no field of the decision (`apps/api/src/mail/templates.ts:344`): it reads the decision's `automated_decision` from 3d on (row 26; sections 7 and 15).
- F sets the hold on an account's address in `report_open()`, for a seal's row alone. A refused upload has no seal row, so 6.7's trigger sets the hold itself, and F 6.7's pin on the writers of `auth.report_holds` gains it (row 35).
- F's import reads lost decisions from `case_decided`, `appeals_reviewed` and `order_effected` rows (F 7.17 step 2.4): `automated_decided` joins them, or a program's lost seal would be in no list (row 45).
- E's one predicate refuses every write of a suspended account that E 7.3's table does not list as left: 3d's two objection routes join that table (row 25).
- 3c asks every intake for a rule or an allegation (`intakes_has_ground`, `0015:256`). A flag of a class that its source does not name child sexual abuse material cites no rule (review ruling 3), so that constraint gains an arm for the kind `automated` (6.6).

## 4. Scope

3d builds mechanisms. Every part that needs a third party or a fetched artefact sits behind an adapter that is off by default and has a test adapter, and 3d adds no dependency (row 50). The stack, the tests and the smoke test pass with every adapter off.

**In**, with every adapter off:

| # | Part | What ships | Task |
|---|---|---|---|
| 1 | The quarantine | the volume `media-quarantine`; the one-shot service `quarantine`; `quarantine_files`; the mount path in the API's image; `staff.js quarantine-list` and `quarantine-record`, with the directions `in`, `out` and `destroy` (here for a file whose image row is gone) and the operator's own lines (`operator`, for a file of an image the database does not know), the mover's inventory, a receipt taken line by line, and a file's lost end with the author's notice and the alert `quarantine_lost`; the counts on the console's home and the custody line of a seal on its case; the alert `quarantine_due`; F's `handover` re-pointed | 1 |
| 2 | The release | `releases`, `release_posts` and `release_leaves`; `staff.js release-leave`, which records a leave or an instruction to destroy and withdraws one that was recorded by mistake and is not yet used; the clause in `frozen_for`; the admin's confirmed action `seal_released` and its screen; the released files and the release's id in the `destroy` direction, with a digest of every file; the author's notice, held back while an authority's "not to the person" runs; the alert `seal_released` to every staff account; `release-show`; `release-replay` and the gap class `release`; the day after which no backup that is deleted on time holds a released file | 2 |
| 3 | The edge | `edge_purges`, written by triggers for every image that stops being public; the job that drains it; the adapter with `off`, `test` and `cloudflare`; `APP_SITE` as a setting of the API and the refusal of a `test` adapter while the site is open, built here with the first `test` adapter; the new cache headers, with the smoke test's and the media integration files' pins of the old one; the purge's outcome on the case and on F's order screen | 3 |
| 4 | The public figures and pages | the API's module `transparency`, its job and its place in the wiring and in the architecture test; the sketches and `recipient_months`; `transparency_editions`; `/transparency`; `/rules` with its change log; `GET /api/public/facts` and `/transparency`; `staff.js recipients` and `edition` | 4 |
| 5 | The head | `head_publications`; the daily value; the witness adapter with `off`, `test` and `rfc3161`; the keeper's mail; `GET /api/public/head` and the head's section of `/transparency`; the restore row and `head-restore-mark` | 5 |
| 6 | The automated decision and the R1 seam | the enum values `automated` and `system`; `decided_by` nullable; `automated_signals`; `automated_objections` and "Ask for a person"; the step and its sweep; the caps by rule and the two limits on unanswered measures; the statement's sentences and redress version 4, which an automated decision prints; the queue's chips; the worker's scorer seam with `off` and `test`, and the refusal of a `test` adapter in the worker; result protocol version 2; `automation-status`; `audit-verify`'s check; `restore-import` reading an `automated_decided` line as a lost decision; the two dates of row 49 for R1 and their guards | 6 |
| 7 | Known material | `media_hashes`, `media_matches`, `upload_refusals`; the API's hashes and the worker's own PDQ; the matcher seam with `off` and `test`; the refusal and hold of an upload with an acting match, out of every reader and the export, with the limit on refusals and the hold on the uploader's address; the flag for a person for every other match; staff's closed door on a matched image; the console's Held uploads with its two ends and the alert `hold_ended_unreported`; `upload-report`; the release of a held upload, with `restore-import` and `release-replay` extended to `upload_released` and `upload_hold_ended` lines; the automatic seal; the retry and `matcher_down`; the two dates of row 49 for the matcher and their guards | 7 |
| 8 | The flag, the texts and the record | `case_flag` and its chip; `erase_automation_records`, and the forgetting of hashes and scores once a tool is off; rulebook version 4; the terms and the privacy text; the README; the main design's amendments and the dated notes to C, E and F | 8 |

**What each adapter adds when the owner switches it on** is the table of section 5.

**Out, by decision** (the row says why):

- any submission to the Transparency Database, and any export file for it (row 6);
- public rows of decisions (row 1); a yearly report in the DSA's template (row 4);
- a composer warning before posting (row 21);
- a list of korbat's own removed images (row 30);
- a second basis for E's protective suspension, or a termination under R2 (row 29); a suspension, a strike or any account measure by a program (row 27);
- a deferral or a batch on a signal (row 48); ban-evasion signals (M 148);
- Cloudflare's scanning tool: the README says what switching it on does, and it stays off (row 31);
- a real adapter for any source of known material, since no source's interface can be read without an agreement (row 32);
- a backfill of hashes or scores for images uploaded before a tool was switched on (row 33);
- a destruction on an authority's assessment alone, and any promise of a destruction or of a period in the terms (row 41);
- a refusal, a hold, a freeze or a rule cited on a match that is not acting (row 28); a way for staff to open an image that a match record names (row 26); a way for anyone at korbat to accept a refused upload (row 35);
- any path that tells an author of an authority's order: the notice and its hold are 3f's alone (F 17).

**Not tasks of 3d, each waiting for the owner:** the classifier's real adapter (the runtime, the weights, the base image, the measurements, the threshold); a real source's adapter; the lab on the owner's zone at the edge.

**What 3d receives**, and uses without changing a table or a migration of the designs before it (ruling 7):

| From | What | Used for |
|---|---|---|
| C 6.1 | `intake_items.suspect` and `intake_items_attach` | a finding citing R2 freezes its post by the built rule, whoever opened it |
| C 6.1 | `frozen_for`, `post_frozen`, gate K (`post_media_keep`), gate E (`erase_snapshots`), gate V, gate S | the freeze; 3d replaces `frozen_for` for one clause and touches no gate |
| C 6.2 | `seal_media`, `unseal_media`, `seal_posts`, the image state `sealed`, `measures_in_force` | what a seal covers, post by post, with image counts |
| C 6.2 | `decisions`, `decision_actions`, `decisions_record`, `decision_holds`, `decisions.suspect`, `unseen`, `needs_admin` | the automated decision; 3d replaces the two functions |
| C 6.1, 7.9 | `post_media.erased_at`, `hold_until`, the disposal (`dropDisposable`) | the release and the held upload |
| C 6.1, 7.3 | gate V's one function (`staffImage`) and the case's access log (`image_viewed`) | the door stays closed for an image that a match record names; "a moderator looked at the image" is said only of a recorded view |
| C 7.13 | `audit-verify`, `text-verify`; `append_confirmed_audit` | the new check; three more confirmed actions |
| C 7.15 | the update to whoever reported (`notice_update`) | it reads the decision's `automated_decision` |
| 2b and C, as built (`media/repo.ts:66`, `:151`) | the data export's reader (`EXPORTABLE`), the owner's status and the owner's delete | a held or refused upload is in no reader and no export, and an upload is not deleted while its check is out |
| E 6.2 | `strike_due`; the protective suspension that rests on a seal for good | unchanged: no automated decision is due a strike, and 3d adds no basis |
| E 7.3 | the table of the writes a suspension leaves | the two objection routes join it |
| F 6.1 | `alert_outbox`, `alert_steps()`, `ALERT_KINDS` and `ALERT_TEXTS` | twelve more alerts |
| F 6.3 | the fourth arm of `frozen_for` and `post_preserved` | a preserved post is never released |
| F 6.5 | `seal_report(action)`, as O1 amends it; the notification records, their events' mark `not_to_person`, and `productions` | what a release rests on, and whether its notice may go out |
| F 6.5 | `auth.report_holds` | the seven-day hold on the address of an uploader whose upload is refused |
| F 6.6, 7.17 | `restore_gaps`, `restore-import`, `RestoreView.mayOpen`, `APP_SITE` | the replay of releases before the site opens; a program's lost measure as a lost decision |
| F 7.14 | the `handover` service, `sealFiles` and the store's naming rule as one pure function | the quarantine's lists; the hand-over reads the quarantine first |
| F 7.18 | `staff.js tco-counts` | the order section of an edition |
| E 10, F 10 | `STANDING_RULES`, `ORDER_RULES`, `STATE_FACTS` | the rules page |

**The going-public gate.** "3d's handling of sealed images" (C 17) is parts 1 and 2 with their restore step: Tasks 1 and 2. korbat is opened to the public only when those, 3f's order path and the owner's list of section 17 are done. Tasks 3 to 5 need nothing of 6 to 8.

## 5. Architecture

3d adds one volume, one one-shot service, four adapters, one small module in the API, no database role and no dependency. The division of C 5 stands: the API decides which rows to write; the database decides whether they can stand and what they mean; the command line, as the migrator, records what only the operator may record. One writer is new: a program. It is given no right a person lacks, and fewer.

**Who may write what.**

| Writer | Database role | Writes |
|---|---|---|
| The API's routes | `korbat_api` | through definer functions and never directly: a release (`seal_release`, `upload_release`), the end of an upload's hold (`upload_hold_end`), each standing only with the audit row an admin's key confirmed; an objection; a refusal's objection and delivery state; the reason of an answer without a seal on an acting match, as a column of the decision that the admin's key signs |
| The API's jobs and the automated step | `korbat_api` | signals; an intake of the kind `automated`; a decision without a decider with its one ledger row and the system's plain audit row, which stand only when `decision_holds` passes at commit; hashes, match records with the mark that the program is done with one, and refusals; the forgetting of the hashes and scores of a tool that is off; the outcome of an outbox row; a month's two counts; a day's head value; an edition, through `edition_publish`; the delivery state of a lost image's notice, through a definer function |
| The database's triggers | the owner | every row of `edge_purges`; `hold_until` of a refused upload and the hold on its uploader's address; `media_matches.acting`; every forced column |
| The command line (`staff.js`) | `korbat_migrate` | `quarantine_files`, with a lost file's alert; a leave or an instruction to destroy, and its withdrawal (`release_leaves`); a replayed release or end of a hold; a refusal's `notification_id`; the restore row of the head; an edition's correction |
| The `quarantine` service | none | files, and nothing else: it has no database, no network and no credential |

No program writes the ledger by a path of its own. An automated decision is a row of `decisions` that passes the same triggers as a person's, with the branches of 6.6; the migrator's own insert of one is refused at commit like anyone's.

**What each module gains.**

| Module | Files | What they hold |
|---|---|---|
| `packages/db` | `src/schema/moderation.ts`, `content.ts`, `transparency.ts` (new); the eight migrations | Section 6. |
| `packages/contracts` | `moderation.ts`, `staff.ts`, `media.ts`, F's `orders.ts`, `automation.ts` (new), `transparency.ts` (new) | Section 10: the mirrors of the three rule functions, `SIGNAL_RULES`, `MATCH_LISTED` and `MATCH_ACTING`, the new members of `ALERT_KINDS` (in `orders.ts`, where F has them), the step-up params, the codes, the public answers. Each name lives where the code has its kind today: `StaffOverview`, `CaseView` and the queue's row in `moderation.ts` (`:1487`, `:1229`, `:917`), the step-up registry and the audit schemas in `staff.ts`, `MediaStatusResponse` in `media.ts` (`:64`). |
| `packages/rules` | `src/index.ts`, `statement.ts` | Rulebook version 4, redress version 4, `RULES_CHANGES`, the new sentences of `STATEMENT_WORDS` (section 18). |
| `packages/media-protocol` | `src/result.ts`; `src/classifier.ts`, `src/fixtures.ts` (new) | The result file's version 2: the optional members `r1 { model, score }` and `pdq { impl, hash, quality }`. The API and the worker ship together; `finalize` refuses a version it does not know. The R1 model's name and the digest of its weights are constants here (`classifier.ts`), since the worker checks the digest, `finalize` refuses a model that is not this build's, and the facts route prints both. `fixtures.ts` holds the test adapters' fixtures as byte constants (see "The adapters"). |
| media (`apps/api/src/media/`) | `repo.ts`, `files.ts`, `cases.ts`, `flows/upload.ts`, `flows/serve.ts`, `flows/status.ts`, `sweeper.ts`, `index.ts`; `match.ts`, `match-adapter.ts`, `edge.ts`, `edge-adapter.ts` (new) | The three hashes of an upload, taken while it streams (`files.ts`, `receive`); `finalize` (`flows/status.ts:10`) stores the score and the PDQ and asks the matcher; the three tables of the migration `known_material` and every statement on them; the matcher's retry (`match.ts`) and the outbox's job (`edge.ts`), each with its adapter in a file of its own that imports nothing of the module (`match-adapter.ts`, `edge-adapter.ts`); the new headers; `media_quarantined` and `media_lost` in `serve` and the owner's status; and the changes to four built readers that follow this table. |
| moderation (`apps/api/src/moderation/`) | `decide.ts`, `repo.ts`, `cases.ts`, `author.ts`, `author-repo.ts`, `routes.ts`, `dispatch.ts`, `retention.ts`, `alerts.ts`, `statement.ts`, `context.ts`, `index.ts`; `automated.ts`, `release.ts`, `uploads.ts` (new) | The automated step, its sweep and "Ask for a person" (`automated.ts`); the release with its notice (`release.ts`); the held uploads, the two ends of a hold, the objection and the uploader's notices (`uploads.ts`); the app's new reads among the author's routes (`routes.ts`); `case_flag`, the custody line and the home's counts in the answers that `overview` and `caseView` build (`cases.ts:193`, `:347`); the retention job's call of `erase_automation_records` and of the media module's forgetting; the new alerts. |
| transparency (`apps/api/src/transparency/`, new) | `index.ts`, `routes.ts`, `repo.ts`, `recipients.ts`, `editions.ts`, `head.ts`, `witness.ts` | The three public routes; the sketches and the month's close; the daily call of `edition_publish`; the daily head, the witness adapter (`witness.ts`, which imports nothing of the module) and the keeper's mail; one job, `transparency`. It reads no session and no table of a person, and the architecture test holds it to that. |
| auth and mail (`apps/api/src/auth/`, `apps/api/src/mail/`) | `auth/middleware.ts`, `auth/index.ts`, `auth/flows/notifiers.ts`; `mail/mailer.ts`, `mail/templates.ts` | `resolveSession` calls the handler that `auth.onSeen` was given; the new members of the closed unions `AccountMessage` and `StaffMessage` (`notifiers.ts:49`, `:70`) and of `TemplateName` for 3d's mails (section 18); `mailKeeper`, the one mail to `HEAD_KEEPER_MAIL`, which no account and no staff list receives. |
| social (`apps/api/src/social/`) | `flows/posts.ts` | `createPost` (`:35`) calls `imagesPublished` after its commit. |
| staff (`apps/api/src/staff/`) | `cases.ts`, `routes.ts` | The routes of the Release screen and of Held uploads. The answers themselves are built in the moderation module, behind `ModerationForStaff`. |
| the API's shell | `apps/api/src/index.ts`, `app.ts`, `config.ts` | The wiring below; the mount of the three public routes before `auth.resolveSession`; every new setting and its guard. |
| the command line | `apps/api/src/cli/staff.ts`, `staff-cases.ts`; `custody.ts`, `figures.ts` (new) | The commands of section 8, one file a concern as F has them: the quarantine's, the release's and the held uploads' in `custody.ts`, the recipients' and the edition's in `figures.ts`; `audit-verify`'s check of row 16. |
| `apps/api/src/quarantine.ts` (new; the entry point `quarantine`) | | The mover. Like `handover.ts` it opens no database and no socket and imports no module: it keeps its own copy of the store's naming rule, held equal to the media module's by a unit test. Its two roots are arguments. |
| the worker (`apps/worker/src/`) | `pipeline.ts`, `loop.ts`, `config.ts`; `score.ts`, `pdq.ts` (new) | The scorer's seam beside the existing decode (`score.ts`); korbat's own PDQ from the decoded pixels (`pdq.ts`); the result's version 2; the settings `R1_CLASSIFIER`, `MEDIA_MATCH` and `APP_SITE`, and the refusal of a `test` adapter on an open site. Its allow-list of dependencies is unchanged. |
| `apps/admin`, `apps/app` | | Sections 8 and 9. |
| `apps/api/build.mjs`, `apps/api/Dockerfile`, `infra/`, `scripts/` | | One more entry point (`dist/quarantine.js`); the mount path `/media/quarantine` in the image; Compose and `compose.dev.yml`, which hand each new setting to the service that reads it; the env examples (`infra/.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`); the smoke test (`scripts/smoke-auth-stack.mjs`). `scripts/gen-dev-env.mjs` and `scripts/test-db.mjs` do not change: 3d adds no role and no generated key, and the generator appends a new key of an example by itself. |
| the tests' shared files | `apps/api/test/architecture.test.ts`, `apps/api/test/integration/media-harness.ts`, `apps/worker/test/loop.test.ts` | The seventh module and its import rule; the rule on `post_media` extended to the three new tables' names; the rule that only `quarantine` and `handover` name the volume; the rule on the three adapter files; the stand-in worker and the worker's own test write and expect result version 2. |

**Four built readers change** in the media module, so that review rulings 2 and 5 hold at the one place each reader has:

- **Gate V** (`staffImage`, `cases.ts:78`): `staffAccess` also answers whether an unerased match record names the image, an acting match or a flag, and the function then opens nothing, on whatever case the request came and whatever the image's state. The staff route answers a code of its own, `image_matched` (section 10), so the console can say why.
- **The export** (`EXPORTABLE`, `readyImages`, `isExportable`; `repo.ts:66`, `:246`, `:262`) leaves out an image that a row of `upload_refusals` names, whatever the hold's end, for as long as the image row lives.
- **The owner's reads** (`find`, `flows/status.ts`): for such an image they answer the status `refused` and neither a blurhash nor a size; `pendingCount` does not count it.
- **The owner's delete** (`deleteUnattached`, `repo.ts:151`): while the matcher is not `off` it does not delete a row that is still `processing` with a `pending` or a `capped` check. It answers as today and the composer forgets the image; the sweeper deletes the row once `finalize` has given it a verdict, and a row the check then matched is held like any other.

**What is forgotten when a tool is switched off** (row 33). In each round of the retention job, as its step `tools_off`, the media module deletes every row of `media_hashes` while `MEDIA_MATCH` is `off`, and sets `nsfw_score` null on every image that no unhandled signal names while `R1_CLASSIFIER` is `off`. The API's role already holds both rights (6.7; `0015:420`); nothing but the setting holds a hash or a score back. A match record keeps its one value until its own erasure (6.8).

**The interfaces between the modules.** Each module still reaches another only through what that module's `index.ts` exports (C 5), and no file outside the media module names `post_media` or one of the three tables of the migration `known_material` (`media_hashes`, `media_matches`, `upload_refusals`). The architecture test's rule on `post_media` (`apps/api/test/architecture.test.ts:117`) is extended to those three names, so the sentence is pinned and not only stated.

- **`MediaForCases` gains** (media, for moderation; built over the module's dependencies as today, `media/cases.ts:58`):
  - `signals(tx, postId)`: for each ready image of the post, its id, its score (null when none was stored) and its unerased match record's id with its `listed` and its `acting` (null when it has none); it locks nothing.
  - `unsignalled(limit)`: the sweep's two enumerations. Posted images with an unerased match record that is not marked handled, an acting match or a flag; and images of a post created in the last 24 hours whose score is at or over the threshold and that no signal names. The media repository names `automated_signals` for this one read. Each of the two is read only while its tool's adapter is not `off`, so no program opens a finding or takes a measure on a day on which the rules page prints that tool as off; what a person was already shown stays with that person.
  - `matchRecord(mediaId)`: the record as staff are shown it (row 37), without the hash.
  - `matchJoined(tx, matchId, caseId)`: the step's write, in the step's transaction: it marks the record handled and, with a case, writes its `case_id` once (review ruling 8).
  - `refusal(id)` and `refusals(cursor)`: a held upload as the console lists it, with the uploader's other refusals as a count that leaves out every hold ended without a report, and never an image or a name.
  - `refusalsOf(ownerId, cursor)` and `objectToRefusal(ownerId, refusalId, text)`: the uploader's own notices, paged, and the one statement that writes an objection.
  - `refusalsUntold(limit)` and `refusalTold(refusalId, outcome)`: for the dispatch job's step that mails a refusal's notice.
  - `lostUntold(limit)` and `lostTold(mediaId, outcome)`: for the notice of a lost file (6.1).
  - `forgetHashes()` and `forgetScores()`: the retention job's two statements above.
- **The media module's index gains plain functions** that take the caller's transaction, beside F's `sealFiles(tx, sealActionId)` and in the form `imageModerationStates` has (`media/index.ts:41`): the command line cannot build the module, which needs the API's whole configuration (F 5).
  - `quarantineNames(tx)` joins `quarantine_plan` to the naming rule for `quarantine-list` and answers, for each post that is sealed for good and not released, its count of image rows, erased or not, which the list compares with `seal_posts.images`: a post whose count differs is left out of the list and named, and the other posts' lines are printed all the same, since one bad line never stops a run.
  - `refusalReported(tx, refusalId, notificationId)` is `upload-report`'s write.
  - `quarantineOrphans(tx)` and `releasedUnerased(tx)` are `text-verify`'s two reads: a `quarantine_files` row that has neither an image row nor a release, and a released post that still has an image row without `erased_at`.
- **`ModerationForSocial` gains** `imagesPublished(postId)`: `createPost` calls it after its commit when the post has images. The member starts its task on the moderation module's `background` (`moderation/context.ts:156`) and returns at once, so `createPost` never waits for a deciding transaction. It is the automated step's entry for a score, and for the match record of an image that was accepted with a flag as an upload and is now posted (7).
- **`media.onMatch(handler)`**: the media module is built before the moderation module (`apps/api/src/index.ts:38`, `:61`), so the wiring hands it the moderation module's handler afterwards. The handler takes `{ kind: "refused", refusalId } | { kind: "posted", mediaId, matchId }`. Media calls it after the commit that stored a refusal, for the uploader's notice and the alert to staff, since the media module mails nobody; and after the commit that stored a match, acting or a flag, for an image that is on a post, which is the step's entry for a late match. A call that is lost to a crash is found by the step's sweep or by the dispatch job's step for untold refusals, which read the same facts from rows.
- **`auth.onSeen(handler)`**, wired like `media.onMatch`: the auth module is the first module built (`apps/api/src/index.ts:27`) and the transparency module needs its mail, so neither can be handed the other when it is built. The handler is a **`TransparencyForAuth`**: `seen(accountId)` and `seenSignedOut(address, userAgent, path)`. Both calls sit in `resolveSession` (`auth/middleware.ts:35`), the first when a session resolved and the second when none did (row 8); the rate-limit middleware calls neither, since it runs before a session can resolve (`app.ts:68`, `:69`). Both swallow every failure of Valkey: counting never fails a request.
- **`AuthForTransparency`**: `mailKeeper(message)`, the keeper's daily mail to the address `HEAD_KEEPER_MAIL`. Today the auth module mails an account, a notifier's contact or every staff account and nothing else (`auth/index.ts:202` to `:217`).
- **`ModerationForStaff` gains** the release's facts and action, the held uploads' list and action, and the home's counts; **`ModerationForAccount`** is unchanged.

Wiring in `apps/api/src/index.ts`: auth first and media, then moderation, as today; then `media.onMatch(moderation.matched)`; `createTransparency({ apiDb, redis, auth, config, logger })` once auth exists, then `auth.onSeen(transparency.forAuth)`; `stopEdge = media.startEdge(jobLock)`, `stopMatch = media.startMatchRetry(jobLock)`, and the transparency module's `startJobs(jobLock)`, which starts its one job, `transparency`. `app.ts` mounts the three public routes before `auth.resolveSession`. The automated step's sweep and the two new alerts of a job join `moderation.startJobs`.

**The architecture test** (`apps/api/test/architecture.test.ts`) gains `transparency` in `MODULES` (`:28`), which today lists six, and one rule for it: a file under `transparency/` imports from `@korbat/db` only the names of `schema/transparency.ts` and `auditHead`. That is what pins "no session and no table of a person".

### The adapters

Each adapter is one TypeScript interface with three implementations, chosen by one setting when the process starts: `off` (the default), `test` (deterministic, for the suite) and the real one. The pattern is `VERIFY_PROVIDER`'s (`apps/api/src/config.ts:168`).

- **A setting that names an adapter without its other settings stops the process at start**, as every missing setting does.
- **A `test` adapter is refused at start while `APP_SITE` is `open`**, so a stand-in can never answer for a third party on a site people can reach. The refusal is built with the first `test` adapter, in Task 3 for the API and in Task 6 for the worker, so no built stack ever accepts a stand-in on an open site (review ruling 11). The tests build the adapters in the process with their own configuration.
- **No adapter is given more than its interface names.** The matcher's takes hashes; the purge's takes prefixes; the witness's takes one digest; the scorer's takes pixels and has no network.
- **An adapter is a file of its own that imports nothing of its module**: `media/match-adapter.ts`, `media/edge-adapter.ts` and `transparency/witness.ts`. The matcher's retry and the outbox's job need the media repository and live beside them, in `match.ts` and `edge.ts`. An architecture test names the three files and fails when one imports the media files or a repository.

| Adapter, where | Setting and values | Interface | While `off` | The `test` adapter | Further settings |
|---|---|---|---|---|---|
| Edge purge, API (`media/edge-adapter.ts`) | `EDGE_PURGE`: `off`, `test`, `cloudflare` | `purge(prefixes: string[]): Promise<"accepted" \| "failed">`. One `fetch` to the provider's purge route with a bearer token and a 5-second timeout; a prefix is `<EDGE_HOST>/api/media/<id>/` | every outbox row closes as `off`; the header is the only bound (row 12) | keeps the prefixes in memory; a prefix that contains `fail` fails | `EDGE_ZONE_ID`, `EDGE_API_TOKEN`, `EDGE_HOST` |
| R1 classifier, worker (`score.ts`) | `R1_CLASSIFIER`: `off`, `test`, `onnx` | `score(pixels, width, height, channels): Promise<number \| null>`, on the small size's raw pixels that `pipeline.ts` already holds, with their three or four channels (`pipeline.ts:101`, `:102`). The model's name and the digest of its weights are constants of `packages/media-protocol` (`classifier.ts`); a wrong digest stops the worker at start | no score; `nsfw_score` stays null; R1 is report-driven as 3c built it | 1 for an image that carries the marker of `fixtures.ts`, else 0. The marker is a block of one exact colour, at least 64 by 64 px, in the image's top left corner, so that it survives the pipeline's resize and its conversion to sRGB; a test proves it through the real pipeline | `AUTOMATION_R1_ACTS` (`off`), `AUTOMATION_DPIA_R1`, `AUTOMATION_DPIA_R1_ACTS` |
| Known material, API (`media/match-adapter.ts`) | `MEDIA_MATCH`: `off`, `test`, or the source's name | `check(h: { sha256, sha1, md5, pdq? }): Promise<{ state: "clear" } \| { state: "matched"; hashType; kind: "exact" \| "near"; classification; listVersion? } \| { state: "unanswered" }>`, and two constants, `MATCH_LISTED` and its part `MATCH_ACTING` (row 28). One function builds the request, and a test fails if it takes anything but hashes | no hash is computed, by the API or by the worker; nothing is checked; the rules page says so | matches the digests of two small PNG files that `packages/media-protocol/src/fixtures.ts` writes out as byte constants (stored, uncompressed blocks; no binary file is committed and none is encoded at test time). The digests are computed from those constants when the adapter is built, and a unit test holds them to `node:crypto`'s. The adapter declares one classification that is listed and acting and one that is not listed. One fixture answers an `exact` match of the first, which acts; the other answers a flag, and a test sets which kind: `near` of the listed class, or the class that is not listed | the source's own settings, `AUTOMATION_R2_ACTS` (`on`), `AUTOMATION_DPIA_MATCH`, `AUTOMATION_DPIA_MATCH_ACTS` |
| Head witness, API (`transparency/witness.ts`) | `HEAD_WITNESS`: `off`, `test`, `rfc3161` | `witness(value: string): Promise<Uint8Array \| null>`: an RFC 3161 request for the SHA-256 value, from a fixed DER template of under 100 bytes written in that file; the answer is stored unparsed beyond its status | the value stands on korbat's page and in the keeper's mail only | returns a fixed token | `HEAD_WITNESS_URL` |

**What the owner must obtain, decide and configure** for each adapter is section 17; in short: a zone with the tunnel, a token with the one permission Zone, Cache Purge, and the zone's settings (edge); leave to fetch pinned weights, the runtime, the measurements and the threshold (R1); an agreement with a source and an adapter written against its interface (known material); a timestamp authority (witness). No step of this design fetches weights, a hash list or a third party's interface.

**The real adapters 3d ships** are `cloudflare` and `rfc3161`: each is one `fetch` against a documented public interface, built and tested against a local stand-in, and switched on only by the owner. `onnx` and every source's adapter are not built: `R1_CLASSIFIER=onnx` and a `MEDIA_MATCH` that names a source stop the process at start with "no such adapter in this build" until the owner's later task adds one.

**The threshold while only the test adapter exists.** `automation_rules().r1_threshold` is null until the owner's build task measures and sets it. The API compares a score with the contracts' mirror of that value and opens no finding while it is null. Under `R1_CLASSIFIER=test` it compares with the test adapter's own constant 0.5 and records `threshold_version` 0, so the suite exercises the whole path and no stored signal can be mistaken for one of a real model.

**Further settings.**

| Setting | Read by | Values, default | What it does |
|---|---|---|---|
| `AUTOMATION_R1_ACTS` | API | `on`, `off`; `off` | a score at or over the threshold also withholds its image (row 19) |
| `AUTOMATION_R2_ACTS` | API | `on`, `off`; `on` | an acting match on a post also seals the post's images; `off` is the fallback, the finding and the urgent alert alone (row 27) |
| `AUTOMATION_DPIA_R1`, `AUTOMATION_DPIA_MATCH` | API | a date each, or empty | the day of the owner's impact assessment for that tool. The API refuses to start with `R1_CLASSIFIER`, or `MEDIA_MATCH`, other than `off` or `test` while that tool's date is empty, and `/rules` prints the date in that tool's block (row 49) |
| `AUTOMATION_DPIA_R1_ACTS`, `AUTOMATION_DPIA_MATCH_ACTS` | API | a date each, or empty | the day on which the assessment covered the measure. The API refuses to start with a real classifier and `AUTOMATION_R1_ACTS=on`, or with a real matcher and `AUTOMATION_R2_ACTS=on`, while that measure's date is empty: with a matcher on and the shipped default, the owner either sets the date or sets `AUTOMATION_R2_ACTS=off` (row 49) |
| `RECIPIENTS_SIGNED_OUT` | API | `on`, `off`; `on` | signed-out readers are counted (row 8) |
| `HEAD_KEEPER_MAIL` | API | an address, or empty | where the keeper's daily mail goes (row 9); empty, no such mail is sent |
| `APP_SITE` | Caddy (F), and now the API and the worker | `open`, `closed`; `open` | 3d reads it only for the rule on `test` adapters above |
| `R1_CLASSIFIER`, `MEDIA_MATCH` | also the worker | | the worker scores only while the first is not `off`, and computes PDQ only while the second is not `off` |

Each comes from `infra/.env` and is blank-as-unset. A setting that the API alone reads is spelled there under the `API_` prefix, as the API's other settings are; the three that two services read (`R1_CLASSIFIER`, `MEDIA_MATCH` and F's `APP_SITE`) are unprefixed, as `MEDIA_FORMATS` is (`infra/compose.yml:139`, `:175`). Compose hands a service only the variables its block names (`:93` to `:141`, `:170` to `:175`), so the task that adds a setting adds it to that block and to the env examples. `GET /api/public/facts` prints every one as a boolean or a name, never a token, a zone or an address.

### The services

**The volume `media-quarantine`.** A named volume on the host's encrypted disk, owned by uid 1000, mode 0700, with the store's own layout under it (`files/<aa>/<id>/<size>.webp`). A new volume takes the owner and mode of the mount path as the image has it, and a path the image lacks is created `root:root 0755`, which the mover, running as `node` with every capability dropped, could neither write nor repair. So the API's image creates `/media/quarantine` owned by `node` with mode 0700 (`apps/api/Dockerfile`, beside the two media paths, `:23` to `:25`), and the volume takes that owner and mode whichever of its two services mounts it first. The README's backup section names it as **not** backed up (row 40). The `api`, `migrate` and `worker` services never mount it, in `compose.yml` or in `compose.dev.yml`: an architecture test reads both files and fails unless `quarantine` (read-write) and `handover` (read-only) are the only services that name the volume.

**The service `quarantine`**, behind the Compose profile `quarantine`:

- the API's image, as `handover` uses it (F 5), the image's user `node`. Its entry point is `node dist/quarantine.js /media/store /media/quarantine`: the two roots are arguments, and the program refuses to start without both, which is also how a test runs it on two temporary directories. The only further arguments it takes are two flags: `--lost` (6.1), and `--inventory`, for a run that reads no list, moves nothing and prints a `have` line for every file the quarantine holds (6.1);
- `network_mode: none`, `cap_drop: [ALL]`, `read_only`, `security_opt: no-new-privileges`, no environment, no database credential;
- `media-store` and `media-quarantine` read-write, and nothing else; no bind mount;
- it reads its list on standard input and prints its receipt on standard output: `docker compose --profile quarantine run --rm -T quarantine < list > receipt`.

What it does with a line is 7's; five rules are architecture. It **decodes nothing**: it copies bytes, takes SHA-256, renames and unlinks. It **refuses a name outside the store's layout**, so a forged list cannot make it touch another file. **A crash leaves a file in one place or in both, never in neither**: the copy is written under a temporary name, synced, compared by digest and renamed before the source is unlinked, and the next run finishes what a crash left; the directory's own sync is skipped only on a platform that refuses it (`EPERM` on Windows, where only the tests run), and any other error ends the run. **One bad line never stops a run** (review ruling 9): a line that cannot be carried out is printed with its word, the next line is taken, and the run ends with exit 1 when any line was not carried out. And **`destroy` looks in both places**: it unlinks the file in the quarantine and, when the store holds one under the same name, there too, and prints where it found it.

**Which files are an image's.** The two variants, `small.webp` and `large.webp`, named by the media module's naming rule, and nothing else: the worker deletes `results/<id>.json` and the attempt marker once the API has discarded the upload (`apps/worker/src/loop.ts:123` to `:130`), so a ready image has neither. The blurhash that a result carried is on the image's row, which no reader hands out for a sealed image (C 7.10).

**`handover`** (F) gains `media-quarantine` read-only beside `media-store` read-only and looks for each listed file in the quarantine first: a seal taken while deciding still has its files in the store (row 38).

**The API and the worker gain no mount and no network.** The API's outbound hosts gain the edge provider's API, the source's and the timestamp authority's, each only while its adapter is on. The worker keeps `network_mode: none`; with a real classifier its image would carry the weights file, fetched at build by digest, which is the owner's later task.

**Valkey** holds three more kinds of key and no new service: `mau:in:<yyyy-mm>` and `mau:out:<yyyy-mm-dd>`, HyperLogLog sketches of about 12 KB each, which cannot list a member (row 8 says what a sketch can still be asked while it exists); and `mau:salt:<yyyy-mm-dd>`, 32 random bytes with 26 hours to live, written nowhere else (row 8). Losing Valkey loses at most the running month's count, which then reads as "not recorded".

**No new database role.** The command line is the migrator, as in F; the `quarantine` service has no database at all, which is why the list and the record are two commands around it.

### The lock order

3c's order stands as F leaves it (F 5): profile rows first, sorted by id; then cases; then, inside a decision's triggers, the `auth.users` rows `FOR SHARE` and the cap's advisory lock; then the case's own post; then image rows in id order; then inserts, the audit row and the deferred checks. 3d adds:

1. **The automated step is a deciding transaction like any other.** It takes the author's profile `FOR NO KEY UPDATE`, then the post's open case or a new one, and never runs inside the transaction that created the post or stored the match: that transaction holds the post's own locks, and profile-then-case would meet them in an order nobody measured (row 22). After the profile's lock it reads its signal's row, and for a match the match record, in a statement of its own: three entries can start the step for one image at once, and the second one then finds the signal handled and ends with nothing written. The price is stated: an image can be public for seconds before a measure.
2. **Without a decider no `auth.users` row is read**, and the cap's advisory lock is taken under the one key `korbat.decision_cap:system`, so two automated steps run one after the other at that point and count each other, each under its own rule (6.6). A refusal's insert takes the same key for its count of refusals (6.7), after it has locked its image row; that row is on no post, so it is no row a step holds or waits for.
3. **A refusal inside the step** (`already_protected`, `automation_capped`) rolls back to a savepoint taken after the finding's writes: the finding stands, the locks stay held until the commit, and nothing is retried in a second transaction.
4. **`seal_release`**: the API takes the subject's profile first; the function takes the seal's case `FOR UPDATE`, reads everything else in statements of their own after that lock, the leave's row `FOR SHARE` (6.2: a withdrawal of that leave and a release on it then run one after the other; `upload_release` reads its leave the same way), reads the admin's `auth.users` row `FOR SHARE`, and updates the posts' image rows in id order.
5. **`upload_hold_end` and `upload_release`**: the uploader's profile first when the refusal still names one; then the refusal's row `FOR UPDATE`; then its one image row.
6. **The triggers of the edge outbox take no lock.** They insert rows of a table nothing else writes, after the statement that hid the image.
7. **`release_replay`, `upload_release_replay` and `upload_hold_replay`** run with the app's site closed and take the image rows in id order.

## 6. Data model (migrations 0030 to 0037)

Eight migrations, none changing a file that exists, each run by drizzle's migrator in one transaction with the others pending.

**The numbers.** The eight are numbered from the first number free after 3f: 0030 to 0037 unless an earlier review task adds a migration, in which case each moves up. This section's headings use the first numbering; no other section writes a migration's number, and a file is named by its name. Before Task 1, 3f is complete, and `--upgrade-from` names 3f's last migration.

| Migration | Name | Task | Holds |
|---|---|---|---|
| 0030 | `quarantine`, generated and completed by hand | 1 | `quarantine_files`, `quarantine_plan`, `quarantine_counts`, `seal_custody`, `media_quarantined`, `media_lost`, `lost_untold`, `lost_told`; `alert_steps` replaced (6.1) |
| 0031 | `release`, generated and completed by hand | 2 | `releases`, `release_posts`, `release_leaves`, `release_notices`, `release_rules`; `frozen_for` replaced; `release_facts`, `seal_release`, `release_tellable`, `release_announce`, `releases_confirmed`, `release_replay`; `append_confirmed_audit`, `quarantine_plan`, `quarantine_counts`, `seal_custody` and `alert_steps` replaced; the gap class `release` (6.2) |
| 0032 | `edge_purges`, generated and completed by hand | 3 | `edge_purges` and its two trigger functions (6.3) |
| 0033 | `transparency`, generated and completed by hand | 4 | `transparency_editions`, `recipient_months`, `transparency_rules`, `band`, `transparency_figures`, `edition_publish` (6.4) |
| 0034 | `head_publications`, generated and completed by hand | 5 | `head_publications`, `head_value` (6.5) |
| 0035 | `automated_decisions`, generated and completed by hand | 6 | the two enum values, the changed constraints, `automated_signals`, `automated_objections`, `automation_rules`; `decisions_record` and `decision_holds` replaced (6.6) |
| 0036 | `known_material`, generated and completed by hand | 7 | `media_hashes`, `media_matches`, `upload_refusals`, `match_listed`, `match_acting`, the column `decisions.match_answer_reason`, the attach block, `upload_hold_end`, `upload_release`, `upload_release_replay`, `upload_hold_replay`; `append_confirmed_audit`, the function of `releases_confirmed`, `release_tellable`, `decision_holds`, `automated_signals_guard`, `quarantine_plan`, `quarantine_counts`, `transparency_figures` and `alert_steps` replaced (6.7) |
| 0037 | `signals_and_retention`, hand-written | 8 | `case_flag`, `erase_automation_records` (6.8) |

0037 changes no table (`pnpm --filter @korbat/db generate:custom --name=signals_and_retention`), so the generate gate prints "No schema changes" after Task 8.

**Conventions**, as C 6, E 6 and F 6:

- Every function is owned by `korbat_migrate`, has its `search_path` pinned (`public, pg_temp` unless said), names every object schema-qualified and has EXECUTE revoked from PUBLIC.
- A "forced" column is set by a BEFORE trigger whatever the insert supplied. "For every role but the migrator" in a plain trigger means `current_user <> 'korbat_migrate'`.
- An error carries its code as the message under SQLSTATE P0001. A read that must see what committed while a lock waited is a statement of its own after that lock.
- A new closed list is `text` with a CHECK, never an enum: only the two values below extend one.
- Every new table has row level security on, with an allow-all policy for each role that is granted anything on it. Its migration first revokes everything 0001's default privileges gave `korbat_api` and then grants what this section lists.

**Replacing a function.** `CREATE OR REPLACE` keeps owner and grants. The migration states each replaced function whole, as the built text of its last version (3c's, then 3e's, then 3f's) with the changes this section lists and no other. Step numbers are those of the comments in `0016_decisions_and_ledger.sql`. The first step of a task that replaces a function is to read that built text and to write the lab's cases as tests on it, through the API's own statements: each case the lab accepted and each refusal it measured is one test with the same code (O4). The lab's patch (`lab-3d/make_proto.py`) is an exact-text replacement written against 0016 and 0017, and its seed and helpers stand in for statements that 3e and 3f have since changed, so the lab's folder is kept as the record of what was measured and is not run. 3c's, 3e's and 3f's own tests of each replaced function run unchanged and pass, which is how a change outside the lists is caught.

**The rule for the two new enum values** (E 6, F 6). 0035 adds `automated` to `intake_kind` and `system` to `intake_channel`. A value added by `ALTER TYPE ... ADD VALUE` cannot be used as an enum literal before the migrating transaction commits (`55P04`). So, in 0035 to 0037:

1. the two values are named as enum literals only inside PL/pgSQL bodies;
2. CHECKs, views and SQL-language functions compare `kind::text` and `channel::text`;
3. no index predicate and no default names one;
4. no statement of a migration executes a function that touches one.

A source test refuses either value as a literal outside a PL/pgSQL body in these files (section 12). The lab's prototype loaded in one transaction under exactly this rule.

**0033 comes before the labels exist**, and its `transparency_figures` counts intakes of the kind `automated` (6.4). A function that names a label its type does not have yet is created without complaint and fails when it is first called (`invalid input value for enum intake_kind`), which would be Task 4's own test of `edition_publish`. So 0033 is under the stricter form of the rule: neither value appears as an enum literal anywhere in it, in a PL/pgSQL body either; it compares `kind::text`, as it does for the kind `order`. The source test reads 0033 under that form.

**The alerts.** `alert_outbox.kind` is text under a CHECK written from `ALERT_KINDS` (F 6.1, 10.1). Each migration below whose task raises a new alert drops that CHECK and adds it again with its kinds:

| Kind | Since | Written by | Condition |
|---|---|---|---|
| `quarantine_due` | 0030 | `alert_steps()` | a move in or out of the quarantine has been due for longer than the daily threshold |
| `quarantine_lost` | 0030 | `staff.js quarantine-record` | a receipt recorded a file as lost |
| `release_undestroyed` | 0031 | `alert_steps()` | a file to destroy has been due for longer than the daily threshold |
| `seal_released` | 0031 | the release's route, after its commit | an admin released sealed images or, from 0036, a held file |
| `edge_purge_failed` | 0032 | the outbox's job | a purge gave up after 24 hours |
| `head_unwitnessed`, `head_missed` | 0034 | the transparency job | the witness did not answer; a day has no value |
| `automated_objection`, `automation_capped` | 0035 | the route; the step | an author asked for a person; a cap or a limit refused a measure, and the fact says which |
| `automated_waiting` | 0035 | the automated step's sweep | an objection is older than `objection_target_hours` and its measure is still in force |
| `matcher_down` | 0036 | `alert_steps()`; `finalize`, at once, for the limit | a check has been unanswered for `matcher_down_minutes` and none was answered since; or the limit on refusals was met |
| `hold_ended_unreported` | 0036 | the route, after its commit | an admin ended the hold on a matched upload without a report |

`alert_steps()` (F 6.1) is replaced in 0030, 0031 and 0036, each time with one more row of F's table under F's one rule: a row is written when its condition holds and no row of the same kind was created at or after its threshold, which for these three is F's daily threshold. A kind that a job writes is that job's own insert into `alert_outbox` under the same rule, as F's alert tick writes the heartbeat's (F 6.1). The three kinds that an act writes (`quarantine_lost`, `seal_released`, `hold_ended_unreported`) are one row for each act and go to every staff account, the actor included, as 3c's `moderation_csam_lifted` does for the milder act. The facts of each kind are section 10's. Every row carries counts and times and never a handle, a hash, a source's answer or an id.

### 6.1 Migration 0030: the quarantine (Task 1)

**`quarantine_files`**: one row a file that was moved.

| Column | Type | Notes |
|---|---|---|
| `media_id` | `uuid not null` | no foreign key: the row outlives the image row |
| `file` | `text not null` | the store's name under its root, `files/<aa>/<id>/small.webp` or `.../large.webp`. CHECK `quarantine_files_file`: that form, with `media_id` as the id. Primary key `(media_id, file)` |
| `post_id` | `uuid` | the image's post when it was recorded; null for an upload on no post. The image row is dropped by the disposal soon after a release, and this column is what still ties the file to its release |
| `size`, `sha256` | `bigint`, `text` | bytes, over zero; 64 hex characters. CHECK: both or neither, and both null only on a row that was written as lost before its file was ever moved |
| `moved_at` | `timestamptz not null` | forced `now()`: the time the move was recorded, which is not before the move |
| `returned_at` | `timestamptz` | the file went back to the store |
| `destroyed_at`, `release_id` | `timestamptz`, `uuid` | the file was unlinked; the release it was destroyed for, with a foreign key to `releases` from 0031. CHECK: a release only on a destroyed row |
| `lost_at`, `lost_told` | `timestamptz`, `delivery_state` | the file was found in neither place and the operator recorded it as lost, which only a run of the mover with `--lost` can bring about; the author's notice of it, `pending` for an image that is on a post and is not sealed for good, else `none`. CHECK: at most one of returned, destroyed and lost; `lost_told` only with `lost_at` |
| `imported_at` | `timestamptz` | a row written again after a restore keeps a supplied `moved_at` that is not after the clock |
| `unknown` | `boolean not null` | forced at insert: no image row with this id existed when the row was written, so the database does not know the image. Such a row is the plan's `operator` line and never a `destroy` line (below) |

- `REVOKE ALL ... FROM korbat_api` and no policy for it: only the command line, as the migrator, reads and writes the table. `quarantine_files_insert`, plain, BEFORE INSERT, forces `moved_at` (but for an imported row), `unknown`, and `returned_at`, `destroyed_at` and `release_id` null.
- **An image is in the quarantine** when each of its two files has a row with `returned_at` and `destroyed_at` null. A row with `lost_at` counts here: the file is accounted for and nothing is left to move, so one missing file never keeps its seal from being released or its image in the plan for good. The two names are the CHECK's; a test holds them to the contracts' `MEDIA_SIZES`.
- A file that returned and is moved again keeps its row: `quarantine-record` clears `returned_at` and writes the new `moved_at`. A digest that differs from the stored one is reported and counted (`mismatched`), and the stored digest stays: the files of an id never change.
- **A receipt is taken line by line** (review ruling 9). For every well-formed line `quarantine-record` writes what the mover did: the file's row for an `in` line, `returned_at` for `out`, `destroyed_at` for `destroy`, `lost_at` for `lost`. It does so whatever the plan says by then, because a line is a fact about where a file now is. A line that the plan computed at the record no longer holds is reported and counted (`againstPlan` in the audit row `quarantine_recorded`, section 10), and the plan computed after the record lists that file under `out`, `in` or `destroy`, so the next run moves it back. A line is skipped, by itself, when it is malformed or names a file that is not one of its image's two; a line whose digest differs from the stored one is recorded as the move it was, with the stored digest kept, and counted (`mismatched`); a `missing` or a `refused` line writes nothing and is counted. No line stops the others from being recorded. The whole receipt is one transaction, as the migrator, whose last statement is the one audit row `quarantine_recorded` (section 7.1): a line that is skipped is skipped inside it, and the command exits 1 after its commit when it reported anything.
- **No file lies in the quarantine without a row.** The mover's run with `--inventory` moves nothing and prints one `have` line for every file it finds there, and `quarantine-record` gives a file that has no row its row, with the size and the digest the mover took, and reports it (`found`). The plan then lists it as it lists any row: under `out`, under `destroy`, as rightly there, or, when the database does not know the image (`unknown`), under `operator`. A name that is no image's is reported for the operator and gets no row, since the table's CHECK would refuse it.

**`public.quarantine_plan() returns table (direction text, media_id uuid)`**, STABLE, SECURITY DEFINER, EXECUTE to nobody: the command line calls it as the migrator. It answers four sets: three that the mover carries out, and one that it leaves alone.

An image is **sealed for good** when a `seal_media` in force lists its post in `seal_posts` and that measure's decision is not interim (`measures_in_force`, `decision_kind::text <> 'interim'`). A seal taken while deciding, a person's or the program's, does not count: it is meant to end within hours (row 38).

1. **`in`**: every image row with `erased_at` null that is sealed for good and not in the quarantine.
2. **`out`**: every image that has a row with `returned_at`, `destroyed_at` and `lost_at` null, whose image row exists, is on a post, has `erased_at` null, and is not sealed for good. This is the way back after an `unseal_media` (row 39), and also the way back for a file that a stale list moved after its seal had been lifted: its line was recorded, so it has a row and is in this set.
3. **`destroy`**: every image that has such a row, not marked `unknown`, and whose image row no longer exists. That is the file of a row an ordinary deletion took after its seal had ended: the worker's deletion found nothing in the store, and without this clause the file would stay for good. 0031 and 0036 add the released files. A lost row is in no set: nothing of it is left to move or to destroy.
4. **`operator`**: every image that has such a row marked `unknown`: a file that lies in the quarantine for an image the database did not know when the file was recorded, which is what the inventory finds after a restore to a backup taken before the upload. It may be a held upload that is kept for a report, or a sealed image from after the backup, so it is never in `destroy` and never in `out`, whatever the database has since been told: nothing is destroyed on a list's word for an image the database cannot place. `quarantine-list` prints the line, the mover leaves it alone, and the row stays in this set until a line that the operator had the mover carry out for that file is recorded, as any line is. What the operator checks first is the Restoring runbook's (section 18).

So a file with a row is never without a place in the plan for longer than the disposal takes: it is rightly in the quarantine, or in `out`, or in `destroy`, or the operator's, or its image row is erased and about to be dropped, after which it is in `destroy`.

**`public.quarantine_counts() returns table (due_in integer, due_out integer, undestroyed integer, oldest timestamptz)`**, STABLE, SECURITY DEFINER, EXECUTE to `korbat_api`: the sizes of the three sets the mover carries out, and the earliest time at which an image of `in` or `out` became due. For `in` that is its seal's decision's `decided_at`; for `out`, the `created_at` of the newest ledger row that reversed a seal for good listing its post. It is what the console's home and the alert learn: counts and one time, never an id.

**`public.seal_custody(action uuid) returns table (files integer, moved integer, moved_at timestamptz, to_return integer, files_left integer, lost integer)`**, the same kind and grant: the same for one seal, which is what its case shows. `files` is two for each unerased image row of the posts the seal's ledger row lists and that are not released; `moved`, how many of those files are in the quarantine; `moved_at`, the newest `moved_at` among them; `to_return`, the files of the seal's posts that the plan lists under `out`; `lost`, the files of the seal's posts that are recorded as lost, for the case's line on a file that never reached the quarantine or never came back; `files_left` is 0 here and, from 0031, the files of the seal's released posts that are not yet destroyed, found through `quarantine_files.post_id`, since their image rows are gone. Counts and one time, never a file's name or digest: `CaseDecision.custody` (section 10) is this one object on the seal's decision, not a list by image.

**`public.media_quarantined(media uuid) returns boolean`**, the same kind and grant: a row of that image with `returned_at`, `destroyed_at` and `lost_at` null exists. **`public.media_lost(media uuid) returns boolean`**, the same: a row of that image with `lost_at` set exists. `serve` and the owner's status call them only for an image whose state is `visible` and whose file is missing, to say "being restored", or that korbat lost the file, in place of an error (row 39).

**`public.lost_untold(n integer) returns table (media_id uuid, lost_at timestamptz)`** and **`public.lost_told(media uuid, outcome delivery_state) returns void`**, SECURITY DEFINER, EXECUTE to `korbat_api`: the images that have a lost row whose `lost_told` is `pending`, and the write of the notice's outcome, which changes only from `pending`. They are the one way the dispatch job learns of a lost file and marks its author told, since the table is closed to it.

These six functions are all that the API's role can call on the quarantine; none answers a file's name or digest.

**`alert_steps()`**, replaced: it gains `quarantine_due`, with the facts `count` (due in and due out together) and `oldestAt`, as section 10 names them.

### 6.2 Migration 0031: the release (Task 2)

**`public.release_rules()`**, SQL, IMMUTABLE, EXECUTE to `korbat_api`: one row, `silence_days integer` null, `period_notice_days integer` 30, `backup_days integer` 30, `posts_max integer` 1000. A test holds `backup_days` to `RETENTION.backupDays` and `posts_max` to the contracts' `RELEASE_POSTS_MAX`. `silence_days` is counsel's (row 41): it changes only by a later migration that replaces this function.

**`release_leaves`**: a leave or an instruction to destroy, recorded as a fact of its own (row 41, review ruling 1). It is the one thing a release on the ground `leave` rests on; an authority's assessment is not in this table and is no ground.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `notification_id` | `uuid not null` | F's record of the report that the leave answers: the seal's, or from 0036 the one a refusal's `notification_id` names. No foreign key into F's table |
| `leave_from` | `text not null` | `authority` or `court` (the contracts' `from`; the word is reserved in SQL) |
| `reference` | `text not null` | the reference of the letter or order that holds it, 1 to 200 characters |
| `received_on` | `date not null` | the leave's day: the day that the letter or order bears, not after today |
| `untold`, `untold_until` | `boolean not null`, `timestamptz` | the authority forbids telling the person, and until when; null with the mark set is an open end, as F's `not_to_person` has it. The command may later end an open one; no other member of a recorded leave is changed |
| `recorded_at`, `recorded_by` | `timestamptz not null`, `text` | forced `now()`; the operator's name, as F's commands record it |
| `withdrawn_at`, `withdrawn_by` | `timestamptz`, `text` | the withdrawal of a leave that was recorded by mistake: both null while the leave stands, and written together, once. The time is forced `now()` by the table's guard (below), whatever the update supplied; the name is the operator's, as `recorded_by`. CHECK: both or neither |

- No privilege for `korbat_api`: the API can neither invent a leave nor read one but through `release_facts`. The one writer is the command line, as the migrator: `staff.js release-leave` is given the seal, by its ledger row's id, or the refusal, finds that one's notification record itself (the seal's as `seal_report` finds it; a refusal's `notification_id`) and is refused without one; it inserts the row, or ends an open `untold_until`, with a plain audit row `release_leave_recorded` under the system's id that carries every member. The keeper's copy so holds a leave; after a restore a lost one is a gap of the class `release`, which the same command closes when the operator records the leave again, under the id that the gap's line names (below).
- **A leave recorded by mistake is withdrawn, never deleted or rewritten.** `staff.js release-leave --withdraw <leave>` writes the withdrawal on the leave's row, with a plain audit row of its own, `release_leave_withdrawn`, under the system's id, which names the leave. `release_leaves_guard`, plain, BEFORE UPDATE, binds every role, the migrator included, since the migrator is the table's one writer. It forces `withdrawn_at` to `now()`; it refuses a withdrawal with `leave_used` when a row of `releases` names the leave in `leave_id`, which it reads in a statement of its own after the row's lock; and it lets the two columns change only from null, and nothing of a withdrawn leave change (`moderation_column`, as 3c's guards answer). A withdrawn leave supports no release: `release_facts` does not answer it, and step 3 of `seal_release` refuses it with the code that a missing leave gets. A leave that a release has rested on is never withdrawn: the release cannot be taken back, and its record keeps the word it rested on. The row of a withdrawn leave stays, with what was recorded and with when and by whom it was withdrawn.
- A leave does nothing by itself: the files stay sealed and in the quarantine until an admin's confirmed action names it by its id. It is never typed into the console, and it is no member of a request that an admin could make up.

**`releases`**: one row a release. No role but the owner inserts it: `seal_release`, `upload_release` and the two replay functions are its writers.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `seal_action_id` | `uuid` | the seal's ledger row the admin named; null for a replay and for an upload. No foreign key |
| `upload_refusal_id` | `uuid` | the refusal, from 0036; else null |
| `post_ids` | `uuid[] not null` | the posts released, in id order; empty for an upload |
| `basis` | `text not null` | `leave` or `period` |
| `leave_id` | `uuid` | the leave or instruction the release rests on; null with the basis `period`. No foreign key: after a restore a release may be replayed before its lost leave is recorded again |
| `their_reference` | `text` | the leave's reference, copied from its row. CHECK: `leave_id` and this are set with the basis `leave`. The record's answer is not copied: an assessment is not what a release rests on |
| `released_by` | `uuid` references `profiles` | null for a replay |
| `released_at` | `timestamptz not null` | `now()`; a replay keeps the original |
| `replay_of` | `uuid` unique | the original release's id |
| `backups_clear_at` | `timestamptz not null` | the day after which no backup that is deleted on time holds a released file: the later of `released_at` and the newest `moved_at` of the files plus `backup_days`. For a replay: the replay's own time plus `backup_days`, since the backup just restored from is still kept. A backup that korbat keeps for an authority is outside this day (row 46) |
| `author_notice`, `author_notice_at` | `text not null`, `timestamptz` | one of 3c's delivery states or `held`, under a CHECK (the contracts' `RELEASE_NOTICE_STATES`): text, because `delivery_state` is an enum and gains no value here. Forced at insert: `none` for an author who no longer exists; else `held` while `release_tellable` answers false for the new row, a replay's among them; else `pending` for a release and `none` for a replay, whose author was told when the release was first taken. So a replay is `held` while a hold on telling stands and `none` otherwise: the author of a release whose notice was still held when a restore lost it is told when the hold ends, and a restore never turns a held notice into none. While it is `held` no mail goes out and no reader lists or answers the release |
| `imported_at` | `timestamptz` | set on a replay |

Grants to `korbat_api`: SELECT, and UPDATE of the two notice columns. **`releases_notice`**, plain, BEFORE INSERT OR UPDATE, forces the notice's first state as the table says and, for every role but the migrator, lets `author_notice` leave `held` only for `pending` and only while `release_tellable` answers true: the dispatch job makes that one move in the round that finds the hold ended.

**`release_posts`**: `post_id uuid` primary key, `release_id uuid not null` references `releases`. No foreign key to `posts`. Insert-only for its owner; SELECT to `korbat_api`. This is the release's mark, keyed on the post (row 43, O2).

**`release_notices`**: the day of a release by period, told to the author beforehand (row 41). `subject_id uuid` primary key (the seal's ledger row, or the refusal); `release_on date not null`; `created_at` forced; `told delivery_state not null default 'pending'`, `told_at`; `objection text` (at most 2000 characters), `objected_at`; `objection_answered_at`. Grants: SELECT, and UPDATE of `told`, `told_at`, `objection` and `objected_at`. Its one writer is **`public.release_announce(subject uuid, staff uuid) returns date`**, SECURITY DEFINER, EXECUTE to `korbat_api`: admin only, and `release_period_unset` while `silence_days` is null. **Nothing reaches it in 3d**: the constant ships null, the console shows no control for it, and the route, the screen and the objection's form are built by the task that sets the period, on counsel's answer. The table and the function are here so that step 3 of `seal_release` is whole. Task 2 calls and tests the function all the same, since no function of a migration is left without a task that does (review ruling 10): as built it answers `release_period_unset`; and a test that replaces `release_rules()` with a period set, inside a transaction it rolls back, proves the row it writes, the admin's check, and the `period` branch of step 3 with its three waits.

**`frozen_for(post, author)`**, replaced as F leaves it, with its four arms. Only the seal arm changes. It becomes: a row of `seal_posts` for the post whose measure is in force exists, **and** no row of `release_posts` for the post exists. The other three arms are untouched, so a released post with a new unanswered suspect item is frozen again through the first arm (LAB D4), and one preserved for an order through the fourth. It stays an SQL function that names no enum value. Cost: one index-only probe, about 0.02 ms a call more (LAB D).

**`public.release_facts(action uuid) returns table (reported boolean, their_reference text, answer text, answered_at timestamptz, handed_over_at timestamptz, quarantined boolean, preserved boolean, leave_id uuid, leave_from text, leave_reference text, leave_received_on date, leave_untold boolean, leave_untold_until timestamptz, tell_held boolean)`**, STABLE, SECURITY DEFINER, EXECUTE to `korbat_api`. The console's Release screen shows exactly these facts.

- `reported`, `their_reference`, `answer`, `answered_at`: from F's `seal_report(action)`, as O1 amends it. It stays executable by nobody; this function calls it as its owner. The answer is shown as what it is, the authority's assessment, and no step of `seal_release` reads it.
- `handed_over_at`: the newest `delivered_at` of F's `productions` that hold files and name this ledger row in `seal_action_id`. This is one of the reads of a table of 3f's that remain in 3d's release (O1).
- `quarantined`: every post that the seal lists and that is not released has as many image rows, erased or not, as its `seal_posts.images`, and each **unerased** one of them is in the quarantine (6.1). `seal_posts.images` counts every row of the post, erased or not (`0016:695`, `:704`), and gate K keeps an erased row of a sealed post, so a count of unerased rows would keep such a seal from ever being released. `quarantine-list` counts the same rows for the same posts (section 5, `quarantineNames`): the posts that are sealed for good and **not released**, since the disposal deletes a released post's rows while the seal still lists it.
- `preserved`: F's `post_preserved` answers true for one of those posts. F 6.7 pins `post_preserved` as named by `frozen_for` alone: the pin gains this function.
- `leave_id` and the five members after it: the newest row of `release_leaves` for the seal's notification record that is not withdrawn; null when there is none.
- `tell_held`: what `release_tellable` would answer for a release taken now, negated (below). The screen says so before the admin confirms, since the author's notice then waits (row 44).

**`public.seal_release(action uuid, basis text, leave uuid, staff uuid) returns uuid`**, PL/pgSQL, SECURITY DEFINER, EXECUTE to `korbat_api`. The API has taken the subject's profile first (section 5). In this order:

1. The seal's ledger row, and its case `FOR UPDATE`. `release_not_open` unless the row is a `seal_media` of a decision that is not interim, is in force, and lists at least one post that is not in `release_posts`. The posts to release are the lowest `posts_max` of those in id order, read after the lock: a seal that lists more is released in parts, the case answer shows how many remain, and the admin confirms each part.
2. `release_facts`, read after the lock: `release_not_reported` unless reported; `release_not_quarantined` unless quarantined; `release_preserved` when preserved. The two facts are over every unreleased post of the seal, not over this part alone, so nothing is released from a seal that is not wholly in the quarantine.
3. The ground.
   - `leave`: `release_no_leave` unless a row of `release_leaves` for this seal's notification record exists, is not withdrawn and is the one the request names in `leave`. The function reads that row `FOR SHARE`, so a withdrawal and a release of one leave run one after the other: a withdrawal that comes second waits and is then refused (`leave_used`), and a release that comes second waits and then finds the leave withdrawn. The record's answer is not read (review ruling 1): `illegal` is an assessment and supports no destruction, `not_illegal` has its own path, `unseal_media`, and `no_assessment`, `other` and silence end nothing.
   - `period`: `release_period_unset` while `silence_days` is null. Otherwise `release_period_running` until `silence_days` have passed since `handed_over_at` or, when nothing was handed over, since the report's `sent_at` (from `seal_report`); and until the seal's row of `release_notices` is told, is `period_notice_days` old and has no objection without an answer.
   - any other word, the withdrawn ground `answer` among them: `release_no_leave`.
4. `admin_required` unless `staff` is an admin, read from `auth.users` `FOR SHARE` as `decision_actions_check` step 9 reads a decider.
5. The writes: one row of `releases`, with the leave's id and its reference; one row of `release_posts` a post; `UPDATE post_media SET erased_at = now()` on the posts' rows where it is null, in id order. It answers the release's id.

It writes no decision and no ledger row: the seal stays in force as a measure, and the mark is what ends the freeze through it. Gate V and `serve` refuse an erased row, and 3c's disposal drops it; gates K and E, the R4 redaction and the case answer follow with no clause of their own (C 17).

**`public.release_tellable(release uuid) returns boolean`**, STABLE, SECURITY DEFINER, EXECUTE to `korbat_api`. It answers false while one of three holds, and true otherwise:

- the release's leave is `untold` and its `untold_until` is null or ahead;
- an event of the notification record that the release rests on (the seal's record, as `seal_report` finds it; from 0036 also the record that a refusal's `notification_id` names) carries F's mark `not_to_person` with an end that is open or ahead (F 7.13 step 6);
- a decision about a post of the release is untold under F's hold (F 6.3 step 10).

A release is born `held` while it answers false. The dispatch job asks again in every round and moves the notice to `pending` in the round that finds it true, so the notice goes out when the last hold has ended and never before (row 44). It answers a boolean and nothing of a record.

**For a replay** the same three are asked, and its notice is `held` while the answer is false and `none` otherwise (the table above). A replay names no seal, so the record of the report is the one that the row of its leave names (`release_leaves.notification_id`). While that leave has no row, because the restore lost it and the operator has not yet recorded it again (its gap keeps the site closed until then), neither the leave's mark nor the record can be read, and the function answers false: the replay is `held`, and the dispatch round after the leave is back reads what the marks say. That is the cautious side: an author who had been told before the restore may so be told a second time, and nobody is shown a release that an authority forbade telling.

**`releases_confirmed`**, a deferred constraint trigger, AFTER INSERT ON `releases`, for a row with `replay_of` null. At commit the transaction's head audit row must:

- be `seal_released` on this seal's ledger row (from 0036: or `upload_released` on this refusal), and name the release in `metadata.releaseId`;
- carry a step-up and have been written by `released_by`;
- have params that equal the row under the contracts' names: the posts' ids, the ground, the leave's id and its reference (section 10).

Otherwise the commit is refused `release_mismatch`. So what an admin's key confirmed is what was destroyed, and the keeper's copy holds every fact a replay needs (row 45).

**`append_confirmed_audit`**, replaced as F leaves it: its action list gains `seal_released`. Nothing else changes.

**`public.release_replay(original uuid, posts uuid[], basis text, leave uuid, their_reference text, released_at timestamptz) returns text`**, PL/pgSQL, SECURITY DEFINER, EXECUTE to nobody: `staff.js release-replay` calls it as the migrator, with the app's site closed. In this order:

1. `present` when a release with that `id` or that `replay_of` exists. So it is idempotent, and a release the backup already held is left alone.
2. `replay_no_gap` unless an open gap of the class `release` names that release. A gap is written only by `restore-import`, for a line it has checked against the chain (F 7.17 step 2.1), so nothing but a verified line of the keeper's copy can erase an image row, and `release-replay` need not check the keeper's files a second time.
3. One row of `releases` with `replay_of`, the original time, `imported_at`, no seal and no admin; the leave's id and the reference are the line's. Its notice is forced `held` or `none`, as the table's rule for a replay says.
4. A row of `release_posts` for each post that has none.
5. `erased_at` on the posts' image rows where it is null, in id order.
6. That gap is closed, with the disposition `imported`.
7. It answers `replayed`, with the numbers of posts and of image rows.

It reads no seal. A post that no seal of the restored database lists is erased all the same, and a lost seal for good that an admin takes again afterwards lists a post that is already released and freezes nothing (LAB D2 to D4).

**F's `restore_gaps` gains the class `release`**: the CHECK on `class` is dropped and added again with the value, which is text. `RestoreView.mayOpen` stays false while one is open. F 6.7 pins the writers of `restore_gaps`: the pin gains the replay functions (three from 0036) and, from 0036, `upload_hold_end`; the command `release-leave` closes a gap as the migrator, as F's notification commands do with `--gap`. What the import writes for 3d's lines above the restored head (section 7):

- one gap of the class `release` for each `seal_released` line and, from 0036, for each `upload_released` and each `upload_hold_ended` line, closed by its replay, or, for a lost end of a hold whose refusal the restored database still holds, by the admin's new end of that hold (6.7);
- for an `automated_decided` line, a lost decision under F's own classes, by its one action: `seal_interim` for a `seal_media`, `restriction` for a `withhold_media`. F's import reads three actions for lost decisions (F 7.17 step 2.4); this is the fourth. Without it a backup taken before an automatic seal would restore a matched image as public and on no list;
- one gap of the class `release` for each `release_leave_recorded` line: the restored database has lost a leave, and `staff.js release-leave` closes the gap when the operator records it again from the paper (section 8). A leave that a later line of the copy withdraws gets no such gap: a withdrawn leave supported no release, and it is not recorded again;
- one gap of the class `release` for each `release_leave_withdrawn` line whose leave the restored database holds: there the leave stands again as if it had never been withdrawn, and `staff.js release-leave --withdraw`, given the gap, closes it by withdrawing the leave again (section 8).

**`quarantine_plan`, `quarantine_counts`, `seal_custody` and `alert_steps()`**, replaced. `destroy` gains every image that has a row with `returned_at`, `destroyed_at` and `lost_at` null, not marked `unknown` (6.1), and whose `post_id` is in `release_posts`; `quarantine-record` then writes the release's id from that post. `seal_custody` gains `files_left` (6.1). `alert_steps()` gains `release_undestroyed`: a file of a release older than the daily threshold, or one of 6.1's third set recorded longer ago than that, is not destroyed.

**Two pins of 3c's tests are extended** (C 17): the writers of `post_media.erased_at` gain `seal_release` and `release_replay` (and in 0036 `upload_release` and `upload_release_replay`). The callers of `post_frozen` gain none: the release reads `seal_posts` and `measures_in_force`, not the predicate.

### 6.3 Migration 0032: the edge outbox (Task 3)

**`edge_purges`**: one row for each time an image stops being public.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity primary key | |
| `media_id` | `uuid not null` | no foreign key |
| `cause` | `text not null` | `state`, `deleted` or `released` |
| `created_at`, `next_at` | `timestamptz not null` | forced `clock_timestamp()` and `now()`: a row is due at once |
| `attempts` | `smallint not null default 0` | |
| `outcome`, `done_at` | `text`, `timestamptz` | `accepted`, `failed` or `off`; both or neither |

- Indexes: `(next_at) where done_at is null` for the job; `(media_id, id)` for the newest row of an image.
- Grants to `korbat_api`: SELECT; UPDATE of `attempts`, `next_at`, `outcome` and `done_at`; DELETE, which the retention job uses for rows 30 days past `done_at`. **No INSERT**: only the two triggers write a row, so no route can forget one and none can invent one.

**`public.post_media_purge()`**, SECURITY DEFINER, the function of a trigger AFTER UPDATE OF `moderation_state`, `erased_at` OR DELETE ON `post_media`, for each row. For a row that is on a post and ready it writes one row:

- when its state was `visible` and no longer is: cause `state`;
- when its `erased_at` becomes set: cause `released` if its post is in `release_posts` (the release writes its mark first), else `deleted`;
- when the row is deleted: cause `deleted`.

**`public.posts_purge()`**, SECURITY DEFINER, AFTER UPDATE OF `moderation_level`, `state` ON `posts`, for each row: one row for each ready, unerased image of the post when the level was `visible` and no longer is (cause `state`), or the state was `visible` and no longer is (cause `deleted` when it became `deleted_by_author`, else `state`).

Both compare through text and name no enum literal, so `disabled` (F) and every later level are covered without being named. Every measure of 3c, 3e and 3f moves these columns through `moderation_apply`, and an author's deletion, a purge and a release move them too: the triggers see all of them, whoever the writer is (row 11). A row is written whether the adapter is on or off; two rows for one image in one transaction are harmless, since the job sends each prefix once a request. The job closes exactly the rows its round read, by id at or under the highest it read: a row written for the same image while the request was out stays open for the next round. An upload on no post, a held one among them, never gets a row: it was never public, so an upload's release writes none.

### 6.4 Migration 0033: the public figures (Task 4)

**`public.transparency_rules()`**, SQL, IMMUTABLE, EXECUTE to `korbat_api`: `floor` 10, `round_to` 10, `due_month` 3, `due_day` 1, `method` 1.

**`public.band(n bigint) returns text`**, SQL, IMMUTABLE, the same grant: `0` for zero; `1 to 9` for a count under the floor; otherwise `about ` and the count rounded to the nearest `round_to`, halves upward (row 3). It is the only place a count becomes public text.

**`transparency_editions`**: `year smallint`, `version smallint`, primary key both; `computed_at`, `published_at timestamptz not null`; `method smallint not null`; `reason text not null` (`first`, `hold_ended` or `correction`; version 1 is `first` and no other is); `figures jsonb not null`. SELECT to `korbat_api`. `edition_publish` alone writes a row, and nothing updates or deletes one: an edition is frozen when it is stored (row 2).

**`recipient_months`**: `month date` primary key (a first day of a month); `signed_in integer not null`; `signed_out_days integer`, null when `RECIPIENTS_SIGNED_OUT` was off; `method smallint not null`; `computed_at` forced. INSERT and SELECT to `korbat_api`; no UPDATE and no DELETE. Two numbers a month, and nothing of a person.

**`public.transparency_figures(year integer, as_of timestamptz) returns jsonb`**, STABLE, SECURITY DEFINER, EXECUTE to nobody. In this order:

1. `edition_not_due` before `due_day` of `due_month` of `year + 1`, in UTC. So no figure of the running year exists anywhere.
2. Every count is of rows whose time lies in the year in UTC. A decision of the kind `order` (compared as text) is in none of the tables of step 3. Where a table counts a row's later fate (how an upload's hold ended; whether a person's decision then restricted), it is the fate on the edition's due day and not on `as_of`: a version computed later prints the same tables, and `as_of` moves the order section alone.
3. The tables, each a list of `{ label, count }` with `count` from `band`:

   | Member | Rows counted | By |
   |---|---|---|
   | `restrictions.byGround`, `.total` | decisions of the kinds `interim` and `final` with the outcome `restricted`, by `decided_at` | each rule; "the law" for the ground `illegal` |
   | `restrictions.byMeasure` | the ledger rows of those decisions that reverse nothing | the measure's kind, as text; never crossed with the ground (row 1) |
   | `noBreach` | final decisions with the outcome `no_violation` or `not_evident` | one count |
   | `intakes` | intakes by `received_at`, without the kind `order` | the kind; and how many allege illegality |
   | `appeals`, `reexaminations` | appeals by the `decided_at` of the review that answered them; re-examined items by their answer | the result |
   | `accountMeasures` | E's standing measures, by their decision's `decided_at` | the kind |
   | `automated` | decisions without a decider; intakes of the kind `automated`, compared as text and never as an enum literal, since the label exists only from 0035 (this section's head); and of those, the ones whose case a person's final decision had restricted by the due day. An automated intake that cites no rule (a flag of another class, 6.6) is in no row here: it is counted in `intakes`, under its kind | the rule |
   | `uploads` | from 0036: refusals by `refused_at` | how the hold had ended by the due day, or that it had not |

4. **The folding.** In a table that is split by a label, a row under the floor is folded into "other grounds" (or "other measures", "other") before printing, and the folded row prints its own band. The printed rows therefore do not give the printed total (LAB E4). A share prints only as two banded counts, and only when its base is ten or more: the `automated` table's "then restricted" is absent under that.
5. **The order section** (`orders`) holds the figures F 7.18 lists for `tco-counts`, as numbers and without the issuing state (row 4). Task 4 takes the statements from the built command, and a test holds the two equal on the same rows. An order is left out while one of its decisions is untold and its `order_hold_until` lies after `as_of`. The member is absent when no countable order exists, and nothing in the JSON says whether an order was left out (row 5).
6. **The recipients** (`recipients`): the average of the six stored months before the edition's due day, for every version, whatever `as_of` is (a version written two years on must not print that year's readers under this one), as two bounds rounded to `round_to`, the signed-in average and that plus the signed-out average; the second is absent when a month's `signed_out_days` is null. With fewer than six stored months the member is the string `not recorded`, never a number (F 7.18's rule).

The JSON holds banded strings only, except the order section's numbers.

**`public.edition_publish(year integer, reason text) returns smallint`**, PL/pgSQL, SECURITY DEFINER, EXECUTE to `korbat_api`. The transparency job (section 7) calls it daily with the reason `first`, for the last closed year and for every earlier year that has an edition: a hold that ends after the next year has closed still gives its year a `hold_ended` version. In this order:

1. An advisory transaction lock on the year.
2. Which version, if any:
   - no version exists: version 1, `first`, when the edition is due; otherwise it answers null and writes nothing;
   - a version exists, and the order section computed now holds an order that the newest version's stored `orders` does not: the next version, `hold_ended`. The test reads the same rows by the same times as step 5 of `transparency_figures` does, so an order received in the year and disabled or told later is not lost between the section and its trigger;
   - the reason `correction`: the next version, and only when the session's role is the migrator (`staff.js edition <year> --correct`); for the API's role `invalid_edition`;
   - otherwise null.
3. One row, with both times `now()` and the rules' `method`. Its `figures` are `transparency_figures(year, now())` for version 1 and for a `correction`. A `hold_ended` version **copies the newest version's stored `figures` and replaces the `orders` member alone**: it computes no table again, so the difference between two versions shows an order and nothing that happened to anyone else in between (row 2).
4. A plain audit row `edition_published`, written by the function under the system's id, on the edition, with the year, the version and the reason.

It answers the version it wrote.

### 6.5 Migration 0034: the head's publications (Task 5)

**`public.head_value(day date, seq bigint, hash text) returns text`**, SQL, IMMUTABLE, EXECUTE to `korbat_api`: the hex SHA-256 of the UTF-8 text `korbat.head.v2`, a line feed, the day as `YYYY-MM-DD`, a line feed, the place in decimal, a line feed, the hash. The value shows neither the place nor a row's hash, so nobody counts staff actions or tests a guessed row from it; and because the day is in it, the value differs every day, also over days on which no audit row was written, so nobody reads the quiet days off the page (row 9).

**`head_publications`**:

| Column | Type | Notes |
|---|---|---|
| `day`, `kind` | `date not null`, `text not null` | the UTC day; `head` or `restore`. Primary key both: a restore can fall on a day that already has its value |
| `chain_seq`, `value` | `bigint not null`, `text not null` | the audit head's place, and `head_value` of the row's day, that place and its hash. The public route never returns `chain_seq` |
| `witness` | `text not null` | the adapter that was asked: `none`, `rfc3161` or `test` |
| `token`, `witnessed_at` | `bytea`, `timestamptz` | the token as received, at most 16 KB. A row whose token is null is published as witnessed by nobody, whatever was asked |
| `published_at`, `retired_at` | `timestamptz` | when the value went public; when a restore retired it |

- Grants to `korbat_api`: INSERT, SELECT, and UPDATE of `token`, `witnessed_at` and `published_at`.
- **`head_publications_insert`**, plain, BEFORE INSERT, for every role but the migrator: the row is a `head`; `day` is today in UTC; `chain_seq` and `value` are forced from `audit_head` as it stands in that statement; `token`, `witnessed_at`, `published_at` and `retired_at` are null. So the API's role cannot publish a value of its own making.
- **`head_publications_guard`**, plain, BEFORE UPDATE, for every role but the migrator: each of the three granted columns changes only from null, and nothing else changes (`moderation_column`, SQLSTATE 42501, as 3c's guards answer).
- A `restore` row and every `retired_at` are the command line's (`staff.js head-restore-mark`, as the migrator): the row names the newest published value whose place and hash the restored chain still holds, and the values after it are retired, not deleted.

### 6.6 Migration 0035: the automated decision (Task 6)

**The two enum values**, under the rule of this section's head: `ALTER TYPE public.intake_kind ADD VALUE 'automated'` and `ALTER TYPE public.intake_channel ADD VALUE 'system'`. No value of `decision_kind` is added: an automated decision is `interim` (row 15).

**The changed constraints**, each dropped and added again as F leaves it, with only this change:

| Constraint | Change |
|---|---|
| `decisions.decided_by` | loses NOT NULL |
| `decisions_decider` (new) | `(decided_by is null) = (automated_decision = 'fully') and (decided_by is not null or kind::text = 'interim')` |
| `decisions_restricted` | its two text digests are required only with a decider: a system decision has a ground and no text |
| `intakes_finding` | one more clause: `(kind::text = 'automated') = (channel::text = 'system')` |
| `intakes_r2_finding_only` | R2 for the kinds `finding` and `automated` |
| `intakes_automated` (new) | an `automated` intake has `automated_processing` true, the rule R1 or R2 or no rule at all, no allegation of illegality, no `csam` flag, no reporter, no contact and no `finding_by` |
| `intakes_has_ground` | one more arm, `or kind::text = 'automated'`: an automated intake may cite no rule, which no other kind may. That is the flag of a class that its source does not name child sexual abuse material (row 28; review ruling 3) |

- So no profile stands for the system (row 14), and `staff_texts` is untouched.
- `intake_items_attach` is unchanged. It makes the item of an intake citing R2 suspect (`0015:562`), so an automated finding citing R2 freezes its post by the built rule (LAB C1), and it gives an item without a sender the outcome mail `none`. The item of an intake that cites no rule is not suspect: it freezes nothing and alerts nobody.
- An automated intake has one item, about the post, that names the image in `intake_items.media_id`. Its lane is 2 under R1 and without a rule, and 0 under R2; its category is the rule's default (`RULE_DEFAULT_CATEGORY`) and, without a rule, `STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE`. From 0036 it cites R2 only for a match record that is listed (6.7).

**`public.automation_rules()`**, SQL, IMMUTABLE, EXECUTE to `korbat_api`: one row.

| Member | Value | Row |
|---|---|---|
| `decisions_per_hour`, `decisions_per_day` | 20, 100 | 18; the system's decisions under R1 |
| `r2_decisions_per_hour`, `r2_decisions_per_day` | 20, 100 | 18; the system's decisions under R2, counted apart |
| `unanswered_max`, `unanswered_hours` | 20, 72 | 18; no new measure under a rule while that many of the system's measures under that rule stand in force, or, under either rule, while a request for a person is older than that |
| `r1_threshold real`, `r1_threshold_version` | null, 1 | 23; set by the owner's build task, by a migration that replaces this function |
| `objection_target_hours` | 24 | 25 |
| `match_timeout_ms`, `match_retry_hours`, `matcher_down_minutes` | 3000, 24, 15 | 34 |
| `refusals_per_hour` | 20 | 18, 35; read from 0036 |
| `no_report_hours` | 24 | 35; read from 0036 |
| `pdq_min_quality` | 50 | 33 |
| `match_keep_days` | 180 | 37 |

**`automated_signals`**: one row a signal, the fact an automated decision rests on.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `kind` | `text not null` | `r1_score` or `known_match` |
| `media_id` | `uuid not null` | no foreign key: the image may leave first |
| `score`, `threshold_version` | `real`, `smallint` | both set for an `r1_score` and for no other |
| `match_id` | `uuid` | set for a `known_match` and for no other; a foreign key to `media_matches` from 0036 |
| `created_at` | `timestamptz not null` | forced |
| `intake_item_id`, `decision_id` | `uuid` | the finding's item; the decision, references `decisions`. Unique where not null |
| `handled_at`, `handled` | `timestamptz`, `text` | both or neither; `finding`, `measure`, `capped`, `covered` (a measure of that kind already stands) or `gone` (the image left first) |

- Unique index `automated_signals_one (media_id, kind)` over all rows: an image has one signal a kind for as long as the row exists, so "a handled one is never written again" is the database's rule and not only the step's. The index `automated_signals_open (media_id, kind) where handled_at is null` stays beside it for the sweep's read. When a row may go is 6.8's, and for a match the sweep's memory is not this row at all but the mark on the match record (6.7; review ruling 8).
- Grants to `korbat_api`: SELECT, INSERT, UPDATE of the last four columns. `automated_signals_insert`, plain, BEFORE INSERT, forces `created_at` and those four null; `automated_signals_guard`, plain, BEFORE UPDATE, for every role but the migrator, lets each of the four change only from null. A signal is never pointed at a second decision.

**`automated_objections`**: "Ask for a person" (row 25). `decision_id uuid` primary key references `decisions`; `text text`, 1 to 2000 characters, null once erased; `created_at` forced; `erased_at`. SELECT and INSERT to `korbat_api`.

- `automated_objections_insert`, SECURITY DEFINER, BEFORE INSERT: `objection_not_open` unless the decision has no decider and a measure of it is in force.
- An objection is unanswered while a measure of its decision is in force. Nothing stores "answered": a person's correction or final decision ends the measure, and with it the objection.

**`decisions_record`**, replaced as F leaves it. "Without a decider" means `NEW.decided_by is null`.

- **The forced columns** at the top: `automated_detection` and `automated_decision` are no longer forced to false and `not_automated`. Without a decider they are true and `fully`; with one they are set in step 6.
- **Step 2**, before the kinds. Without a decider: the kind is `interim`, the ground `incompatible`, the rule R1 or R2, the three text digests null and no order item named; otherwise `invalid_decision`. The built interim branch then asks for the outcome `restricted` on an open case.
- **Step 5.** The one read of the considered items also answers three questions: whether one is of an `automated` intake; whether one is of an automated intake citing R2; whether one is of an automated intake citing this decision's rule. Without a decider the third must be true (`invalid_decision`), and `staff_party_conflict` is not asked: the system is no party.
- **Step 6.**
  - Without a decider no role is read, and `needs_admin` is false as for every interim decision.
  - Without a decider, `already_protected`: under R2, when a seal in force lists the case's post; under R1, when a `withhold` of the post is in force, or a `withhold_media` is in force for the image of every unanswered automated item of the case that cites R1. The built code accepts a second seal while one stands (LAB C3, C4); a person may still take one, a program may not.
  - With a decider, for the kinds `interim` and `final`: `automated_detection` is "a considered item is of an automated intake"; `automated_decision` is `partially` when the decision restricts, is suspect and considers an automated intake citing R2, and `not_automated` otherwise (row 26). The person cannot look at a matched image, so the match is the fact the decision draws on.
  - A review or a correction takes its reviewed decision's `automated_detection`, and is `not_automated`.
- **Step 7.** The advisory lock's key takes "no decider" as one decider: the key ends in `system`. The counts are written as two branches, `decided_by = NEW.decided_by` with a decider and `decided_by IS NULL` without: either stays on the built index `decisions_decided_by_idx (decided_by, decided_at)`, where `is not distinct from` would leave its leading column unused, for a person's decision too. Without a decider:
  - the two counts are by rule: decisions without a decider under this decision's rule in the last hour and in the last day, against `decisions_per_hour` and `decisions_per_day` under R1 and `r2_decisions_per_hour` and `r2_decisions_per_day` under R2. A burst of scores so never uses up the budget of a known match;
  - two limits that end nothing: the decision is refused while `unanswered_max` measures of decisions without a decider under this decision's rule, or more, are in force, and, under either rule, while a row of `automated_objections` whose decision's measure is still in force is older than `unanswered_hours`;
  - the refusal is `automation_capped` in each case, with a detail that names the limit that was met, one of `hour`, `day`, `unanswered` and `waiting` (the contracts' `CAP_LIMITS`), which the alert carries as its fact `limit`.

  A person's caps count no system decision.
- **Step 9.** Without a decider the source is `own_initiative`, whatever other items wait on the case: the decision rests on its signal, not on a report.
- **Step 10** is unchanged: an interim decision on a target that is not deleted has `author_mail` `pending`, so the statement goes out at once (row 24); and F's rule that nothing reaches an author while an order's notice is held applies to it as to any decision.

A system decision is never due a strike: E's `decision_holds` asks `strike_due` for a final decision only. Task 6 checks that in the built text.

**`decision_holds`**, replaced as F leaves it. Every decision with a decider passes the built checks unchanged.

- **(a), for a decision without a decider.** The transaction's head audit row:
  1. names the decision in `metadata.decisionId`, as built;
  2. carries no step-up and no key, was written by the system (`00000000-0000-0000-0000-000000000000`), and is `automated_decided` on the decision's case;
  3. names in `metadata.signalId` the one row of `automated_signals` whose `decision_id` is this decision: exactly one exists;
  4. that signal's image is an image of the case's post, which is a post case's target;
  5. its params equal the decision's columns and its ledger rows as for `case_decided`.

  Each failure is `invalid_decision` with a detail that names the member, as built.
- **(b), for a decision without a decider.** It holds exactly one measure and no reversal: a `withhold_media` of the signal's image for an `r1_score` under R1, or a `seal_media` for a `known_match` under R2. Anything else is `invalid_decision` (LAB A2: two measures; a seal on an R1 finding). 0036 replaces the function once more, when the match records exist: the seal's signal must then name a match record whose `acting` is true (6.7).

`decision_actions_check` is not replaced: its own step 3 refuses a final measure in an interim decision (LAB A2), and its step 9 reads a role only for the kinds that need an admin, which a system decision never holds. `decisions_apply` and `measures_in_force` are untouched: the measure ends with the case's final decision, a seal with the answer to its suspect items, and a person's correction lifts either at once (LAB A5 to A7, C6).

**What this leaves a compromised API** is row 17's: it can write a signal, and from 0036 a match record that it calls acting, so it can make the system withhold one image or seal one post's images at a time, up to the caps and the two limits of step 7, each with a statement to the author, a line on the console's home and an audit row that `audit-verify` checks. It cannot take a final measure, touch an account, or exceed a cap as the system.

### 6.7 Migration 0036: known material (Task 7)

**`media_hashes`**: one row an image, written only while `MEDIA_MATCH` is not `off` (row 33).

| Column | Type | Notes |
|---|---|---|
| `media_id` | `uuid` primary key | references `post_media` on delete cascade: no hash outlives its image. The retention job deletes every row once the matcher is `off` (section 5) |
| `sha256`, `sha1`, `md5` | `bytea not null` | of the upload as received, taken before the original bytes are discarded (review ruling 4); 32, 20 and 16 bytes |
| `pdq`, `pdq_quality`, `pdq_impl` | `bytea`, `smallint`, `smallint` | 32 bytes from the worker's decoded pixels, its quality from 0 to 100, and the implementation's version; `pdq` is null under `pdq_min_quality` and for a result without the member |
| `check_state` | `text not null` | `pending`, `clear`, `matched`, `unchecked` or `capped`. `capped` is an upload whose acting match met the limit on refusals: nothing of the match is written, the row stays `processing`, and the retry asks again |
| `checked_at`, `source` | `timestamptz`, `text` | the newest attempt, and the adapter that answered |

All rights to `korbat_api`. Index `(check_state) where check_state in ('pending', 'unchecked', 'capped')` for the retry.

**`media_matches`**: the match record (row 37). No account column and no text.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `media_id` | `uuid not null` | no foreign key: the record outlives the image row |
| `case_id` | `uuid` | the case of the finding, written once by the automated step; null for an upload on no post |
| `source`, `list_version` | `text not null`, `text` | the adapter's name; the list's version when the source gives one |
| `hash_type`, `match_kind` | `text not null` | `sha256`, `sha1`, `md5` or `pdq`; `exact` or `near` |
| `classification` | `text` | as the source returned it, at most 100 characters; null once erased |
| `listed` | `boolean not null` | forced: `match_listed` accepts the classification for that source, that is, the source itself names it child sexual abuse material (review ruling 3) |
| `acting` | `boolean not null` | forced: true only for a listed record whose classification `match_acting` accepts as well and that its source reports as `exact`, whatever the hash type (row 28; review ruling 4). A record that is not acting is a flag: no program refuses, holds or seals on it |
| `hash` | `bytea` | the one hash value that matched; null once erased |
| `handled_at` | `timestamptz` | the program is done with this record (review ruling 8): written once, in the transaction that wrote the refusal, or the finding, or found the image gone |
| `queried_at`, `erased_at` | `timestamptz` | forced `now()`; set by 6.8's function |

- **`public.match_listed(source text, classification text) returns boolean`** and **`public.match_acting(source text, classification text) returns boolean`**, SQL, IMMUTABLE: two closed lists of pairs. The first holds the classifications by which a source itself names child sexual abuse material, and never a wider class; the second is a part of the first, the classifications on which a program may act. In this build each holds the test adapter's one acting classification and nothing else. A source's adapter adds its pairs by a migration that replaces the functions, and a test holds each function to every adapter's `MATCH_LISTED` and `MATCH_ACTING`.
- `media_matches_insert`, plain, BEFORE INSERT, forces `listed`, `acting` and `queried_at`, and `case_id`, `handled_at` and `erased_at` null. `media_matches_guard`, plain, BEFORE UPDATE, for every role but the migrator: `case_id` and `handled_at` change only from null and nothing else changes.
- Grants to `korbat_api`: SELECT, INSERT, UPDATE of `case_id` and `handled_at`.
- `automated_signals.match_id` gets its foreign key here.
- **Three kinds of record, and what each starts** (row 28). An acting record on an upload: the refusal and the hold below. An acting record on a posted image: a finding citing R2, and the automatic seal when the setting says so (6.6). A flag of a listed class: the same finding without a measure, on a post; an upload is accepted. A flag of another class: a finding that cites no rule, so not suspect, in lane 2, freezing nothing and alerting nobody, shown in the queue with its chip (section 10's `matchFlag`); an upload is accepted. Neither kind of flag refuses an upload, holds or seals anything, and no match record carries a mark that a person read it. `automated_signals_guard` is replaced here for the one check that ties the finding to its record: when a `known_match` signal gains its `intake_item_id`, the item's intake cites R2 exactly when the record is listed.
- **The sweep's memory is `handled_at`.** It reads a posted image's unerased record with `handled_at` null (section 5, `unsignalled`), and the step sets the mark in its own transaction. The retention job may so delete a signal, erase an intake or leave them, and the sweep never finds a handled match again: no second finding, no second freeze, no second seal a month after a person decided the first. A test answers an automatic seal, makes its intake due, runs the retention step and the sweep, and expects no new intake.
- **What an unerased record does to its image**, whatever its kind: staff are never served it (gate V, section 5; review ruling 2).

**`decisions.match_answer_reason`**, a new column, `text`, null or one of `source_withdrew`, `counsel`, `other` under a CHECK (the contracts' `MATCH_ANSWER_REASONS`): the reason of an admin's answer without a seal on an acting match (note 26). It is one of the decision's signed params, and `decision_holds` holds it to them and to the case (below, "Replaced in 0036").

**`upload_refusals`**: the hold of an upload that is on no post and has an acting match. It is a record of its own, not a case (O5, row 35). An upload whose match is only a flag has no row here: it is accepted.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `media_id` | `uuid not null` unique | no foreign key |
| `owner_id` | `uuid` | references `profiles`, with no `on delete` clause: no profile row is ever deleted (`0015:424`), so a purged account's refusal keeps the id of an anonymised profile, which `upload-report` needs for F's record. 6.8's function sets it null with the match record's erasure: a refusal names its uploader only as long as the notice says (review ruling 6) |
| `match_id` | `uuid not null` | references `media_matches` |
| `refused_at` | `timestamptz not null` | forced |
| `told` | `delivery_state not null default 'pending'` | the uploader's notice |
| `objection`, `objected_at` | `text`, `timestamptz` | one text of at most 2000 characters, shown to the admin |
| `ended_at`, `end_as`, `end_reason`, `ended_by` | `timestamptz`, `text`, `text`, `uuid` | `report` or `no_report`; a reason only with `no_report`, one of `source_withdrew`, `counsel_no_duty`, `other`. The draft's fourth reason, `not_acting_class`, is gone: only an acting match is held |
| `notification_id` | `uuid` | F's record of the notification, set by `staff.js upload-report` as the migrator |
| `release_id` | `uuid` | references `releases` |

Grants to `korbat_api`: SELECT, INSERT, UPDATE of `told`, `objection` and `objected_at`.

- **`upload_refusals_insert`**, SECURITY DEFINER, BEFORE INSERT. It takes the image's row `FOR NO KEY UPDATE` and reads it again: `upload_attached` unless the row exists, is on no post, is owned by `owner_id`, and the match names the same image; `refusal_not_acting` unless that match record is acting. A row that an attach reached first is so never held: its match takes the path of a match on a post (row 27). Then it takes the cap's advisory lock (`korbat.decision_cap:system`) and answers `refusals_capped` when `refusals_per_hour` refusals were written in the last hour: `finalize` then rolls back to its savepoint, writes neither the match record nor a refusal, sets the check state `capped` and leaves the row `processing`, so the upload is not ready and cannot be posted; nobody is told, and `matcher_down` goes out at once (row 35; the flow is 7's). It forces `refused_at` and every column of the last three table rows null.
- **`upload_refusals_hold`**, SECURITY DEFINER, AFTER INSERT, `search_path = public, auth, pg_temp`. It sets the image row's `hold_until` to `infinity`: gate K's first test then keeps the row against the sweeper, the owner's own delete and the purge (section 3), and no timer ends the hold. It marks the match record handled. And it sets the uploader's row of F's `auth.report_holds` as F's `report_open()` does for a seal taken while deciding (`set_at = now()`, `seal_final` false; a released row is set again, a row that is set is left): the purge of an account that is deleted in the next seven days leaves its address in place (F 6.5), so a report can still name who uploaded. F's commands release that hold when the record that `upload-report` opens is sent or declined; `upload_hold_end` releases it on "No report", and sets it again when that end is turned into "Report" inside its hours (step 4 below). F 6.7's pin on the writers of `auth.report_holds` gains these two functions.
- **`upload_refusals_guard`**, plain, BEFORE UPDATE, for every role but the migrator: the objection is written once, with `objected_at` forced, and only while the refusal has none, `release_id` is null and `end_as` is not `no_report`. That is one rule for the guard, the route, the app's control and the notice: an objection is open for as long as korbat holds the file, also after "Report".
- **`public.post_media_refused()`**, SECURITY DEFINER, the function of a trigger BEFORE UPDATE OF `post_id` ON `post_media`: `upload_refused` when a row that had no post gains one while a row of `upload_refusals` names it, while its `erased_at` is set, or while its `hold_until` is `infinity`. So no route, retry or import attaches a refused upload, a released one, or one whose hold a restore kept while it lost the refusal (below). It is keyed on the refusal and not on every match record: a flag blocks nothing, and its upload may be posted. It reads the refusals in a statement of its own after the row's lock, so an attach that waited for a refusal sees it.
- **A held or refused upload is in no reader and no export** (review ruling 5). The database refuses the attach; `serve` answers "not found" for an image on no post (`flows/serve.ts:37`); the export, the owner's reads and the pending count leave out an image that a row of this table names (section 5). The admin's Held uploads screen is the one place that shows that the upload exists, and it shows no image.

**`public.upload_hold_end(refusal uuid, end_as text, reason text, staff uuid) returns void`**, PL/pgSQL, SECURITY DEFINER, EXECUTE to `korbat_api`. In this order:

1. The refusal's row `FOR UPDATE`. `hold_not_open` unless one of three holds: the hold has not ended; it ended as `report`, is not released, and `end_as` is `no_report` (a report that turned out not to be owed); or it ended as `no_report`, its image row's `hold_until` still lies ahead, and `end_as` is `report` (a second admin who read the alert).
2. `admin_required` unless `staff` is an admin, read `FOR SHARE`.
3. `invalid_hold_end` unless `end_as` is one of the two words, with a reason of the closed list for `no_report` and none for `report`.
4. The four end columns. For `no_report` the image row's `hold_until` becomes `now()` plus `no_report_hours`: after that the sweeper deletes the upload as any other, and a file that was already in the quarantine is listed for destruction once its row is gone (6.1). So "No report" can be undone for a day, and nothing is deleted before every staff account has had the alert `hold_ended_unreported`. The hold on the uploader's address is released (`declined`) when nothing else holds it: no record of the account is `owed` and no other refusal of the account is unended. For `report` the image row's hold is `infinity`, and `quarantine_plan` lists the files. A `report` that follows a `no_report` (step 1's third case) also sets the hold on the uploader's address again, which this function released at the first end, so that the address is there for the report: it writes the account's row of `auth.report_holds` as `upload_refusals_hold` wrote it, but with the refusal's `refused_at` as its `set_at` in place of `now()` (a released row loses its release, a row that F's retention has deleted is inserted, and a row that is set is left). The hold so runs for what is left of the seven days from the refusal, which is the bound that the notice and the terms state (section 18), and never longer; where the account was deleted and purged in the hours between, the address is gone and the hold keeps nothing.
5. An open gap of the class `release` whose lost row is an `upload_hold_ended` line of this refusal is closed, with the disposition `reapplied` (6.2).

**`upload_refusals_confirmed`**, a deferred constraint trigger, AFTER UPDATE OF `ended_at`, `end_as`: at commit the head audit row is `upload_hold_ended` on this refusal, carries a step-up, was written by `ended_by`, names the refusal's image in `metadata.mediaId`, and its params equal `end_as` and `end_reason`; otherwise `release_mismatch`.

**`public.upload_release(refusal uuid, basis text, leave uuid, staff uuid) returns uuid`**, the same kind and grant: `seal_release` for a held upload. In this order:

1. The refusal's row `FOR UPDATE`: `release_not_open` unless it ended as `report` and is not released.
2. The facts, read after the lock from the record that `notification_id` names (F's `authority_notifications` and the `productions` that name it, a read of 3f's tables that O1 counts): `release_not_reported` unless that record is `sent`; `release_not_quarantined` unless the image is in the quarantine.
3. The ground, as step 3 of `seal_release`, with the leave recorded against the record that `notification_id` names: no leave or instruction to destroy on record, no release, whatever the authority answered.
4. `admin_required`, as step 4.
5. One row of `releases` with `upload_refusal_id`, the leave and no posts; the refusal's `release_id`; `erased_at = now()` and `hold_until = now()` on the one image row. `releases_confirmed` asks for `upload_released` on the refusal, whose metadata names the image in `mediaId`.

**`public.upload_release_replay(original uuid, refusal uuid, media uuid, basis text, leave uuid, their_reference text, released_at timestamptz) returns text`**, EXECUTE to nobody: `release_replay` for an upload. `present` and `replay_no_gap` as there; else the `releases` row, and:

- when the restored database holds the refusal: its `release_id`, and `erased_at` and `hold_until = now()` on its image row;
- when the restore lost the refusal (a backup taken while the upload was ready and its check unanswered): the same two columns on the image row that `media` names, if it exists and is on no post. Without this a file that korbat reported, released and recorded as destroyed could be posted from the restored store, since no refusal would name it; with `erased_at` set, `post_media_refused` refuses the attach and the disposal takes the row.

It closes the gap. Files of a lost refusal that the quarantine still holds are named by no row: the Restoring runbook has the step that lists the quarantine against the records (section 18).

**`public.upload_hold_replay(refusal uuid, media uuid, end_as text, ended_at timestamptz) returns text`**, EXECUTE to nobody, called by `staff.js release-replay` for an `upload_hold_ended` line above the restored head. `present`, with nothing written, when the restored database holds the refusal: its gap then waits for the admin, who ends the hold again in the console, and `upload_hold_end` closes it. Otherwise `replay_no_gap` unless an open gap names the line; then, on the image row that `media` names, if it exists and is on no post: for `report`, `hold_until = infinity`, so that nothing sweeps the file and `post_media_refused` lets nobody post it; for `no_report`, `erased_at` and `hold_until = now()`, as the hold's end meant. It closes the gap as `imported`. A hold that an admin had ended as `report`, and that the operator had reported, is so never offered for a second report by a database that forgot the first.

**Replaced in 0036:**

- `append_confirmed_audit`: its list gains `upload_released` and `upload_hold_ended`.
- The function of `releases_confirmed`: for a row with `upload_refusal_id` it asks for `upload_released` on that refusal where 0031's text asks for `seal_released` on the seal's ledger row. Left as 0031 wrote it, it would refuse every release of a held upload at commit (`release_mismatch`).
- `release_tellable`: for an upload's release, the record is the one that the refusal's `notification_id` names.
- `decision_holds`, once more, with two changes and no other:
  - (b), for a decision without a decider: a `seal_media` stands only for a `known_match` whose match record is acting. With `media_matches.acting`, which the database forces itself, "a flag cannot seal" is a fact of the database (row 16);
  - (c), new, for a decision with a decider: `match_answer_reason` is set exactly when the decision is final, holds no `seal_media` and considers an item of an automated intake whose match record is acting, and it equals the signed param; otherwise `invalid_decision`, with a detail that names the member. The check sits here and not in `decisions_record`, which runs before the decision's actions exist and cannot know whether it seals. This is the reason note 26 asks for: such a decision puts an image with an exact match back before everyone with nobody having looked. A flag's answer needs none.
- `quarantine_plan` and `quarantine_counts`: the image of a refusal that ended as `report` and is not released counts as sealed for good, due since its `ended_at`; `destroy` gains the image of every released refusal. An upload on no post is never in `out`: it has no reader to return to.
- `transparency_figures`: the `uploads` table.
- `alert_steps()`: `matcher_down`, when a `media_hashes` row has been `unchecked` since before `matcher_down_minutes` ago (by its image's `created_at`) and no row was answered `clear` or `matched` since then. Its facts are `since` and `count`, as section 10 names them, and `refusalsCapped` on the row that `finalize` writes at once when the limit on refusals is met.

### 6.8 Migration 0037: the flag and the retention (Task 8)

**`public.case_flag(case_id uuid) returns table (coordinated boolean, items integer, reporters integer)`**, STABLE, SECURITY DEFINER, EXECUTE to `korbat_api` (row 47). In this order:

1. The case's unanswered items of signed-in reporters: `intake_items` with `answered_by` null and `reporter_account_id` not null, each with its `created_at`.
2. Among the 60-minute windows that begin at one of those items, the one with the most distinct reporters; `items` and `reporters` are its two counts.
3. `coordinated` is true when `items` is at least 5, `reporters` is at least 5, and at least half of those reporters follow or are followed by another of them (`follows`).

The numbers 5, 5, 60 and one half are constants of the function, mirrored as `SIGNAL_RULES`. It answers counts and never a reporter. It keeps nothing: once retention has forgotten a reporter (`forget_reporter`, C 6.4) the item no longer counts, and a signed-out notice never does. No function, view or index but the queue's and the case answer's reads names it, and no decision reads it (row 48).

**`public.erase_automation_records() returns integer`**, PL/pgSQL, SECURITY DEFINER, EXECUTE to `korbat_api`, called by the retention job in every round. It answers how many rows it changed. In this order:

1. **Match records.** A `media_matches` row gets `hash` and `classification` null and `erased_at` when `match_keep_days` have passed since its case was closed; or since the release of its post, when its post is in `release_posts`; or since its refusal's hold ended without a report or was released; or, with none of these, which is the case of a flagged upload that was never posted, since `queried_at`. Not while a seal for good in force lists a post of its case that is not in `release_posts`, and not while its refusal is unended or ended as `report` and not released. So a post's record and an upload's end the same way: the hash of a file that korbat has destroyed goes 180 days after the release, as the terms' list says, and is not kept for as long as the seal's ledger row stands.
   - With the record, its refusal's `objection` and `owner_id` become null (review ruling 6). The refusal's row stays with its times, its end and its release, and names nobody.
   - What stays of an erased record: its ids, the source, the list's version, the hash type, the kind of match, `acting` and its times.
2. **Objections.** An `automated_objections` row gets `text` null and `erased_at` when its decision's texts are due by 3c's schedule for a statement's texts (C 6.4, the test `erase_statement_texts` applies).
3. **Signals.** A handled `known_match` signal is deleted only when its match record is erased. A handled `r1_score` signal is deleted when its intake is erased, or, when it was handled without a finding (`gone`), `match_keep_days` after that. The clause on the intake is for scores alone: their sweep reaches back 24 hours and no further, so nothing finds the image again, while a match's sweep has no such bound and reads the record's own mark (6.7).

It never touches `releases`, `release_posts`, `release_leaves`, `release_notices` or `quarantine_files`. The forgetting of hashes and scores once a tool is `off` is not in this function: it is the media module's two statements in the same round of the job (section 5), under rights the API's role already holds.

### 6.9 What the schema, grants and function tests pin

- **The schema test**: fourteen more tables; the two enum values at the end of their types; `decisions.decided_by` nullable with `decisions_decider`; each re-added CHECK by name; `quarantine_files`' and `head_publications`' two-column keys, and the CHECKs on a file's three ends; the two unique indexes of `automated_signals`; the two deferred constraint triggers (`releases_confirmed`, `upload_refusals_confirmed`); the CHECKs of `alert_outbox.kind` and `restore_gaps.class` with their new words.
- **The grants test**, as `korbat_api`:
  - no privilege at all on `quarantine_files` and `release_leaves`; EXECUTE refused on `quarantine_plan`, `transparency_figures`, `release_replay`, `upload_release_replay`, `upload_hold_replay` and F's `seal_report`; on the quarantine it can call the six functions of 6.1 and nothing else;
  - no INSERT on `edge_purges`, `releases`, `release_posts`, `release_notices` and `transparency_editions`; no UPDATE or DELETE on `release_posts`, `recipient_months` and `automated_objections`;
  - an update of `post_media.erased_at` or `hold_until` is refused as before, so the role can neither release nor end a hold by itself (LAB D); an update of a refusal's `owner_id` or of a match record's `acting` is refused;
  - `edition_publish` with the reason `correction` is refused.
- **What a key must cover**: `seal_release`, `upload_release` and `upload_hold_end`, each called and committed without its audit row, with a plain audit row in its place, with another admin's row, and with params that differ in one member; every one is refused at commit.
- **What a leave must cover** (review ruling 1): `seal_release` and `upload_release` on the ground `leave` are refused `release_no_leave` without a row of `release_leaves`, with the id of a leave that was recorded against another record, with the word `answer`, and whatever the record's answer is, `illegal` among them; with the leave of their own record they pass whatever the answer is, or with none. A withdrawn leave is refused `release_no_leave` like one that was never recorded, and `release_facts` does not answer it; the withdrawal of a leave that a release names is refused `leave_used`; the guard writes `withdrawn_at` itself and lets nothing of a withdrawn leave change. A release whose leave is `untold` is born `held`, and its notice moves to `pending` only in a round after the hold has ended.
- **What the system may do**: LAB A1 accepted; each of LAB A2's nine faults refused and leaving nothing; `fully` refused on a decision with a decider; `already_protected` in both orders; the caps by rule (twenty R1 decisions in the hour, then an acting match on a post, which is sealed); each of the two limits on unanswered measures; a seal whose match record is not acting refused; an insert of an automated decision by the migrator refused at commit like the API's.
- **What a match may do** (review rulings 2 to 6): `listed` and `acting` forced for each pair of kind and class; a refusal on a record that is not acting refused; an attach refused for a refused upload, an erased row and an `infinity` hold, and allowed for a flag; an automated intake accepted without a rule, and its item not suspect; a signal's finding citing R2 for a record that is not listed refused; the refusal over `refusals_per_hour` refused `refusals_capped`; an objection accepted after "Report" and refused after "No report" and after a release; a final answer without a seal on a case with an acting record refused `invalid_decision` without its reason, and a reason on any other decision refused; the erasure of a match record taking the refusal's account; the sweep's test of 6.7.
- **What the quarantine's record must hold** (review ruling 9): list, unseal, move, record, list again, and the file is an `out` line; a `missing` line records nothing and stops no other line; a `lost` line writes `lost_at` and its image is no longer "being restored"; a `have` line for an image the database does not know gets a row marked `unknown`, which the plan lists under `operator` and never under `destroy` or `out`; a line with a digest that differs from the stored one is recorded, counted and leaves the stored digest; a seal over a post with an erased image row is released; the list after a release and a disposal round prints its `destroy` lines.
- **The function pins**, each a test that reads the migrations' text:
  - the writers of `post_media.erased_at` are 3c's and `seal_release`, `release_replay`, `upload_release`, `upload_release_replay`, `upload_hold_replay`; the writers of `hold_until` are 3c's and `upload_refusals_hold`, `upload_hold_end`, `upload_release`, `upload_release_replay`, `upload_hold_replay`;
  - `frozen_for` is named only by `post_frozen` and `post_media_keep`; the callers of `post_frozen` are 3c's and F's; `post_preserved` is named by `frozen_for` and `release_facts`;
  - `restore_gaps` is written by F's two functions, the three replay functions and `upload_hold_end`; `auth.report_holds` is written by F's writers and by `upload_refusals_hold` and `upload_hold_end`; no function writes `release_leaves`;
  - only the two trigger functions of 6.3 insert into `edge_purges`; only `edition_publish` writes `transparency_editions`; only `seal_release`, `release_replay`, `upload_release` and `upload_release_replay` write `releases` and `release_posts`;
  - no function or view that 0030 to 0037 create, and no line they add to a replaced function, holds an interval literal or a number of `release_rules()`, `transparency_rules()` or `automation_rules()`: each reads its function. `case_flag`'s four numbers are its own, and the replaced functions keep the literals they were built with.
- **The source test** of the enum-literal rule reads the three files 0035 to 0037, and 0033 under the stricter form: neither value as an enum literal anywhere in it, in a PL/pgSQL body either.
- **The upgrade test**: `scripts/test-db.mjs --upgrade-from` with 3f's last migration, and `--fresh`, run the eight migrations in one transaction.

### 6.10 Retention

What 3d keeps, and for how long. Every period is a design choice published in the terms' retention list, which `RETENTION` and a table test hold to the rule functions; the periods flagged for counsel are rows 37, 41 and 46.

| Record | Kept | Then | Anchor |
|---|---|---|---|
| A sealed file in the quarantine | until a release destroys it, an `unseal_media` returns it, or its image row is gone; by time never, while `silence_days` is null; on an authority's assessment never (row 41) | unlinked or moved by the one-shot service, with a digest; a file found in neither place is recorded as lost | 6.1, 6.2; rows 38 to 42 |
| A held upload's row and files | while the hold stands; after "No report", 24 hours (`no_report_hours`) and then until the sweeper's next round; after "Report", as a sealed file | deleted, or destroyed at its release | 6.7; row 35 |
| A backup that holds a released file | 30 days after it was taken (`RETENTION.backupDays`), when it is deleted on time; the release prints `backups_clear_at`. A backup that korbat keeps for an authority, until the operator destroys it by hand; on an authority's instruction to destroy, the README's step destroys the backups too | deleted by the operator | row 46 |
| `releases`, `release_posts`, `release_leaves`, `quarantine_files`, `release_notices` | for good: they are the proof of a destruction and of the word it rests on, and the freeze reads `release_posts` for as long as the seal's ledger row stands, which 3c never deletes. They hold ids, digests, times, a ground and the reference of a leave, and no content | not deleted by 3d | 6.2, 6.8; row 42 |
| A match record's hash and classification | 180 days (`match_keep_days`) after its case closed, its post was released, or its hold ended without a report or was released; the record of a flagged upload that was never posted, 180 days after it was made; never while a seal for good on an unreleased post or a hold rests on it | set null; the row stays without them: the source, the list's version, the hash type, the kind of match and the times | 6.8; row 37 |
| A refusal's account and objection (`upload_refusals`) | with its match record's hash | set null. The row stays for good: it says that an upload was refused on a day and how its hold ended, and names nobody | 6.7, 6.8; rows 35 and 37 |
| The hold on a refused uploader's address (F's `auth.report_holds`) | seven days from the refusal at most; less when F's record is sent or declined, or the hold ends without a report. An end without a report that an admin turns into "Report" inside its 24 hours sets the hold again, for what is left of the same seven days | released; after seven days it reads as not held (F 6.5) | 6.7; row 35 |
| `media_hashes` | as long as the image row, and only while the matcher is not `off` | deleted with the image, by cascade; all of them by the retention job once the matcher is `off` | 6.7; section 5; row 33 |
| An image's R1 score (`post_media.nsfw_score`) | as long as the image row, and only while the classifier is not `off` | deleted with the image; set null by the retention job once the classifier is `off`, unless an unhandled signal names the image | section 5; row 33 |
| A signal | a match's: until its match record is erased; a score's: until its intake is erased; an unused one 180 days | deleted | 6.8 |
| An objection's text ("Ask for a person") | as its decision's statement texts (C 6.6) | set null | 6.8; row 25 |
| An outbox row of the edge | 30 days after it was done | deleted by the retention job | 6.3 |
| A day's sketch and its salt | the sketch until its month is stored, on the job's first round after the month's end; the salt 26 hours, in Valkey alone | deleted; expired. A sketch that the job never closed expires by itself 70 days after its first write (section 10's `RECIPIENT_RULES.sketchDays`) | section 5; row 8 |
| A month's sketch | until the month's two numbers are stored | deleted, or expired as a day's | row 8 |
| `recipient_months`, `transparency_editions`, `head_publications` | for good: numbers and public values that hold nothing of a person | not deleted; a head value a restore overtook is retired, not removed | 6.4, 6.5 |
| The system's audit rows (`automated_decided`, `edition_published`, `release_leave_recorded`, `release_leave_withdrawn`, `release_replayed`, `quarantine_recorded`, `head_restore_marked`) and the confirmed rows of a release and of a hold's end | as the audit log (3a) | never | 6.2, 6.6 |

## 7. Flows

Short names: C is the 3c design, E the 3e design, F the 3f design, each with its section. Every time is the
database's, stored as an instant. Every staff route stands behind the staff gate and `requireStaff`
(`apps/api/src/staff/routes.ts`); "step-up" means `requireStaffStepUp` in front of the handler with the path's id as
the action's target, as `staff/cases.ts:85` does for a decision. A sentence a person reads is named by its key;
section 18 holds the words. Where a function of section 6 is called, this section says what it is given and what
follows from its answer; section 6 holds its body. `file:line` is of the scratch clone at `aab8345`.

Six rules hold in every flow, and each is stated once here.

1. **A program never ends anything.** A decision without a decider is of the kind `interim`, holds one protective
   measure and lasts until a person decides (7.9). No job, trigger or command of 3d writes a final measure, an
   account measure, a reversal, a release or the end of a hold: each of those is a person's confirmed action. The
   one command that writes a release replays, after a restore, what a key confirmed before it (7.3). One thing a
   program does no person at korbat undoes: an upload it refuses stays not accepted, and a person decides only
   what happens to the held file (7.12). Every text says so, and nothing calls that refusal temporary.
2. **The audit row is last.** Every write of 3d that takes a measure, releases, ends a hold or records a move of
   files ends with one audit row in the same transaction, as its last statement (`staff/audit.ts:43`). A finding
   writes none, as a moderator's finding writes none (C 7.1). Metadata holds ids, enums, numbers, instants and hex
   digests, and one named string, an authority's reference (10.5).
3. **After the commit, nothing can undo.** A mail, an alert, a purge or a call to a third party that follows a
   commit runs in a try of its own, unwaited for (`ModerationDeps.background`), and a failure leaves a row that a
   job picks up. None of them delays, blocks or reverses the measure it follows.
4. **Off means absent.** With an adapter `off` its flow computes nothing for it, stores nothing for it and calls
   nobody: no hash, no score, no request. Each flow below says what remains.
5. **Files move only by hand.** No request of the API, no job and no command of `staff.js` moves, returns or
   destroys a file of the quarantine. The one-shot service `quarantine` does, on a list the operator pipes into it,
   and what it did enters the database only through `staff.js quarantine-record`. A file is never left without a
   record: the record takes a receipt line by line, and one bad line never stops a run or the lines after it (7.1).
6. **A match acts only when two things hold.** The source itself classifies the entry as child sexual abuse
   material, and the source calls the match exact: an exact match of a cryptographic hash of the bytes as
   received, or an exact match the source reports for a perceptual hash. Such a match is **acting**. Any other
   answer `matched` is a **flag**: it refuses nothing, holds nothing and seals nothing, and a person reads it in
   the queue (7.8, 7.9). And an image that an unerased match record names is never opened by staff, on any case
   and whatever was answered (7.11).

### 7.1 A seal for good, and the quarantine

The quarantine holds the files of images sealed **for good** and of held uploads an admin ended as `report`
(7.12). A seal taken while deciding, a person's or the program's, leaves its files in the store: it ends within
hours either way, and a move that had to be undone each time would be a second risk for nothing.

**Moving in.**

1. An admin's final decision holds `seal_media` (C 7.5). Its transaction is 3c's, with one row an image in
   `edge_purges` from the trigger of 7.4. From its commit `quarantine_plan()` lists every image row of the seal's
   posts under `in`, and `quarantine_counts().due_in` is above zero.
2. `GET /api/staff/overview` carries `quarantine` (`dueIn`, `dueOut`, `undestroyed`, `oldest`: the four values of
   `quarantine_counts()`); the home screen prints `home.quarantine`. `alert_steps()` writes `quarantine_due` once
   the oldest due move is 24 hours old, then daily (facts `count`, `oldestAt`).
3. The operator runs `staff.js quarantine-list` in the migrate service. It is read-only and writes no audit row.
   It reads `quarantine_plan()` through the media module's plain function `quarantineNames(tx)` and prints one
   line a stored file, `<direction> <image id> <file>`, the file as the store's naming rule gives it for each
   size (`files/<aa>/<id>/small.webp`, `large.webp`; `packages/media-protocol/src/layout.ts:59`). The direction
   is `in`, `out`, `destroy` or `operator` (below). **It leaves out a post whose rows do not match its seal and
   prints the others:** a post that is sealed for good and **not released** and has not as many image rows,
   erased or not, as its `seal_posts.images` gets no line and is named on standard error with F's
   `handover_mismatch`, and the command exits 1 after it printed every other post's lines. A list that misses a
   row would leave a sealed file in the store, and one bad post never stops the list for the others. A released
   post is not counted: the disposal has deleted its erased rows by then, and its `destroy` lines must still
   print (7.2).
4. `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt`. The
   service's command names its two roots as arguments (`node dist/quarantine.js /media/store /media/quarantine`)
   and refuses to start without both; the tests pass two temporary directories the same way. For each `in` line
   the service:
   1. skips a name outside the store's layout: the line is printed with the word `refused`, and the run goes on;
   2. copies the file to the quarantine under a temporary name, syncs it, and compares the SHA-256 of source and
      copy; on a difference it removes the copy, keeps the source and prints the line with `refused`;
   3. renames the copy to its name, syncs the directory, and only then unlinks the source. The directory's sync
      is skipped on a platform that refuses it (`EPERM` on Windows, where only the tests run); any other error
      ends the run;
   4. prints `<direction> <image id> <file> <bytes> <sha256> <word>`. The word is `done`; `already` for a file
      that was in the quarantine with the same digest (only its source, if one is left, is unlinked); `missing`
      for a file found in neither place, with no size and no digest; `refused` as above.
   It decodes nothing and opens no file but those the list names. A crash leaves a file in one place or in both,
   never in neither; the next run finishes it. **One bad line never stops a run:** after a `missing` or a
   `refused` line the service goes on with the next line, and it exits 1 at the end when it printed either.
5. `staff.js quarantine-record < receipt`, one transaction as the migrator. **It records what the mover did,
   line by line, whatever the plan says now:** a line with a well-formed name and digest for an image id is a
   fact about where a file is, and it gets its row. Three commands that a person runs minutes apart cannot hold
   the database still between them, so the record never refuses a move that happened.
   - An `in` line with `done` or `already`: the `quarantine_files` row (the image's post, `size`, `sha256`,
     `moved_at`). When a returned row of that file exists it clears `returned_at` and writes the new `moved_at`;
     a digest that differs from the stored one is reported and counted as `mismatched`, and the stored digest
     stays: the files of an id never change.
   - A line that the plan, computed again, no longer holds (the seal was lifted, or taken again, between the list
     and the mover) is recorded all the same and **reported**: the command prints that the line no longer fits
     the plan (section 8) and counts it as `againstPlan`. The plan computed after the record then lists the
     file under `out` (or `in`), and the next run moves it back.
   - A `missing` or `refused` line is reported and writes nothing; the other lines are recorded.
   - A line that is malformed, or that names a file the store's layout does not know, is reported and skipped.
     The command exits 1 when it reported anything, after the commit of what it recorded.
   Last, the audit row `quarantine_recorded` (10.5).
6. `media_quarantined(media)` is now true for the image; `quarantine_counts()` no longer counts it.

**A file that does not exist any more.** 2b knows the state "a ready image has no usable file", and the
quarantine has no backup (section 2, row 40). A file that every run prints as `missing` gets an end of its own,
which only a person writes:

1. The operator runs the mover on the same list with the one flag `--lost`. For a file found in neither place it
   then prints the word `lost` in the place of `missing`; nothing else changes. A flag, not a default, so that a
   typing mistake or a disk that is not mounted cannot write it: without both roots the service does not start.
2. `quarantine-record` writes the file's row with `lost_at` and no size or digest (or sets `lost_at` on its
   unreturned row). A lost file counts as moved for `release_facts` and as returned for the plan: it is in no set
   again, so the alert ends and a seal with a lost file can still be released. The audit row counts `lost`.
3. For an `out` line (the image is `visible` again and its file is gone): `media_quarantined` is false and
   `media_lost` is true, so the owner's status answers `lost: true` (10.2) and the app prints `image.lost` in
   the place of `image.restoring`. The row's `lost_told` is `pending` (for an image that is on a post and not
   sealed for good; `none` otherwise), and the dispatch job mails the author `image_lost` (7.14, 7.15), once an
   image: it learns of the file through `lost_untold` and records the mail's outcome with `lost_told`
   (`MediaForCases.lostUntold(limit)` and `lostTold(mediaId, outcome)`), since the table is closed to the API's
   role.
4. For an `in` line: the case page shows `case.custody.lost` on the seal.
5. Staff get the alert `quarantine_lost` (facts `count`, `at`), written by the command with its record.

**A file in the quarantine that no row names** (a receipt that was never recorded; a restore, 7.3). The mover
run with `--inventory` reads no list: it prints one line `have <image id> <file> <bytes> <sha256>` for every file
the quarantine holds, and changes nothing. `quarantine-record` takes those lines too: a `have` line whose file
has an unreturned row is checked against it (a different digest is reported); a `have` line without a row gets
its row, as a move in that nobody recorded, and is reported under "found without a record". From then on the
plan lists it: under `out` when its image is not sealed for good, under `destroy` when its post is released,
under nothing when the seal for good stands. **A file recorded this way for an image the database does not
know is never listed under `destroy`:** after a restore it may be a held upload kept for a report, or an image
posted and sealed after the backup. The list prints it under the fourth direction, `operator`; the mover leaves
an `operator` line alone, and the README's Restoring says what the operator does with it (section 8). The list
comes by the direction through the row's mark `unknown`, which the insert forces when no image row with the id
exists (section 6.1); such a row stays under `operator`, never under `destroy` or `out`, until a line that the
operator had the mover carry out for the file is recorded. Only a file whose row was written while its image row existed
becomes a `destroy` line when that row is gone (the table below). A file whose name is no image id of the
store's layout gets no row: it is reported for the operator and left where it is. So a file in the quarantine
is listed for its return, for its destruction or for the operator, and never stays without a record.

**Returning.** An `unseal_media` (an admin's correction, or a review on appeal; C 7.7) makes the image's state
`visible` at once, in 3c's transaction.

1. From that commit the image is in the plan's `out` set: its row exists, `erased_at` is null, no seal for good in
   force lists its post, and an unreturned row of `quarantine_files` names it.
2. Until the files are back, the image row says `visible` and the store has no file.
   - `serve` (`media/flows/serve.ts:49`): when `openImage` answers null it asks `media_quarantined(id)`. True: the
     answer is the same 404, and the line it logs is an info line, not the error "a ready image has no usable
     file". False: as today.
   - The owner's status (`GET /api/media/:id`, `media/flows/status.ts`): a ready row on a post whose state is
     `visible`, for which `media_quarantined` is true, is answered with `restoring: true` (10.2). A post's
     images come from `PostView.media`, which says nothing of this, so the app asks: when an image of the
     viewer's own post fails to load, its component calls `GET /api/media/:id` once and prints `image.restoring`
     when the answer says `restoring`, and `image.lost` when it says `lost`. Other readers see an image that
     could not be loaded.
   - The case page shows `case.custody.return`; `quarantine_due` alerts as for a move in.
3. The operator runs steps 3 to 5 again. An `out` line is the same four steps in the other direction; the record
   sets `returned_at`. A file that is in neither place is `missing`, and with `--lost` it gets its end as above:
   the author then reads that korbat lost the image, not that it is being restored.

**F's hand-over.** `handover-list` is unchanged. The `handover` service mounts `media-quarantine` read-only beside
`media-store` read-only and looks for each listed file in the quarantine first: the files of a seal taken while
deciding are still in the store.

| Case | What happens |
|---|---|
| The seal for good is lifted before its files were moved | the rows leave the `in` set; nothing is due |
| The operator runs the mover with an old list | a line whose file is where its direction wants it prints `already`; a line the plan no longer holds is recorded as the move it was and reported, the next list holds the file under the other direction, and the next run moves it back |
| A seal for good is lifted between the list and the mover | the mover takes a visible image's files to the quarantine; the record writes their rows, so `media_quarantined` is true, the author reads `image.restoring`, and the next list prints the `out` lines |
| The author deletes the post after an `unseal_media`, before the files returned | the image row goes as any deleted post's row; `quarantine_plan()` lists its unreturned files under `destroy` (an image row that is gone is content to delete, wherever its file lies) |
| An old `out` line is run after the author deleted the post | the mover returns the file to the store and the record sets `returned_at`; no row is left in the store for it, so the worker's reconcile pass deletes it as any file without a row. When that return was never recorded, the next list prints a `destroy` line, and a `destroy` line looks in both places (7.2) |
| A post sealed for good holds an image row that was erased before the seal (an R4 redaction) | the row counts against `seal_posts.images`, erased or not; only the unerased rows' files are in the plan and must be in the quarantine for a release |
| A file is in neither place | `missing`, the run goes on and exits 1; with `--lost` the row gets `lost_at`, the author and staff are told, and the plan lets the image go |
| The worker's reconcile pass | unchanged: it deletes files without a row (`media/sweeper.ts:65`), and a row without files is nothing to it |
| A deletion request for a quarantined image | the worker finds nothing in the store (`apps/worker/src/loop.ts:73`); the API has no mount on the quarantine |
| The data export while files are away | a sealed image is exported to nobody (C 7.11); an image waiting to return is listed as missing, as any file the store cannot give |
| `MEDIA_RECONCILE=off`, `MODERATION_RETENTION=off` (a restore) | the list, the mover and the record do not read either switch |

### 7.2 The release

A release is the one-way end of korbat's keeping of images sealed for good. It is no decision: it writes no row of
`decisions` or `decision_actions`, the seal stays in force as a measure, and the post's text is untouched.

**Destruction needs leave, not an assessment.** An authority's recorded answer is an assessment. `illegal` is the
reason an authority wants evidence kept, not a word to destroy it: by itself it changes nothing about the files,
which stay sealed and in the quarantine. `not_illegal` supports the unsealing, which is `unseal_media` and 3c's;
no answer supports nothing. Sealed files are destroyed only on two things together: a **leave or an instruction
to destroy** that an authority or a court gave, recorded as a fact of its own, and an admin's confirmed action.
The terms promise no destruction and no period.

**The leave.** `staff.js release-leave` (section 8), as the migrator, records it. The operator names the seal
(its ledger row) or the refusal, and the command writes the leave against F's notification record of that seal
or held upload (`release_leaves.notification_id`, section 6.2): who gave it (`from`, one of
`RELEASE_LEAVE_FROM`: `authority` or `court`; the column is `leave_from`), its reference, the day it bears
(`receivedOn`) and, when the authority forbids telling the person, that and until when: the row's mark `untold`
with its end `untold_until`, null for an open end as F's `not_to_person` has it, which the contracts carry as
`untold` and `untoldUntil` (10.3). It is a row of `release_leaves` and one audit row,
`release_leave_recorded` (10.5). The command changes a recorded leave in two ways and in no other. It ends an
open `untold_until`. And it withdraws a leave that was recorded by mistake, `release-leave --withdraw <leave>`:
the leave's row then holds when and by whom (`withdrawn_at`, which the database forces, and `withdrawn_by`,
section 6.2), and the command ends with an audit row of its own, `release_leave_withdrawn` (10.5). A withdrawn leave supports no
release: the case answer no longer carries it, and `seal_release` and `upload_release` refuse it with
`release_no_leave`, the code of a leave that was never recorded. A leave that a release already rests on
cannot be withdrawn (`leave_used`): nothing takes a release back, and its record keeps the word it rested on.
No leave is deleted, and the right leave, where there is one, is recorded as a new one. The command records
what the operator holds in writing; it cannot check that an
authority wrote it (11.3). A leave is never typed into the console and is no member of a request an admin can
make up: the confirmed params name the recorded leave by its id.

**Before.** The operator has reported the seal (F 7.13), moved its files (7.1), recorded the authority's answer
with F's `notification-answer` if one came, and recorded the leave. The case answer carries, on each seal for
good in force, `release` (10.3): the facts of `release_facts(action)` (reported, the authority's reference, the
answer and its day, the hand-over's day, quarantined, preserved, the leave, and `tellHeld`: whether the author's
notice would be held if the release were taken now), the ids of the lowest
`RELEASE_POSTS_MAX` posts of the seal that are not released, how many more remain, and `silenceDays`. The fact
`quarantined` reads: every post the seal lists that is not released has as many image rows, erased or not, as
its `seal_posts.images`, and each unerased one of them has a row for each of its files (moved or lost, 7.1). The
console's block shows them to an admin (section 8).

**The confirmed action.** `POST /api/staff/seals/:action/release`, behind `requireStaff` and the step-up
`seal_released` with the seal's action id as its target (target type `seal`). The body is `SealReleasedParams`
(10.4) with the assertion as `stepUp`. One transaction on the API's pool, built as `recordConfirmed`
(`moderation/decide.ts:106`) builds a decision's:

1. Every lock wait is bounded by what is left of the challenge.
2. The subject's profile `FOR NO KEY UPDATE`: the post's author for a post case, the account for an account case,
   read before the transaction as `decide` reads it. It is the first lock, as in every deciding transaction.
3. `select public.seal_release(action, basis, leave, staff)`. In the function's order:
   1. the seal's ledger row and its case `FOR UPDATE`; `release_not_open` unless the row is a `seal_media` of a
      decision that is not interim, in force, with at least one post not yet in `release_posts`. The posts to
      release are the lowest `RELEASE_POSTS_MAX` (1000) of those, in id order: a seal over more posts is released
      in parts, each a confirmed action of its own;
   2. `release_facts`, read after the lock: `release_not_reported`, `release_not_quarantined`, `release_preserved`.
      `quarantined` and `preserved` are read over **all** the seal's unreleased posts, not over the part: nothing
      is released from a seal that is not wholly in the quarantine or of which a post is preserved;
   3. the ground. `leave`: `release_no_leave` unless a row of `release_leaves` for this seal's notification
      record exists, is not withdrawn and is the one the request names; the function reads that row
      `FOR SHARE`, so a withdrawal and a release of one leave run one after the other. The recorded answer is
      not read: no answer is a ground, `illegal` included. `period`: `release_period_unset` while
      `release_rules().silence_days` is null, which is
      how it ships. Any other word, the withdrawn ground `answer` among them: `release_no_leave`;
   4. `admin_required` unless the caller is an admin;
   5. one row of `releases` (with the leave's id and `backups_clear_at`), one row of `release_posts` a post, and
      `erased_at = now()` on the posts' image rows where it is null, in id order.
4. Last, `append_confirmed_audit`: action `seal_released`, target the seal, metadata `{ params, releaseId }`. The
   params hold the released posts' ids, so the keeper's copy holds every fact a replay needs (7.3), and the
   leave's id and reference, so the proof of a destruction names the word it rests on.
5. At commit `releases_confirmed` holds the row to that audit row: `seal_released` on this seal, naming the
   release, with a step-up, written by `released_by`, its params equal to the row's `post_ids`, `basis`,
   `leave_id` and `their_reference` (the leave's reference as its record holds it). Otherwise `release_mismatch`:
   a fact that moved between the page and the key (another leave, a post released meanwhile, a post the seal
   gained) refuses the commit, and the console reads again.

The answer is the case as it now stands (201). "ended" and "late" answer as for a decision (`staff/cases.ts:91`).

**What the commit changed.** The posts are no longer frozen through the seal (`frozen_for`'s clause); their image
rows are erased, so `serve`, gate V and the export refuse them as any erased image. The image's state stays
`sealed`. A new unanswered suspect item about a released post freezes it again through the first arm, and an
order's preservation through the fourth.

**After the commit**, each in a try of its own:

1. The trigger of 7.4 wrote one `edge_purges` row an image, cause `released`; the purge job drains them.
2. The author's notice (`RELEASE_NOTICE`, 10.8), listed by `GET /api/moderation/notices` and answered by `GET
   /api/moderation/releases/:release` for the subject account alone; the mail `release_notice` carries its
   paragraphs. The notice says what korbat did, in the commit's own terms: it has **released** the images, will
   not show them again or give them back, has erased its record of them and destroys the files, and its backups
   hold them until `backups_clear_at` at the latest. It does not say that korbat "no longer holds" them: at the
   commit every file is still in the quarantine. As its ground it says that an authority or a court gave leave
   or an instruction to destroy. It carries no assessment of any authority, no answer's word, no name and no
   reference, and it names the images by post and count.
   - **Held, not sent, while a rule of non-disclosure holds it.** `releases.author_notice` is `held`, no mail is
     sent and no reader lists or answers the release, while `release_tellable(release)` answers false. It does
     so while one of three things holds: the release's leave is `untold` and its `untold_until` is null or lies
     ahead; an event of the notification record the release rests on carries F's mark `not_to_person` with an
     end that is open or ahead (F 7.13 step 6); or a decision about a post of the release is untold under F's
     hold (F 6.3 step 10). The row is born `held` by its trigger `releases_notice`, and the dispatch round that
     finds `release_tellable` true sets it `pending` (7.14), never earlier. `release-leave` ends an open
     `untold_until`, and F's `notification-event` ends the record's mark (section 8). Nothing reaches the author
     on another path meanwhile: a released post's chip and case are 3c's and say nothing new.
   - Otherwise `author_notice` records the mail's outcome (`none` for an account that no longer exists); a
     pending one is the dispatch job's (7.14).
3. Every staff account, the admin's own included, is told: the alert `seal_released` (10.1; facts `at`, `posts`,
   `uploads`), sent after the commit through `staffAlert` without a throttle, and the home screen lists every
   release of the last 30 days (`StaffOverview.destructive`, 10.3). A release cannot be taken back, so it gets
   what 3c gives the milder act of lifting a seal unseen.
4. 3c's disposal (C 7.9) deletes the erased image rows at its next round, as any erased row nothing retains, and
   asks the worker for their files, which the store no longer holds.
5. `alert_steps()` writes `release_undestroyed` daily once a file has been due for destruction, undestroyed, for
   24 hours, counted from its release, or from its record for a file of the plan's third set whose image row is
   gone (facts `count`, `oldestAt`).

**The destruction.**

1. `staff.js quarantine-list` prints a `destroy` line for every file of `quarantine_files` that is not
   returned, destroyed or lost and whose post is released. The file's row carries its post (`post_id`, section 6.1), so the
   line does not depend on the image row, which the disposal has deleted by then.
2. The mover, for a `destroy` line, looks in both places: it takes the SHA-256 of the quarantined file, unlinks
   it and, when the store holds a file under the same name (a return that was never recorded, a restored
   store), unlinks that too, syncs the directories, and prints the line with the digest and where it found the
   file: `quarantine`, `store`, `both`, or `already` when it is in neither.
3. `staff.js quarantine-record` sets `destroyed_at` and the release's id on the file's row. A digest that differs
   from the one recorded at the move is printed and counted in the audit row's `mismatched`; the row is completed
   all the same, since the file is gone.
4. `staff.js release-show <release>` prints the record: the ground, the leave (who gave it, its reference and
   day), each destroyed file with its digest and time, the state of the author's notice, and
   `backups_clear_at`. It prints no answer of an authority: the release's row copies none (section 6.2).
   It prints that day with its condition: no backup of the store **that is deleted on time**
   (`RETENTION.backupDays`) holds a released file after it; a backup kept for an authority (C 7.9) is destroyed
   by hand (README, Restoring).

**What a release leaves alone.**

- **A waiting appeal of the seal.** It stays open. `GET /api/staff/appeals` marks its row `released` (`{ at,
  basis }`), and an admin reviews it as any appeal whose review needs an admin (C 7.7): only a person closes it.
- **E's protective suspension.** It rests on the seal for good, which is still in force, and ends by its own days.
- **F's records.** The notification record, a hand-over's production and its archive are F's to keep and destroy.
- **The snapshots of the post.** Their images are held by reference; gate E erases them on 3c's schedule once the
  post is not frozen.

**The ground `period`.** In 3d it is a refusal. While `silence_days` is null every request with it answers
`release_period_unset` at step 3.3, before any other check of the ground, and the console offers no control for
it. The checks behind it (`release_period_running`: the days since the hand-over or the report; the seal's row of
`release_notices` told `period_notice_days` before, with no objection unanswered) are reached only by a non-null
constant. `release_announce`, which writes that row, answers `release_period_unset` too, and no route calls it:
the route, the screen, the objection's form and the sending of the mail `release_day` are built by the task that
sets the period, on counsel's answer (section 17).

| Case | What happens |
|---|---|
| The answer is `not_illegal` | no ground for a release; it supports `unseal_media`, an admin's decision of 3c, and the files return (7.1) |
| The answer is `illegal`, and no leave is recorded | `release_no_leave`: an assessment destroys nothing; the images stay sealed and in the quarantine, for the authority that may still ask for them |
| `no_assessment`, `other`, or no answer | the same: sealed and kept, for as long as nothing else ends it |
| A leave is recorded and the authority forbade telling the person | the release is taken; the author's notice is `held` and no reader shows the release until the hold ends |
| A leave is recorded for another notification record | `release_no_leave`: a leave releases the seal it was given for |
| A leave was recorded by mistake (the wrong seal, a letter that was no leave) | the operator withdraws it (`release-leave --withdraw`) before a release rests on it: the case answer shows no leave again, and a release that names it answers `release_no_leave`. Once a release rests on it the withdrawal is refused (`leave_used`), and nothing takes the release back |
| A withdrawal and a release of one leave arrive together | one waits for the other at the leave's row: the release then finds the leave withdrawn (`release_no_leave`), or the withdrawal finds it used (`leave_used`) |
| A seal taken while deciding | `release_not_open` |
| Two admins release at once | the second waits at the case and finds every post in `release_posts` (`release_not_open`), or, on a seal released in parts, other posts than its params name (`release_mismatch` at commit) |
| A deletion or a purge races the release | both take the subject's profile first, so one runs after the other; a row the deletion took first is not in the release's update, and its quarantined file is a `destroy` line by 7.1's rule |
| A new suspect item arrives while the release waits | the intake takes no profile lock and commits; the release then commits too, and the post is frozen through the new item, whose images are erased: the admin answers it on the record alone |
| A post of the seal is preserved for an order | `release_preserved`; nothing of the seal is released while that lasts |
| The seal lists more unreleased posts than `RELEASE_POSTS_MAX` (1000) | one request's params cannot hold them (a request body is at most 64 KB, `app.ts:21`), so a release takes the lowest 1000 in id order; the case answer shows how many remain (`release.remaining`) and the admin confirms again for the next part. The facts are read over all unreleased posts each time |

### 7.3 After a restore: the replay

A database restored from a backup has forgotten every release taken after it, and treats those images as sealed
and kept. F 7.17 runs first, with `APP_SITE=closed` and both retention switches off. 3d adds four steps.

1. **`staff.js restore-import`** (F 7.17 step 2), extended. It replays nothing itself; for the lines of 3d above
   the restored head it writes rows of `restore_gaps`, each with the line's place, hash, target and metadata, as
   it does for a lost decision:
   - `seal_released` and `upload_released`: one gap of the class `release`, which the replay closes (step 2);
   - `automated_decided`: a lost decision, as F writes one for `case_decided`, with F's class by its one action:
     `seal_interim` for a `seal_media`, `restriction` for a `withhold_media`. It keeps the site closed as F's
     rule does. The restored database has neither the finding nor the match record, its `media_hashes` row may
     read `unchecked` and be past the retry's 24 hours, so nothing would find the image again: an admin takes
     the measure again on the gap, as a finding of their own;
   - `upload_hold_ended`: one gap of the class `release`. When the restored database holds the refusal, the
     admin's new end of that hold closes it (`upload_hold_end` closes the gap with the disposition
     `reapplied`); when it does not, `staff.js release-replay` closes it through `upload_hold_replay` (step 2)
     and prints that the hold's end is on record and its upload is not;
   - `release_leave_recorded`: one gap of the class `release` for each such line, which recording the leave
     again closes (`release-leave` names the gap, as F's notification commands do, and records the leave
     under the id that the gap's line names). A release that used a lost
     leave is replayed all the same, before or after: `releases.leave_id` has no foreign key (section 6.2). A
     leave that a later line of the copy withdraws gets no gap: a withdrawn leave supported no release, and
     it is not recorded again;
   - `release_leave_withdrawn`: one gap of the class `release` when the restored database holds the leave,
     which stands there again as if it had never been withdrawn. Withdrawing it again closes the gap
     (`release-leave --withdraw <leave> --gap <gap>`), and the README's Restoring has that step before an admin
     reads the case (section 18): until then the release block shows a leave that korbat had withdrawn.
   So everything of 3d that a restore loses is in the gap list, or in step 3's inventory.
2. **`staff.js release-replay < <the keeper's files>`**, as the migrator, one transaction a release. For each
   `seal_released` line above the restored head it calls `release_replay` with the release's id, the params'
   posts, ground, leave and reference, and the line's time as `released_at`; for an `upload_released` line,
   `upload_release_replay` with the refusal and the line's `mediaId` in place of the posts. The function answers
   `present` when that release, or a replay of it, is already there. Otherwise it refuses (`replay_no_gap`)
   unless an open gap of the class `release` names that release: only a line that `restore-import` checked
   against the chain (F 7.17 step 2.1) can erase image rows, and the command need not check the keeper's files
   a second time. Then it writes the `releases` row with `replay_of`, the original time and `imported_at`.
   The insert forces that row's `author_notice` (section 6.2): `held` while `release_tellable` answers false
   for it, that is while one of the three holds on telling says that the author may not be told, and `none`
   otherwise, since the author was then told when the release was first taken. So a release whose notice
   was still held when the restore lost it is held again, not dropped: no reader shows it meanwhile, and its
   author is told in the dispatch round that finds the last hold ended (7.14). A replay names no seal and
   finds the report's record through the row of its leave; while a lost leave is not yet recorded again
   neither its mark nor the record can be read, and the replay is `held` until it is: the cautious side, on
   which an author may be told a second time and nobody is shown a release too early. Then it writes a
   `release_posts` row for each post not yet marked and
   `erased_at` on the image rows the restored database holds for them, and closes the release's gap with the
   disposition `imported`. `upload_release_replay` sets the refusal's `release_id` when the restored database
   holds the refusal; whether it does or not, it sets `erased_at` and `hold_until = now()` on the image row that
   `mediaId` names, when that row exists: an upload that the backup knew only as `ready` and `unchecked` must
   not be attachable after korbat has recorded its destruction. For an `upload_hold_ended` line the command
   calls `upload_hold_replay` with the refusal, the line's `mediaId`, its `endAs` and its time. That function
   answers `present`, with nothing written, when the restored database holds the refusal: the gap then waits
   for the admin (step 1). Otherwise, under the same refusal `replay_no_gap`, it writes on the image row that
   `mediaId` names, when that row exists and is on no post: for `report`, `hold_until = infinity`, so that
   nothing sweeps the file and `post_media_refused` lets nobody post it; for `no_report`, `erased_at` and
   `hold_until = now()`, as the hold's end meant; and it closes the gap as `imported`. The command ends each
   transaction with the audit row `release_replayed` (10.5). Run twice, it changes nothing.
3. **Files.** A copy in the restored store goes as any erased image's files go: once the retention switch is
   back on, the disposal deletes the erased rows and asks the worker for their files, and a `destroy` line
   removes a copy the store holds under the same name (7.2). A copy the quarantine still holds is a `destroy`
   line of `staff.js quarantine-list`, as far as the restored `quarantine_files` knows it; the mover and
   `quarantine-record` run as in 7.2. A file moved, or moved and released, after the backup has no row any more.
   The restored rows cannot list it, so the operator runs the mover's `--inventory` and pipes it into
   `quarantine-record` (7.1): every file the quarantine holds without a row gets its row and is reported, and
   the next list holds it under `destroy` (its post is released by the replay), under `out`, under nothing, or,
   when the restored database does not know its image, under `operator` and never under `destroy` (7.1). The
   README's Restoring has this step before the site opens.
4. **`staff.js head-restore-mark`** writes the public `restore` row (7.7).

**Opening.** `RestoreView.mayOpen` is false while a gap of the class `release` is open, beside F's three classes:
until the replay the restored database counts as sealed and kept what the record says was released, and an
`unseal_media` could give back images whose destruction korbat has recorded. A lost automatic seal keeps the
site closed through F's class `seal_interim`.

| Case | What happens |
|---|---|
| The backup was taken after the seal for good and before its release | the replay marks the seal's posts and erases their rows; one mark, idempotent |
| The backup was taken before the seal for good | F's gap `seal_final` asks an admin to take the seal again. The replay has marked the post already, so the new seal lists it, freezes nothing and brings nothing back: the mark is keyed on the post, not on the seal's row |
| The release named a post the restored database does not hold | the mark is written all the same (it has no foreign key); nothing else exists to change |
| The quarantine's disk was lost with the server | its files are gone and no backup holds them (section 5); the `destroy` lines print `already`, and the record says so |
| The keeper's files end before a release | it is not replayed, as everything after the last download is lost (F 7.17); the images stay sealed and kept, which is the cautious side, and the operator, who holds the leave in writing, records it again for a new release |
| The release was taken after the backup, and its author's notice was still held | the replay is born `held` while a hold on telling stands, and the dispatch job tells the author in the round after the last one ended; a replay with no hold standing is `none` and tells nobody |
| A leave was recorded before the backup and withdrawn after it | the restored database shows it as standing: a gap of the class `release`, closed when the operator withdraws it again with `release-leave --withdraw ... --gap` |
| A leave was recorded and withdrawn after the backup | no gap, and nothing to record again: it supported no release |
| A held upload was released after the backup, and the backup holds its refusal | the gap, then the replay: the refusal's `release_id`, the image row erased and its hold ended; the file is a `destroy` line |
| A held upload was released after the backup, and the backup knows the upload only as `ready` and `unchecked` | no refusal to mark: the replay erases the image row that `mediaId` names and ends its hold, so nothing can attach or serve it; the inventory finds its file, and the list prints it under `operator` |
| A hold was ended as `report`, and reported, after the backup | the gap of the class `release` shows the admin that the end is on record; the admin ends the hold again, and the gap's line tells the operator that a report was already made, so that `upload-report` records that report again (F's own gap for the lost notification record) and does not start a second one. When the backup does not hold the refusal, `upload_hold_replay` sets the image row's `hold_until` to `infinity`, so nothing sweeps the upload and nobody posts it |
| The program sealed a post's images after the backup, and no admin had answered | F's class `seal_interim` keeps the site closed until an admin has taken the measure again or set the gap aside with a reason, as for any lost seal taken while deciding |

### 7.4 The edge: the header, the outbox and the purge

**The header.** `PUBLIC_CACHE` (`media/flows/serve.ts:6`) becomes `public, max-age=60, s-maxage=300,
must-revalidate, stale-if-error=0`, on the 200 and on the 304 of a public image. `PRIVATE_CACHE` stays `private,
no-store`, and every other answer of the API, a 404 of the image route included, stays `no-store`
(`middleware/security-headers.ts:18`), so no edge keeps a refusal that would outlive a restored image. The bound
korbat prints is the header's: an edge copy for up to five minutes without an accepted purge, a browser's copy for
up to one minute. The contracts hold both numbers as `EDGE_CACHE` (10.1); a unit test holds the header's text to
them.

**The call sites are triggers, not routes.** An image stops being public in a transaction of 3c, E, F, the social
module, the account module or 3d; the two triggers of section 6.3 write the outbox row in that transaction,
whoever the writer is, so a writer added later cannot forget the purge.

| What hides the image | Writer | Trigger | Cause |
|---|---|---|---|
| `withhold_media`, `remove_media`, `seal_media` (a person's or the program's) | `moderation_apply` sets `post_media.moderation_state` | `post_media_purge` | `state` |
| `withhold`, `remove` (C), `disable_by_order` (F) | `moderation_apply` sets `posts.moderation_level` and `state` | `posts_purge`, one row an image of the post | `state` |
| An author deletes the post (`social/flows/posts.ts:68`) | the post's `state`; `detachAll` deletes the rows a freeze does not keep | `posts_purge`; `post_media_purge` on delete | `deleted` |
| An account's purge, a deletion's or a final termination's (E 7.8) | `purgeOwner` deletes the rows | `post_media_purge` on delete | `deleted` |
| An erasure (C 7.9: an R4 redaction, the disposal) | a migrator-owned function sets `erased_at` or deletes the row | `post_media_purge` | `state`, `deleted` |
| A release (7.2), a replay (7.3) | `seal_release` and `release_replay` set `erased_at` | `post_media_purge` | `released` |

A suspension or a termination of E hides no post by itself and writes no row; a measure that is lifted writes
none either, since nothing has to leave a cache. The release of a held upload writes none: the trigger writes a
row only for an image that is on a post and ready (section 6.3), and a held upload was never served to anyone. A row is written whether the adapter is on or off. Two rows for
one image (a deleted post writes one from each trigger) are harmless: the job sends each prefix once.

**The job.** `edge-purge`, in the API under the jobs' shared lock (`lib/jobs.ts:81`), a round 15 seconds after the
last one ended. One round sends at most one request, so at most four a minute.

1. **Adapter off** (`EDGE_PURGE=off`, the default): every row without an outcome gets `outcome` `off` and
   `done_at`. Nothing is sent.
2. **Adapter on:** the oldest rows with no outcome and `next_at` at or before now, up to `EDGE_RULES.prefixes` (30)
   distinct images. For each image one prefix, `<EDGE_HOST>/api/media/<id>/`, which covers both sizes and every
   query-string variant a stranger may have put into the cache. One call `purge(prefixes)`, bounded at 5 seconds.
   - `accepted`: every row of those images that the round read (an id at or under the highest it read) gets
     `accepted` and `done_at`. A row written for one of those images while the request was out stays open for
     the next round: it may stand for a second hiding that the first purge did not cover.
   - `failed` (a refusal, a timeout, no connection): `attempts + 1` and `next_at` = now + 30 seconds doubled a
     failure, at most one hour. A row whose `created_at` is 24 hours back gets `failed` and `done_at`, and the job
     writes the alert `edge_purge_failed` (7.14; facts `count`, `oldestAt`), at most once in 24 hours.
3. A round that throws leaves its rows as they were. The token is in no log line, no audit row and no answer.

A purge never delays, blocks or undoes a measure, and an accepted request is no proof that every edge node has
dropped its copy: the header stays the bound, and F's target of 55 minutes stays (section 15 notes it in F 16).

**What staff read.** The case answer carries `purges`: for each image the case's newest snapshot lists, the newest
outbox row's `outcome` and time (10.3). The console prints `case.purge.accepted`, `.failed`, `.off` or `.pending`;
F's order screen prints the same line for each disabled item. The retention job deletes a row 30 days after
`done_at` (7.14).

| Case | What happens |
|---|---|
| The API stops between the measure's commit and the purge | the row is committed with the measure; the next round sends it |
| The limit store is down | no round runs (the job's lock is the store's); the rows wait, and the header bounds every copy meanwhile |
| The provider refuses the token | every round fails and backs off; after 24 hours the rows read `failed` and staff are alerted; the measure stood from its commit |
| A seal of an account with thousands of images | 30 prefixes a round, four rounds a minute: 120 images a minute. An image whose turn comes later than five minutes after the seal has no edge copy left by then; the screen shows it as "not sent yet" until its row closes |
| The image becomes public again (a restore, an unseal) | nothing is purged; the first request refills the edge |

### 7.5 The recipients' count

The count is of sketches that hold no member: a HyperLogLog answers "about how many different values were added"
and cannot give one back. Method version 1 (`RECIPIENT_RULES.method`).

1. **A, signed in.** `resolveSession` (`auth/middleware.ts:35`), right after it resolved a session, calls the
   handler's `seen(accountId)`: `PFADD mau:in:<yyyy-mm> <account id>` for the UTC month. It is not waited for,
   and a failure of Valkey is swallowed: counting never fails or slows a request. **The wiring** is as for
   `media.onMatch`: the auth module is built first and cannot be given a module that needs its mail, so it gains
   `onSeen(handler)`, the handler being `TransparencyForAuth` (`seen`, `seenSignedOut`), and `index.ts` registers
   the transparency module's once that is built. Until then, and in a test that registers none, the calls are
   no-ops. Both calls sit in `resolveSession` and nowhere else: the global rate limit runs before it
   (`app.ts:68`) and cannot know whether a session will resolve.
2. **B, signed out**, only while `RECIPIENTS_SIGNED_OUT` is `on`. The same middleware, when no session resolved,
   calls `seenSignedOut(address, userAgent, path)` for a `GET` of one of `RECIPIENT_READ_ROUTES`: the seven routes
   of the social module that answer without a session (`social/routes.ts:48`, `:53`, `:67`, `:68`, `:77`, `:78`,
   `:81`: a post, its thread, the two public timelines, a profile, its posts and its replies). The image route and
   F's page status are not counted: an edge answers most image requests itself, and Caddy asks the status. The
   function:
   1. drops a user agent that names itself a crawler (`RECIPIENT_RULES.crawler`, one pattern on the agent's own
      words); nothing else is guessed about a reader;
   2. reads the day's salt, `mau:salt:<yyyy-mm-dd>`, creating it with 32 random bytes and 26 hours to live when it
      is absent (`SET ... NX`); the process keeps it in memory for that UTC day and writes it nowhere;
   3. adds `HMAC-SHA-256(salt, network LF user agent)` to `mau:out:<yyyy-mm-dd>`, the network being
      `clientNetwork(address)` (`auth/client-ip.ts:55`: an IPv4 address, or an IPv6 address's first 64 bits) and
      the user agent cut at 256 bytes. The digest is never stored outside the sketch, and after 26 hours nobody,
      korbat included, can compute it again.
3. **The month's close.** The transparency module's job (7.14), on its first round after a UTC month ended: when
   `mau:in:<month>` exists and `recipient_months` has no row for the month, it reads `PFCOUNT` of the month's
   sketch and of each of the month's day sketches, inserts the row (`signed_in`; `signed_out_days` as the sum over
   the days, null while the setting is off; `method`), and deletes the keys. Every sketch also carries 70 days to
   live from its first write, so a key the job never closed dies by itself.
4. **The figure** is the average of the six full months before the day it is asked for: "between A and A + B",
   or "at least A" for months without B. `staff.js recipients [--months 6]` prints it exactly, for the authority
   that asks (DSA Art. 24(3)); the yearly edition prints the two bounds rounded (7.6). An edition's figure is
   of the six stored months before **its due day**, in every version of it: a version written two years later
   does not print that later time's readers under the edition's year.

| Case | What happens |
|---|---|
| Valkey loses its data | the running month has no sketch at its end and gets no row; `recipients` prints "not recorded" for it and averages the months on record, saying how many |
| A month in which nobody came | no sketch, no row: it reads as "not recorded", which is what korbat knows |
| One reader on two networks, or two readers behind one address with one browser | counted twice, or once: B is a sum of daily readers and an upper bound by construction, which the page's method text says |
| A signed-in reader | never in B: a request with a session adds to A alone |

### 7.6 The yearly edition

1. **Due.** The edition of year Y is due on 1 March of Y + 1 in UTC (`TRANSPARENCY_RULES.dueMonth`, `dueDay`).
   The running year has no figure anywhere: nothing on the page moves when one decision is taken.
2. **The job.** Once a day, after the dispatch hour, the transparency job calls `edition_publish(y, 'first')` for
   the last closed year and for every earlier year that has an edition. The function decides, under an advisory
   lock on the year, and answers the version it wrote, or null:
   - no version exists and the edition is due: version 1, `first`. `transparency_figures(y, as_of)` computes
     every count from rows of that year **as they stood on the edition's due day**: the tables are fixed to
     that day (1 March of Y + 1) inside the function, whenever it runs and whatever `as_of` is, and `as_of`, for
     which every caller passes the present time, moves the order section alone. The function bands each count
     (`band`), folds every row under the floor into "other", and leaves out every decision of the kind `order`.
     The order section reads F's rows as `tco-counts` does and leaves out every order whose notice is held at
     `as_of`; it is absent when no countable order exists;
   - a version exists, and the order section computed now would count an order that the newest version's figures
     do not hold (the same rows, by the same time, as the section reads them: an order received in that year
     whose hold has ended since): the next version, `hold_ended`. It **copies** the newest version's stored
     figures and replaces the `orders` member alone: no other table is computed again, so the difference between
     two versions shows the order and nothing that happened to anyone else in between. The older version stays,
     marked as replaced;
   - otherwise nothing;
   - with a version it writes the plain audit row `edition_published` as the system (10.5), its last statement.
   The database refuses the figures of a year that is not due (`edition_not_due`) whoever asks, and the reason
   `correction` from the API's role (`invalid_edition`).
3. **A correction.** `staff.js edition <year> --correct`, as the migrator, stores the year computed again as the
   next version with the reason `correction`: the one reason under which every table is computed again, as of
   the same due day, and the page says so on that version's line. No version is ever changed or deleted.
4. **The read.** `GET /api/public/transparency` answers every year's newest version and the list of its older
   versions (10.6). It reads `transparency_editions` and `recipient_months` and nothing of a person.
5. **What the page always says**, whether or not it applies in a year, so that its presence tells nothing:
   `tr.ordersHeld` (orders whose disclosure an authority's decision forbids are counted after it
   ends) and `tr.tdb` (korbat feeds no Transparency Database, and why).

| Case | What happens |
|---|---|
| A year with one order, held on 1 March | version 1 has no order section and says nothing of an omission; when the hold ends, version 2 (`hold_ended`) adds the section and repeats every other figure of version 1 unchanged |
| An order received on 31 December and disabled, under a hold, on 1 January | it is an order of the year it was received in, as the order section counts it; when its hold ends, that year gets its `hold_ended` version |
| A hold ends two years after its year closed | the daily job asks every year that has an edition, so that year gets its version then; its recipients' figure is still the one of its due day |
| A held upload of the year is ended, or a program's finding of the year is decided, after 1 March | no version moves: the tables count what stood on the due day, and a later version copies them |
| A cell of 1 to 9 | it prints "1 to 9", or is folded into "other grounds" or "other measures" when its row is under the floor; a rate prints only as two banded counts, and only when its base is ten or more |
| The parts do not add up to the total | by design: each figure is rounded by itself, so no folded cell can be subtracted back; the page says so (`tr.read`) |
| The API was down on 1 March | the first round after it publishes; `computed_at` and `published_at` say when |

### 7.7 The daily head

1. **The value.** Once a day, after the dispatch hour, the transparency job reads the audit head (`audit_head`:
   place and hash) and computes `head_value(day, seq, hash)`, the SHA-256 of `korbat.head.v2`, a line feed, the
   day (`yyyy-mm-dd`, UTC), a line feed, the place, a line feed and the hash. The value shows neither the place
   nor a row's hash, so nobody counts staff actions from it or tests a guessed row against it. The day is in the
   digest so that two days never show the same value: without it a weekend on which nothing was written to the
   audit log would print one value three times, and anyone could read off the days on which nobody at korbat
   did anything.
2. **The row.** One insert into `head_publications`, `on conflict do nothing`: `kind` `head`, `witness` the
   adapter's name (`none` while it is off). The insert's trigger forces the day, the place and the value from
   `audit_head` as it stands, so the API's role cannot publish a value of its own making. A day holds one `head`
   row.
3. **The witness**, when `HEAD_WITNESS` is not `off`: one call `witness(value)`, bounded at 10 seconds. An answer
   is stored as `token` with `witnessed_at`. No answer: the row is published without a token, reads `witness`
   `none` on the public route, and the job writes the alert `head_unwitnessed` (7.14; fact `day`), at most once a
   day. Later rounds of the same day ask again while the token is null; a token that comes later still proves the
   value from that later time on.
4. **Published.** `published_at` is set (from null, once). `GET /api/public/head` answers the last 30 days: `day`,
   `kind`, `value`, `witness`, the token and `retiredOn`, never the place (10.6).
5. **The keeper's mail.** One mail with the template `head_published` to the address `HEAD_KEEPER_MAIL`, and to
   nobody else: the day, the value, the place and the hash, from which the keeper computes the value again. It
   is the copy that is not on korbat's server. The auth module mails an account, a notifier's contact or every
   staff account and nothing else (`auth/index.ts:202`), so it gains one sender for this, `mailKeeper(message)`,
   a member of the interface the transparency module is given (`AuthForTransparency`): it takes no address, only
   the message, and sends to the configured one. While the setting is empty no mail is sent, and `staff.js
   automation-status` says so.
6. **A missed day.** When the day before has no published row, the first round of a day writes the alert
   `head_missed` (fact `day`). A missed day is not written afterwards: the page shows the hole.
7. **After a restore.** `staff.js head-restore-mark [<day>:<value> ...]`, as the migrator: it stores the values the
   keeper's mails hold for days the restored database lacks, marks as retired every stored value whose place is
   above the restored head, and writes the day's row of the kind `restore` from the restored head. The page then
   shows, dated, that korbat restored its database and which published value is the last that still verifies.

The page says in words (`tr.head`) that a value on korbat's own page proves nothing against
korbat's operator by itself: the proof is the keeper's copy and, where one is on, the outside witness's token.

### 7.8 An upload while a tool is on

With `R1_CLASSIFIER` and `MEDIA_MATCH` both `off`, an upload runs as 2b built it: nothing is hashed, nothing is
scored, `media_hashes` gains no row, and the only change is the result file's version. The steps below say what
each tool adds; "classifier" and "matcher" mean the adapter is not `off`.

1. **The upload** (`POST /api/media`, `media/flows/upload.ts:44`). Matcher on: `files.receive`
   (`media/files.ts:106`) feeds every chunk it writes to three hashers of `node:crypto` (SHA-256, SHA-1, MD5) and
   answers the digests with the byte count. `insertProcessing` and the `media_hashes` row (`check_state`
   `pending`) are one transaction, so no image row exists without its hashes. The hashes are of the file as
   received: the store keeps only korbat's own re-encoded sizes, which no list knows. Every hash a match can
   rest on is computed before the original bytes are discarded (step 3.4): the three here, the perceptual one in
   the worker.
2. **The worker** decodes as today (`apps/worker/src/pipeline.ts:82`).
   - Classifier on: `score(pixels, width, height, channels)` on the small size's raw pixels, which the pipeline
     already holds with their channel count, three or four (`pipeline.ts:101`). A scorer that throws or answers
     null leaves the member out: the classifier never fails an upload.
   - Matcher on: korbat's own PDQ of the decoded pixels, with its quality.
   - The result file is version 2 (10.2): version 1's members, and for a ready image the optional members `r1
     { model, score }` and `pdq { impl, hash, quality }`. The worker writes version 2 always.
3. **`finalize`** (`media/flows/status.ts:10`), called by the owner's status read or by the sweeper as today:
   1. it reads and parses the result strictly; a version it does not know, a score outside 0 to 1, a model name
      that is not this build's or a PDQ that is not 64 hex characters is a result that does not follow the
      protocol, which is ignored and logged as today (`files.ts:173`): the file comes from the one process korbat
      does not trust;
   2. matcher on, result ready: one call `check({ sha256, sha1, md5, pdq? })`, bounded at
      `AUTOMATION_RULES.matchTimeoutMs` (3000). The PDQ is sent only at or over `pdqMinQuality` (50). The request
      holds hashes and nothing else: no image, no address, no account, no id of korbat's;
   3. one transaction: the row's verdict as today (only a row still `processing` changes; when none did, another
      caller finalized and nothing more is written); `nsfw_score` from `r1`; the PDQ columns; `check_state` and
      `checked_at`: `clear`, `unchecked` (no answer in time) or `matched`. For `matched`, in the same transaction,
      one row of `media_matches`: the source, its list version, the hash type, the kind, the classification as
      returned, the one hash value that matched, and two columns its trigger forces, `listed` (`match_listed`:
      the source itself names this classification child sexual abuse material) and `acting` (listed, on the
      source's `MATCH_ACTING`, and exact: a cryptographic hash, or a perceptual hash for which the source's
      answer says `exact`). Then, by `acting`:
      - **an acting match:** one row of `upload_refusals`. Its insert (`upload_refusals_insert`) refuses a record
        that is not acting (`refusal_not_acting`), and its trigger `upload_refusals_hold` sets the image row's
        `hold_until` to `infinity`, marks the match record handled (`handled_at`) and writes the account's
        address hold (below);
      - **any other match, a flag:** nothing more. The upload is refused by nobody and held by nobody: it is
        ready as any image, its uploader is told nothing, since nothing was done to it, and no rule is cited.
        The record waits for the image to be posted (7.9); an upload nobody posts goes by the sweeper as any,
        and its record by 7.14;
   4. the upload file is discarded as today.
   So an image is `ready` only once its check was answered or timed out, and an upload with an acting match is
   never ready without its refusal.
   **The limit on refusals.** A source gone wrong would tell every uploader of an afternoon that their file
   matched such a list. So the refusal's insert (`upload_refusals_insert`) counts, under the cap's advisory key
   (7.9), the refusals of the last hour, and at `automation_rules().refusals_per_hour` (20) it is refused
   `refusals_capped`. `finalize` then
   rolls back to its savepoint and writes neither the match record nor a refusal: it sets `check_state` `capped`
   and leaves the row `processing`. The upload is not ready and cannot be posted; its status answers
   `processing`, which the composer shows as any upload that is still being processed, in 2b's own words;
   nothing is told to its uploader. The alert
   `matcher_down` goes out at once with the fact `refusalsCapped` (7.14). `match-retry` asks again for `capped`
   rows, oldest first, and finalizes each as this step does once the hour's count allows or the source's answer
   is `clear`: a person who read the alert has by then switched the matcher off, or left it on. A `capped` row
   is exempt from the sweeper's five-minute bound for a stuck upload while it is younger than `matchRetryHours`;
   after that it fails as any stuck upload. Refusals already written stay as they are.
4. **After a refusal's commit**, each in a try of its own (through `media.onMatch` with `{ kind: "refused",
   refusalId }`, since the media module mails nobody): the uploader's notice (7.12 step 1), and
   `moderation_urgent` to staff, whose count and oldest time now include the held uploads no admin has ended and
   those ended as `report`, not released, on which an objection waits (the message gains `heldUploads`). A held
   upload alerts once, at its refusal; after that it stands on the home screen (`home.uploads`).
   **The address.** The uploader is told in the same minute, and account deletion is immediate (1b). So the
   refusal's trigger `upload_refusals_hold` writes the account's row of `auth.report_holds` itself, as F's
   `report_open()` writes it for a seal taken while deciding and for the same seven days: F's function writes
   that row in its own body and offers nothing to call, so the trigger is a second writer and F 6.7's pin on
   the writers of `auth.report_holds` gains it (section 15 lists the pin under the 3f design). For those days
   the purge leaves the address, and F's deletion mail says so in its variant. Without it a report could name
   nobody. F's commands release the hold when the record that `upload-report` opens is sent or declined, and
   `upload_hold_end` releases it on "No report" when nothing else holds the address, and sets it again when
   an admin turns that end into "Report" inside its hours (7.12). Counsel's question
   2 of section 17 E covers it.
5. **Posting** attaches as today (`media/repo.ts:176`). The trigger `post_media_refused` refuses the update of a
   refused upload's `post_id` (an image that a row of `upload_refusals` names, whatever its end; an image row
   that is erased, which is what a replay leaves of a released upload whose refusal a restore lost; and an
   image row whose `hold_until` is `infinity`, which is what a replay leaves of a hold ended as `report` whose
   refusal a restore lost, 7.3);
   it does not refuse an image that only a flag's match record names; `attach` turns
   the raised `upload_refused` into the media error of that code (422), and the post's transaction rolls back.
   So no route, retry or later import attaches a refused upload, whatever the app sent. A flagged upload
   attaches as any. **A refused or held upload is in no reader and no export:**
   - the owner's status answers `refused` with the refusal's id and nothing else (10.2): no blurhash, no sizes;
     the composer never offers the image;
   - `pendingCount` leaves it out; `find` and the media repository's `EXPORTABLE` (`media/repo.ts:66`) leave out
     every image that a row of `upload_refusals` names, whatever its end, until the row is gone, so
     `readyImages`, `isExportable` and the export's `open` never take its file or list it. Today's predicate
     takes ready images "on a post or not", which a held upload is;
   - `serve` answers `not_found` for an image on no post, as today (`flows/serve.ts:37`);
   - `DELETE /api/media/:id` answers `not_found` for it, since gate K keeps the row.
   The uploader is told what the notice says and no more.
   **Removing an upload before its check.** While the matcher is not `off`, the owner's delete
   (`deleteUnattached`, `media/repo.ts:151`) does not remove a row that is still `processing` with a `pending`
   or `capped` check: it answers as today, the composer forgets the image, and the sweeper deletes the row as
   any unposted upload once `finalize` gave it a verdict (a failed or stuck upload goes by the sweeper's age
   bound as today). A row the check then matched with an acting match is held like any other.
   Otherwise an uploader who removes the image in the three seconds of the check would leave no record and no
   hold.
6. **An unanswered check.** The job `match-retry` (media module, a round a minute under the jobs' lock) asks again
   for every image whose `check_state` is `unchecked` or `capped` and whose row is younger than `matchRetryHours`
   (24), oldest first, at most `MATCH_RETRY_BATCH` (20) a round. Meanwhile an `unchecked` image is ready and may
   be posted: a third party's outage never stops korbat's images. After 24 hours the row stays `unchecked` for
   good. An answer:
   - `clear`: the state, nothing more;
   - `matched`, the image on no post: step 3.3's record and, for an acting match, its refusal and step 4. When
     an attach reached the row first, the refusal's insert is refused (`upload_attached`, a code no route
     answers) and the match takes the next path;
   - `matched`, the image on a post: the match record alone (a posted image is no upload to refuse), then
     `media.onMatch` with `{ kind: "posted", mediaId, matchId }` starts the automated step (7.9). The step's
     sweep finds the record should that call be lost.
7. **`matcher_down`.** Once a check has been unanswered for `matcherDownMinutes` (15) and none was answered since,
   `alert_steps()` writes the alert daily (facts `since`, `count`, and `refusalsCapped`, the uploads that wait
   under the limit on refusals). The first `capped` row of an hour writes it at once.

| Case | What happens |
|---|---|
| The matcher is switched on later | images uploaded before have no `media_hashes` row and are never checked: no backfill (section 4) |
| The matcher is switched off again | no new row. The retention job's step `tools_off` deletes every `media_hashes` row while `MEDIA_MATCH` is `off` (the one value a match rests on is in its match record), so the public text of `match.off` (korbat computes no fingerprint and keeps none from a time when it did, except the one in the record of a match) is true once the step has run (7.14); match records go by 7.14 |
| The classifier is switched off again | the same step sets `nsfw_score` null where no unhandled signal names the image |
| Two callers finalize one upload at once | both may ask the source; one transaction changes the row, the other writes nothing |
| The source answers `matched` with a classification it does not itself name child sexual abuse material (a wider "harmful" class) | a flag: the record with `listed` false, no refusal, no hold, no rule. Once the image is on a post a person reads it in the queue (7.9) |
| The source answers `matched` with a listed classification, and the match is `near`, or anything short of exact | a flag as well: the upload is accepted, and once it is on a post the finding citing R2 puts it before an admin, without a measure (7.9) |
| The source answers `exact` for a perceptual hash of a listed, acting classification | an acting match: refused and held. The words a person reads call every perceptual match "similar", never "the same" (10.2) |
| The source answers `matched` for everything, or for a picture that half of korbat uploads that day | 20 refusals in the hour, then `capped`: those uploads wait unposted and untold, and `matcher_down` says so at once |
| The uploader removes the upload during its check | the row stays until `finalize` has its verdict; an acting match holds it |
| A file that fails to decode | the result is `failed`; nothing is checked, and the row is swept as today |
| The same file uploaded twice | two rows, two checks, two refusals: korbat keeps no list of its own. So an upload refused once is refused again for as long as the source's entry stands, also after a hold ended as `no_report`; the notice says so (7.12) |

### 7.9 The automated step

A signal is one of two facts about one image that is on a post: a score at or over the threshold (`r1_score`), or
a match record (`known_match`). The step turns a signal into a finding and, where a setting allows, into one
protective measure. It never runs inside the transaction that created the post or stored the match (section 5,
the lock order), so an image can be public for seconds before a measure.

**What starts it.**

| Entry | When | For |
|---|---|---|
| `ModerationForSocial.imagesPublished(postId)` | `createPost` (`social/flows/posts.ts:35`), after its commit, when the post has images and a tool is on. The social module has no place to run a task unwaited for, so the member itself starts the step in the moderation module's `background` and returns at once: `createPost` never waits for a deciding transaction | scores; the match records of images that were flagged as uploads (7.8) |
| `media.onMatch` with `{ kind: "posted", mediaId, matchId }` | after the commit that stored a match for an image on a post (7.8 step 6) | matches |
| the job `automated-sweep` | a round a minute, in `moderation.startJobs`. **Each of its reads runs only while its adapter is not `off`**, so with both tools `off` it reads nothing, and no program opens a finding on a day on which `/rules` prints its tool as off | what a crash or a failed step left: every unhandled signal between one minute and 24 hours old, which is the moderation module's own read of its table `automated_signals`; and, through `MediaForCases.unsignalled(limit)`, the two reads of images: every posted image with an unerased match record that is not marked handled, and every image of a post created in the last 24 hours whose score is at or over the threshold and that no signal names. At most 20 a round |

**What "handled" rests on.** For a score it is the signal's row, and the sweep looks back 24 hours only. For a
match it is a mark on the match record itself (`media_matches.handled_at`, set in the step's transaction), not
the signal: the retention job deletes signals (7.14), and a record that is kept for as long as a seal for good
stands must never read as new again. So nothing the retention job deletes can make the sweep find a matched
image a second time, freeze its post again or seal what a person has answered.

The 24 hours bound a threshold's change: a new threshold version never reaches back over images posted before
it. A score counts only when `AUTOMATION_RULES.r1Threshold` is set (under `R1_CLASSIFIER=test`, the test
adapter's own 0.5 with threshold version 0, section 5); while it is null no score opens anything.

**The step**, for one image and one kind.

1. **The signal.** One statement: `insert into automated_signals ... on conflict do nothing` (`kind`, `media_id`,
   and `score` with `threshold_version`, or `match_id`). An image has one signal a kind for as long as the row
   is kept: the unique index is over all rows, handled or not (section 6.6), so a handled one is never written
   again beside it.
2. **One transaction** on the API's pool, with a `lock_timeout` of 10 seconds, run again up to three times on a
   deadlock or a lock timeout, as an intake is (`moderation/intake.ts:134`):
   1. the author's profile `FOR NO KEY UPDATE` (`social.lockAccounts`), the first lock as in every deciding
      transaction. Then the signal's row and, for a match, its record, read in a statement of their own after
      that lock: a signal that is handled, or a record that is marked handled, ends the step with nothing
      written. Three entries can start the step for one image at once, and this is how the second and the third
      end. No profile, a deleted post, an image that is gone or erased: `handled` `gone` (for a match, the
      record's mark too), and nothing else is written;
   2. **the finding**, written as the body of `recordIntake` writes a moderator's finding (C 7.1 step 4): the
      post's open case or a new one; one intake of the kind `automated` on the channel `system`,
      `automated_processing` true, no reporter, no contact, no `finding_by` and no text; one item about the post
      that names the image (`mediaId`); the case's hold on the post's images and its first snapshot. No item is
      added for a post it quotes: the signal is about an image of this post. What the intake cites follows the
      signal:
      - a score: rule R1, its default category, lane 2;
      - a match the source lists as child sexual abuse material (`listed` true), acting or not: rule R2, lane 0.
        An item citing R2 is suspect by 3c's trigger, so **from this commit the post is frozen**, whatever
        follows;
      - a match of any other class (`listed` false): **no rule**. The intake has the category
        `STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE`, sits in lane 2 as `laneFor` puts an item without a rule
        (`contracts/src/moderation.ts:106`), is not suspect, freezes nothing and alerts nobody. It is a flag in
        the queue: the row carries `matchFlag` (10.3), the chip is `queue.matchFlag`, and a person decides the
        case as any, without the image (7.11).
      The signal's `intake_item_id` is set and, for a match, acting or a flag, the record's `case_id` and
      `handled_at` (`MediaForCases.matchJoined(tx, matchId, caseId)`: the media module owns the table). The
      guard `automated_signals_guard` holds the tie between the two: when a `known_match` signal gains its
      `intake_item_id`, the item's intake cites R2 exactly when the record is listed (section 6.7);
   3. a savepoint;
   4. **the measure**, only when the rule's setting is on (`AUTOMATION_R1_ACTS` for a score; `AUTOMATION_R2_ACTS`
      for a match, and only a match whose `acting` is true: listed, and exact as rule 6 of this section's head
      has it):
      - a snapshot of the post as it stands, when the case's newest differs (as `takeSnapshot`,
        `moderation/cases.ts:607`);
      - the decision's row with `decided_by` null and the values of `AutomatedDecidedParams` (10.4): kind
        `interim`, outcome `restricted`, ground `incompatible`, the rule, the current rulebook and redress
        versions, the case's state version as this transaction reads it after the item joined, no text digest;
      - its one ledger row: `withhold_media` of the signal's image for a score, `seal_media` for a match (a seal
        covers every image of the post, C 6.2);
      - the signal's `decision_id`, `handled` `measure`;
      - last, the plain audit row (`appendAuditRow`): the system actor, `automated_decided`, target the case,
        metadata `{ params, decisionId, signalId }`.
   5. `decisions_record` refuses with `already_protected` (a seal in force already lists the post; for a score, a
      `withhold` of the post is in force, or a `withhold_media` for the image of every unanswered automated item
      of the case that cites R1) or `automation_capped`. Either rolls back to the savepoint: the finding stands,
      and `handled` is `covered` or `capped`. Without a measure for any other reason (the setting is off, the
      match is not acting) `handled` is `finding`. **The cap has four limits**, each read under the one advisory
      key, and the first three are counted **for the decision's rule alone**, so that a burst of R1 scores can
      never use up the seals of known matches:
      - the hour's and the day's decisions without a decider under that rule: 20 and 100 for R1
        (`decisions_per_hour`, `decisions_per_day`), 20 and 100 for R2 (`r2_decisions_per_hour`,
        `r2_decisions_per_day`);
      - the measures of decisions without a decider under that rule that are **in force and unanswered**: at
        `unanswered_max` (20) no new one is taken;
      - under either rule, an objection (7.10) that has been unanswered for longer than `unanswered_hours` (72).
      The last two end nothing and only stop new measures: when no person is there to answer, the program falls
      back by itself to what the setting's other value is, a finding without a measure.
   6. At commit `decision_holds` passes only for exactly this shape (section 6.6): no decider, `fully`, interim,
      one measure of the kind its signal's kind allows, the system's audit row naming the decision and its one
      signal, that signal about an image of the case's post, and, for a `seal_media`, a match record whose
      `acting` is true: the database, not the API, holds that a flag seals nothing. Anything else is
      `invalid_decision` and nothing commits.
3. **After the commit**, each in a try of its own:
   - with a measure: the author's statement (`sendStatement`, as after any decision; 7.10);
   - for R2: `alertUrgentLane` (`moderation/alerts.ts:44`), as for any finding citing R2. A flag that cites no
     rule alerts nobody: it stands in the queue and is counted on the home screen (`automated.flags`, 10.3);
   - when capped: `staffAlert` with `automation_capped` (key `automation-capped`, at most once an hour; facts
     `at`, `limit`, one of `CAP_LIMITS` (`hour`, `day`, `unanswered`, `waiting`), and `count`, the findings that
     stand without a measure since the cap was met);
   - the trigger of 7.4 has written the image's outbox rows; F's `report_open()` has opened the owed record of a
     report for the automatic seal's row, as for any seal (F 7.13), and with it the account's address hold. So a
     program's seal does start something about the account: the statement does not say "does nothing to your
     account", it says that a program does not suspend, limit or end the account and that korbat keeps what a
     report would need while images are sealed (section 18).

**What the measure is.** A decision of 3c's ledger like any other: `automated_detection` true, `automated_decision`
`fully`, source `own_initiative`, `author_mail` pending. It is of the kind `interim`, so 3c's rules apply as built:
it ends with the case's final decision, a seal with the answer to the case's suspect items; a correction lifts it
at once; it is never due a strike (E 6.2) and never appealed, since the open case is the person's intervention and
the final decision is appealable (7.10).

**With the settings as shipped** (`AUTOMATION_R1_ACTS=off`, `AUTOMATION_R2_ACTS=on`): a score opens a finding in
lane 2 and hides nothing; an acting match on a post freezes it, seals its images and wakes the phone on call; a
match of a listed class that is not exact freezes and alerts and seals nothing; a match of any other class is a
flag in lane 2 that freezes nothing and wakes nobody. `AUTOMATION_R2_ACTS=on` has no effect by itself: with a
real matcher the API starts only when the impact assessment that covers the measure is dated
(`AUTOMATION_DPIA_MATCH_ACTS`, 10.8), which the owner sets with counsel's word (section 2, row 27). The
setting's other value is the design's fallback: an acting match only raises the urgent item, and a person takes
every measure.

| Case | What happens |
|---|---|
| Two images of one post score over the threshold | two signals, two findings on the post's one case, two decisions, two statements; each counts against the cap |
| A second matched image on a post the program sealed | `already_protected`: a finding, `covered` |
| A moderator is deciding the case when the finding arrives | their confirmation meets a new state version (`case_changed`); the console reads the case again, as after any new item |
| The post is deleted between the post's commit and the step | `gone`; for a match the record stays and is erased on its schedule (7.14) |
| The step fails three times | the signal stays unhandled; the sweep tries it each minute for 24 hours, then leaves it, and `staff.js automation-status` counts it |
| The classifier's worker is compromised and scores everything high | every new image gets a finding in lane 2; with `AUTOMATION_R1_ACTS=on` the first 20 an hour are also withheld, then `automation_capped` (section 11.2). The seals of known matches are counted apart and go on |
| Twenty R1 decisions in the hour, then an acting match on a post | the post's images are sealed: the cap that was met is R1's |
| The one admin is away for ten days | after 20 unanswered measures of a rule, or once a request for a person has waited 72 hours, the program takes no new measure under that rule (or under either); findings still open, the alert says which limit was met, and the rules page's sentence on the cap says the same |
| The retention job deleted a match's signal while its record is kept | the record is marked handled; the sweep does not read it again |
| A person already withheld the post | `already_protected` for a score; the finding joins the open case |
| An image that was flagged as an upload is posted | `imagesPublished` starts the step for its match record; within seconds the finding stands, citing R2 for a listed class and no rule otherwise |

### 7.10 What the author reads, and "Ask for a person"

**The statement.** A decision without a decider has no staff text; `statementParagraphs` renders it from
enumerated fields alone. `DecisionStatement` gains `automatedDetection`, `automatedDecision` and `signal` (10.2):
for an automated finding its kind and, for a match, the source's name, whether the fingerprint is the same or a
similar one, and whether the source lists it as child sexual abuse material; for a person's decision after a
score, whether that person opened the image (`viewed`). "The same" is said only of a cryptographic hash: the
statement's `matchKind` is derived, `exact` for an exact match of a cryptographic hash and `near` for every
perceptual match, whatever the source called it, since an equal perceptual hash says that two pictures
resemble each other and not that they are one file. The statement holds no score, no hash, no hash type, no list
version and no classification string. The automation paragraph is one of `STATEMENT_WORDS` (section 18), chosen
from the decision's own columns, so every statement reads as sent:

| Decision | Automation paragraph | With |
|---|---|---|
| no decider, a score | `automated.fully.r1` | `automated.until.r1`, `source.automated`, `automated.ground`; redress `askPerson` |
| no decider, a match | `automated.fully.match`, `automated.notAssessed` | `automated.until.match`, `source.automated`, `automated.ground`; redress `askAdmin` |
| a person's, `automatedDetection` true, `not_automated`, a score | `automated.found.r1`, ending `.viewed` when `signal.viewed` is true and `.unviewed` otherwise | `source.automated` |
| a person's, `automatedDetection` true, `not_automated`, a match | `automated.found.match`, `automated.notAssessed` | `source.automated` |
| a person's, `partially` | `automated.partly`, `automated.notAssessed` | `source.automated` |
| any other | 3c's `automation` ("No automated means were used to find this or to decide it.") | |

No sentence says more than is known: a match's says that an automated comparison found the same, or a similar,
fingerprint as one the source, by name, has classified, that korbat's staff do not open an image found this way
and that korbat has not assessed it. That second clause is true after every answer, since the image stays
closed to staff (7.11). It never says that the image "is" such material, that korbat "confirmed" it, or that the
account "posted" it. A match of a class the source does not name child sexual abuse material (`listedAs`
`other`) reaches a statement only through a person's decision that considered the flag, and its sentence says
that the source lists the image and not as what. A score's says that a program rated the image as likely within
rule R1. A person's decision after a score says "a moderator looked at the image" only when the record shows
it: `viewed` is true when an `image_viewed` row of 3c's access log exists for the decider and the signal's image
on this case before the decision's time and the decision is not stored as `unseen`; otherwise the sentence is
"a moderator took this decision without opening the image". A program's measure is never worded as a finding:
its statement names the rule it was taken under, never "It breaks". The table test of section 12 renders every
row, both endings, and fails on those words.

**The reporter is told the same of the decision.** 3c's update to whoever reported (`notice_update`, and the
status page of a report) prints one fixed sentence, "No automated means were used to decide", from no field of
the decision. Its line gains the decision's `automatedDecision` (10.2): for `partially` the sentence is
`update.automated.partly` (the decision rests in part on an automated comparison of fingerprints; an admin took
it without opening the images), with no source's name; otherwise 3c's sentence stands. DSA Art. 16(6) asks for
it, and the two texts about one decision then agree.

**Told at once.** The decision is its author's from its commit: `informed_at` is forced by `decisions_record`
step 10, as for any decision, `GET /api/moderation/cases` lists it (`byProgram` true), `GET
/api/moderation/decisions/:id` answers it, and the mail is 3c's `moderation_decision` with the statement's
paragraphs. A pending mail is the dispatch job's, as for any decision. Step 10 is unchanged, so under F's hold a
program's decision about a post with an untold order is untold too, and nobody can ask for a person about a
decision they cannot see; both follow at F's release.

**Ask for a person.** `POST /api/moderation/decisions/:id/objection`, behind `requireSession`, body
`ObjectionRequest { text }` (1 to 2000 characters, 10.2). **A suspended account may ask.** The two objection
routes of 3d (this one and 7.12's) join the writes that E's suspension leaves, as the reply and an appeal are
left, for a suspended account and for a terminated one whose termination is not yet final: each gets its row in
E's route table (section 15 names it under E 7.3), and a test of each sends the objection from a suspended
account. The people a program's seal reaches are often those whose other post an admin has just sealed.

1. The decision is read for its subject alone; for anyone else, and for a decision that does not exist, the
   answer is `not_found`, as `authorDecisionView` answers (`moderation/author.ts:117`).
2. One statement inserts the row of `automated_objections`. Its trigger refuses with `objection_not_open` unless
   the decision has no decider and a measure of it is in force; a second text for the same decision meets the
   primary key and is answered with the same code. Nothing stores "answered": an objection is unanswered while a
   measure of its decision is in force.
3. After the commit: `staffAlert` with `automated_objection` (key `automated-objection`, at most once in 15
   minutes; facts `at`, and `count`, the objections unanswered).
4. The answer (201) is the decision as it now reads: `askPerson` (10.2) is `asked` with the text and its time.

**What answers it.** The case sorts first inside its lane, before age (`queueRows`, `moderation/repo.ts:1402`; the
cursor carries the mark, so pages stay stable; `MODERATION_DEFER_UNPROVEN` never moves it down), with the chip
`queue.objected`; the case page shows the text above the evidence (`CaseView.objection`). Then one of two things,
both 3c's and both a person's confirmed `case_decided`:

- **A correction** of the automated decision that lifts its measure (`restore_media`, with the moderator's own
  reason): any moderator for a withheld image, an admin for a seal (`unseal_media`), as 3c's rules on who lifts
  what already say.
- **The case's decision**, final, of any outcome: the measure ends with it by 3c's derivation.

Either way the author gets that decision's statement, and `askPerson` reads `decided` with that decision's id.
There is no lapse by time: a timer would be a second automated writer. The published target is
`AUTOMATION_RULES.objectionTargetHours` (24); once an objection is unanswered for longer, the sweep of 7.9 writes
`automated_waiting` daily (7.14; facts `count`, `oldestAt`). What time does change is the program, not the
measure: once an objection has waited longer than `unansweredHours` (72), or `unansweredMax` (20) measures of a
rule stand unanswered, the program takes no new measure (7.9 step 2.5), so that its word is not the only one
for longer than the people who answer can be away.

### 7.11 A person's decision after a signal

1. **What the person sees.** For a finding citing R1: the image, through gate V as for any report, and the words
   `case.r1` ("over the threshold", with the threshold's version), never the score: a number beside an image
   reads as a verdict. For a finding on a match, citing R2 or no rule: no image, and the match's record
   (`CaseView.signals`): the source, its list version, the hash type, the kind of match, the classification as
   returned, the time, whether the source lists it as child sexual abuse material and whether it is acting. No
   answer carries a hash value.
2. **An image found by a match is never opened by staff, whatever the answer.** `staffImage`
   (`media/cases.ts:78`), the one function that serves staff an image, refuses an image that an unerased row of
   `media_matches` names: on every case, frozen or not, before and after an admin's answer, for an acting match
   and for a flag. The image route for staff answers `image_matched` (10.7), and the case shows
   `case.image.matched` in the image's place. 3c's rule that after an answer without a seal whoever is on duty
   "may, and must the same day" open the case's images does not apply to such an image (section 15 amends C 6.1
   and 7.5); it stands for every other image of the case. The refusal ends when the match record is erased
   (7.14), which is when korbat no longer knows that the image was matched.
3. **Who decides.** A moderator decides a case with an R1 finding as any case, and a case with a flag that cites
   no rule as any case too: by the post's text, its reports and the record, closing the item with no action or
   opening a finding of their own under a rule; a finding citing R2 is 3c's and makes the case an admin's. A
   case with an unanswered suspect item is an admin's, as 3c built it: the admin seals for good or answers
   without a seal, unseen. The facts draft of a seal that rests only on automated findings is
   `SEAL_DRAFTS.facts.match_post` (section 18), which says what the comparison found and not that anyone
   reported the images.
4. **An answer without a seal on an acting match names its reason.** It puts an image with an exact match back
   before everyone with nobody having looked. So `CaseDecidedParams` gains `matchAnswerReason`, one of
   `MATCH_ANSWER_REASONS` (`source_withdrew`, `counsel`, `other`) and set exactly when the decision is final,
   holds no `seal_media` and considers an automated item whose match is acting; `decision_holds` (c) refuses
   `invalid_decision` otherwise, at commit, and the decision's row keeps it (`decisions.match_answer_reason`).
   The check sits there and not in `decisions_record`, which runs before the decision's actions exist and
   cannot know whether the decision seals. `other` rests on the operator's notes, as a hold's end does. A
   flag's answer needs none.
5. **What the database records**, forced in `decisions_record` whatever the request says:
   - `automated_detection` is true when an item the decision considers is of an `automated` intake;
   - `automated_decision` is `partially` when the decision restricts, is suspect and considers an automated
     intake citing R2: the person cannot look, so the comparison is a fact the decision rests on. It is
     `not_automated` otherwise. No decision with a decider can read `fully`;
   - a review or a correction takes `automated_detection` from the decision it reviews.
6. **What ends.** The final decision ends the program's measure (`ended_interim`). An admin's seal for good
   replaces the automatic one and starts 7.1. An answer without a seal ends the seal and the freeze: the images
   are served again as before to everyone the post is shown to, **and the matched image stays closed to staff**
   (step 2). 3c's mail `moderation_csam_lifted` goes to every staff account as after any such answer, in a
   variant for a case whose finding came from a match (`StaffMessage`'s member gains `matched: true`): it leaves
   out "staff may open them" and the look of the same day, and says that the images are served again and that
   nobody at korbat opens an image found by a match, also after this answer. The variant carries no reason:
   the message's member is the one boolean, and the reason the admin gave is on the decision, where the
   console shows it (section 18). The console's sentence for the admin on such a case says the same
   (section 8). The residual is stated in
   11.3: after an answer without a seal a matched image is public and no person at korbat has seen it.
7. **Everything after is unchanged:** the statement, the author's appeal of a final restriction, E's strike rule
   on the person's decision (never on the program's), F's record of a report for a seal for good.

### 7.12 A refused upload: the hold and its two ends

A held upload is a record of its own, `upload_refusals`, not a case: a case's target is a post or an account, and
the upload is neither.

1. **Told at once.** From the refusal's commit (7.8) the uploader's notice exists: `GET /api/moderation/notices`
   lists it and `GET /api/moderation/uploads/:refusal` answers `UploadRefusalView` (10.2), for the uploader
   alone. The mail `upload_refused` carries the notice's paragraphs and no link; `told` records its outcome, and
   a pending one is the dispatch job's. The notice (`UPLOAD_NOTICE`, section 18) is rendered fresh from the
   refusal's row and its match, so its state paragraph follows the hold. It says: not accepted; that automated
   means did this and no person took part, with the comparison and the source's name; that korbat's staff do not
   open the file and korbat has not assessed it; rule R2, which is true of every refusal, since only a match of
   a class the source names child sexual abuse material refuses (7.8); that the upload stays not accepted and
   that korbat's staff cannot accept the image, since nobody opens it; that an admin decides, unseen, what
   happens to the held file; and the redress `uploadObject`. The uploader is told this and no more: the held
   file is in no reader and no export (7.8 step 5).
2. **Object.** `POST /api/moderation/uploads/:refusal/objection`, `ObjectionRequest`, open to a suspended account
   as 7.10's route is. **An objection is open** while the refusal has none, its `release_id` is null and its
   `end_as` is not `no_report`: one rule, which the route's WHERE, the guard `upload_refusals_guard`, the app's
   control and the notice's paragraph `object` all state. So a person who reads the notice after an admin chose
   `report` can still be heard: the report is made by hand afterwards, and a hold ended as `report` can still
   end as `no_report`. One statement (`MediaForCases.objectToRefusal(ownerId, refusalId, text)`: the media
   module owns the table) sets `objection` and `objected_at` under that rule; `objection_not_open`
   when it changed no row of theirs, `not_found` for anyone else's. An objection that arrives after `report`
   shows on the console's row and is counted in `heldUploads.objected` and in `moderation_urgent`'s
   `heldUploads`.
3. **The console.** `GET /api/staff/uploads` answers `UploadsPage` (10.3): the refusals whose hold has not ended,
   oldest first; then those that ended as `report` and are not released, for as long as that lasts (each can
   still take an objection, a later `no_report` or a release); then those released or ended as `no_report` in
   the last 30 days; each with its match record, the objection, its state,
   whether the uploader's account still exists, and no image, hash, file name or handle. `otherRefusals`, the
   one thing the admin is given about the person, counts the same uploader's other refusals **whose hold has
   not ended or ended as `report`**, never one ended as `no_report`: a mistake of the source that an admin has
   set aside does not weigh on the next decision.
4. **Ending the hold.** `POST /api/staff/uploads/:refusal/end`, step-up `upload_hold_ended` with the refusal as
   its target, params `UploadHoldEndedParams` (`endAs`, and `reason` exactly when `endAs` is `no_report`). One
   confirmed transaction: the uploader's profile `FOR NO KEY UPDATE` when the refusal still names one; `select
   public.upload_hold_end(refusal, end_as, reason, staff)`; last, `append_confirmed_audit`, whose metadata
   carries the upload's `mediaId` beside the params (a restore may hold the image and not the refusal, 7.3).
   **The route and the screen instruct nothing about reporting:** the request names its end, neither value is a
   default, the console preselects neither and words both neutrally, and what counsel advises on when a match
   obliges a report stands in the runbook, not on a button (section 8; section 17 E). The function refuses an
   end the refusal's state does not allow (`hold_not_open`: an open hold may end either way; a hold ended as
   `report` and not released may later end as `no_report`; a hold ended as `no_report` may be ended as `report`
   while its `hold_until` lies ahead; and nothing else), anyone but an admin (`admin_required`), and an end
   without its reason or with one too many (`invalid_hold_end`). At commit `upload_refusals_confirmed` holds the
   end to its audit row, or the commit is refused `release_mismatch`. After a restore the same call closes the
   open gap that the lost end of this refusal's hold left, with the disposition `reapplied` (7.3).
   - **`report`:** the hold stays (`hold_until` `infinity`). `quarantine_plan()` lists the upload's files under
     `in` (7.1). `staff.js upload-report <refusal> --duty <duty>`, as the migrator, opens F's notification record
     for the uploader's account without a case and stores its id on the refusal (through the media module's
     plain function `refusalReported(tx, refusalId, notificationId)`); the operator reports and records it with
     F's commands (F 7.13). The refusal keeps the account's id when the account is deleted: no profile row is
     ever deleted, the purge anonymises it, and for seven days from the refusal its hold keeps the address (7.8
     step 4). After that a report carries the file's facts and times and an account that names nobody; the
     console's row says so (`uploaderGone`). The retention job never clears the `owner_id` of a refusal that
     ended as `report` and is not released (7.14), so the command finds the id; should a refusal name none all
     the same, it opens the record without an account (F's column allows it, or F is amended: section 15).
     Nothing is mailed: the notice's state paragraph, rendered fresh, says that the file is kept only for the
     authorities korbat reports it to. **When this `report` follows a `no_report`, inside that end's hours,**
     `upload_hold_end` also sets the hold on the uploader's address again, which it released at the first
     end, so that the address is there for the report. The hold counts from the refusal as before (its
     `set_at` is the refusal's time, section 6.7), so it runs for what is left of the seven days that the
     notice and the terms state and never longer; where the account was deleted and purged in the hours
     between, the address is gone, and a report carries the file's facts and times alone, as the console's
     row then says (`uploaderGone`).
   - **`no_report`**, with a reason of `UPLOAD_END_REASONS` (`source_withdrew`, `counsel_no_duty`, `other`):
     `hold_until` becomes now plus `noReportHours` (24), not now. For those hours the file exists, the
     uploader's notice still reads as held, and another admin who reads the alert can end the hold as `report`
     instead. With this end `upload_hold_end` releases the hold on the uploader's address (7.8 step 4) when
     nothing else holds it: no record of the account is owed and no other refusal of the account is unended;
     an end as `report` inside those hours sets it again (above).
     Then the sweeper deletes the row as any upload nobody posted (`media/sweeper.ts:52`) and asks the
     worker for its files; a file that had gone to the quarantine is a `destroy` line (7.1). The mail
     `upload_hold_lifted` is the dispatch job's once `hold_until` has passed (7.14), and only from then on the
     notice says that the hold was lifted and the file deleted. It also says, by the reason, what the person
     can do: after `source_withdrew`, that the image can be uploaded again; otherwise, that the image is still
     not accepted while the source's list holds a matching entry, and that the source is the body that can
     correct an entry.
   - **Every staff account is told of a `no_report`**, the admin's own included: the alert
     `hold_ended_unreported` (10.1; facts `at`, `until`), after the commit, without a throttle, and the home
     screen lists every such end of the last 30 days beside the releases (`StaffOverview.destructive`). "No
     report" deletes what a report would have carried, so it is no quieter than 3c's lifting of a seal unseen.
5. **The release of a held upload.** `POST /api/staff/uploads/:refusal/release`, step-up `upload_released`, params
   `UploadReleasedParams`. `upload_release(refusal, basis, leave, staff)` is `seal_release`'s steps 2 to 5 for the one
   image, with the facts read from the record that `notification_id` names: reported, quarantined, and a leave
   recorded for that record and not withdrawn (or the unset period). The answer is no ground here either (7.2). It writes the
   `releases` row and the refusal's `release_id`, and sets `erased_at` and `hold_until = now()` on the image
   row; `releases_confirmed` holds it to its audit row, whose metadata carries `mediaId`. What follows is 7.2's:
   the notice, worded and held as there (for an upload two of `release_tellable`'s three conditions can hold
   it: the leave's `untold`, and F's mark `not_to_person` on the record that `notification_id` names), the
   alert `seal_released`, the `destroy` lines, the record, `release_undestroyed`.

Nothing else follows a refusal: no case, no strike, no suspension. **And no mark on the account that outlives
the matter:** when the retention job erases a refusal's match record (7.14), it clears the refusal's `owner_id`
and its objection in the same step, so the row keeps its times and its end and names nobody. It erases that
record `matchKeepDays` after the hold ended as `no_report` or the refusal was released, and never while the
hold is unended or ended as `report` and not released: for as long as korbat keeps a file for the authorities
the refusal names its uploader, and F's record of the report names the account for as long as F keeps that
record. The notice and the terms say both. What a refusal leaves behind is so what the person was told. Until
then the admin sees how many other uploads of the same uploader were refused and not set aside, as a count.

| Case | What happens |
|---|---|
| The uploader deletes their account while an upload is held | gate K keeps the row (`hold_until`); the refusal keeps the account's id, which is then the id of an anonymised profile; the refusal's hold on the address (a row of F's `auth.report_holds`, 7.8 step 4) keeps it for seven days from the refusal; the notice has no reader, and the two ends stay the admin's |
| The uploader removes the upload in the composer | `not_found`: the row is kept, and the composer shows the refusal |
| Nobody ends the hold | it has no end by a timer; the home line counts it, and its age shows on the list |
| The source withdraws its entry | an admin ends the hold as `no_report` with `source_withdrew`; the notice then says that the image can be uploaded again |
| An admin chose `report` at eight, and the uploader reads the notice at nine | "Object" is open: the refusal has no objection, is not released and did not end as `no_report`. The objection shows on the console's row and in the urgent alert's count |
| An admin ends a hold as `no_report`, and a second admin disagrees within 24 hours | the second ends it as `report`: `hold_until` is `infinity` again, the hold on the uploader's address that the first end released is set again for what is left of its seven days from the refusal, the uploader was told nothing in between, and both ends are audit rows |
| A stolen admin's key ends every hold as `no_report` | each end mails every staff account at once and stands on the home screen for 30 days; the files exist for 24 hours more |
| The person uploads the same picture again after `no_report` | refused again while the source's entry stands (7.8); the notice said so, and an end of a hold is no decision of the ledger and has no appeal, which the terms say (section 18) |
| A suspended account objects | allowed: the route is one of the writes E's suspension leaves |

### 7.13 The flag "possible coordinated reporting"

1. `case_flag(case)` answers `coordinated`, `items` and `reporters`, computed at read from rows 3c already keeps:
   at least `SIGNAL_RULES.minItems` (5) unanswered items of the case, from at least `minReporters` (5) distinct
   signed-in reporters, arrived within `windowMinutes` (60), and at least half of those reporters follow or are
   followed by another of them. A signed-out notice has no account and is not in it.
2. The queue (`moderation/cases.ts:248`) asks it for the cases of its page in one statement, the case answer for
   its case. A flagged case carries `flag` (`{ items, reporters }`, 10.3) and shows `queue.flag` and `case.flag`.
3. **Nothing else reads it.** It is no key of the queue's order, closes no item, touches no reporter, is stored
   nowhere and is named in no decision. It never names a reporter: the counts are all a moderator sees, and a
   reveal stays 3c's confirmed action. When retention forgets who reported, the flag goes dark by itself.
4. `CaseItem.sameSourceOpen` is the one other aid: how many other unanswered items the same signed-in reporter
   has on other open cases, as a count (`case.sameSource`). It batches nothing: each case is decided on its own,
   and E's mark "manifestly unfounded" answers one reporter's many items.
5. This flag is not the flag of a match (7.9). That one is an automated finding of its own in the queue
   (`QueueRow.matchFlag`); this one is computed at read and stored nowhere (`QueueRow.flag`). Neither orders the
   queue above its lane's other cases by itself, and what a moderator makes of either chip the design cannot fix:
   its sentence says that it is no finding, and the moderator still judges the content itself.

### 7.14 What each job gains, and retention

Every job runs in the API under the jobs' shared lock (`lib/jobs.ts:81`), on one instance at a time, a round
counted from the end of the one before. With every adapter off each new job's round is a read that finds nothing.

| Job | Module | Round | Does |
|---|---|---|---|
| `edge-purge` (new) | media | 15 s | 7.4: closes outbox rows as `off`, or sends one purge |
| `match-retry` (new) | media | 60 s | 7.8 step 6: asks again for `unchecked` and `capped` images of the last 24 hours |
| `automated-sweep` (new) | moderation | 60 s | 7.9: unhandled signals and facts without a signal, each read only while its adapter is not `off`; `automated_waiting` |
| `transparency` (new) | transparency | 10 min | the month's close (7.5); once a day after `MODERATION_DISPATCH_HOUR`, the editions (7.6) and the head (7.7). Each daily part is idempotent by its table's key, so a round that runs it again writes nothing. It is the transparency module's own job (`startJobs(jobLock)` in `index.ts`), not a step of the dispatch job |
| `moderation-dispatch` (C 7.8) | moderation | 10 min | one more step, `notices`, before the statements: the pending mails of refusals (`upload_refusals.told`, read and recorded through `MediaForCases.refusalsUntold(limit)` and `refusalTold(refusalId, outcome)`), of holds lifted whose `hold_until` has passed, of lost images (`quarantine_files.lost_told`, read and recorded through `MediaForCases.lostUntold(limit)` and `lostTold(mediaId, outcome)`, 7.1), and of releases (`releases.author_notice`), each recorded as a statement's mail is and given up after 5 days as 3c gives up. A release's notice that is `held` becomes `pending` in the round in which `release_tellable` answers true (7.2), never earlier |
| `alert-tick` (F 7.2) | moderation | 30 s | `alert_steps()` now also writes `quarantine_due`, `release_undestroyed` and `matcher_down`; the tick mails every kind of 3d, since each has `mail: "sentence"` |
| the media sweeper (2b) | media | 30 s | no new step: gate K keeps a held upload's row while `hold_until` lies ahead, and the sweeper deletes it as any unposted upload once the hold has ended |
| the retention job (C 7.9) | moderation | 10 min | the three steps below |

**Alerts a job writes** (`edge_purge_failed`, `head_unwitnessed`, `head_missed`, `automated_waiting`) are that
job's own insert into F's `alert_outbox` under F's daily rule: no row of the kind was created in the last 24
hours. F's two legs do the rest. `automated_objection` and `automation_capped` follow a commit and go through
`staffAlert` with a throttle key (7.9, 7.10). `seal_released` and `hold_ended_unreported` follow an admin's
confirmed commit and go through `staffAlert` without a throttle, to every staff account, the actor included
(7.2, 7.12). `quarantine_lost` is written by `quarantine-record` with its record (7.1). `matcher_down` is also
written at once by the first `capped` upload of an hour (7.8).

**The retention job's new steps**, each a transaction of its own that ends with a `moderation_retention` audit row
when it changed anything (metadata: the step and the count). The first two are held by
`MODERATION_RETENTION=off`; the third is held by nothing but its tool's setting:

| Step | Call | What it does |
|---|---|---|
| `automation_records` | `erase_automation_records()` | erases a match record (`hash` and `classification` null, `erased_at` set) `matchKeepDays` (180) after its case closed, its refusal's hold ended as `no_report` or its refusal was released, or, for a flagged upload that was never posted, after the record was made (`queried_at`); never while its refusal's hold is unended or ended as `report` and not released, and never while a seal for good in force lists a post of its case **that is not in `release_posts`**: for a released post the 180 days run from the release, as for a released upload. With a refusal's match record it clears the refusal's `owner_id` and erases its objection (7.12). It erases an objection's text with its decision's texts, on 3c's schedule. It deletes a handled `known_match` signal only when its match record is erased, and a handled `r1_score` signal when its intake is erased or, when it was handled as `gone`, `matchKeepDays` after that: a match's "handled" is the record's own mark (7.9), so no deletion here can make the sweep act twice |
| `edge_purges` | one delete | rows `EDGE_RULES.keepDays` (30) after `done_at` |
| `tools_off` | the media module's two statements (`MediaForCases.forgetHashes()`, `forgetScores()`) | while `MEDIA_MATCH` is `off`: deletes every `media_hashes` row. While `R1_CLASSIFIER` is `off`: sets `post_media.nsfw_score` null where no unhandled signal names the image. So what `/rules` and the terms say of a tool that is off (`TOOL_TEXTS`' `match.off` and `r1.off`: no fingerprint is computed and none is kept from a time when one was, but for the one in a match's record; no image is rated and no rating is kept) is true once the step has run; while a tool is on, its rating or fingerprints are kept as long as the image, which the retention list says |

What no job erases: `releases`, `release_posts`, `release_leaves`, `release_notices` and `quarantine_files` (the
proof of a destruction and of the word it rested on, kept as F keeps its records); `transparency_editions`,
`recipient_months` and `head_publications` (public record). `media_hashes` goes with its image row, or with its
tool. The row of `upload_refusals` stays after its hold, with its times and its end and, after 180 days, no
account and no objection. The sketches in Valkey end by 7.5.

### 7.15 Mails and alerts

**To a person.** Each is sent after its commit, in a try of its own, through the auth module's `mailAccount`; a
mail to an account that no longer exists is not sent, and none carries a link, a staff handle, an authority's
name, assessment or answer, a reference, a hash or a file's name. Each new template is a member of the closed
union `AccountMessage` (`auth/flows/notifiers.ts:49`) and a `TemplateName` (`mail/mailer.ts:1`), sent through
`AuthForModeration`; the moderation module names no address.

| Template | Sent when | Body |
|---|---|---|
| `moderation_decision` (3c's) | a decision without a decider commits (7.9), unless F's hold makes it untold | the statement's paragraphs; its subject names the hidden image or the sealed images "until a person decides" |
| `upload_refused` | a refusal commits (7.8) | `UPLOAD_NOTICE`'s paragraphs as they stand |
| `upload_hold_lifted` | a hold ended as `no_report` and its `hold_until` has passed (7.12) | `UPLOAD_NOTICE.ended.noReport`, by the end's reason |
| `release_notice` | a release commits (7.2, 7.12), unless its notice is `held`; then when the hold ends, also for a replayed release that a restore found still held (7.3) | `RELEASE_NOTICE`'s paragraphs: what korbat did and that a leave or an instruction is its ground, never an assessment |
| `image_lost` | the dispatch round after `quarantine-record` wrote `lost_at` for a file of an image that is on a post and not sealed for good (`lost_told` `pending`, 7.1, 7.14) | `IMAGE_LOST_NOTICE`: korbat lost the image's files while they were kept apart; it cannot be shown again; the post can be deleted or the image posted again |
| `release_day` | never in 3d (7.2, the ground `period`) | `RELEASE_DAY_NOTICE` |

**To whoever reported.** 3c's `notice_update` and the status page of a report print, for a line whose decision
is `partially` automated, `update.automated.partly` in the place of 3c's fixed sentence (7.10).

**To the keeper.** `head_published`, daily, to `HEAD_KEEPER_MAIL` alone, through `mailKeeper` (7.7).

**To staff.** Twelve kinds join `ALERT_KINDS` (10.1), each with a push and a mail that are its one sentence of
`ALERT_TEXTS`, carrying counts and UTC times and nothing else; each mail is a member of `StaffMessage`
(`notifiers.ts:70`). A match raises F's `moderation_urgent` and no kind of its own: on a post through the
finding citing R2 (7.9), for a held upload through the same alert with `heldUploads` (7.8); a flag that cites no
rule raises none. 3c's `moderation_csam_lifted` gains its variant for a case whose finding came from a match
(7.11).

## 8. The console and the command line

3c 8, 3e 8 and 3f 8 stay whole: text-only rendering, one CSS file, every answer parsed with the contracts' schemas,
the key asked only after the console checked what it signs, no link into the app, every screen usable at 360 px.
3d adds one route, the members listed in 8.1 and words. Every sentence below is a member of `CUSTODY_WORDS` (the
quarantine, the release, held uploads) or of `AUTOMATION_WORDS` (a program's findings and measures, the objection,
the flag, the edge purge) in `apps/admin/src/messages.ts`, under the key in brackets. Every number in one is printed
from the answer or from a constant of section 10 (`AUTOMATION_RULES`, `RELEASE_RULES`, `SIGNAL_RULES`, the header's
constant), never typed, so the table test of section 12 can hold them.

Four rules hold for every screen of 3d.

1. **No image, ever.** No screen of 3d requests, draws or links an image of a sealed post or of a held upload: the
   console's fixture of the browser check fails on any image request from these screens.
2. **An image that a match names is closed to staff, whatever was answered** (ruling 2 of the review). The one
   function that serves staff an image refuses an image that an unerased match record names, on every case, with
   the code `image_matched`. The console offers no reveal control for such an image and prints [case.image.matched]
   in its place (8.4), also after an admin has answered without a seal and the image is served to everyone again.
3. **A third party's words are framed.** A source's name, its list version and its classification come from an
   adapter, so from outside korbat. They are drawn through `UserText` inside a frame labelled "As the source
   returned it", never in the console's own label positions, with 3c 8's "Show hidden characters".
4. **The console instructs nothing about reporting** (ruling 7 of the review). Where an admin ends a held upload, the two
   choices are worded as what each does, neither is preselected, and no sentence says which to take: what counsel
   has advised korbat is in the README's runbook (W.11), which the owner writes into, not on a button.

### 8.1 What the console reads

- **Router.** `uploads` (`/uploads`). `ConsolePath` gains `"/uploads"`. The navigation gains "Held uploads" after
  "Appeals". The release has no route: it is a block of the case page and of a held upload's block.
- **Home** reads four new members of `StaffOverview`: `quarantine` (`dueIn`, `dueOut`, `undestroyed`, `oldest`:
  the four values of `quarantine_counts()` and nothing else), `automated` (`waiting`, `oldestAt`, `objected`,
  `oldestObjectionAt`, `flags`, and up to 20 case ids of each of the first two), `heldUploads` (`open`, `oldest`,
  `objected`, `capped`), and `destructive`: the releases and the holds ended as `no_report` of the last 30 days,
  at most 50, each with its `kind` (`seal_released`, `upload_released` or `hold_ended_unreported`), `at`, and the
  case's or the refusal's id.
- **Queue.** `QueueRow` gains `foundByProgram`, `takenByProgram`, `objected`, `matchFlag` (booleans) and `flag`
  (`{ items, reporters }` or null, from `case_flag`).
- **Case.** `CaseView` gains: `signals` (one an automated item, an item that cites no rule among them: `itemId`,
  `kind`, `thresholdVersion`, and `match`, null for a score, else `source`, `listVersion`, `hashType`,
  `matchKind`, `classification`, `listed`, `acting`, `queriedAt`); `objection` (`text`, `createdAt`, or null);
  `purges` (one an image of the post: `mediaId`, `outcome`, `at`); `flag`. Each image of the evidence gains `matched` (true when an unerased match
  record names it: rule 2 above). An item gains `sameSourceOpen` (a count). A decision gains `byProgram` (true
  when it has no decider) and `matchAnswerReason`; a seal for good's decision gains `custody` (the answer of
  `seal_custody` for that seal: `files`, `moved`, `movedAt`, `toReturn`, `filesLeft`, `lost`: counts and one
  time, never a file's name or digest and no list by image) and `release` (the facts of `release_facts` that
  8.5 lists, with `leave`, null or the recorded leave that stands, as section 10 lists it (a withdrawn leave
  is in no answer): `id`, `from`, `reference`,
  `receivedOn`, `untold`, `untoldUntil`; `tellHeld`, whether the author's notice of a release taken now would
  be held;
  `postIds`, `remaining`, `silenceDays`, and once released `releasedAt`, `basis`, `backupsClearAt`,
  `noticeHeld`).
- **Held uploads.** `UploadsPage` from the staff route that lists `upload_refusals`: one entry a refusal with
  `refusedAt`, the match's members as above, `otherRefusals` (a count), `uploaderGone` (true when the uploader's
  account no longer exists), `objection` and `objectedAt`, `endedAt`, `endAs`, `endReason`, `deletesAt` (for a
  hold ended as `no_report`, the time after which the upload is deleted), `reported` (whether `notification_id`
  is set), `quarantined`, and the release's facts as on a case.
- **What no answer of 3d holds:** a score, a hash value, a file's name or digest, an uploader's handle on the
  Held uploads list (the count of other held uploads is all it shows of the person), a reporter behind a flag.
- **A refusal the page did not foresee** (`release_mismatch`, 409, on a release or on a hold's end) means the
  facts moved between the read and the key. [changed]: "The database refused this: the seal, the upload, the
  record of the report or the recorded leave is no longer what this page showed. Read the page again."

### 8.2 Home

The home screen gains a block "Sealed files and programs" below 3f's "Authorities". Each line is shown only while
it applies, in this order.

| Key | Shown while | Sentence |
|---|---|---|
| [home.quarantine] | `quarantine.dueIn` or `dueOut` is above zero | "Files to move or return: {dueIn} images to move into the quarantine, {dueOut} to return to the image store, the oldest due since {oldest}. Whoever has the server runs the README's steps under Quarantine (staff.js quarantine-list). Until then a sealed image's files are still in the image store, and an image whose seal was lifted is not shown." After 24 hours it adds "More than 24 hours: every staff account is alerted daily until the move is recorded." |
| [home.undestroyed] | `quarantine.undestroyed` is above zero | "Released files to destroy: {undestroyed}. Their release is recorded and the files are still in the quarantine. Whoever has the server runs the same steps; the list's destroy lines name them." |
| [home.automated] | `automated.waiting` is above zero (each a `CaseLink`) | "Measures a program took, waiting for a person: {waiting}, the oldest since {oldestAt}. A moderator decides a hidden image; an admin answers sealed images." |
| [home.objected] | `automated.objected` is above zero (each a `CaseLink`) | "The author asked for a person: {objected} cases, the oldest request of {oldestObjectionAt}. korbat's published target is an answer within {objectionTargetHours} hours." |
| [home.flags] | `automated.flags` is above zero | "Matches that only flag: {flags} open cases hold one, a match with an entry that its source does not class as child sexual abuse material. Each stands in the queue where its lane and age put it." |
| [home.uploads] | `heldUploads.open`, `objected` or `capped` is above zero (a link to `/uploads`) | "Held uploads: {open} matched uploads wait for an admin, the oldest since {oldest}; {objected} uploaders objected and have no answer." With `capped` above zero it adds "{capped} uploads matched over the limit of refusals an hour and are neither refused nor accepted: the operator looks at the comparison first (the alert says so)." |
| [home.released] | `destructive` has an entry of the kind `seal_released` or `upload_released` (each a `CaseLink`, or a link to `/uploads`) | "Released in the last 30 days, each by an admin's key: {at}, sealed images of a case." (for a held upload: "{at}, a held upload.") One line a release, newest first. |
| [home.unreported] | `destructive` has an entry of the kind `hold_ended_unreported` (a link to `/uploads`) | "Holds ended without a report in the last 30 days, each by an admin's key: {at}." One line an end, newest first. |

The two last lines are 3c's list of unseen answers carried over to 3d's two acts that cannot be taken back (3c 8:
every decision that lifted a seal or ended a freeze unseen is listed for 30 days). Each such act also mails every
staff account, the admin who took it included (W.7, `seal_released` and `hold_ended_unreported`), so that with
two people the second learns of it the same hour, and with a stolen key the owner does.

The home screen says nothing of the cap, the matcher's health, the purge or the head: each is an alert (W.7) and a
line of `staff.js automation-status`, since none of them is a thing a moderator acts on from the console.

### 8.3 The queue

Four chips and one mark join 3c's columns. None is a key of the order but the last.

| Key | Chip | Shown when |
|---|---|---|
| [queue.found] | "Found by a program" | an unanswered item of the case is of an `automated` intake and cites R1 or R2 |
| [queue.taken] | "Taken by a program" | a measure of a decision without a decider is in force on the case |
| [queue.matchFlag] | "A match that only flags" | `matchFlag` is true: an unanswered item of the case is of an `automated` intake and cites no rule, which is how a match with an entry of another class than the source's own for child sexual abuse material is put before a person (ruling 3 of the review) |
| [queue.flag] | "Possible coordinated reporting" | `flag` is not null |
| [queue.objected] | "The author asked for a person" | an objection to a measure in force exists; such a case sorts first inside its lane, before age |

Neither flag moves a case: a case with either chip stands where its lane and age put it (section 2, row 48). A
match that only flags froze nothing, sealed nothing, refused nothing and cites no rule; the chip is all it does.

**Two kinds of match do not act, and only one of them is this flag.** A match with an entry of the source's
class for child sexual abuse material that the source does not report as exact (`listed` true, `acting` false;
the rare exact match with a listed entry outside the adapter's `MATCH_ACTING` goes the same way) is no flag in
the queue: on a post it is an automated finding citing R2 without a measure, so its case carries [queue.found], stands in lane
0, is frozen and has raised the urgent alert, by 3c's rule for every finding citing R2. A match with an entry
of another class is the flag: an item of an `automated` intake that cites no rule, in lane 2, with
[queue.matchFlag]. Neither refuses an upload, and neither holds or seals anything. No match record is "marked
as read": a person's decision on the case answers the item, as it answers any item.

### 8.4 A case

**An item a program opened.** Its source line reads "Found by a program", never a reporter's summary, and it has
no reveal control and no mark "manifestly unfounded" (it is no report).

- [case.r1], on an item citing R1: "A program rated this image as likely within rule R1: over the threshold
  (version {thresholdVersion}). That is a reason to look, not a finding. Look at the image and decide as for any
  report. The statement will say that a moderator looked at the image only if you opened it on this case before
  you decided; otherwise it says that you decided without opening it." The page shows no score: a number beside
  an image reads as a verdict (section 2, row 26).
- [case.match], on every item that a match opened, whether it cites R2 or no rule, the match's record as a list
  of label and value: "Source", "List version", "Hash type" (`sha256`, `sha1`, `md5` or `pdq`), "Kind of match, as the source
  reported it" ("exact" or "near"), "Classification, as the source returned it", "Compared at". The three values
  a source wrote stand in their frame (rule 3 above).
- [case.matchWeak], under the record when the hash type is `md5` or `sha1`: "A file with the same MD5 (or SHA-1)
  as another can be made on purpose by whoever made both files." And when it is `pdq`: "A perceptual hash
  describes how a picture looks. Two different pictures can have the same one, by accident or on purpose."
- [case.matchActing], when `acting` is true: "The source reports this as an exact match with an entry that it
  classifies as child sexual abuse material. That is the one kind of match on which korbat's program refuses an
  upload or, where the owner has switched that on, seals a post's images. It is the source's word about a
  fingerprint: nobody at korbat has checked it, and nobody can."
- [case.matchNear], when `listed` is true and `acting` is false: "The source reports this as a match with an
  entry that it classifies as child sexual abuse material, but it is not a match on which korbat's program
  acts: the source does not report it as exact (the kind of match is shown above), or the entry is outside the
  part of its list that korbat acts on. The program refused and sealed nothing on it, and the author was told
  nothing. It opened this finding under rule R2, so the post is
  frozen as after any such finding: korbat keeps its images, also against the author's deletion, until an admin
  has answered, and the urgent alert went out. A similar fingerprint can be made on purpose for a harmless
  image. Only an admin answers: seal for good, or answer without a seal, without seeing the images."
- [case.matchFlag], when `listed` is false: "This match is a flag and nothing more: the source does not class
  the entry as child sexual abuse material. The program refused, sealed and froze nothing and cited no rule,
  nobody was alerted, and the author was told nothing. Decide the case on what you can read: this record, the
  post's text and alt texts, and the account's conduct. If they give you a ground of your own, decide on that
  rule or the law; if they do not, decide that nothing breaks a rule, which answers the flag."
- [case.matchWhat], under either: "What a match shows: a file has the same, or a similar, fingerprint as one that
  the source classified. It does not show what the image is. Nobody at korbat opens an image that a match names,
  before an answer or after it. Decide as for a report: on this record, the post's text and alt texts, and the
  account's conduct. Never write that the image is child sexual abuse material or that korbat confirmed it."
- [case.image.matched], in the place of every image whose `matched` is true, on this case and on every other: "Not
  opened: this image matched a list of known material. Nobody at korbat opens it, also after an answer without a
  seal." No reveal control stands beside it, and a request for it is refused `image_matched`.

3c's banner for a case with an unanswered suspect item stands above the evidence unchanged for an item that cites
R2: a finding on a match of the listed class, acting or not, is suspect by 3c's rule, so the post is frozen. A
match of another class stands on its post's case as an item of an `automated` intake that cites no rule: it is
not suspect, raises no banner and no urgent alert and freezes nothing. Its source line reads "Found by a
program" like every automated item's (section 10's one fixed label), and [case.matchFlag] under its record
says what it is. Its image is closed to staff all the same (rule 2).

**A decision a program took** is listed with the chip "Taken by a program" in the place of a staff handle.

- [case.auto]: "A program took this measure at {decidedAt}, with no person involved: {measure}. It lasts until a
  person decides this case. Its author was told at once, with these words:" and the statement's preview.
- [case.autoR1], for a `withhold_media`: "Any moderator may lift it now ("Lift what was done while deciding", with
  your reason), or decide the case. A final decision ends it either way."
- [case.autoR2], for a `seal_media`: "Only an admin answers a seal: seal for good, or answer without a seal. You
  answer without seeing the images, and nobody at korbat opens them afterwards either. An answer without a seal
  puts them before everyone again: it needs one of the reasons below."
- **An answer without a seal on a case with an acting match** asks for a reason, one of
  `MATCH_ANSWER_REASONS` (labelled by `MATCH_ANSWER_REASON_LABELS`), before the key; it is part of what the key
  signs (`matchAnswerReason`) and is stored with the decision.
  A match that does not act, of either kind, asks for none: no program refused or sealed on it.

| Reason | Label |
|---|---|
| `source_withdrew` | "The source withdrew or corrected its entry" |
| `counsel` | "Counsel's advice, written in the operator's notes" |
| `other` | "Another reason, written in the operator's notes" |

- [case.liftedMatch], for the admin, in the place of 3c 8's sentence that after an answer without a seal the
  case's images may be opened and whoever is on duty opens them the same day, on every case that holds a match:
  "After an answer without a seal the images are served again as before. They stay closed to staff: nobody at
  korbat opens an image that a match names, on this case or on any other. No person will have looked at them."
  3c's sentence stands unchanged on a case without a match.
- **The composer** on such a case is 3c's. Beside "Decide the case" it adds [case.autoRecord]: "Your decision is
  recorded as found by automated means." and, for an admin who restricts on a match's finding citing R2, "It is recorded as taken
  partly by automated means: you cannot view the images, so the comparison is a fact your decision rests on." The
  preview shows the statement's sentence that follows from it (W.3), with the ending that says whether the
  moderator opened the image ([case.r1]).

**The objection** stands at the top of the case, above the evidence, while its measure is in force.

- [case.objection]: "The author asked for a person on {createdAt}:" then the text in a frame "Written by the
  author", then "korbat's published target is an answer within {objectionTargetHours} hours. Lift the measure or
  decide the case; either way the author gets that decision's statement, and nothing else answers this."

**Further lines.**

| Key | Where | Sentence |
|---|---|---|
| [case.purge.accepted] | beside each image that stopped being public | "Edge copy: purge accepted at {at}." |
| [case.purge.failed] | the same | "Edge copy: purge failed. A copy may have been served for up to {edgeMinutes} minutes after the measure; the operator is alerted." |
| [case.purge.off] | the same | "Edge copy: no purge (off): a copy may be served for up to {edgeMinutes} minutes." |
| [case.purge.pending] | the same, while the row has no outcome | "Edge copy: purge not sent yet." |
| [case.sameSource] | on an item, when `sameSourceOpen` is above zero | "{n} other open items from this source." It names no case and no person; 3e's mark answers one reporter's many items. |
| [case.flag] | under the header, with the chip | "Many reports in a short time from accounts that are linked: {items} unanswered reports from {reporters} accounts within {windowMinutes} minutes, and at least half of those accounts follow one another. This is not a finding: decide the content as always." |
| [case.custody.in] | on a seal for good's decision, from its `custody` | "Files: {moved} of {files} are in the quarantine, since {movedAt}." or "Files: not moved to the quarantine yet." While `moved` is under `files` it adds "The others are still in the image store until whoever has the server moves them (the README, Quarantine)." |
| [case.custody.return] | on a seal's decision whose `custody.toReturn` is above zero (the seal was lifted while files are in the quarantine) | "Files to return: the seal was lifted and {toReturn} files of its images are still in the quarantine. The images are shown again once whoever has the server has returned them (the README, Quarantine)." |
| [case.custody.lost] | on a seal's decision whose `custody.lost` is above zero | under a seal for good in force: "Files lost: {lost}. They were found in neither the image store nor the quarantine and are recorded as lost; there is nothing to move, hand over or destroy for them." After a lifted seal: "Files lost: {lost}. Their images cannot be shown again; their author was told so." |

F's order screen prints the same four purge lines for each disabled item, from the same member.

### 8.5 The release

On a seal for good that is in force, an admin sees the block "Release" under the decision; a moderator sees it
greyed with `admin_required`'s words. It opens with the facts of `release_facts`, each a label and a value, then
the words.

**What releases, and what does not** (ruling 1 of the review). An authority's recorded answer `illegal` is an
assessment. By itself it changes nothing about the files: they stay sealed and in the quarantine, and the block
offers no control. Sealed files are destroyed only on a recorded **leave or instruction to destroy**, from the
authority or from a court, with its reference, recorded from the command line as a fact of its own (`staff.js
release-leave`, 8.10), and on an admin's confirmed action. An answer `not_illegal` supports lifting the seal, as
3c built it. No answer, `no_assessment` and `other` support nothing.

| Fact | Label | Values |
|---|---|---|
| `reported` | "Reported to an authority" | "yes", "no" |
| `theirReference` | "The authority's reference" | the text, in a frame "As recorded from the authority", or "not recorded" |
| `answer` | "The authority's assessment" | "illegal", "not illegal", "no assessment", "another answer", "none recorded" |
| `answeredAt` | "Assessed on" | the day, or "no answer" |
| `handedOverAt` | "Files handed over on" | the day, or "nothing was handed over" |
| `leave` | "Leave or instruction to destroy" | "none recorded", also once a leave that was recorded by mistake has been withdrawn (8.10); else "from the authority" or "from a court" (`leave.from`) |
| `leave.reference` | "Its reference" | the text, in the same frame, or "none recorded" |
| `leave.receivedOn` | "Its day" | the day the leave bears, or "none recorded" |
| `tellHeld`, with `leave.untold` and `leave.untoldUntil` | "The author may be told" | "at once" (`tellHeld` false); or, with `leave.untold` true and its end open or ahead, "not yet: the leave is recorded as not to be told to the person, until {untoldUntil}" (with `untoldUntil` null, an open end: "with no end recorded"); or, when the leave carries no such mark, "not yet: the record of the report, or an authority's order about one of these posts, says that the person is not to be told" |
| `quarantined` | "Files in the quarantine" | "all of them, by the record", "not all: the move is not recorded" |
| `preserved` | "Preserved for an order" | "no", "yes" |

The hold on telling is no setting of the console. The author's notice of a release is held while one of three
things holds, which is what section 6's `release_tellable` reads: the recorded leave is itself marked as not to
be told to the person (`untold`), with an end that is open or ahead, as `staff.js release-leave` recorded it;
an event of the report's record carries 3f's mark "not to the person" with an end that is open or ahead (3f
7.13; `staff.js notification-event`); or a decision about a post of the release is untold under 3f's hold for
an authority's order. While one does, the notice of a release is not sent, and nothing else in the app shows
the release (9.6).

- [release.what]: "A release ends korbat's keeping of these sealed images for good. It marks the posts as released
  and erases their image rows now. Whoever has the server then destroys the files in the quarantine, and the
  digest of each destroyed file is recorded as the proof. It cannot be undone: nothing brings a destroyed file
  back. The seal stays in the record as a measure, and the post's text is not touched."
- [release.tells]: "The author is told what korbat did: that it released the images, and that an authority's or
  a court's leave or instruction is its ground. The notice names no authority and no reference and says nothing
  of what any authority found. It is sent at once, or, while the leave, the record of the report or an
  authority's order says that the person is not to be told, when the last of these has ended and never before.
  If an authority has asked korbat not to tell the person and the line above still reads "at once", do not
  release: whoever has the server records the authority's request first (with the leave when the leave is
  recorded, staff.js release-leave --untold; for a leave that is recorded already, notification-event on the
  record of the report)."
- [release.backups]: "A backup of the image store taken before the files moved may still hold them: korbat's
  backups are deleted {backupDays} days after they were taken, except a backup kept for an authority, which is
  destroyed by hand (the README, Backups). The release's record prints the day after which no backup that is
  deleted on time holds these files."
- [release.leave], the ground `leave`, offered only while a leave is recorded: "Ground: leave to destroy. The
  record holds a leave or an instruction to destroy these images, {from the authority | from a court}, of the
  day and with the reference shown above." The params the key signs name that recorded leave by its id
  (`leaveId`) and carry its reference as the record holds it (`theirReference`); a leave is never typed into
  the console.
- [release.assessed], when the answer is `illegal` and no leave is recorded, in place of the control: "The
  authority assessed these images as illegal. An assessment is not leave to destroy: it is a reason an authority
  may want them kept. The images stay sealed and kept until the authority or a court gives korbat leave or an
  instruction to destroy them and whoever has the server has recorded it (staff.js release-leave)."
- [release.notIllegal], when the answer is `not_illegal`, in place of the control: "The authority answered that the
  images are not illegal. That is no ground for a release. Lift the seal instead (Correct this decision, Lift the
  seal): the images are shown again once their files are returned." When a leave is recorded all the same, the
  control stays and [release.conflict] stands above it: "The record holds an assessment "not illegal" and a leave
  to destroy. The two do not fit. Ask whoever has the server which is wrong before you do either: lifting the
  seal returns the images, a release destroys them."
- [release.nothing], for `no_assessment`, `other` or no answer, while no leave is recorded: "This ends nothing by
  itself. The images stay sealed and kept."
- [release.periodUnset], while `silenceDays` is null: "korbat has set no period after which sealed images are
  released when an authority stays silent. Until counsel has set one and the terms publish it, nothing is released
  by time."
- [release.period], once it is set: "Ground: the period's end. {silenceDays} days have passed since the hand-over
  (or, when nothing was handed over, since the report), the author was told the day {periodNoticeDays} days before
  it, and no objection of the author's is unanswered."
- [release.more], when `remaining` is above zero: "This seal lists more posts than one confirmation can release.
  This one releases the first {max} of them, in the order of their ids; {remaining} more remain. Read the case
  again and confirm again for the rest."
- [release.sign]: "You confirm with your staff key: this seal, its {posts} posts, the ground, and the leave with
  its reference as shown above."
- [release.done]: "Released at {releasedAt}: {posts} posts, {images} image rows erased. Files left to destroy:
  {filesLeft}. They are in the quarantine until whoever has the server destroys them (the README, Quarantine),
  and every staff account is alerted daily while one is still recorded there. The author's notice: {sent at
  once | held until the person may be told}. No backup that is deleted on time holds these
  files after {backupsClearAt}; a backup kept for an authority is destroyed by hand (the README, Backups)."
  `filesLeft` is the seal's `custody.filesLeft`, and the notice's second form is printed while `noticeHeld` is
  true.

The control is one button, "Release and destroy", then the key. Each refusal is worded in place (8.8) and the block
is read again.

### 8.6 Held uploads (`/uploads`)

The refusals whose hold has not ended, oldest first; then those that ended as "Report" and are not released,
for as long as that lasts (each can still take an objection, a later "No report" or a release); then those
released or ended as "No report" in the last 30 days; 50 a page.

- [uploads.what]: "An upload was not accepted because its source reports its fingerprint as an exact match with
  an entry that the source classifies as child sexual abuse material. It is on no post, nothing serves it, no
  data export holds it, and nobody at korbat opens it: this screen shows no image. It is held, with no end by a
  timer, until an admin ends the hold one of the two ways below." Only such a match is ever held: a match that
  is not exact, or of another class, refuses and holds nothing. Its upload is accepted, and once it is on a
  post the match is a finding citing R2 or a flag on that post's case (8.3, 8.4).
- **A refusal's block:** "Refused at {refusedAt}"; the match's record as [case.match] prints it, with
  [case.matchWeak] and [case.matchActing]; [uploads.others] "Other held uploads of the same uploader: {n}.",
  counted over the refusals whose hold has not ended or ended as "Report", never over one that ended as "No
  report": a hold that ended without a report counts for nothing later; [uploads.gone], while `uploaderGone` is
  true: "The uploader's account no longer exists. A report can carry the file's facts and times, and the
  account's address only while korbat still holds it for a report: up to {reportHoldDays} days from the
  refusal, as after a seal. After that a report can carry the file's facts and times alone.";
  the objection, when there is one, in a frame "Written by the uploader", under "The uploader objected on
  {objectedAt}:"; and its state.
- [uploads.unseen], above the two controls: "You decide without seeing the image, and this screen does not tell
  you which way. What you have is the record above: the source, the kind of match, the time, what the uploader
  wrote, and how many other uploads of the same uploader are held. Whether a match obliges korbat to report is a
  question of law that this screen does not answer: read the README's section A held upload, which holds what
  counsel has advised korbat, decide with whoever has the server, and write your ground into the operator's
  notes." Neither control is preselected, and they stand side by side with the same weight.
- **"Report"** (an admin, the step-up `upload_hold_ended`). [uploads.report]: "The upload stays held and its files
  move to the quarantine, kept for the authority alone. Whoever has the server opens the record of the report
  (staff.js upload-report) and reports. The uploader reads on the notice that korbat reports the file. The hold
  then ends by a release on a recorded leave to destroy, or by "No report" later, with a reason."
- **"No report"** (the same step-up). [uploads.noReport]: "The hold ends. korbat deletes the upload {noReportHours}
  hours from now; until then an admin can still end it as "Report" instead. Every staff account is mailed now
  that a hold ended without a report; the uploader is told that the hold was lifted only once the upload is
  deleted." Then the reason, one of
  `UPLOAD_END_REASON_LABELS`:

| Reason | Label |
|---|---|
| `source_withdrew` | "The source withdrew or corrected its entry" |
| `counsel_no_duty` | "Counsel: no duty to report this" |
| `other` | "Another reason, written in the operator's notes" |

- **State lines.** [uploads.state.open] "Held, waiting for an admin."; [uploads.state.report] "Held for a report
  since {endedAt}. Report recorded: {yes or no}. Files in the quarantine: {yes or no}."; [uploads.state.noReport]
  "Hold ended at {endedAt}: {reason}. The upload is deleted after {deletesAt}; until then it can still be ended as
  "Report"."; [uploads.state.released] "Released at {releasedAt}. Home counts the released files that are left to
  destroy."
- **An objection after "Report".** The uploader may object for as long as the refusal has no objection, is not
  released and has not ended as "No report" (9.5). A refusal that ended as "Report" therefore still shows an
  objection that arrives later, under its state line, and Home's [home.uploads] counts it among the objected.
- **"Release"**, on a refusal ended as `report`: 8.5's block with the facts read from the record that
  `upload-report` opened and the leave recorded for the refusal, the step-up `upload_released`, and "this upload"
  in place of "this seal, its posts".

### 8.7 Appeals, and After a restore

- **Appeals** (`/appeals`). A waiting appeal of a seal whose posts were released shows [appeals.released]: "The
  images this appeal is about were released on {releasedAt}, on the ground: {a recorded leave to destroy | the
  period's end}. korbat has released them: it will not show them again or give them back. The appeal is still
  open: an admin reviews it, and the release closed nothing." 3c's sentence that an appeal of a seal waits for the
  authority is not shown beside it.
- **After a restore** (`/restore`, 3f 8.8). The class `release` joins the table, after `seal_interim`. It holds
  five kinds of lost line (a seal's release, a held upload's release, the end of a hold, a recorded leave, the
  withdrawal of a leave), each read from the keeper's files by `restore-import`:

| Class | Heading | A gap's line and its control |
|---|---|---|
| `release` | "Releases and held uploads to replay" | For a `seal_released` or an `upload_released` line: "Lost: a release of {actedAt}. The database again treats its images as sealed and kept." No control: [restore.release] "No key closes this. Whoever has the server replays it from the keeper's files (staff.js release-replay), then destroys again what a restored store or the quarantine holds." |
| | | For an `upload_hold_ended` line: "Lost: the end of a held upload's hold, of {actedAt}, as {Report \| No report}. The database again shows the hold as open, or does not hold the refusal at all." [restore.holdEnd]: when the refusal is there, a link to Held uploads and "End this hold again the same way; your key closes this gap. Do not run upload-report a second time: whoever has the server checks the keeper's files for the record of the report first." When the refusal is gone: "No key closes this. Whoever has the server replays it (staff.js release-replay), which keeps the image's row from being posted and lists its files." |
| | | For a `release_leave_recorded` line: "Lost: a leave or an instruction to destroy, recorded on {actedAt}. The database no longer holds it, so nothing can be released on it." No control: [restore.leave] "No key closes this. Whoever has the server records the leave again from what korbat holds in writing (staff.js release-leave, naming this gap); that closes it." |
| | | For a `release_leave_withdrawn` line: "Lost: the withdrawal, on {actedAt}, of a leave that had been recorded by mistake. The database shows that leave as standing again. Do not release on it." No control: [restore.withdrawn] "No key closes this. Whoever has the server withdraws the leave again (staff.js release-leave --withdraw, naming this gap); that closes it." |

- **A lost leave** (a `release_leave_recorded` line above the restored head) is so a gap of the class `release`
  like the others, as section 6.2 has it: recording the leave again from what the operator holds in writing
  (`staff.js release-leave --gap <gap>`, 8.10) closes it, and nothing else does. A release that used the leave
  may be replayed before the leave is back (`releases.leave_id` has no foreign key); the leave's own gap stays
  open until it is recorded again, and keeps the site closed like every gap of the class. A leave that was
  recorded and withdrawn after the backup has no gap: it supported no release and is not recorded again.
- **A lost withdrawal** (a `release_leave_withdrawn` line above the restored head, for a leave that the backup
  holds) is a gap of the class too: the restored database shows the leave as standing, the release block of
  its case offers it, and the gap's line says not to release on it. Withdrawing it again closes the gap
  (`staff.js release-leave --withdraw <leave> --gap <gap>`, 8.10), and nothing else does.
- **A program's lost measure** is no class of 3d's: an `automated_decided` line above the restored head is a lost
  decision of 3f's own classes, by its one action (`seal_interim` for a `seal_media`, `restriction` for a
  `withhold_media`), with 3f's headings and controls: a person takes the measure again under a staff key, and the
  site stays closed until then, as for any lost measure. [restore.program], beside such a gap: "A program took
  this measure, not a person. Take it again as your own decision while you decide; the author is sent your
  decision's statement."
- [restore.site] is unchanged and now true of one more class: the app's site stays closed while a `release` gap is
  open. [restore.sealAgain], beside a `seal_final` gap whose post is released: "This seal's post was released. Take
  the seal again all the same, so that the record is whole: it freezes nothing and brings nothing back."

### 8.8 Messages

`CONSOLE_MODERATION_CODES` and `MODERATION_MESSAGES` gain the codes a staff route of 3d can answer.

| Code | Words |
|---|---|
| `release_not_open` | "This seal cannot be released: it is not a seal for good in force, or its posts are released already. Read the case again." |
| `release_not_reported` | "No report of this seal to an authority is recorded. Whoever has the server records the report first (staff.js notification-sent)." |
| `release_not_quarantined` | "Not every file of this seal is recorded as moved to the quarantine. Whoever has the server moves and records them first (the README, Quarantine)." |
| `release_preserved` | "A post of this seal is preserved for an authority's order. Nothing of it is released while that lasts." |
| `release_no_leave` | "No leave or instruction to destroy is recorded for this. An authority's assessment alone releases nothing. Whoever has the server records the leave first (staff.js release-leave)." |
| `release_period_unset` | [release.periodUnset] |
| `release_period_running` | "The period has not ended, the author was not told the day in time, or an objection of the author's is unanswered." |
| `release_mismatch` | [changed] (8.1) |
| `hold_not_open` | "This hold cannot be ended this way: it is released, it ended as "No report" and its upload is deleted, or it ended the same way already. Read the page again." |
| `invalid_hold_end` | "An end as "No report" needs exactly one of its reasons, and an end as "Report" takes none. Nothing changed." |
| `image_matched` | [case.image.matched] (8.4) |
| `admin_required` | 3c's words |

`release_no_leave` takes the place of the draft's `release_not_for_answer`, which no longer exists: no answer
releases. `upload_refused` and `objection_not_open` are the app's (9.7). `automation_capped` and
`already_protected` never leave the API: the automated step records them on the signal. `edition_not_due` is the
command line's.

### 8.9 The browser check

`apps/admin/test/browser/` gains fixtures for the new members, with hostile strings in a source's name, list
version and classification, in an authority's reference and in an objection (bidirectional overrides, a look-alike
console label, `javascript:`). Every run is at 360 by 740 px with the virtual authenticator and fails as 3f 8.10
says, and also on any image request from a release block or from `/uploads`, and on any request for an image
whose `matched` is true.

| Task | Runs |
|---|---|
| 1 | Home with [home.quarantine]; a case with [case.custody.in], one with [case.custody.return] and one with each form of [case.custody.lost] |
| 2 | the release block in each state: a recorded leave with the control; the answer `illegal` without a leave, with [release.assessed] and no control; `not_illegal`, `no_assessment` and no answer without it; a leave beside `not_illegal` with [release.conflict]; a seal with more posts than `RELEASE_POSTS_MAX` with [release.more]. A release confirmed, the options binding the seal, its posts, the ground, the leave and its reference; the same with options that bind another reference, refused before the key is asked; the block greyed for a moderator; the row "The author may be told" in each of its three values; Appeals with [appeals.released]; After a restore with a lost release, with a lost leave ([restore.leave]) and with a lost withdrawal of a leave ([restore.withdrawn]), none with a control; Home with [home.released] |
| 3 | a case with each of the four purge lines |
| 6 | the queue with the chips of Task 6 and an objected case first in its lane; a case with [case.r1] and no score anywhere on the page; a program's decision with [case.auto], lifted by a moderator; a case with an objection; Home with [home.automated] and [home.objected]; After a restore with [restore.program] |
| 7 | a case with the match's record in each of its three kinds (acting, with [case.matchActing]; of the listed class and not exact, with [case.matchNear] and 3c's banner; of another class, with [case.matchFlag] and no banner), each with [case.matchWeak]; the queue with [queue.matchFlag]; [case.image.matched] in the place of a matched image, with no reveal control and no image request, before an admin's answer and after an answer without a seal; that answer asking for its reason and refused without one; [case.liftedMatch] in the place of 3c's sentence; Held uploads with one refusal of each state, with [uploads.gone] and with an objection that arrived after "Report"; neither control focused or preselected when the page loads, and no word of [uploads.unseen] naming one of them; "Report" and "No report" confirmed, the options binding the refusal, the end and the reason; the controls greyed for a moderator; After a restore with a lost end of a hold, the refusal there and gone; Home with [home.uploads] and [home.unreported] |
| 8 | a case with [case.flag] and [case.sameSource] |

### 8.10 The command line

`staff.js` gains the commands below; `STAFF_USAGE` lists each with its first line here. 3c 7.13's and 3f 8.11's
rules hold: the 10-second `lock_timeout`, the audit row as the transaction's last statement, exit 1 with
"<command>: <why>; nothing changed", every printed line starting with the command's name, no command that prints,
takes or opens an image, and none that sends anything to anyone. All run as the migrator in the migrate service,
except `automation-status`, which runs in the api service as `access-request` does, since it prints the API's own
settings; it reads with the API's role and writes nothing.

**The quarantine and the release.**

| Command | Does | Prints |
|---|---|---|
| `quarantine-list` | reads `quarantine_plan()` and, through the media module's plain function `quarantineNames(tx)` and its naming rule, prints one line a stored file. Read-only, no audit row. It counts, for every post that is sealed for good and **not released**, the post's image rows, erased or not, against its `seal_posts.images`; a post whose count differs is left out of the list and named on standard error (`handover_mismatch`), and the other posts' lines are printed all the same | on standard output a line a file: "<in\|out\|destroy\|operator> <image id> <file>"; on standard error "quarantine-list: <n> files to move in, <n> to return, <n> to destroy, <n> for the operator." or "quarantine-list: nothing is due."; a line each "quarantine-list: post <id>: its image rows do not match its seal; left out"; exit 1 when a post was left out. An `operator` line is a file the quarantine holds whose image the database does not know: the mover leaves it alone, and the README's Restoring says what to do |
| `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt` | the one-shot service (section 5), whose command is `node dist/quarantine.js /media/store /media/quarantine` (the two roots are arguments, and it refuses to start without both): for each `in` or `out` line, copy, verify, rename, sync and unlink in the line's direction; for a `destroy` line, the digest first, then the unlink in the quarantine and, when the store holds a file of the same name, there too. It decodes nothing. **One bad line never stops a run:** it is printed, the next line is taken, and the run exits 1 at its end. Run with the one flag `--lost` (after the operator has looked), it prints `lost` where it would print `missing`. Run with `--inventory` and no list, it moves nothing and prints a line for every file the quarantine holds | a line a file: "<direction> <image id> <file> <bytes> <sha256> <word>", for `in` and `out` the word `done`, `already`, `missing` (the file is in neither place), `lost`, or `refused` (a name outside the layout; a copy whose digest differs); for `destroy` where the file was found: `quarantine`, `store`, `both` or `already`; for an inventory "have <image id> <file> <bytes> <sha256>". On standard error "quarantine: skipped: <file> is outside the layout" or "quarantine: <file>: the copy's digest differs; the copy is removed and the source kept", the run going on |
| `quarantine-record < receipt` | takes the receipt **line by line**, in one transaction that ends with the one audit row `quarantine_recorded` (counts only), and writes or completes the `quarantine_files` rows; a line it cannot take is reported and skipped inside that transaction. A well-formed line of a move the mover did is a fact about where a file is and is recorded as that, whatever the plan says now; a line that no longer fits the plan (the seal was lifted or taken again between the list and the move) is recorded and reported, and the next list moves the file back. A `missing` line is reported and records nothing; a `lost` line records the file as lost (`lost_at`); a `have` line whose file has a row is checked against it (another digest is reported), and one without a row gets its row, as a move in that nobody recorded. A `refused` line and a line that is not a receipt line are reported and skipped. No line makes it refuse the others | "quarantine-record: <n> files recorded as moved, <n> as returned, <n> as destroyed, <n> as lost, <n> found without a record. Still due: <n>."; a line each "quarantine-record: line <n>: image <id> no longer fits the plan; recorded where the file is, and the next list moves it back", "quarantine-record: line <n>: <file> is missing in both places; nothing recorded (see the README, Quarantine, step 5)" or "quarantine-record: line <n> is not a receipt line; skipped"; exit 1 when a line was reported |
| `release-leave <seal \| refusal> --by <authority\|court> --reference <text> --day <yyyy-mm-dd> [--untold [--until <instant>]] [--gap <gap>]`, `release-leave --end-untold <leave> [--until <instant>]`, and `release-leave --withdraw <leave> [--gap <gap>]` | records, as a fact of its own (a row of `release_leaves`, section 6.2), that an authority or a court gave korbat leave or an instruction to destroy the files of a seal for good in force (named by its ledger row's id) or of a held upload ended as `report` (by the refusal's id); the second form ends an open hold on telling the person; the third withdraws a leave that was recorded by mistake, for as long as no release rests on it. What it stores, what it refuses and what it leaves alone is under this table. Audit row `release_leave_recorded`, and for a withdrawal its own, `release_leave_withdrawn` | "release-leave: leave <id> recorded for <seal\|upload> <id>, on the record of its report: from <authority\|court>, reference <text>, of <day>; the person <may be told\|is not to be told until <instant>\|is not to be told, with no end recorded>. An admin can now release it on the case (or on Held uploads)."; or "release-leave: leave <id>: the person may be told from <instant>."; or "release-leave: leave <id> withdrawn. It supports no release, and the case shows none recorded. If there is a right leave, record it as a new one."; refused with "release-leave: `leave_used`: a release already rests on leave <id>; nothing changed" |
| `release-show <release>` | prints a release's record; read-only | "release-show: release <id>: ground <leave\|period>, leave or instruction from <authority\|court>, reference <text>, of <day>, released <instant> (or: replayed <instant>, first released <instant>)."; "posts <n>; image rows erased <n>; files destroyed <n> of <m>, lost <n>."; a line a destroyed file "<file> <bytes> <sha256> <instant>"; "no backup that is deleted on time holds these files after <instant>; a backup kept for an authority is destroyed by hand."; "author's notice: <sent <instant>\|pending\|held: the person may not be told yet\|not sent: the account is gone\|not sent again: a replay, and no hold on telling stood>." |
| `release-replay < <copy>` | after `restore-import`, with the keeper's files on standard input as that command reads them (the migrate service mounts no directory, so the copy is never a path). For each open gap of the class `release` whose lost line is a `seal_released` row it calls `release_replay`; for an `upload_released` row, `upload_release_replay` with the line's `mediaId`, which marks the image row erased and its hold ended also when the restored database lacks the refusal; for an `upload_hold_ended` row whose refusal the restored database lacks, `upload_hold_replay`, which keeps the image row that the line names from every post, reader and export (below). Each closes its gap, in one transaction a line. It refuses a line that no open gap names (`replay_no_gap`), so only what `restore-import` checked against the chain is replayed. Idempotent | "release-replay: <n> releases and <k> ends of a hold in the copy; <m> already present."; a line each "release-replay: release <id> of <instant>: <n> posts marked released, <n> image rows erased." or "release-replay: held upload <refusal>: the hold's end of <instant> as <report\|no_report>; the image is kept from every post."; then "release-replay: run the Quarantine steps now, with an inventory first: the list's destroy lines name every released file that the restored store or the quarantine still holds, and its operator lines every file it cannot place." |
| `upload-report <refusal> --duty <duty>` | for a held upload ended as `report`: opens 3f's notification record under one of 3f's duties, as `notification-open` takes them (which duty a match carries is counsel's, section 17), and stores its id on the refusal through the media module's plain function `refusalReported`; refused (`hold_not_open`) when the hold was not ended that way, and when a record is stored already. The record names the account that the refusal names. When that account no longer exists, this is the id of an anonymised profile (no profile row is ever deleted), and the command says so; on a refusal that names no account any more the record is opened without one | "upload-report: record <id> opened for the held upload <refusal>, owed since <instant>. Report it, then record it with notification-sent." and, when the account is gone, "upload-report: the uploader's account no longer exists: the record names nobody, and the report can carry the file's facts and times (and the address until <instant>, while 3f still holds it)." |

**What `release-leave` records.** The operator names the seal or the refusal; the command finds 3f's record of
its report (the seal's, as `seal_report` finds it; for a held upload the one its `notification_id` names) and
stores the leave against that record (`notification_id`), with who gave it (`leave_from`, from `--by`), its
reference, the day the leave bears (`received_on`, from `--day`, not after today) and, with `--untold`, that
the authority forbids telling the person (`untold`), until the instant given (`untold_until`) or with an open
end. `--end-untold` ends an open end, at the instant given or now. `--withdraw` withdraws a leave that was
recorded by mistake: the leave's row then holds when and by whom (`withdrawn_at`, which the database
forces, and `withdrawn_by`), the transaction ends with the audit row `release_leave_withdrawn`, and from
then on the leave supports no release: the case shows "none recorded", and a release that names it is
refused as one without a leave (`release_no_leave`). A withdrawal is refused (`leave_used`) once a release
rests on the leave, since nothing takes a release back; a leave that is withdrawn already is the command's
"nothing to do". These are the two changes a recorded leave ever takes. No member of a leave is changed
otherwise and no leave is deleted, so the operator still checks the target and the reference before
recording (section 17, A.5); the right leave, where there is one, is recorded as a new one.
The command changes no file, no seal and no hold and releases
nothing: the release stays an admin's confirmed action, whose params name this leave by its id. It records
what the operator holds in writing and cannot check it. With `--gap` it closes, in the same transaction, the
gap of the class `release` that a restore left for a lost leave or, with `--withdraw`, for a lost withdrawal
(8.7); a lost leave is recorded again under the id that its gap's line names, so that a release replayed
before it finds its leave. A recording is refused without a reference, for
any other target, and while the target has no record of a report: a seal that is not reported, or a held
upload for which `upload-report` has not run.

**What `release-replay` leaves to others.** For a lost end of a hold whose refusal the restored database lacks,
`upload_hold_replay` holds the image row that the line names for good after an end as `report` and erases it
after an end as `no_report`. When the refusal is there the function answers `present` and writes nothing: the
gap waits for the admin's new end of that hold (8.7). A lost leave's gap and a lost withdrawal's are not this
command's either: `release-leave --gap` and `release-leave --withdraw --gap` close them. A release that it
replays tells nobody, unless a hold on telling still stands: then the replay's notice is `held`, as section
6.2 forces it, and the dispatch job sends it when the hold has ended.

**The public figures and the head.**

| Command | Does | Prints |
|---|---|---|
| `recipients [--months 6]` | the figure of DSA Art. 24(2) and (3), exact, for the authority that asks; read-only | "recipients: method <n>; the <k> full months to <yyyy-mm>."; a line a month "<yyyy-mm>: signed in <n>; signed out, summed by day, <n\|not counted>"; "recipients: average monthly active recipients: between <A> and <A+B>." (with the setting off: "at least <A>; signed-out readers are not counted."); with fewer months on record, "recipients: only <k> full months are recorded." |
| `edition <year>` | prints the newest stored version of that year's edition as its page prints it; read-only | "edition: <year>, version <n> of <day>, <first\|hold ended\|correction>.", then a line a figure, or "edition: none stored for <year>." |
| `edition <year> --correct` | computes every table of the year again and stores the result as the next version with the reason `correction`; the older versions stay. It is the only way a table is computed a second time: a version the job writes because an order's hold ended (`hold_ended`) copies the newest version's stored figures and replaces the order section alone, so two versions never differ by what happened to a few people meanwhile. Refused with `edition_not_due` | "edition: <year>, version <n> stored, every table computed again. The page lists version <n-1> as replaced on <day>." or "edition: `edition_not_due`: the edition of <year> is due on <day>; nothing changed" |
| `head-restore-mark [<day>:<value> ...]` | after a restore: takes the values that the keeper's mails hold for the days the restored database lacks, stores each as a retired row, retires every stored value whose place is above the restored head, and writes the day's public `restore` row from the restored head | "head-restore-mark: restore recorded for <day>. The last published value that still verifies is of <day>. <n> later values are shown as retired." |
| `automation-status` | each adapter, each setting, each of the four impact-assessment dates, the use of every limit of a program, what a program found today and what its sweep gave up on; never a token or an address | a line each: "automation-status: edge purge: <off\|test\|cloudflare>; <n> purges waiting, <n> failed in 24 hours."; "... R1 check: <off\|test\|onnx>, acts <on\|off>; model <name>, threshold version <n>; impact assessment <day\|not set>, for its measure <day\|not set>."; "... known material: <off\|test\|source>, acts <on\|off>; impact assessment <day\|not set>, for its measure <day\|not set>; <n> uploads unchecked, the oldest since <instant>; refusals <n> of <refusalsPerHour> this hour."; "... head witness: <off\|test\|rfc3161>; last value <day>, witnessed <yes\|no>; keeper's mail <set\|not set: no daily mail is sent>."; "... signed-out readers: <counted\|not counted>."; "... a program's findings today: <n> under R1, <n> under R2, <n> without a rule; signals the sweep left unhandled after 24 hours: <n>."; "... a program's decisions under R1: <n> of <decisionsPerHour> this hour, <n> of <decisionsPerDay> today; under R2: <n> of <r2DecisionsPerHour>, <n> of <r2DecisionsPerDay>."; "... a program's measures waiting for a person: under R1 <n> of <unansweredMax>, under R2 <n> of <unansweredMax>; the oldest unanswered request for a person: <instant\|none> (no new measure under either rule once one is older than <unansweredHours> hours)." |

`audit-verify` gains one check and one line: "audit-verify: <n> decisions without a decider, each with its
automated_decided row." It exits 1 with "audit-verify: decision <id> has no decider and no automated_decided row
in the chain" otherwise. `text-verify` reports a `quarantine_files` row without an image row or a release, and a
released post that still has an image row without `erased_at`; it reads image rows only through two plain
functions of the media module's index that take the caller's transaction (`quarantineOrphans`,
`releasedUnerased`), as `quarantine-list` does, since no
file outside the media module names `post_media`. `tco-counts` is 3f's, unchanged.

## 9. The app and the public pages

3c 9, 3e 9 and 3f 9 stay. 3d adds two public pages, two notice screens, one form and words. The pages' fixed
texts are `RULES_PAGE` and `TRANSPARENCY_PAGE` in `apps/app/src/lib/public-pages.ts` (W.1, W.2); the words of an
automated step, of a refused upload and of a release are `AUTOMATED_WORDS` in `apps/app/src/lib/moderation-words.ts`
(the keys below) and the constants of `@korbat/rules` (W.3 to W.6), which the mails and the console use too.

### 9.1 The two public pages, in common

- `apps/app/src/app/rules.tsx` and `transparency.tsx`, outside `settings/`, inside `AppShell`, signed in or out.
  Neither reads the session for its content, and neither sends anything but its one `GET`.
- **Links.** The terms page links both under its sections, above "Report something on korbat". The report form
  links "The rules" beside its list of rules. Every statement screen links "The rules page" after its rule. The
  rules page and the transparency page link each other and How Explore works.
- **A public page points at no person.** No handle, no post, no address of a post, no day of a decision, no row.
  The transparency page shows what the stored edition holds and never a live count (section 2, rows 1 to 3).
- **When the route does not answer**, the fixed texts are shown and the fetched part reads [page.down]: "korbat
  could not load this part right now. Try again in a minute." The rules page never prints a tool as off or on
  without the route's answer.
- **The facts are read fresh.** `GET /api/public/facts` answers `Cache-Control: no-cache` (it is a handful of
  values read from memory), so `/rules` prints what is switched on now, also in the minute after a restart: the
  runbook's "read `/rules`" and every reader see the same. The two other public routes may be an hour old; they
  hold nothing that changes within a day.
- **Accessibility.** Each heading is a header of its level; each table is a list of rows read as "label: value"
  and is laid out as blocks under 600 px; a banded figure is text, never a chart.

### 9.2 The rules page (`/rules`)

In this order; the words are W.1.

1. The title "The rules" and [rules.lead].
2. **"The rules"**: each rule of `RULEBOOKS[RULES_VERSION]` with its id, title, text, "Allowed" and "Not allowed",
   then [rules.law], the paragraph on illegal content.
3. **"What korbat can do, and when"**: the measures from `MEASURES`, then the numbers of `STANDING_RULES` and of
   `ORDER_RULES` as the sentences the terms already build from them (3e W.7, 3f W.6): the same builder functions,
   so one number has one sentence in both places and the table test holds both.
4. **"Automation"**: [rules.auto.lead], then one block a tool from `GET /api/public/facts`, each `TOOL_TEXTS[tool]`
   in the state the answer gives (W.1). Inside the block of each of the two tools that rate or compare images,
   while it is on: [rules.auto.dpia] with that tool's own date and, while its measure is switched on,
   [rules.auto.dpiaActs] with the date of the assessment that covers the measure. A date is never printed over
   a tool it was not set for. Then [rules.auto.cap] and [rules.auto.target], or [rules.auto.none] while no tool
   is on.
5. **"Version and changes"**: "This is version {RULES_VERSION} of the rules." and one line a member of
   `RULES_CHANGES`, newest first: "Version {version}, {date}: {summary}".

### 9.3 The transparency page (`/transparency`)

In this order; the words are W.2. The page reads `GET /api/public/transparency` (the editions, each with its
versions, and the recipients' bounds) and `GET /api/public/head`.

1. The title "Transparency" and [tr.lead], then [tr.read], how to read a figure.
2. **One section a year**, newest first, headed "{year}", with [tr.edition] and the tables of W.2 from the newest
   version's `figures`. A table with no row is replaced by its "none" sentence. Under it, when the year has older
   versions, [tr.versions] and one line a version; an older version opens in place.
3. While no edition exists: [tr.none]. The running year has no section.
4. **"Authorities' orders"**, inside each year that has the section: [tr.orders] and 3f W.9's headings with the
   figures. Under every year, whether it has the section or not, the standing sentence [tr.ordersHeld].
5. **"Recipients"**, inside each year's section: [tr.recipients] with the edition's two bounds, which are of the
   six stored months before that edition's due day and are the same in every version of the year; once on the
   page, under the newest year, [tr.method].
6. **"The audit log's daily value"**: [tr.head], the last 30 days as rows (day, value, witness), a `restore` row in
   its place among them with [tr.restore], retired values marked [tr.retired], and [tr.verify] with the download of
   a day's token while a witness is on.
7. **"The Transparency Database"**: [tr.tdb].

### 9.4 A measure a program took, as its author sees it

- **Chips.** A post's chip is 3c's ("Under review: R1"; an image shows "Under review" or "Sealed: not shown to
  anyone, you included"), linking to the decision. Nothing on a post says "program": the decision's screen does.
- **The decision's screen** (`/settings/cases/[id]`) shows the chip [auto.chip] "Taken by a program" beside the
  day, then the statement (W.3), whose sentences say that automated means found the image and took the measure
  and that no person was involved yet.
- **"Ask for a person"** [auto.ask], a button under the statement while the measure is in force and no objection
  exists. It opens one field (1 to 2000 characters) under [auto.askLead]: "Write anything a person should know.
  You can send one message. A moderator reads it and lifts the measure or decides the case; for sealed images an
  admin does. You get that decision's statement either way. You do not need to cite rules or law."
- **A suspended account can still ask.** The button and the route work for an account under 3e's suspension and
  for one whose termination is not yet final, as the reply and an appeal do: both objection routes of 3d are
  among the writes a suspension leaves (section 15, the 3e design). The way to a person that a statement
  promises is never closed by a standing measure.
- After sending, [auto.asked]: "You asked for a person on {createdAt}. korbat's target is an answer within
  {objectionTargetHours} hours." and the text as sent. The number is the published target, not a promise of an
  end: the measure lapses by no timer (section 2, row 25).
- Once a person has decided, the button is gone and [auto.decided] reads: "A person has decided since: the
  decision of {decidedAt}, listed under Settings, Cases." with a link to it. `objection_not_open` is worded the
  same way.
- A person's later decision on the same case is 3c's screen; its statement carries W.3's sentence that the image
  was found by automated means.

### 9.5 A refused upload

- **Which uploads are refused.** Only an upload whose match is of the acting kind: the source reports it as
  exact, with an entry it classifies as child sexual abuse material (rulings 3 and 4 of the review). An upload
  whose match is not exact, or is of another class, is accepted like any other, and the app shows nothing about
  it. Once it is on a post, a match of the listed class that is not exact is put before an admin as a finding
  under rule R2, which freezes the post and takes no measure, and a match of another class is a flag in the
  queue (8.3, 8.4). Either way its uploader hears of it only if a person later decides something.
- **In the composer.** The image's tile shows [upload.refused] "This image was not accepted." with the link "Why"
  to its notice. Posting with it attached is answered `upload_refused` (422): [upload.refusedPost] "This image was
  not accepted, so the post was not sent. Remove the image to post. Its notice is under Settings, Cases."
  Removing the tile removes it from the composer only: the upload stays held. While a comparison is switched on,
  the same holds for an upload that is removed before its check has answered: the composer forgets it at once,
  and korbat deletes it only once the check has answered and found no match.
- **An upload over the limit of refusals** (`AUTOMATION_RULES.refusalsPerHour`: a burst of matches is more
  likely a fault of the source than so many uploads of such material) is neither refused nor made ready. Its
  tile stays as any upload that is still being processed, in 2b's own words, no notice exists and nobody is told
  of a match, until a person has looked at the alert and the check has answered again.
- **The notice** (`/settings/cases/uploads/[id]`): `UPLOAD_NOTICE`'s paragraphs (W.5), rendered fresh, so its state
  paragraph follows the hold. No image is shown: the uploader cannot open it either. A held or refused upload is
  in no other screen, list, count or export: the notice is all its uploader is given.
- **"Object"** [upload.object], for as long as the refusal has no objection, is not released and has not ended
  as "No report" (so also after an admin chose "Report", while korbat still holds the file): one field (1 to
  2000 characters) under [upload.objectLead]: "Write anything the admin should know. You can send one message.
  The admin reads it and decides without viewing the image. What you write is kept with this record for as long
  as korbat keeps the file." After sending, [upload.objected]: "You objected on {objectedAt}. An admin reads
  what you wrote; korbat tells you here what was decided, and by email when the hold is lifted." A suspended
  account can object as it can ask for a person (9.4).

### 9.6 A release, an image being restored, and the lists

- **The release's notice** (`/settings/cases/releases/[id]`): `RELEASE_NOTICE`'s paragraphs (W.6) and no control.
  When an appeal of the seal is waiting it links that decision's screen, whose appeal state reads [release.appeal]:
  "Your appeal is still open. An admin reviews it; korbat has released the images and will not show them again."
- **A release that may not be told yet.** While one of the three holds of 8.5 stands (the leave's own mark, the
  mark "not to the person" on the record of the report, or 3f's hold for an authority's order about a post of
  the release), the release's notice is `held` and no screen of the app shows the release: no notice, no list
  entry, no mail, no member of the export, and the post's sealed placeholders read as they did under the seal.
  Everything appears together when the last hold has ended, and never before it.
- **An image being restored.** An image whose seal was lifted and whose files are not back yet is not served
  (404). Its author sees, in the post and in the viewer, [image.restoring]: "This image is being restored. It is
  shown again once korbat has moved it back; you do not need to do anything." Anyone else sees what a missing
  image shows. The fact reaches the post this way: when an image of the viewer's own post fails to load, its
  component asks `GET /api/media/:id` once, and prints [image.restoring] when the answer says `restoring` and
  [image.lost] when it says `lost`; `PostView` stays unchanged.
- **An image korbat lost.** A file that was in the quarantine, or on its way there, and is found in neither
  place is recorded as lost (section 7.1); an image whose seal was lifted is then never "being restored". Its
  author sees [image.lost]: "korbat lost this image's files while they were kept apart from its other images. It
  cannot be shown again. You can delete the post, or post the image again." The mail `image_lost` (W.8) says the
  same once, and nothing tells the author to wait.
- **Settings, Cases, "About you"** lists three more kinds of entry, each with its day: "Taken by a program: {what}"
  for an automated decision (then 3c's line once a person has decided); "An upload was not accepted" for a
  refusal; "Sealed images released" for a release.
- **The status page of a report or a notice** (3c 9) and its update by mail print, for a decision that is
  recorded as partly automated, `update.automated.partly` (W.3) in the place of 3c's fixed sentence "No
  automated means were used to decide."; for every other decision 3c's sentence stands. Whoever reported is so
  never told less than the author about the same decision (DSA Art. 16(6)).
- **Unchanged.** How Explore works (`/explore/about`): 3d changes no formula and adds no line to it. The report
  form but for its link to the rules page. The export gains W.10's members.

### 9.7 Errors

The app's message table gains `upload_refused` ([upload.refusedPost]), `objection_not_open` ([auto.decided],
without the day) and, for both forms, `rate_limited` in the table's own words. Every other code of 3d is staff's
or the command line's.

## 10. Contracts

`packages/contracts/src/automation.ts` and `transparency.ts` (new), `moderation.ts`, `staff.ts`, `media.ts` and
F's `orders.ts`; `packages/media-protocol/src/result.ts`; `packages/rules`. Each table below is the one source
its words and numbers are taken from: the console, the app, the public pages, the mails, the terms and the README
use it, and a test pins each (section 12). Every schema is strict; none has a transform but the ids that already
have one.

### 10.1 Constants

**The mirrors.** Each number is a constant of one SQL function and is mirrored here; a database test holds the two
equal, and each CHECK list to its constant, as C 10 does.

| Constant | Mirrors | Members |
|---|---|---|
| `AUTOMATION_RULES` | `automation_rules()` | `decisionsPerHour` 20 and `decisionsPerDay` 100 (R1's), `r2DecisionsPerHour` 20 and `r2DecisionsPerDay` 100, `unansweredMax` 20, `unansweredHours` 72, `refusalsPerHour` 20, `noReportHours` 24, `r1Threshold` null, `r1ThresholdVersion` 1, `objectionTargetHours` 24, `matchTimeoutMs` 3000, `matchRetryHours` 24, `matcherDownMinutes` 15, `pdqMinQuality` 50, `matchKeepDays` 180 |
| `RELEASE_RULES` | `release_rules()` | `silenceDays` null, `periodNoticeDays` 30, `backupDays` 30 (held to `RETENTION.backupDays`). The function's fourth column, `posts_max`, is mirrored as `RELEASE_POSTS_MAX` (below), and the same test holds it. No member lets an answer release: the ground is a recorded leave (7.2) |
| `TRANSPARENCY_RULES` | `transparency_rules()` | `floor` 10, `roundTo` 10, `dueMonth` 3, `dueDay` 1, `method` 1; and `band(n)`, which answers `0`, `1 to 9` or `about <n rounded>` exactly as the SQL `band` does (a table test over 0 to 200) |
| `SIGNAL_RULES` | the constants of `case_flag` | `minItems` 5, `minReporters` 5, `windowMinutes` 60, `linkedShare` 0.5 |

**What only the API reads.**

| Constant | Members |
|---|---|
| `EDGE_CACHE` | `browserSeconds` 60, `edgeSeconds` 300: the two numbers of the header (7.4) and of every sentence that states the bound |
| `EDGE_RULES` | `prefixes` 30, `roundSeconds` 15, `timeoutMs` 5000, `backoffSeconds` 30, `backoffMaxSeconds` 3600, `giveUpHours` 24, `keepDays` 30 |
| `RECIPIENT_RULES` | `method` 1, `months` 6, `saltHours` 26, `sketchDays` 70, `userAgentBytes` 256, `crawler` (the pattern of 7.5) |
| `RECIPIENT_READ_ROUTES` | the seven method-and-path patterns of 7.5; a route-table test fails when the social module gains a signed-out read that is not listed or refused here by name |
| `HEAD_RULES` | `tag` `korbat.head.v2`, `shownDays` 30, `witnessTimeoutMs` 10000, `tokenMaxBytes` 16384 |
| `RELEASE_POSTS_MAX` | 1000, the mirror of `release_rules().posts_max`: the posts one release's params may name; a seal over more is released in parts (7.2) |
| `MATCH_RETRY_BATCH`, `SWEEP_BATCH`, `SWEEP_HOURS` | 20, 20, 24 (7.8, 7.9) |
| `MATCH_LISTED` | declared by each matcher adapter: the classifications that its source itself names child sexual abuse material. An answer of any other classification is a flag (7.8). The test adapter declares one listed and one that is not; a database test holds `match_listed()` to every adapter's list |
| `MATCH_ACTING` | declared by each matcher adapter, a part of its `MATCH_LISTED`: the classifications of its source on which a program may act. The test adapter declares one; a database test holds `match_acting()` to every adapter's list |

**Closed lists**, each the CHECK of its column: `SIGNAL_KINDS` (`r1_score`, `known_match`); `SIGNAL_HANDLED`
(`finding`, `measure`, `capped`, `covered`, `gone`); `CHECK_STATES` (`pending`, `clear`, `matched`, `unchecked`,
`capped`); `MATCH_HASH_TYPES` (`sha256`, `sha1`, `md5`, `pdq`); `MATCH_KINDS` (`exact`, `near`); `UPLOAD_ENDS`
(`report`, `no_report`); `UPLOAD_END_REASONS` (`source_withdrew`, `counsel_no_duty`, `other`);
`MATCH_ANSWER_REASONS` (`source_withdrew`, `counsel`, `other`: an answer without a seal on an acting match,
7.11); `RELEASE_BASES` (`leave`, `period`); `RELEASE_LEAVE_FROM` (`authority`, `court`); `RELEASE_NOTICE_STATES`
(3c's delivery states and `held`: the column `releases.author_notice` is text under this CHECK, since
`delivery_state` is an enum and gains no value); `CAP_LIMITS` (`hour`, `day`, `unanswered`, `waiting`); `QUARANTINE_WORDS`
(`done`, `already`, `missing`, `lost`, `refused` for a move; `quarantine`, `store`, `both`, `already` for a
`destroy` line; and the line kind `have`); `EDGE_PURGE_CAUSES` (`state`, `deleted`, `released`);
`EDGE_PURGE_OUTCOMES` (`accepted`, `failed`, `off`); `EDITION_REASONS` (`first`, `hold_ended`, `correction`);
`HEAD_KINDS` (`head`, `restore`); `HEAD_WITNESSES` (`none`, `rfc3161`, `test`). The intake kinds gain `automated`
and the intake channels `system`; an `automated` intake may cite no rule (a flag, 7.9), which no other kind
may; `ACTION_KINDS`, `MEASURES`, the decision kinds and the sources gain nothing: a program's measure is one of
3c's.

**`ALERT_KINDS`** (F 10.1) gains twelve kinds, each with priority 3, scope `all`, a push and a mail, and `mail:
"sentence"`; `ALERT_TEXTS` holds each one's title, sentence and line (section 18).

| Kind | Facts | Written by |
|---|---|---|
| `quarantine_due` | `count`, `oldestAt` | `alert_steps()`, daily |
| `quarantine_lost` | `count`, `at` | `staff.js quarantine-record`, with its record |
| `release_undestroyed` | `count`, `oldestAt` | `alert_steps()`, daily |
| `matcher_down` | `since`, `count`, `refusalsCapped` | `alert_steps()`, daily; at once by the first `capped` upload of an hour |
| `edge_purge_failed` | `count`, `oldestAt` | the job `edge-purge` |
| `head_unwitnessed`, `head_missed` | `day` (the day's first instant) | the job `transparency` |
| `automated_waiting` | `count`, `oldestAt` | the job `automated-sweep`, daily |
| `automated_objection` | `at`, `count` | `staffAlert`, after the objection's commit |
| `automation_capped` | `at`, `limit` (one of `CAP_LIMITS`), `count` | `staffAlert`, after the step's commit |
| `seal_released` | `at`, `posts`, `uploads` (counts) | `staffAlert`, after a release's commit, to every staff account, no throttle |
| `hold_ended_unreported` | `at`, `until` (when the upload is deleted) | `staffAlert`, after the commit of a hold's end as `no_report`, to every staff account, no throttle |

`moderation_urgent` keeps its entry; its staff message gains `heldUploads` (a count), which its mail prints as a
second sentence when it is above zero.

### 10.2 The worker's result, and what the app's side gains

- **`ResultFile`** (`packages/media-protocol/src/result.ts:12`) is the union of version 1 as it stands and
  version 2: version 1's members with `v: 2`, and on a ready result the optional members `r1 { model, score }`
  (`model` a name of at most 64 characters of `[a-z0-9._/-]`, `score` a number from 0 to 1) and `pdq { impl,
  hash, quality }` (`impl` a positive integer, `hash` 64 lower-case hex characters, `quality` an integer from 0
  to 100). The worker writes version 2; the API reads version 1 as it stands and version 2, and refuses every
  other version, member and range. The model's name and digest are constants of `packages/media-protocol`,
  which the worker and the API both import: `finalize` refuses a model name that is not this build's, and the
  facts route prints both. The scorer's interface is `score(pixels, width, height, channels)`.
- **`MediaStatusResponse`** (`media.ts:64`) gains a fourth variant, `{ id, status: "refused", refusalId }`, which
  holds nothing of the file (no blurhash, no sizes), and its ready variant the optional `restoring: true` and
  `lost: true` (7.1), of which at most one is set. An upload whose check is `capped` answers `processing`.
  `MediaErrorCode` gains `upload_refused`, and the media module's statuses gain 422.
- **`DecisionStatement`** (`moderation.ts:1291`) gains `automatedDetection` (boolean), `automatedDecision`
  (`not_automated`, `partially` or `fully`) and `signal`: null, or `{ kind, source, matchKind, listedAs, viewed
  }` with `kind` one of `SIGNAL_KINDS`. For a match: `source` the adapter's declared name; `matchKind` one of
  `MATCH_KINDS`, **derived, not copied**: `exact` only when the record's hash type is a cryptographic one and
  its kind is `exact`, `near` for every match of a perceptual hash whatever the source called it; `listedAs`
  `csam` when `match_listed` accepts the record's classification and `other` otherwise (a program's own
  decision and a refusal always read `csam`, since only an acting match takes a measure or refuses; `other`
  reaches a statement only through a person's decision that considered a flag); `viewed` null. For a score:
  the first three null, and `viewed` a boolean on a person's decision (an `image_viewed` row of
  `case_access_log` exists for the decider and the signal's image on this case before `decided_at`, and the
  decision's `unseen` is false), null on a program's. It is read from the decision's own columns and its
  signal, or, for a person's decision, from the automated item it considered, never from a later event. A
  decision made before 3d reads `false`, `not_automated`, null.
- **The line of an update to whoever reported** (`notice_update`'s lines and the decided lines of
  `NoticeStatus` and `ReportsPage`) gains `automatedDecision`, the decision's own value: the one change to
  those three (7.10).
- **`AuthorCaseRow`** gains `byProgram` (boolean). **`DecisionView`** gains `askPerson`: null for a decision with
  a decider; else `{ state: "open" }` while a measure of it is in force and no objection exists, `{ state:
  "asked", text, createdAt }`, or `{ state: "decided", decisionId, decidedAt }` once no measure of it is in
  force, naming the person's decision that ended it.
- **`ObjectionRequest`** `{ text }`: 1 to 2000 characters after trimming, under `text.ts`'s rules, no transform.
  It is the body of both objection routes.
- **`AuthorNoticesPage`** (`GET /api/moderation/notices`): `{ notices: [{ kind: "upload_refused" | "release", id,
  at }], nextCursor }`, newest first, 20 a page: the caller's refusals (`MediaForCases.refusalsOf(ownerId,
  cursor)`) and the releases about the caller's posts or uploads, without a release whose notice is `held`.
- **`UploadRefusalView`** (`GET /api/moderation/uploads/:refusal`): `{ id, refusedAt, source, matchKind, listedAs,
  objection: { text, objectedAt } | null, mayObject, endedAt, endAs, endReason, released, reportKept }`: what
  `uploadNoticeParagraphs` reads, and nothing of the file. `matchKind` is derived as in the statement and
  `listedAs` is always `csam`. `mayObject` is 7.12's one rule. `endedAt`, `endAs` and `endReason` (one of
  `UPLOAD_END_REASONS`) are null while the hold stands, and for an end as `no_report` until its `hold_until`
  has passed: the uploader is told of that end when it is one. `released` is the release's time, and null
  while there is none or its notice is `held`. `reportKept` is true while a record of a report under F names
  the refusal (its `notification_id` is set), so that the notice says how long the account stays on that
  record. No hash, no classification string, no list version, no admin.
- **`ReleaseNoticeView`** (`GET /api/moderation/releases/:release`): `{ id, basis, releasedAt, backupsClearAt,
  upload, posts: [{ id, createdAt }]` (at most 20), `postCount, images, sealDecisionId }`: what
  `releaseNoticeParagraphs` reads, and the decision that sealed, for the link. `basis` is `leave` or `period`.
  Never an answer's word or an assessment, who gave the leave, the authority or a reference. The route answers
  `not_found`, and the notices list leaves the release out, while its notice is `held`.
- **Unchanged:** `PostView`, `MediaView`, `HiddenMedia`, `MeResponse` and every request of 3c, E and F but
  `CaseDecidedParams` (10.4). Nothing on a post says "program": the chip is 3c's, and the decision's screen says
  it. The export's new members are section 18's; a held or refused upload is in none of them (7.8).

Each of the three reads answers `not_found` to anyone but its subject, as `GET /api/moderation/decisions/:id`
does, so no id can be tested by a stranger.

### 10.3 Staff answers

No member below is named like `email`, `address`, `userId`, `accountId` or `actorId` (the route-table test's
`PERSONAL` runs over them), and none holds a score, a hash value, a file's name or digest, a source's raw answer
beyond the three framed strings, or an uploader's handle.

| Answer | Gains |
|---|---|
| `StaffOverview` (`GET /api/staff/overview`; the schema is in `contracts/src/moderation.ts:1487`, the answer is built by `overview` in `moderation/cases.ts`) | `quarantine` `{ dueIn, dueOut, undestroyed, oldest }`, the four values of `quarantine_counts()`; `automated` `{ waiting, oldestAt, objected, oldestObjectionAt, flags, cases, objectedCases }`, `flags` the open cases with a match flag, the last two at most 20 case ids each; `heldUploads` `{ open, oldest, objected, capped }`, `objected` counting also a hold ended as `report`, not released, with an unanswered objection, `capped` the uploads that wait under the limit on refusals; `destructive`: the releases and the holds ended as `no_report` of the last 30 days, at most 50, each `{ kind: "seal_released" \| "upload_released" \| "hold_ended_unreported", at, caseId \| null, refusalId \| null }` |
| `QueueRow` (`moderation.ts:917`) | `foundByProgram`, `takenByProgram`, `objected`, `matchFlag` (booleans), `flag` (`{ items, reporters }` or null). `matchFlag` is true while the case holds an unanswered automated item that cites no rule. The cursor carries `objected`, which sorts before age inside a lane |
| `CaseView` | `signals`: one an automated item, `{ itemId, kind, thresholdVersion, match }`, `match` null for a score, else `{ source, listVersion, hashType, matchKind, classification, listed, acting, queriedAt }` (`source`, `listVersion` and `classification` are a third party's strings, at most 100 characters each, drawn framed; `hashType` lets the console say what an MD5 or a SHA-1 match is worth); `objection` `{ text, createdAt }` or null; `purges`: one an image of the newest snapshot, `{ mediaId, outcome, at }`, `outcome` one of `EDGE_PURGE_OUTCOMES` or `pending`; `flag`; on each image, `matched` (boolean): staff are served no file of it (7.11) |
| `CaseDecision` | `byProgram` (true when it has no decider; it then names no staff member); `matchAnswerReason` (one of `MATCH_ANSWER_REASONS`, or null); on a `seal_media` of a decision that is not interim, `custody`: `{ files, moved, movedAt, toReturn, filesLeft, lost }`, the answer of `seal_custody(action)`, counts and one time for the seal, never a file's name or digest and no list by image; and `release`: `{ reported, theirReference, answer, answeredAt, handedOverAt, quarantined, preserved, leave, tellHeld }` (the fourteen facts of `release_facts`; `leave` is null or `{ id, from, reference, receivedOn, untold, untoldUntil }`, the function's six `leave_` columns, which are those of the newest leave recorded for the seal's report that is not withdrawn: a withdrawn leave is in no answer, and with none standing `leave` is null; `untoldUntil` is an instant or null, and null with `untold` true is an open end; `tellHeld` is true when the author's notice of a release taken now would be held), `postIds` (the lowest `RELEASE_POSTS_MAX` of the seal's posts not yet released), `remaining` (how many more), `silenceDays`, and once released `releasedAt`, `basis`, `backupsClearAt`, `noticeHeld` |
| `CaseItem` | `sameSourceOpen` (a count); for an item of an `automated` intake the source summary is the fixed label "Found by a program" and nothing else, also for an item that cites no rule: what such an item is, the chip and the case's own sentence say (section 8) |
| `AppealRow`, `CaseAppeal` | `released`: `{ at, basis }` or null |
| `UploadsPage` (`GET /api/staff/uploads`, new) | `{ uploads: [...], nextCursor }`, 50 a page, in 7.12's order: a refusal that ended as `report` and is not released stays on the list for as long as that lasts; each `{ id, refusedAt, match` (as in `signals`), `otherRefusals, uploaderGone, objection, objectedAt, endedAt, endAs, endReason, deletesAt, reported, quarantined, release }`, `otherRefusals` as 7.12 counts it, `deletesAt` the `hold_until` of an end as `no_report`, `quarantined` the answer of `media_quarantined` for the upload, `release` as on a seal without `postIds` and `remaining` |
| `RestoreView` (F) | the class `release` among its gaps; `mayOpen` false while one is open |

`theirReference` and a leave's `reference` are the two strings of an authority or a court that an answer
carries, both bound as F binds a reference; the console draws them framed, and no answer of the app carries
either. The API's role reaches the quarantine through six functions and no table: `quarantine_counts()`,
`seal_custody(action)`, `media_quarantined(media)`, `media_lost(media)`, and for the lost image's notice
`lost_untold(n)` and `lost_told(media, outcome)` (section 6.1).

### 10.4 The step-up's params, and the program's

`STAFF_STEP_UP_ACTIONS` gains three keys, `StaffStepUpOptionsRequest` three members, and
`append_confirmed_audit`'s list the three actions. All three are an admin's; the database refuses anyone else.

| Action | Route | Target | Params (strict) |
|---|---|---|---|
| `seal_released` | `POST /api/staff/seals/:action/release` | `seal`, the seal's ledger row | `SealReleasedParams`: `postIds` (1 to `RELEASE_POSTS_MAX` lower-case uuids, sorted, without a repeat: the lowest unreleased posts of the seal, as the page showed them), `basis` (one of `RELEASE_BASES`), `leaveId` (the recorded leave's id, or null), `theirReference` (the leave's reference as its record holds it, or null) |
| `upload_hold_ended` | `POST /api/staff/uploads/:refusal/end` | `upload_refusal`, the refusal | `UploadHoldEndedParams`: `endAs` (one of `UPLOAD_ENDS`), `reason` (one of `UPLOAD_END_REASONS`, or null). Neither value of `endAs` is a default: a request without it is refused |
| `upload_released` | `POST /api/staff/uploads/:refusal/release` | `upload_refusal` | `UploadReleasedParams`: `basis`, `leaveId`, `theirReference`, as above |

- **Refinements**, each checked again by the database: `leaveId` and `theirReference` are set exactly when
  `basis` is `leave`; `reason` is set exactly when `endAs` is `no_report`. No param carries an authority's
  answer: an answer is no ground (7.2).
- **The one string.** C 10's rule that a param is never a free string keeps F's named exception and gains no
  other: `theirReference` is a reference as F binds one, here the file number under which an authority or a
  court gave its leave or instruction, and `releases_confirmed` compares it and `leaveId` with the leave's
  record at commit. The schema test lists it by name. The leave itself is no param anyone types into the
  console: it is recorded from the command line and named by its id.
- **What the console checks before the key:** that the options it signs name this seal or refusal, the posts,
  the ground, the leave and the reference that the page showed (3a's rule, as for a decision).
- **`case_decided` gains one member; `appeals_reviewed` is unchanged.** `CaseDecidedParams` gains
  `matchAnswerReason`: one of `MATCH_ANSWER_REASONS`, set exactly when the decision is final, holds no
  `seal_media` and considers an automated item whose match is acting, and null otherwise (7.11). It is an
  enum, signed with the key and compared by `decision_holds` as every other param. A correction that lifts a
  program's measure and an admin's answer to an automatic seal are `case_decided` as built otherwise.

**`AutomatedDecidedParams`** is not a step-up's: it is the `params` of the system's audit row, and
`decision_holds` compares it with the decision as it compares `CaseDecidedParams`. It has that schema's members
with these values fixed: `kind` `interim`; `throughSeq` 0; `reviewsDecisionId` null; `outcome` `restricted`;
`ground` `incompatible`; `ruleId` R1 or R2; `categoryKeyword`, `factsDigest`, `reasonDigest`,
`legalReferenceDigest` and `matchAnswerReason` null; `actions` exactly one entry, `{ kind: "withhold_media", mediaId }` or `{ kind:
"seal_media", mediaId: null }`. `stateVersion`, `snapshotId`, `snapshotDigest`, `rulesVersion`, `redressVersion`
and `category` are the transaction's own.

### 10.5 The audit actions

Every action is its transaction's last statement. "System" is `SYSTEM_ACTOR_ID`.

| Action | Actor | Step-up | Target | Metadata |
|---|---|---|---|---|
| `automated_decided` | system | no | `case` | `params` (`AutomatedDecidedParams`), `decisionId`, `signalId`, and F's `target` |
| `seal_released` | staff | yes | `seal` | `params`, `releaseId` |
| `upload_hold_ended` | staff | yes | `upload_refusal` | `params`, `mediaId` |
| `upload_released` | staff | yes | `upload_refusal` | `params`, `releaseId`, `mediaId` |
| `release_leave_recorded` | system | no | `notification` | every member of the leave: `leaveId`, `from`, `reference`, `receivedOn`, `untold`, `untoldUntil`, and the gap it closes after a restore, if any. Written when the command records a leave and when it ends an open `untoldUntil` |
| `release_leave_withdrawn` | system | no | `notification` | `leaveId`, and the gap it closes after a restore, if any. Written when the command withdraws a leave (`release-leave --withdraw`) |
| `release_replayed` | system | no | `release`; `upload_refusal` for a replayed end of a hold | `replayOf` (null for a hold's end), `posts` and `images` (counts), `upload` (boolean), and for a hold's end `endAs` and `mediaId` |
| `quarantine_recorded` | system | no | none | `in`, `out`, `destroyed`, `mismatched`, `lost`, `found`, `againstPlan`, `reported` (counts), `receiptSha256` |
| `edition_published` | system | no | `edition`, `<year>.<version>` | `year`, `version`, `reason` |
| `head_restore_marked` | system | no | none | `day`, `retired` (a count) |
| `moderation_retention` (C 7.9) | system | no | none | the steps `automation_records`, `edge_purges` and `tools_off` with their counts |
| `notification_recorded` (F) | system | no | `notification` | written by `upload-report` with the step `opened`, as F's command writes it |
| `case_decided` (3c's) | staff | yes | `case` | its `params` now hold `matchAnswerReason` |

- **The bound on metadata** is F 10.5's: ids, enums, numbers, booleans, instants and hex digests, and the two
  named strings, of which 3d uses one, the reference (in `seal_released`'s and `upload_released`'s params and
  in `release_leave_recorded`). Never a score, a hash of an image, a source's answer, an authority's answer or
  assessment, a handle or a text. The audit-metadata test walks every action above with the largest request.
- **`audit-verify`** gains one check: every decision without a decider has, in the chain, an `automated_decided`
  row of the system actor without a step-up that names it, and no other row names it as its `decisionId`. A
  system decision without that row, or a row of that action that carries a key, fails the run.
- **What the keeper's copy must hold after a restore.** For a replay: `seal_released`'s and `upload_released`'s
  params, `releaseId` and `mediaId`, and the line's time. For a gap that a person closes: `automated_decided`'s
  `decisionId`, `signalId` and target, `upload_hold_ended`'s params and `mediaId`,
  `release_leave_recorded`'s members and `release_leave_withdrawn`'s `leaveId` (7.3). Nothing else of 3d is
  replayed or listed.

### 10.6 The public answers

Three routes, mounted before session resolution (`app.ts:69`) and after the global rate limit: none reads a
session, a cookie or a table of a person. `/api/public/transparency` and `/api/public/head` answer
`Cache-Control: public, max-age=3600`. `/api/public/facts` answers `no-cache`: it is a handful of values read
from memory, and after a tool is switched on or off the rules page, and the operator who reads it as the
runbook says, must not be given an hour-old answer.

| Route | Answer |
|---|---|
| `GET /api/public/facts` | `PublicFacts`: `r1` `{ state: "off" \| "flags" \| "withholds", test, model, digest, threshold, thresholdVersion, publisherClaim, dpia, dpiaActs }` (the five before `dpia` null while no classifier is built in); `match` `{ state: "off" \| "alerts" \| "seals", test, source, dpia, dpiaActs }`; `edge` and `witness` `{ on, test }`; `recipientsSignedOut` (boolean). `dpia` and `dpiaActs` are a day or null each: the tool's own impact assessment and the one that covers its measure, so no date of one tool stands over another. Booleans, names, days and numbers: never a token, a zone, a host or an address |
| `GET /api/public/transparency` | `PublicTransparency`: `editions`, one a year, newest first, `{ year, version, publishedOn, method, reason, figures, older: [{ version, publishedOn, replacedOn, reason, figures }] }`; `figures` is the stored JSON as section 6.4 computes it, with the members `restrictions` (`byGround`, `byMeasure`, `total`), `noBreach`, `intakes`, `appeals`, `reexaminations`, `accountMeasures`, `automated`, `uploads`, `orders` (absent when no countable order exists) and `recipients`: banded strings, the order section's numbers when it exists, and `recipients` as two rounded bounds, one, or the string `not recorded` |
| `GET /api/public/head` | `PublicHead`: `days`, the last `HEAD_RULES.shownDays`, each `{ day, kind, value, witness, token, retiredOn }`; `token` base64 or null; `witness` reads `none` for a row without a token. Never the place |

A schema test holds that no public answer has a member that could hold an id of a post, a case, a decision or an
account, a handle, a day of a decision, or a number under ten outside the order section.

### 10.7 Error codes

| Code | Status | Raised by | Answered on |
|---|---|---|---|
| `upload_refused` | 422 | `post_media_refused`, when a matched upload is attached | `POST /api/posts` (a media error) |
| `objection_not_open` | 422 | `automated_objections_insert`; the objection's primary key; the refusal's guarded update | the two objection routes |
| `release_not_open` | 409 | `seal_release`, `upload_release` | the two release routes |
| `release_not_reported`, `release_not_quarantined`, `release_preserved`, `release_no_leave`, `release_period_unset`, `release_period_running` | 422 | the same, in that order of checks | the two release routes |
| `release_mismatch` | 409 | `releases_confirmed`, `upload_refusals_confirmed`, at commit | the two release routes and the end route |
| `hold_not_open` | 409 | `upload_hold_end` | the end route |
| `invalid_hold_end` | 422 | `upload_hold_end` | the end route |
| `image_matched` | 404 | `staffImage`, for an image that an unerased match record names | the staff's image route (7.11) |

- `ModerationErrorCode` gains twelve of the thirteen; `upload_refused` joins `MediaErrorCode`. The console's
  table gains words for the release's and the hold's codes and for `image_matched`, and words under its
  "changed, read again" for `release_mismatch`, so that an admin never reads a bare code; the app's table gains
  `upload_refused` and `objection_not_open` (sections 8 and 9). A release or a hold's end that the facts no
  longer allow answers one of the codes above, never `invalid_decision`.
- 3c's codes gain causes, not meanings: `admin_required` (a release, the end of a hold); `invalid_decision` (any
  difference `decision_holds` finds in a decision without a decider, a seal on a match that is not acting
  included; a person's decision that claims `fully`; a `matchAnswerReason` that is missing or one too many);
  `not_found` (a notice, a refusal or a release that is not the caller's, or a release whose notice is held;
  `DELETE /api/media/:id` on a held upload); `invalid_request` (more posts than `RELEASE_POSTS_MAX`; an
  objection outside its bounds; a hold's end without `endAs`).
- **Never answered by a route:** `already_protected` and `automation_capped` (the automated step records them on
  its signal, 7.9); `upload_attached` (the retry takes the other path, 7.8); `refusals_capped` (`finalize`
  writes `capped`, 7.8); `refusal_not_acting` (`finalize` inserts a refusal only for an acting record, so the
  database's refusal is a second lock and not a path, 7.8); `edition_not_due` and `invalid_edition` (the job asks only what is due; the command
  line prints them); `replay_no_gap` and `leave_used` (the command line prints each); `moderation_column` from the guards. A code
  the API does not know would be a 500 (`app.ts:105`), so each of these is caught where it is raised.
- **The command line's refusals** exit 1 with one sentence and write nothing: `edition_not_due`,
  `replay_no_gap`, `hold_not_open` (`upload-report` on a refusal not ended as `report`), `leave_used`
  (`release-leave --withdraw` on a leave that a release rests on, raised by the guard of `release_leaves`),
  and each command's "nothing to do". Two commands refuse no whole run. `quarantine-list` leaves out a post whose rows do not
  match its seal, names it with `handover_mismatch`, prints the other posts' lines and exits 1 at its end.
  `quarantine-record` refuses no line of a move that happened: it records what it can, reports the rest and
  exits 1 after its commit (7.1).

### 10.8 The texts' versions and places, and the settings

- `RULES_VERSION` becomes 4 (Task 8) and `REDRESS_VERSION` 4 (Task 6); versions 1 to 3 of both render as sent.
  The `Automation` type gains `flag_or_withhold` and `seal_for_review`. `RULES_CHANGES` holds one dated sentence
  a version.
- `statementParagraphs` stays a pure function of `DecisionStatement`; `uploadNoticeParagraphs` and
  `releaseNoticeParagraphs` are pure functions of `UploadRefusalView` and `ReleaseNoticeView`. The mail, the app
  and the console's preview share each.
- A table test renders a statement for each row of 7.10's table (both endings of `automated.found.r1`), an
  update to a reporter for each of the three values of `automatedDecision`, each notice in each of its states
  (the refusal's with each end and each reason; the release's with each ground), every `TOOL_TEXTS` entry and
  every `ALERT_TEXTS` entry of 3d, and holds: none contains "is child sexual abuse material", "confirmed" or
  "posted such"; none says "the same fingerprint" of a perceptual match; none says "no longer holds",
  "destroyed" in the past tense, "assessed" or "illegal" of a release; none says "looked at the image" where
  `viewed` is not true; every text of an automated step holds the automated-means sentence and a way to reach a
  person; none holds a staff handle, an "@", a reference, a hash or a score.

| Text | Constant | Read where |
|---|---|---|
| the statement's new sentences | `STATEMENT_WORDS` (`packages/rules/src/statement.ts`) | the app's decision screen, the mail, the console's preview, the export |
| the reporter's sentence on a partly automated decision | `update.automated.partly` (the same file) | `notice_update`, the status page of a report |
| the refused upload's notice; the release's; the lost image's | `UPLOAD_NOTICE`, `RELEASE_NOTICE`, `RELEASE_DAY_NOTICE`, `IMAGE_LOST_NOTICE` (the same file) | the app's two notice screens, the mails |
| redress version 4 | `REDRESS_TEXTS[4]` (`askPerson`, `askAdmin`, `uploadObject`) | the statement and the notice |
| rulebook version 4 and its change log | `RULEBOOKS[4]`, `RULES_CHANGES` | `/rules`, the report form, the terms |
| each tool's text | `TOOL_TEXTS`, `RULES_PAGE`, `TRANSPARENCY_PAGE` (`apps/app/src/lib/public-pages.ts`) | the two public pages |
| alerts | `ALERT_TEXTS[kind]` | pushes and staff mails |
| the console's words | `CUSTODY_WORDS`, `AUTOMATION_WORDS`, `MODERATION_MESSAGES[code]` | the console |
| a seal's facts draft on a match | `SEAL_DRAFTS.facts.match_post` | the console's composer |

**Settings the API reads** (`config.ts`; each `API_<NAME>` in `infra/.env`, blank as unset; section 5 holds the
adapters' own). `R1_CLASSIFIER`, `MEDIA_MATCH` and `APP_SITE`, which two services read, are spelt without the
prefix, as `MEDIA_FORMATS` is (`infra/compose.yml:139`, `:175`). A setting that names an adapter without its
other settings stops the API at start.

| Setting | Shape, default | Meaning |
|---|---|---|
| `EDGE_PURGE` | `off`, `test`, `cloudflare`; `off` | with `cloudflare`: `EDGE_ZONE_ID`, `EDGE_API_TOKEN` and `EDGE_HOST` are required |
| `R1_CLASSIFIER` | `off`, `test`, `onnx`; `off` | also read by the worker; `onnx` stops the process in this build |
| `MEDIA_MATCH` | `off`, `test`, a source's name; `off` | also read by the worker; a source's name stops the process in this build |
| `AUTOMATION_R1_ACTS`, `AUTOMATION_R2_ACTS` | `on`, `off`; `off`, `on` | whether a signal also takes its measure (7.9). `off` for R2 is the design's fallback: an acting match only raises the urgent item |
| `AUTOMATION_DPIA_R1`, `AUTOMATION_DPIA_MATCH` | a day, or empty, each | the day of the impact assessment for that tool. Each is required by its own adapter: the API refuses to start with `R1_CLASSIFIER` (`MEDIA_MATCH`) other than `off` and `test` while its day is empty. One tool's assessment never passes the other. Printed by the facts route in that tool's block |
| `AUTOMATION_DPIA_R1_ACTS`, `AUTOMATION_DPIA_MATCH_ACTS` | a day, or empty, each | the day of the assessment that covers the tool's measure. The API refuses to start with a real adapter and its `AUTOMATION_*_ACTS` `on` while this day is empty: the switch from flagging to acting is the processing that needs the assessment, and for a match the owner sets it only with counsel's word (section 2, row 27). So the shipped `on` of `AUTOMATION_R2_ACTS` acts on nothing until then |
| `HEAD_WITNESS` | `off`, `test`, `rfc3161`; `off` | with `rfc3161`: `HEAD_WITNESS_URL`, an https address |
| `HEAD_KEEPER_MAIL` | an address, or empty | where the daily head is mailed (7.7) |
| `RECIPIENTS_SIGNED_OUT` | `on`, `off`; `on` | whether signed-out readers are counted (7.5) |
| `APP_SITE` | `open`, `closed`; `open` | Caddy's switch (F 5), now also handed to the API and the worker: a `test` adapter is refused at start while it is `open` |

## 11. Security and privacy

C 11, E 11 and F 11 stand. This section adds what 3d makes possible and what it keeps impossible, for a program,
for each role and for each third party. "The API's role" is `korbat_api`; "the operator" is whoever holds the
migrator's role and the host.

### 11.1 What stays impossible, and what proves it

| What stays impossible | The mechanism | What proves it (section 12) |
|---|---|---|
| A program takes a final measure, a removal, a measure on text, an account measure, a strike, a release, or two measures in one decision | the CHECK `decisions_decider`; `decisions_record` step 2; 3c's `decision_actions_check` step 3; `decision_holds` (b) (6.6) | LAB A's nine faults on the built code, each refused and leaving nothing; a function test that no ledger kind but `withhold_media` and `seal_media` commits without a decider |
| A decision without a decider that no record explains | `decision_holds` (a): the system's audit row names the decision and its one signal, and the signal is about an image of the case's post | database tests as the API's role; `audit-verify` fails on a system decision without its row |
| A person's decision recorded as `fully`, or a program's as a person's | `decisions_decider`; the forced columns | database tests |
| A program acts while its setting is off, without its tool's dated assessment or the one that covers the measure, or over the cap | the step's condition (7.9); the refusals at start, one a tool and one a measure (10.8); the cap in `decisions_record` step 7 under one advisory key, counted by rule | integration tests; two concurrent steps at the cap's last place, of which one takes its measure; twenty R1 decisions in the hour, then an acting match that is sealed; a configuration test for each refused combination, the second tool on the first tool's date among them |
| A program goes on taking measures while no person answers | `unanswered_max` and `unanswered_hours` in the same step | 20 measures of a rule in force and unanswered: the 21st signal is a finding, `capped`; an objection older than 72 hours: the same under either rule; an answer frees the next measure |
| A match that is not acting refuses an upload, holds a file, seals an image or cites R2 without being listed | `media_matches`' forced `listed` and `acting`; the refusal's insert (`refusal_not_acting`) and `decision_holds` (b) read `acting`; the intake cites R2 only for `listed` (`automated_signals_guard`) | a table test over hash type, kind and classification: which rows refuse, which seal, which cite R2, which cite nothing; as the API's role, a seal on a record that is not acting is refused |
| Staff are served an image that a match found, on any case, before or after an answer | `staffImage`, the one function that serves staff an image, refuses an image with an unerased match record (`image_matched`) | the gate's test on a frozen post, after an answer without a seal, on another case of the same post, for a flag of another class, and after the record's erasure (then served) |
| An acting match is answered without a seal and without a reason | `CaseDecidedParams.matchAnswerReason` and the column `decisions.match_answer_reason`, held to the signed param and to the case by `decision_holds` (c) at commit (`decisions_record` runs before the decision's actions exist) | function tests: missing, one too many, each value |
| A refused upload is put on a post, served, exported, listed, or deleted by a timer | `post_media_refused`; `EXPORTABLE`, `find` and the status leave out every image a row of `upload_refusals` names; `serve` answers `not_found` for an image on no post; `hold_until` `infinity` and gate K | a table test over every method of the media repository that sets `post_id`; `readyImages`, `isExportable` and the export's `open` with a held upload, a hold ended as `report` and one ended as `no_report` that the sweeper has not taken yet; the sweeper, the owner's delete and the purge each leave a held row |
| An upload escapes its check by being removed during it | the owner's delete leaves a `processing` row whose check is `pending` or `capped` | the race of 7.8: a delete between the check's answer and `finalize`'s transaction, then a refusal and a hold |
| A source gone wrong tells every uploader that their file matched | `refusals_per_hour` under the cap's key; `capped` rows are untold and unposted | 21 matched uploads in an hour: 20 refusals, one `capped` row, one alert, no notice for it; the retry after the hour |
| A refusal marks the account for good | the retention step clears `owner_id` with the match record, 180 days after a hold ended as `no_report` or after a release; `otherRefusals` leaves out a hold ended as `no_report` | after those days the refusal names nobody; a refusal ended as `report` and not released keeps its record; the count on a second refusal after a first one set aside is 0 |
| The API or the worker reads, serves or deletes a quarantined file | neither mounts `media-quarantine`; `quarantine_files` has no grant for the API's role, which can call six functions and nothing else (`quarantine_counts`, `seal_custody`, `media_quarantined`, `media_lost`, `lost_untold`, `lost_told`), none of which answers a file's name or digest | the architecture test that reads both Compose files; a grants test |
| A file moves, returns or is destroyed without a record, or a record is written for a file that did not move | the mover acts only on listed names inside the store's layout; `quarantine-record` records every move that happened, whatever the plan says now, and writes nothing for a `missing` or `refused` line; the inventory gives a file without a row its row, and one recorded for an image the database does not know is an `operator` line, never a `destroy` line; `lost_at` only from a `lost` line | the mover's tests with harmless files: a crash between copy and unlink, a digest mismatch, a name outside the layout, both directions, a file in neither place (the run goes on, exit 1), `--lost`, `--inventory`, a `destroy` line with the file in the store; list, unseal, move, record, list again, and expect an `out` line; an inventory's file for an unknown image, listed for the operator; a list with one post whose rows do not match its seal, which prints the others and exits 1 |
| A release without an admin's key bound to these posts, this ground, this leave and this reference; a release of a seal that is not reported, not wholly in the quarantine, preserved, or for which no leave is recorded or the leave was withdrawn; a release on an authority's answer, `illegal` included; a release by time | `seal_release`, `releases_confirmed`; `release_leaves` is written by the migrator alone; no INSERT on `release_posts` and no UPDATE of `erased_at` for the API's role; `silence_days` null | LAB D's refusals on the built code, with "answered `illegal`, no leave" refused, and a withdrawn leave refused like none; database tests as the API's role |
| The author learns of a release, or of an authority's assessment, while a rule of non-disclosure holds | `releases.author_notice` `held` while `release_tellable` answers false (an `untold` leave; F's mark `not_to_person` on the report's record; a decision untold under F's hold), forced by `releases_notice`; the readers leave a held release out; the notice has no member for an answer | a release under each of the three holds: no mail, no list entry, `not_found`; then the round after the hold's end; a replay of a release under a hold is `held` again, and one under none is `none` |
| A released image comes back: by a restore, by an `unseal_media`, by a seal taken again | `erased_at`; the mark keyed on the post; the replay, which acts only on a gap that the import wrote; `mayOpen` | LAB D2 to D4; the restore test of section 12, with a held upload's release on a backup that holds the refusal and on one that holds only the image |
| The sweep finds a handled match again | the mark on the match record; the unique index over all signals | answer an automatic seal, make the intake due, run the retention step and the sweep: no new intake |
| The matcher is sent anything but hashes | the interface takes four hashes; one function builds the request | a unit test that fails for any other member; an architecture test that the three adapter files (`media/match-adapter.ts`, `media/edge-adapter.ts`, `transparency/witness.ts`) import neither the media files nor a repository |
| An image stops being public without an outbox row | the two triggers of 6.3 | a table test over every measure kind of 3c, E and F, a deletion, a purge, an erasure and a release |
| A public answer holds a row, an id, a day of a decision, a count under ten, a figure of the running year, or a held order | `transparency_figures` and `band`; stored editions that nobody updates; the routes read two tables and no person's | no number under ten in any stored edition outside the order section; a held order absent, then a second version; the schema test of 10.6 |
| A published head is changed, or is published from a place the chain does not hold | the insert's trigger forces it from `audit_head`; the guard; the keeper's mail and the witness | database tests as the API's role |
| The recipients' count lists who was counted, or keeps anything of a reader after its period | sketches that cannot list their members; a salt of 26 hours that is stored nowhere else; two integers a month. A sketch can still be asked whether one given value was probably added: 11.3 | no key older than its period; a source scan that `seen` and `seenSignedOut` write nothing to PostgreSQL or a log |
| A flag orders the queue, closes an item, feeds a decision or names a reporter | `case_flag` answers three values and has two callers | the callers' pin; the queue's order with and without a flag |
| A score, a hash value or a file's name reaches the author, staff or the public | no answer schema has such a member | the schema test's list of refused names gains `score`, `hash`, `sha256`, `pdq`, `file` |
| A text says more than is known of a match, a score, a look or a release | statements, updates and notices are rendered from enumerated fields: `matchKind` derived from the hash type, `viewed` from the access log, the release's ground without an answer | 10.8's table test |
| The public reads a quiet day off the daily value | the day is in the digest | two days with one audit head publish two values |
| A later version of an edition shows what happened to a few people in between | `hold_ended` copies the stored figures and replaces `orders` alone; every table is counted as of the due day | version 2 after a hold's end equals version 1 in every member but `orders`, with rows changed in between |

### 11.2 A poisoned match, a stolen key, a compromised service

| Who, or what | Can | Cannot | How it shows |
|---|---|---|---|
| **A poisoned entry at the source** (a harmless file's cryptographic hash on its list, in a class the source names child sexual abuse material) | have every upload of that exact file refused and held, up to 20 an hour; on a post, have that post's images sealed until an admin answers | reach an account, a final measure or a report: a person decides each, with the match's record, and ends a hold with `source_withdrew`; have staff open the image | the uploader's notice, the author's statement with "Ask for a person", the home screen, the urgent alert |
| **A crafted pair with one MD5, or one SHA-1** (whoever makes both files and gets the harmful half onto a list) | the same as a poisoned entry, for everyone who uploads or posts the harmless half: an exact match of any of the three cryptographic hashes acts (11.3 states the risk, for the owner and counsel) | more than a poisoned entry can; make the words say "the same file": they say "the same fingerprint" | the case's record shows the hash type, and the console says what an MD5 or SHA-1 match is worth (section 8) |
| **A crafted look-alike** (a perceptual hash near a listed entry's, or equal to it) | when the source answers `near`: a flag, so nothing on an upload, and on a post a finding citing R2, which freezes that post until an admin answers. When the source answers `exact` for the perceptual hash: an acting match, so one upload refused and held, or one post's images sealed until an admin answers | reach an account or a final measure; be worded as "the same": every perceptual match reads "similar" | the case's record reads the hash type and the kind; the statement says "similar" |
| **An entry in a class the source does not name child sexual abuse material** | put a flag into the queue for a post that holds the image, in lane 2, and close that image to staff | refuse, hold, seal, freeze, alert or cite a rule | the queue's chip; a person closes the case |
| **A source, or the path to it, that answers `matched` for everything** | have 20 uploads an hour refused and held, each with a notice; keep every further upload waiting, unposted and untold, until the operator sets `MEDIA_MATCH=off` or the answers change; seal posted images up to R2's cap | tell more than 20 uploaders an hour that their file matched; take a measure beyond the cap; reach an account | `matcher_down` at once with `refusalsCapped`; Held uploads grows; `moderation_urgent`; `automation_capped`. Each hold then needs an admin's own confirmation: there is no batch (C 2) |
| **A compromised worker** (the decoder's process) | write any score and any PDQ: a flood of R1 findings in lane 2 and, with `AUTOMATION_R1_ACTS=on`, withheld images up to R1's cap; or scores of zero, which blinds the check; a PDQ copied from a listed entry, for which a source that answers `exact` has the upload refused, or a posted image's post sealed, up to the refusals' limit and R2's cap | forge the cryptographic hashes, which the API takes from the bytes it received; use up R2's cap with scores; reach the quarantine | `automation_capped` with its limit; `matcher_down`; the count of findings a day in `automation-status` |
| **A stolen moderator's key** | what 3c allows, and lift a program's withheld image | release, end a hold, lift a seal, open an image that a match found | the audit log; 3c's burst alert |
| **A stolen admin's key** | release a seal that is reported, in the quarantine and for which a leave is recorded, which erases its image rows for good; end a hold as `no_report`, after which the upload is deleted 24 hours later; answer an acting match without a seal, with a reason, after which the image is public again | release anything else; record a leave, which only the command line does; destroy a quarantined file (the host does that); open an image that a match found | the alerts `seal_released` and `hold_ended_unreported` to every staff account at once, and `moderation_csam_lifted`; the home's list of 30 days; the audit row; the author's notice |
| **An API under an attacker's control** | write a signal and so make the system hide one image or seal one post's images at a time, up to the cap, each with a statement, a home line and an audit row; insert a match and a refusal for any upload that is on no post, up to 20 an hour; record a release or a hold's end with a confirmation it made up, where the facts allow one; mark an outbox row as sent; add to the sketches and store a month's count; read the edge token and the source's credentials | take a final or an account measure as the system; exceed the cap; read, return or destroy a quarantined file; release a seal that F's records do not show as reported or for which the migrator's role recorded no leave; change an edition, or publish a head that is not the chain's | `audit-verify` (a confirmation that verifies against no key; a system decision without its row); the kept head; the keeper's copy |
| **A stolen edge token** | purge korbat's zone, again and again: load on the origin | read, change or disclose anything: the token has one permission on one zone | the provider's own log |
| **A dishonest timestamp authority** | date a token falsely | change korbat's value, or the keeper's copy | nothing in korbat: the page says the witness is one proof beside the keeper's |
| **The operator** | everything on the host, the quarantine's files included | hide a rewrite of the chain from the keeper's copy and, where one is on, from the witness's tokens | `audit-verify` against kept places; the public `restore` row |

### 11.3 What the controls cannot prove

- **A release rests on a word the operator typed.** `seal_release` checks that a leave is recorded for the seal's
  report; it cannot check that an authority or a court gave one. A wrong `release-leave` and an admin's key
  together destroy images for good. With two people these are two people; with one they are one, and the
  runbook says so. What the design does hold: an assessment alone destroys nothing, the leave is a record of
  its own with its reference, a leave recorded by mistake can be withdrawn for as long as no release rests on
  it, and every staff account is told of the release at once.
- **Without a leave, sealed files are kept without an end.** The period is unset and no answer releases. That is
  the cautious side for evidence and the costly one for storage limitation; when and on whose word korbat may
  destroy is counsel's (section 17 E), and the terms promise neither a destruction nor a period.
- **A digest proves one deletion, not the absence of every copy.** A backup of the store taken before the move
  holds the file until `backups_clear_at`, and that day is true only of backups deleted on time: a backup kept
  for an authority is destroyed by hand. An edge copy lives for up to five minutes and a browser's for one; a
  hand-over's archive is F's to destroy. The release's record states the first, the header bounds the second,
  and no text says "korbat no longer holds".
- **The quarantine has no backup, by decision** (section 2, row 40): a lost disk loses every sealed file, and
  with it what an authority might still ask for. The record of what was there, with each digest, survives in the
  database and its backups. A lost file gets its end by a person's flag (`--lost`), and the author whose image
  was to return is told that korbat lost it; nothing brings it back.
- **After a restore the database and the quarantine can disagree** about files moved after the backup. The
  lists come from the restored rows, so only the inventory finds such a file (7.3): it is a step a person must
  run, and until it is run a file lies in the quarantine without a row. A file it finds for an image the
  restored database does not know is the operator's to place: the list prints it under `operator` and never
  under `destroy`.
- **A seal taken while deciding keeps its files in the store**, the program's seal included. For those hours
  3c's residual stands: an API under an attacker's control can read them.
- **After an answer without a seal a matched image is public, and no person at korbat has seen it.** Review
  ruling 2 (section 2) closes such an image to staff whatever the answer, so 3c's look of the same day does not happen for
  it. What stands between an exact match and the image being public again is one admin's judgement on a record,
  a reason from a closed list, and a mail to every staff account.
- **An exact match of an MD5 or a SHA-1 alone acts.** Both are broken for collisions: whoever makes two files
  with one such hash and gets one of them listed can have the other refused or sealed for everyone. The design
  takes the source's word "exact" for any of the three hashes (section 2, row 28); the cost is bounded by the
  caps, by the admin who answers and by the console's sentence on what such a match is worth, and it is the
  owner's and counsel's to accept before a source is switched on. `(owner)` `(counsel)`
- **An exact match that a source reports for a perceptual hash acts too**, and the perceptual hash is the one
  hash the untrusted worker computes. A compromised worker, or a picture made to collide, can so have an upload
  refused or a post sealed until an admin answers. The words never call such a match "the same".
- **A flag is public until a person reads it.** A match that is not acting stops nothing: the image is
  accepted, posted and served, and for a listed class the finding that freezes the post follows the posting by
  seconds, while a flag of another class waits in lane 2. That is what "only an acting match acts" costs.
- **A release in parts can stop half way.** A seal over more than `RELEASE_POSTS_MAX` posts is released by
  several confirmed actions; between two of them some of its images are erased and others sealed and kept, and
  the case answer shows how many remain.
- **Seconds, minutes and a day of exposure remain.** Between a post's commit and the automated step an image is
  public for seconds; an edge copy outlives a measure by up to five minutes when no purge was accepted; an
  unanswered check leaves an image public and unchecked, for good after 24 hours; nothing uploaded before a tool
  was switched on is ever scored or compared.
- **A held upload cannot be told from a real one by anyone at korbat.** The admin who ends a hold has a source's
  word, a class and an objection, and no image. "No report" deletes what a report would have carried, 24 hours
  after every staff account was told. And the refusal itself is final: no person at korbat can accept the
  image, the same file is refused again for as long as the source's entry stands, and an end of a hold is no
  decision that can be appealed. The texts say so, and the source is the only body that can correct an entry.
- **Telling the uploader at once lets them delete the account.** The hold that the refusal's trigger writes
  into F's `auth.report_holds` keeps the address for seven days from the refusal; after that a report can carry
  the file's facts and times and an account that names nobody.
- **A refusal leaves a row.** After its match record is erased the row keeps its times and its end and no
  account. While its hold ended as `report` and it is not released, the record is not erased and the refusal
  names its uploader, for as long as korbat keeps the file; the notice says so.
- **A sketch can be asked about one account.** `PFADD` answers whether a value changed the sketch, so until the
  month's sketch is deleted at the month's close, whoever reaches Valkey could ask whether one given account was
  probably counted. The page's method text says "cannot list who was counted", not "holds no identifier".
- **The classifier's quality is its publisher's claim.** korbat publishes the model, its digest and the
  threshold and no error rate; naming the model lets anyone test an image against it before posting. That
  trade is taken for transparency (section 2, rows 21 and 23).
- **korbat's own page proves nothing against korbat's operator.** The daily value becomes evidence only through
  the keeper's mail and, where one is on, the witness's token, and both begin on the day they began.
- **The recipients' figure is an estimate**: a sketch errs by about one per cent, and the signed-out sum counts a
  reader again on each day and network. It is given as two bounds for that reason.
- **A band still says something.** "1 to 9" in a row of a year tells that at least one such decision was taken
  that year, and in a community of some hundreds a reader who knows of one case may recognise it. The floor, the
  folding, the year and the delay make that the most a figure tells; rows and days would tell more (section 2,
  rows 1 to 3, for the owner).
- **The flag sees only accounts that follow one another.** A group that coordinates elsewhere is not flagged, and
  a flag on honest reporters who happen to know each other may make a moderator trust them less; its sentence
  says that it is no finding.
- **The cap is the bound of a fault, not its prevention**: at worst 20 wrong measures an hour and 100 a day under
  each rule, and no more than 20 of a rule standing unanswered, each told to its author at once and open to "Ask
  for a person"; and at worst 20 wrong refusals an hour, each told at once. When no person answers for 72 hours
  the program stops taking measures, and what it already took stands until a person comes: the target of 24
  hours is a target, and the owner's to staff (section 17).

### 11.4 What each party may learn

| Party | Learns | Never learns |
|---|---|---|
| The author of a post a program acted on | that automated means found the image and took the measure; the rule; for a match the source's name, "the same" (a cryptographic hash) or "a similar" (a perceptual one) fingerprint, and that korbat has not assessed the image; that a program does not suspend, limit or end the account, and that korbat keeps what a report would need while images are sealed; that a person will decide and how to ask for one | a score, a threshold's distance, a hash, the hash type, the list's version, the classification as returned, who will decide |
| The author of a post with a flag or a finding and no measure | nothing: no measure was taken, so no statement exists. A finding citing R2 freezes the post all the same, which the terms say of every such finding (section 18): the texts promise that every **measure** is told at once, not everything a program does | that a comparison found a match, unless a person's decision then restricts |
| An uploader whose upload was refused | the same of the comparison; that the upload stays not accepted; whether the file is held, kept for the authorities, or deleted, and after a hold was lifted what they can do | which admin decided; whether and when a report was sent, beyond that korbat reports it; the authority, its reference |
| An uploader whose upload waits under the limit on refusals | that it is still being processed, as any upload | that the source answered `matched`, until a person has read the alert and the check has run again |
| The author at a release | that korbat has released the images and destroys the files, until when its backups hold them, that an authority's or a court's leave or instruction is the ground, and that a person did it; nothing while a rule of non-disclosure holds the notice | any authority's assessment or answer; who gave the leave, its name and reference; the digests |
| The author whose restored image was lost | that korbat lost the image's files while they were kept apart, and what they can do | where and how |
| A reporter | whether the decision on their report rested in part on an automated comparison (DSA Art. 16(6)); a flag is never shown to them and changes nothing they are told | that their reports were flagged; the source of a comparison |
| A moderator | "over the threshold" with its version; a match's record without the hash; the author's objection; the flag's two counts; the outcome of a purge | a score; an image that a match found, on any case and after any answer; a reporter behind a flag; an uploader's handle on Held uploads; the authority's reference and the leave (an admin's block) |
| An admin | beside that: the facts of a release with the leave's reference; the count of an uploader's other refusals that were not set aside | an image that a match found; an uploader's refusals that an admin ended as `no_report` |
| The source of known material, while its adapter is on | four hashes of every upload, the time, and the API's network address: so that a file with such a hash reached korbat | the image, the account, the uploader's address, a post, what korbat did next |
| The edge provider | the prefixes korbat purges: which image ids stopped being public, and when. It served those images before | why, and for whom |
| The timestamp authority | one digest a day, and the API's address | the place, the hash, any row |
| The keeper | each day's value, place and hash | nothing of a case: the mail holds no row |
| The public | yearly banded counts; what each tool does today, the model's name, digest and threshold; two bounds of recipients; a daily value | a row, a day of a decision, a person, the running year's figures, a held order, the audit log's size |
| An authority | on request, the recipients' figure exactly (`staff.js recipients`) and F's `tco-counts` | nothing 3d sends by itself: 3d notifies no authority and feeds no database |

**Privacy.**

- **Hashes and ratings.** `media_hashes` exists only while the matcher is on, holds no account column and goes
  with its image row, or with the tool: the retention step `tools_off` deletes every row while `MEDIA_MATCH` is
  `off`, and nulls every `nsfw_score` while `R1_CLASSIFIER` is `off` (7.14). The rating of an image is kept as
  long as the image and only while the check is switched on, and the retention list names it. A match record
  keeps one hash value and the classification for 180 days and no account; while its image row exists it can be
  joined to a post and so to an author, and a refusal names its uploader until that record is erased. Whether a
  match record is data relating to offences (GDPR Art. 10), and whether sending a hash to a source abroad is a
  transfer, are counsel's (section 17); the adapter is off until the owner has both answers and has set
  `AUTOMATION_DPIA_MATCH`.
- **Automated decisions.** The statement and the notice give what GDPR Art. 13(2)(f) and Art. 22(3) ask for in
  software: that automated means decided, their logic in a sentence, and a person on request, with the person's
  own words heard, also from a suspended account. An automatic seal and a refused upload are solely automated
  decisions with a significant effect as the EDPB reads Art. 22(1), so an exception of Art. 22(2) is needed:
  which one carries each tool is counsel's (section 2, rows 19, 25, 27). The matcher, which refuses, is switched
  on only with its own dated assessment, and a measure only with the dated assessment that covers it (10.8). A
  refused upload is the one such decision that a person at korbat cannot change; the notice says so and names
  what the person can do instead.
- **The objection** is the author's free text. Staff read it on the case; it is in no alert, no audit row and no
  log, and it is erased with its decision's texts. An objection to a refused upload is kept with the refusal's
  record for as long as korbat keeps the file's match record, which the form says before the person writes; no
  report or production of 3d's carries it.
- **The sketches** hold no identifier and the salt dies after 26 hours, so the daily digest of a network address
  and a user agent cannot be recomputed by anyone afterwards. The basis for computing it at all is counsel's
  (section 2, row 8); `RECIPIENTS_SIGNED_OUT=off` leaves it out.
- **The logger** gains no new field: no log line of 3d carries a hash, a score, a source's answer, a token, a
  reference or an objection. A purge logs a count; a check logs its state.

### 11.5 The threats `inputs.md` names for 3d

| Threat | Control in 3d | Residual |
|---|---|---|
| T1, T5: brigading; linked accounts as a signal | the flag from follows alone, shown and never acting (7.13); no bridge into the auth schema | 11.3, the flag |
| T10: a rewritten audit log | the daily value, the keeper's mail, the witness's token, the public `restore` row (7.7) | changes older than the first published value; the operator's own page |
| T20: a restore brings removed content back | the replay before the site opens, for seals and for held uploads; the gaps for a program's lost measure, a lost end of a hold, a lost leave and a lost withdrawal of a leave; the mark keyed on the post; `erased_at`; the inventory (7.3) | releases after the keeper's last download; a file moved after the backup until the inventory is run |
| T21, T22, T37: re-identification from public figures; figures written by staff | counts only, yearly, banded and folded; computed by one definer function and stored once; no staff route writes one (7.6) | 11.3, a band |
| T23: a classifier's false positives | the image, not the post; off by default; told at once that a program acted; "Ask for a person", also from a suspended account; never a strike; a person sees the image and no score, and the statement says "looked" only when the record shows it; no new measure while 20 stand unanswered or a request has waited 72 hours (7.9 to 7.11) | a wrongly hidden image until a moderator looks; the target of 24 hours is not a promise |
| T24: the worker as an untrusted source of scores | the result parsed strictly; the cap, counted for R1 apart from R2; `automation_capped`; a score never touches text, a post or an account (7.8, 7.9) | a flood of findings in lane 2; a forged perceptual hash where a source answers `exact` for one (11.3) |
| T25: a score as an oracle before posting | no composer warning and no score in any answer (section 2, row 21) | the published model can be run by anyone |
| T26, T41: a person "confirms" by looking | nobody looks, before or after the answer: a match's case shows a record and no image, and `staffImage` refuses the image for as long as the record stands; an answer without a seal names its reason; R1's case shows the image a moderator must judge anyway | an R1 finding puts an image before a moderator that a hash list does not know; after an answer without a seal a matched image is public unseen (11.3) |
| T27: what stays after a match | the freeze from the finding's commit; the automatic seal; the outbox row; the export and every reader already refuse a sealed image (C 7.10), and a held upload is in no reader and no export (7.8) | files in the store until an admin seals for good and the operator moves them |
| T28: collisions and the cost of a false match | only a match the source lists as such material and calls exact acts; another class and a `near` match are flags; nothing reaches the account, and no mark outlives the matter; the words say "similar" of every perceptual match; the limit on refusals; the record on the case with its hash type (7.8, 7.9, 7.11) | a poisoned list entry, an MD5 or SHA-1 pair or an equal perceptual hash refuses an upload or seals one post's images until an admin answers (11.3) |
| T29, T62: the quarantine as a store out of reach | the volume, the one-shot mover, the record with digests, the inventory, the end `lost` (7.1) | no encryption beyond the host's disk; no backup |
| T50: one prompt, many effects | no batch: each hold's end, each release and each case is one confirmed action; a release covers one seal, or 1000 posts of one | a source gone wrong leaves up to 20 holds an hour to end one by one |
| T53: a silent penalty on reporters | the flag changes no order, no answer and no standing, and is stored nowhere | a moderator's own inference |
| T56: the chain remembers for ever | 3d's audit rows hold ids, counts, digests and one reference, the leave's; a release's row holds its posts' ids by design, for the replay, and the rows of a hold's end and of an upload's release the image's id | those ids stay |

## 12. Testing

3c 12's, 3e 12's and 3f 12's kinds and fixtures stay (`decideForTest`, the software authenticator,
`snapshotForTest` and `restoreForTest`). **Every test runs with every adapter `off` or `test`:** no test, lab or
smoke step reaches a third party, loads model weights or reads a hash list. **Every task's tests pass with every
adapter `off`:** a test that needs a `test` adapter sets it for itself, on a site it has closed. 3d adds eight
fixtures, each built by the task that first needs it.

- **The image fixtures** (`packages/media-protocol/src/fixtures.ts`, Task 6 for the marker, Task 7 for the
  matcher's files). The repository carries no image file and commits none: every image the suite uses today is
  encoded by sharp when the test runs, and an encoder's bytes differ between sharp versions and between the dry
  run's machine, CI and the stack's image, so a digest of such a file cannot be a constant. The matcher's
  fixtures are therefore two small PNG files written out as byte constants (stored, uncompressed blocks; nothing
  is encoded at test time). The `test` matcher's digests are computed from those constants when the adapter is
  built, and a unit test holds them to `node:crypto`'s. The adapter declares one classification that is on its
  `MATCH_LISTED` and its `MATCH_ACTING` and one that is on neither. One fixture answers an `exact` match of the
  first, which acts; the other answers a match that does not act, and a test sets which kind: `near` with the
  listed classification, or the classification that is not listed (section 5). The `test` scorer's marker is a constant of the same file: a block of one exact
  colour, at least 64 by 64 px, in the image's top left corner, which survives the pipeline's resize and its
  conversion to sRGB and is tested through the real pipeline; the scorer reads it as `score(pixels, width,
  height, channels)`.
- `custodyStore()` (Task 1, `apps/api/test/quarantine/`): two temporary directories laid out as the store and the
  quarantine, filled with harmless files that are not images, and a runner of the mover's program on a list,
  which passes the two roots as the program's two arguments.
- `reportForTest(action, { answer, handedOver, leave })` (Task 2): as the migrator, writes 3f's record of a report
  for a seal, sent and answered, as `notification-sent` and `notification-answer` would, and, when `leave` is
  given, the leave to destroy as `release-leave` records it.
- `ageCustodyForTest(target, interval)` (Task 1, grown in Tasks 2, 6 and 7): as the migrator, moves the times of
  3d's rows back. It is the only way a test meets a day's alert, the 24 hours of a retry or the 180 days of a
  match record: every time is forced by a trigger and no setting shortens a number of the three rule functions.
- `fakeEdge()` (Task 3) and `fakeWitness()` (Task 5): local HTTP servers that record each request and can be told
  to fail; the first also records whether a bearer token came, never its value.
- `yearForTest(year, cells)` (Task 4, grown in Task 6 for decisions without a decider and in Task 7 for refused
  uploads): as the migrator, writes a past year of decisions, intakes, appeals and orders by cell, LAB E's seven
  cells among them.
- `signalForTest(media, kind)` (Task 6): inserts a signal as the API's role and runs the automated step once.

**How they run** (the lighter loop). An implementer runs the type check, the unit suites and its task's
integration files. **A task's integration files** are those it adds or changes, and every file under
`apps/api/test/integration/` whose name begins with `media-` or `http-media` when the task changes the media
module, and with `moderation-` or `http-staff-` when it changes moderation: the suite is 105 files on one
database, one at a time, so the rule is the difference between minutes and the whole suite. The whole suite, on
a fresh database and on one upgraded from 3f's last migration (`--upgrade-from`), runs at the six batch ends:
Tasks 1, 2, 4, 6, 7 and 8. Tasks 3 and 5 run their integration files on an upgraded database as well.

**What needs Docker** beyond the data services: Task 1 (the stack rebuilt; the `quarantine` service run once on a
volume of harmless files; the volume's owner and mode and the directory's sync read from inside the service; the
smoke test with the profile off), Task 2 (the stack rebuilt; the smoke test), Task 3 (the header read through
Caddy; the smoke test, whose pin of the header changes), Task 4 (the stack rebuilt; the two pages' texts found in
the web export that Caddy serves), Tasks 6 and 7 (the stack rebuilt; the smoke test with every adapter off, in
which an upload goes through the real worker's result of version 2 and is ready) and Task 8 (the walk-through).
A stack rebuild is so named for every batch end at which the worker's protocol or an image changes. The profile
`quarantine` is off in development and in CI but for those steps, and `docker compose config -q` passes with no
setting of 3d set.

### 12.1 Each invariant and the test that proves it

| # | Invariant | Proved by | Task |
|---|---|---|---|
| 1 | The eight migrations each run in one transaction, fresh and upgraded | the suite after `--fresh` and `--upgrade-from`; `enum-literals.test.ts` extended to 3d's files and its two values, with a violation it catches; for the `transparency` migration (Task 4), which is built before the label `automated` exists, the stricter form: the label never as an enum literal, in a PL/pgSQL body either, so `transparency_figures` compares `kind::text`, and Task 4's test calls `edition_publish` on a database that has no later migration | 1 to 8 |
| 2 | A decision without a decider exists only whole | LAB A1 accepted; each of LAB A2's nine faults refused and leaving nothing (a final kind; no audit row; a staff key's `case_decided` row; no signal; two measures; a final measure; rule R3; an automated intake citing R3; a seal on an R1 finding); a person's decision can never carry `fully`; the API's role cannot update a decision | 6 |
| 3 | No program takes a final measure, an account measure, or any measure while its setting is off | the function tests of `decision_holds` and `decision_actions_check`; the route-table test (the automated step is the only writer of a decision without a decider); with `AUTOMATION_R1_ACTS=off` a signal leaves a finding in lane 2 and no measure; with `AUTOMATION_R2_ACTS=off` an acting match opens its finding, which freezes, and seals nothing; of the two kinds of match that do not act, a `near` answer with the listed class refuses no upload and on a post opens a finding citing R2, which freezes and raises the urgent alert and seals nothing whatever `AUTOMATION_R2_ACTS` says, and a match of another class refuses, holds, freezes and seals nothing, cites no rule, raises no alert, and stands on its post's case as a flag (`matchFlag`, lane 2); `automated_signals_guard` refuses a finding citing R2 for a record that is not listed, and `decision_holds` refuses a `seal_media` whose match record is not acting, whatever the API sends | 6, 7 |
| 4 | The limits hold, each rule has its own, and one image is never protected twice | the decision after the last allowed one in an hour and in a day refused `automation_capped`, its finding standing, its signal `capped`, the alert written; twenty R1 decisions in the hour, then an acting match on a post, which is sealed (the counts are taken per rule); no new measure under a rule while `unansweredMax` measures of decisions without a decider under that rule are in force, or under either rule while an objection is older than `unansweredHours`, the finding standing, the alert's `limit` naming which of the four was met, and a measure again once a person has answered; over `refusalsPerHour` a `matched` answer leaves the upload unrefused and not ready (its check `capped`), writes no match record, no refusal, no notice and no mail, and raises `matcher_down` with `refusalsCapped`; `already_protected` for a second withhold or seal while one stands, in either order (LAB C3, C4) | 6, 7 |
| 5 | Every system decision is in the chain | `audit-verify` passes with them and exits 1 for a system decision whose `automated_decided` row is absent (a chain built so as the migrator) | 6 |
| 6 | The person is told at once, in true words, and can reach a person | the statement of each automated decision: both automation sentences, the rule, "until a person decides", the redress `askPerson`; no staff text, no score, no "is child sexual abuse material", "confirmed" or "posted"; `author_mail` pending at commit; one objection, only while a measure of a decision without a decider is in force; the case first in its lane; `automated_objection` at once and `automated_waiting` daily after the target; no measure ends by time; each of the two objection routes answers an account under 3e's suspension and one whose termination is not yet final, and 3e's route walk holds a row for each; a statement of a decision that only opened a finding does not exist, and no text says that its author was told | 6, 7 |
| 7 | A person's decision records what the program found, and says no more than the record | `automated_detection` true whenever a considered item is automated; `partially` exactly when the decision restricts, is suspect and considers an automated item citing R2 (a match of the listed class, acting or not), `not_automated` otherwise; a correction lifts an automated withhold at once; no staff answer holds a member named `score`; the statement says "looked at the image" only with an `image_viewed` row of the decider for that image on that case before the decision and `unseen` false, and "without opening the image" otherwise, both rendered; the update to whoever reported renders for each of the three values of `automatedDecision` and holds `update.automated.partly` exactly for `partially` | 6, 7 |
| 8 | An acting match freezes, and seals only as an interim measure; a matched image is never opened by staff | LAB C1 to C7 as tests on the built code with gate K: both images sealed, the post frozen, a moderator refused (`admin_required`), an admin's answer without a seal refused (`invalid_decision`, by `decision_holds`) without one of `MATCH_ANSWER_REASONS` and with one ending both with `unseen` true, a reason on any other decision refused, an admin's seal for good replacing the automatic one. A `near` match of the listed class freezes its post through its finding and is never sealed by the program, and its answer without a seal takes no reason. After the answer without a seal the image is served to everyone, and the staff image function still answers `image_matched` for it: on this case and on another case of the same post, for a moderator and for an admin, until the match record is erased; the same for an image that a match of either kind that does not act names. `moderation_csam_lifted` goes out in its variant, which holds neither "staff may open them" nor "opens them the same day" | 7 |
| 9 | An upload with an acting match goes nowhere, and no other match stops an upload | attaching it by the post route, by a retry and by a direct update as the API's role: `upload_refused`; no reader serves it and the data export leaves it out: `readyImages`, `isExportable` and the export's file opening tested with an open hold, a hold ended as `report`, and one ended as `no_report` that the sweeper has not taken yet; the sweeper keeps the held row for any age and deletes it only `noReportHours` after an end as `no_report`, and an end as `report` within those hours keeps it; `hold_ended_unreported` is alerted and Home lists the end; an upload its owner removes while its check is pending is kept until the check has answered and is held when it matched (the delete between the check's answer and `finalize`'s transaction); an upload whose match is not exact, or is of another class, becomes ready, can be posted and has no refusal (a refusal's insert on such a record is refused `refusal_not_acting`), and once posted the first is a finding citing R2 and the second a flag; the refusal's insert sets the uploader's row of `auth.report_holds` itself, an end as `no_report` releases it when nothing else holds the address, and an end as `report` inside the hours after it sets it again, counted from the refusal and so never beyond the seven days from it; an objection is accepted after an end as `report` and refused after a release or an end as `no_report` | 7 |
| 10 | The matcher gets hashes and nothing else, and its silence stops nothing | the request builder's type and a unit test that fails for any member but the four hashes; an unanswered check leaves `unchecked`, the upload can be posted, the retry runs for 24 hours and `matcher_down` is written after 15 minutes; with `MEDIA_MATCH=off` no `media_hashes` row is written and no hash is computed | 7 |
| 11 | The hashes are right and die with their image | SHA-256, SHA-1 and MD5 of the bytes as received equal `node:crypto`'s over the byte constants of `fixtures.ts`, and all are computed before the original bytes are discarded; PDQ equals the reference's vectors where the owner allowed their fetch, and otherwise the member is absent and the test says so; no PDQ under quality 50; deleting the image row deletes its hash row | 7 |
| 12 | The worker stays what it was | result protocol version 2 read, an unknown version refused by `finalize`, and the fake worker of the API's tests and the worker's own tests moved to version 2; the real worker's result and the API's `finalize` meet in the rebuilt stack's smoke test at this task's end; `ALLOWED_DEPENDENCIES` unchanged; with `R1_CLASSIFIER=off` no score is written; the worker refuses a `test` adapter while `APP_SITE` is open (its `network_mode: none` is a line of the Compose test, row 14) | 6 |
| 13 | The mover never loses or invents a file, and one bad line never stops a run | against `custodyStore()`: a crash after the copy and before the unlink leaves the file in both places and the next run finishes it; a digest mismatch removes the copy and keeps the source, and a name outside the layout is skipped, each with the lines after it still done and exit 1 at the end; a file in neither place prints `missing` and the run goes on, and `lost` only with `--lost`; both directions; `destroy` prints the digest it took before the unlink, removes the file in the quarantine and in the store, and prints where it found it; `--inventory` prints every file and moves none; the program refuses to start without its two roots; the directory's sync is skipped only where the platform refuses it (`EPERM` on Windows, where only the tests run), any other error ends the run, and the sync itself is proven in Task 1's Docker step; `quarantine.ts` imports nothing under `./`, and the naming rule's three copies (the media module, `handover.ts`, `quarantine.ts`) agree on the same names | 1 |
| 14 | The API cannot reach a quarantined file | the Compose test: only `quarantine` (read-write) and `handover` (read-only) name the volume `media-quarantine`, and neither `api`, `migrate` nor `worker` mounts it; `quarantine` has no network, no environment, all capabilities dropped and a read-only root; the worker keeps `network_mode: none`; the volume's owner and mode come from the path the API's image creates and are read from inside the service in the Docker step; the API's role has no right on `quarantine_files`; the functions section 6 grants it (`quarantine_counts`, `seal_custody`, `media_quarantined`, `media_lost` and the two that tell an author of a lost image) answer counts, one time for a seal and booleans, never a file's name or digest, and are all it can call | 1 |
| 15 | The plan lists exactly what is due, and a receipt is taken line by line | `in` only for a seal for good in force (not for a person's seal taken while deciding; a program's seal is Task 7's case of the same test); `out` after an `unseal_media`, while `serve` answers 404 and the status reads "being restored"; the count against `seal_posts.images` taken over all image rows, erased or not, of the posts sealed for good and not released: a seal over a post with an erased row is listed, and a post whose count differs is left out and named while the others print; list, unseal, move, record, list again: the stale `in` line is recorded and reported, the other lines are recorded, and the next list prints `out` for it; the mirror case for a stale `out` line; a `missing` line records nothing, and a `lost` line records `lost_at`, after which the image is no longer due, its status reads `lost` and `quarantine_lost` is written; a `have` line of the inventory gives a file without a row its row, and a file whose image the database does not know prints as `operator`, never as `destroy`; a line that is not a receipt line is skipped and the others recorded; `quarantine_due` daily from 24 hours until the record exists; `handover` finds a listed file in the quarantine first and in the store otherwise; the app prints [image.restoring] and [image.lost] from the status after a failed load of the viewer's own image | 1, 7 |
| 16 | A release happens only on a recorded leave, and as section 6 says | every refusal of LAB D1, with `release_not_quarantined` and `release_preserved`; `release_no_leave` with the answer `illegal` recorded and no leave, with every other answer and with none: an assessment changes nothing about the files; a release passes once `release-leave` has recorded a leave, from an authority and from a court, and the API's role cannot write one; a leave withdrawn with `release-leave --withdraw` supports no release (`release_no_leave`, as if none were recorded), is gone from the case answer and has its own audit row, and a leave that a release rests on cannot be withdrawn (`leave_used`); a seal over a post with an erased row is released; a seal with more posts than `RELEASE_POSTS_MAX` is released in parts, lowest ids first, the answer showing how many remain; at commit, without its audit row, with another seal's row, without a step-up or by a moderator: `release_mismatch` or `admin_required`, nothing left; it writes no decision and no ledger row; `seal_released` is alerted to every staff account and Home lists the release; the author's notice is pending at commit when none of `release_tellable`'s three holds stands and is born `held` under each of them (8.5), `pending` only in a dispatch round after the last has ended, and until then no route, list or export of the app shows the release; a leave of another record, and the word `answer` as a ground, are refused `release_no_leave`; afterwards the post is not frozen through the seal, a new suspect item freezes it again, and the API's role can write neither `release_posts` nor `erased_at`; 3c's two pins extended | 2 |
| 17 | A restore cannot bring a released image back into keeping, and loses none of 3d's acts in silence | `release_replay` on a backup taken after the seal for good, before it, and for a post no seal lists; idempotent; refused for a line that no open gap names; a seal taken again freezes nothing (LAB D4); `RestoreView.mayOpen` false while a `release` gap is open; a `release_leave_recorded` line above the head is a `release` gap that `release-leave --gap` closes when the leave is recorded again, and a release replayed before that keeps its `leave_id`; a `release_leave_withdrawn` line above the head, for a leave that the backup holds, is a `release` gap that `release-leave --withdraw --gap` closes, and a leave recorded and withdrawn above the head leaves no gap; a replayed release is born `held` while one of `release_tellable`'s three holds stands, or while its lost leave is not yet recorded again, and its author is told in the dispatch round after the last has ended, and a replay under no hold is `none` and tells nobody; the mover's `destroy` removes a released file that the restored store holds and prints `store`. In Task 7 the same for a held upload's release (`upload_release_replay`): on a backup taken before the release, and for a refusal the restored database does not hold, whose image row is then erased and can be attached to no post; an `upload_hold_ended` line above the head is a `release` gap that the admin's new end closes (`upload_hold_end`), or the command when the refusal is gone (`upload_hold_replay`). An `automated_decided` line above the head is a gap of 3f's class by its one action and keeps the site closed (a withhold in Task 6, a seal in Task 7) | 2, 6, 7 |
| 18 | Destruction is proved and bounded | `destroy` lines only for released posts, released refusals (Task 7) and files whose image row is gone, never for a file that an inventory recorded for an image the database does not know (row 15), and after a release and a disposal round the list still prints them; each file's digest stored with `destroyed_at` and the release's id; `release_undestroyed` daily after 24 hours; `backups_clear_at` as section 6 computes it; `release_rules().backup_days` equals `RETENTION.backupDays`; no text of a release holds "no longer holds" or "destroyed it", and none states a day after which no backup holds a file without "that is deleted on time" | 2, 7 |
| 19 | Every way an image stops being public writes one outbox row | a table test over every measure kind of `MEASURES` (3c's, 3e's and 3f's), an author's deletion, the account's purge and a release; none when nothing public changed; the row is written with the adapter off and closed `off` | 3 |
| 20 | The purge is bounded, quiet and never in the way | against `fakeEdge()`: at most 30 prefixes a request and 4 requests a minute; the prefix's form; backoff, then `failed` and `edge_purge_failed` after 24 hours; a measure commits while the edge is down; the token is in no log line and no audit payload; the header's exact text on a public image, `no-store` on every other answer of the API and `private, no-store` on an author's own hidden image, read through Caddy; the seven pins of the old header (`http-media`, `media-serve`, `media-gates` and `media-sealed` in the integration suite, and the smoke test) moved to the new text in this task | 3 |
| 21 | No public figure points at a person | over generated years, every string of a stored edition is `0`, `1 to 9` or `about N0`, except the order section's numbers; a row under ten is folded; a rate prints only on a base of ten or more; LAB E's subtraction; `edition_not_due` before 1 March and for the running year; a stored version is never updated; a held order is absent, then present in a second version marked `hold_ended`, whose every other table equals the first version's stored figures although holds ended and cases closed in between; only `edition --correct` computes a table again; the recipients of every version of a year are those of the six stored months before the year's due day; an order received in one year and disabled under a hold in the next starts the second version of the year the order section counts it in; an `order` decision is in no other table; the `automated` table (Task 6) and the `uploads` table (Task 7), each over a `yearForTest` year grown there | 4, 6, 7 |
| 22 | The public routes give counts and values only | each is mounted before the session's resolution and reads none; `/api/public/transparency` and `/api/public/head` cacheable for an hour and `/api/public/facts` `no-cache`, so a tool switched on shows on `/rules` at the next read; no answer holds an id, a handle, a decision's day or `chain_seq`; `facts` holds booleans, names and the four dates, each printed only in its own tool's block, never a token or a host; the architecture test knows the module `transparency` and what a file of it may import from `@korbat/db` | 4, 5 |
| 23 | The recipients' count keeps nothing about anyone | Valkey holds only the three key patterns, each a sketch or the salt; the salt lives 26 hours and is in no table, log or audit row; at the month's end two numbers are stored and the sketches deleted; with `RECIPIENTS_SIGNED_OUT=off` the second is null and every text says "at least"; a Valkey failure is swallowed and the request answers | 4 |
| 24 | The head's value proves a day and reveals nothing | `head_value` is neither the place nor the hash and the route never returns the place; the day is part of the digest (`korbat.head.v2`), so two days without a new audit row publish different values, and the keeper's check from the day, the place and the hash still passes; one row a day; a token is set only from null; an unanswered witness publishes `none` with `head_unwitnessed`; a missed day raises `head_missed`; `head-restore-mark` writes the restore row and retires, never deletes | 5 |
| 25 | The flag is a hint and nothing more | `case_flag`'s three numbers equal `SIGNAL_RULES`; signed-out notices are not counted; it goes dark once the reporters are forgotten; the queue's order is the same with and without it; a source test finds its two callers and no third | 8 |
| 26 | The records are kept as the terms and the notices say | `erase_automation_records`: a match erased 180 days after its case closed, its hold ended without a report or was released, or its post was released, and the record of an upload with a match that does not act that was never posted 180 days after it was compared; never while a seal for good in force over a post that is not released, an unended hold, or a hold ended as `report` and not released rests on it; with it the refusal loses its account and its objection, also when korbat reported the upload (what 3f's record of that report keeps of the account is 3f's own); [uploads.others] never counts a refusal that ended as `no_report`; a handled match is marked on the match record itself: answer an automatic seal, make the intake due, run the retention step and then the sweep, and no new intake, freeze or seal follows; with `MEDIA_MATCH=off` the job deletes every `media_hashes` row, and with `R1_CLASSIFIER=off` it sets `nsfw_score` null where no unhandled signal names the image; `releases`, `release_posts` and `quarantine_files` untouched; outbox rows deleted 30 days after they closed; every period that W.5, W.9 and `RETENTION`'s list print is held to the function | 8 |
| 27 | The switches fail closed | the API refuses to start with a `test` adapter while `APP_SITE` is open (built in Task 3, with the first adapter, and held again for each later one) and with an adapter named without its settings; with `R1_CLASSIFIER` on and no `AUTOMATION_DPIA_R1`, with `MEDIA_MATCH` on and no `AUTOMATION_DPIA_MATCH`, with `AUTOMATION_R1_ACTS=on` and no `AUTOMATION_DPIA_R1_ACTS`, and with `AUTOMATION_R2_ACTS=on` and no `AUTOMATION_DPIA_MATCH_ACTS`: one tool's date never passes the other tool or a measure; the worker refuses the same `test` combination; with everything off the stack, the suite and the smoke test pass | 3, 5, 6, 7 |
| 28 | The automated step keeps the lock order | 3c's contention lab with the step against a moderator's decision on the same case, the author's deletion of the post and a seal on the author: no deadlock beyond the one retry, the latency recorded | 6 |

### 12.2 By kind

- **Unit.** `AUTOMATION_RULES`, `RELEASE_RULES` and `TRANSPARENCY_RULES` equal their functions, member for column;
  `release_rules().posts_max` equals `RELEASE_POSTS_MAX`; `match_listed()` and `match_acting()` equal the test
  adapter's `MATCH_LISTED` and `MATCH_ACTING`; `SIGNAL_RULES` equals `case_flag`'s constants; the step-up params of `seal_released`, `upload_hold_ended` and
  `upload_released` (strict, no transform); the mover; the witness's request template; the adapters' `off` and
  `test` implementations; the fixtures' digests against `node:crypto`'s.
- **The tables.** Every number in the words of section 18, in sections 8 and 9 and in the README is held to its
  constant; the rules page and the terms build their numbered sentences with the same functions; `TOOL_TEXTS` has
  a text for each tool in each state; each closed list of section 6 equals its constant, read with
  `pg_get_constraintdef`; the console's message table has words for each new code a staff route answers.
- **The words.** No text of section 18 holds "is child sexual abuse material", "confirmed" or "posted such";
  every text about an automated step holds the sentence on automated means and the way to a person; rulebook
  versions 1 to 3 and redress versions 1 to 3 render as they were sent; each new alert renders with two sets of
  facts and differs only in digits, holds no "@" and no "http" (3f 12.1, row 15). Six more word tests, one for
  each thing the review found a text to say beyond the record:
  - no text to a person or to the public holds "no longer holds", "destroyed it", "assessed them as illegal" or
    "assessed it as illegal", and the terms hold no sentence that promises a destruction or names a period;
  - no text of the console holds "Report when", "Choose "No report" only" or any other sentence that tells an
    admin which end of a hold to take, and neither control of Held uploads is preselected;
  - "looked at the image" is rendered only from `viewed` true;
  - "the same fingerprint" is rendered only for a cryptographic hash;
  - "does nothing to your account", "acts on an account", "Whatever it does" and "staff may open them" (in the
    variant for a match) occur in no text of 3d;
  - each `TOOL_TEXTS` entry is rendered in the four states a tool can be in (off from the start, on, on with its
    measure, off again after it ran) and held against what the database then holds: no `media_hashes` row and
    no `nsfw_score` once the retention job has run with the tool off.
- **Mail.** The templates of W.8 pinned (`upload_refused`, `upload_hold_lifted`, `release_notice`, `release_day`,
  `image_lost`), 3c's update in its three renderings and `moderation_csam_lifted` in its two; the keeper's mail
  of the head.
- **HTTP.** The three public routes; the staff routes behind the staff gate with their rows in the route-table
  test and `PERSONAL`'s check; the objection and the upload's objection behind the session, each once, and each
  from a suspended account.
- **Console and app.** Server-rendered checks of every sentence of sections 8 and 9; the browser check of 8.9.
- **Smoke** (`scripts/smoke-auth-stack.mjs`; Task 3 owns its header check, Task 4 its page and facts checks).
  With every adapter off: an upload through the real worker, a post and its image served with the new header;
  `GET /api/public/facts` names every tool as off. A status code proves nothing about the two pages: the web
  export is a single-page build and Caddy answers every unknown path with its shell. So the smoke test looks
  into the exported bundle that Caddy serves (under `/_expo/`) for the lead sentences of `RULES_PAGE` and
  `TRANSPARENCY_PAGE`: the app's render tests prove the pages, and the smoke test proves they were built in.

### 12.3 The labs, repeated on the real code

| Lab | On the real code | Passes when | Task |
|---|---|---|---|
| `lab-3d/` as it is | Task 1 copies the folder into the repository as `apps/api/test/lab/automation/`, with its `RUN.txt`. It is kept as the record of what was measured and is **not run**: its scripts are SQL driven by hand in a container that no longer exists, on a schema that stops at 3c's migrations, with stand-ins for the API's statements | the files are there for Tasks 2, 6 and 7 to read | 1 |
| D (the release and its replay) | the built `release` migration with 3f's real `seal_report` in place of the lab's stand-in, as tests (rows 16 to 18), with two cases the lab did not have: a seal over a post with an erased image row is released, and the list after a release and a disposal round prints its `destroy` lines | as the rows say; the clause's cost recorded beside the lab's 0.02 ms | 2, as its first step |
| A (the system decider) | the built `decisions_record` and `decision_holds`, which carry 3e's and 3f's branches the lab never saw. The first step reads their built text. Then, as tests on the built code and through the API's own statements, on a database at 3f's last migration with the `automated_decisions` migration applied: each accepted case and each refusal of `out-A.txt` is one test, with the same code | every case of `out-A.txt` has its test and its code; every decision with a decider passes 3e's and 3f's own tests unchanged | 6, as its first step |
| C (the automatic seal) | the same for the `known_material` migration and `out-C.txt`, with gate K and E's `strike_due` answering false for an interim decision | every case of `out-C.txt` has its test and its code | 7, as its first step |
| E (the counts) | `transparency_figures` over `yearForTest`'s year | row 21; the time for 20,000 rows recorded beside the lab's 21 ms | 4 |
| Not measured by the model | the lock order (row 28); the mover on a real volume (Task 1's Docker step); the header through Caddy (row 20); the sketches (row 23); the witness against `fakeWitness()` | as the rows say | 1, 3, 4, 5, 6 |

## 13. Tasks

Eight tasks in build order. Each is one commit, written tests first by one implementer, and each leaves the stack
working and the whole suite able to pass **with every adapter off**. Whatever a task's tests need is built in that
task: no task reads a constant, a route, a screen, a guard or a fixture that a later task makes. Every function a
migration creates has a task that calls it and tests it, and what a restore loses is a gap of After a restore or
a step of the README's Restoring (ruling 10 of the review).

**What each task names.** "First" (a reading or a lab that decides how the task is built); "Migration"; "Builds";
"Files" (by path, at the place where the code lives in the built repository today; by directory where a new
module is made; the tests that pin what a task changes are part of its files); "Tests" (rows of 12.1); "Docker";
"Leaves". A file the list does not name may change when the build's types or tests require it; the task's record
names it. Migrations are called by their names here: section 6 alone writes their numbers, which move if 3f adds
one.

**The gates** are light for every task: the install gates when the lockfile changed (it should not: 3d adds no
dependency), the type check, the unit suites, `generate` printing "No schema changes", the task's migration
applied, the console's build and browser check or the web export when that side changed, the task's integration
files by the rule of section 12 (those it adds or changes, and every `media-` and `http-media` file when it
changes the media module, every `moderation-` and `http-staff-` file when it changes moderation), the bundles.
**The whole suite**, fresh and upgraded from 3f's last migration, and a stack rebuild with the smoke test run at
the six batch ends (Tasks 1, 2, 4, 6, 7, 8): each of them changes an image, the Compose file or the worker's
protocol, and nothing but the rebuilt stack lets the real worker's result meet the real API. Tasks 3 and 5 run
their integration files on an upgraded database; Task 3 also runs the smoke test, whose pin of the header it
changes.

**Before Task 1.** 3c, 3e and 3f are complete, with 3f's amendment of section 15 (`seal_report` returns the
answer's word and the time it was sent). Where a task replaces a function, its first step reads the built text of
that function as 3f leaves it and writes the replacement from that text, not from this design; a difference from
section 6 is recorded as an amendment. No task fetches model weights, a hash list, test vectors or anything else
from outside the repository, and none creates an account anywhere: what would need one is in section 17.

### Task 1. The quarantine (batch end)

- **First.** Copy `lab-3d/` into the repository as `apps/api/test/lab/automation/`: the record of what was
  measured, not a thing to run (12.3). Read the built `alert_steps()`, 3f's `handover.ts`, the media module's
  naming rule, and the lines of `apps/api/Dockerfile` that create the two media paths.
- **Migration.** `quarantine`: `quarantine_files` with its three ends (returned, destroyed, lost),
  `quarantine_plan`, `quarantine_counts`, `seal_custody`, `media_quarantined`, `media_lost` and the two
  functions by which the dispatch job tells an author of a lost image (`lost_untold`, `lost_told`),
  `alert_steps()` replaced with `quarantine_due`, the alert kind `quarantine_lost`.
- **Builds.** The volume `media-quarantine` and the one-shot service `quarantine` under its profile, with the
  path `/media/quarantine` created in the API's image, owned by `node`, mode 0700, so that a new volume takes
  that owner and mode; the mover's program `quarantine.ts` as a bundle of its own with its copy of the naming
  rule, its two roots as arguments, `in`, `out`, the `destroy` direction for a file whose image row is gone,
  `--lost` and `--inventory`, a bad line never stopping a run; `handover.ts` looking in the quarantine first, its
  service mounting it read-only; `quarantine-list` (with `operator` lines and the count over posts that are not
  released) and `quarantine-record` (line by line); the media index's plain function `quarantineNames(tx)`; the
  counts in `StaffOverview` and `seal_custody` behind the `custody` of a seal's decision; `media_quarantined` in `serve` and
  `restoring` and `lost` in the owner's status; the alert kinds and their texts (W.7) and the mail `image_lost`
  (W.8); the console's [home.quarantine], [case.custody.in], [case.custody.return] and [case.custody.lost]; the
  app's [image.restoring] and [image.lost], asked from the status after a failed load of the viewer's own
  image; the README's sections Quarantine and Backups (W.11).
- **Files.** `packages/db/src/schema/`, the migration, `packages/db/test/schema.test.ts`;
  `packages/contracts/src/moderation.ts` (`StaffOverview`, `CaseDecision`), `media.ts` (`MediaStatusResponse`),
  `orders.ts` (`ALERT_KINDS`, `ALERT_TEXTS`); `apps/api/Dockerfile`; `apps/api/src/quarantine.ts` (new),
  `handover.ts`, `build.mjs`, `cli/custody.ts` (new), `cli/staff.ts`, `media/index.ts`, `media/repo.ts`,
  `media/files.ts`, `media/cases.ts`, `media/flows/serve.ts`, `media/flows/status.ts`, `moderation/cases.ts`
  (`overview`, `caseView`), `moderation/alerts.ts`, `auth/flows/notifiers.ts`, `mail/templates.ts`,
  `mail/mailer.ts`; `infra/compose.yml`; `apps/admin/src/screens/Home.tsx`, `Case.tsx`, `messages.ts`; the app's
  image components, `lib/social.ts` (`mediaStatus`), `lib/moderation-words.ts`; `apps/api/test/quarantine/` (new),
  `test/lab/automation/` (new), `test/architecture.test.ts` (which services name the volume); `README.md`.
- **Tests.** Rows 1, 13, 14, 15 (but for a program's seal, which is Task 7's); the browser check's runs of Task
  1; its integration files; the whole suite.
- **Docker.** The stack rebuilt; the service run once on a volume of harmless files: in, out, destroy, a file in
  neither place, an inventory; the volume's owner and mode (`stat`) and the directory's sync read from inside the
  service; the smoke test with the profile off.
- **Leaves.** The files of a seal for good can be moved out of the API's reach and back, and a file that is lost
  has an end that its author is told. Nothing is released yet: a seal still ends only by `unseal_media`.

### Task 2. The release and its replay (batch end)

- **First.** LAB D as tests on the built code, with 3f's real `seal_report` and the two cases of 12.3. Read the
  built `frozen_for`, `append_confirmed_audit`, `restore-import` and `restore_gaps`.
- **Migration.** `release`: as section 6, with the record of a leave to destroy (`release_leaves`),
  `release_tellable`, the trigger `releases_notice` and `release_rules().posts_max`.
- **Builds.** `release-leave` and its record, with the leave's own hold on telling and its end, and the
  withdrawal of a leave recorded by mistake (`--withdraw`, the guard of `release_leaves`, `leave_used`, the
  audit row `release_leave_withdrawn`); `release_announce`
  called and tested as section 6.2 says, though no route reaches it; `seal_release` behind the staff route and the step-up
  `seal_released`, on the ground `leave` alone (the ground `period` stays unreachable), in parts for a seal over
  `RELEASE_POSTS_MAX` posts; the console's release block (8.5), [appeals.released], the `release` class on After a
  restore for a lost release of a seal; the released files in the `destroy` direction of the list, and the
  release's id on the record; `release_undestroyed`; the alert `seal_released` and [home.released]; the author's
  notice (`RELEASE_NOTICE`, W.6; the mail of W.8) sent at once, or born `held` while `release_tellable` answers
  false and sent by the dispatch job in the round that finds the last hold ended, with its two reads for the
  app (`GET /api/moderation/notices`, `/releases/:release`), its screen and its list entry; `release-show`;
  `restore-import` writing `release` gaps for `seal_released` lines, which `release-replay` closes (a replay
  born `held` while a hold on telling stands, and `none` otherwise), and for
  `release_leave_recorded` and `release_leave_withdrawn` lines, which `release-leave --gap` and
  `release-leave --withdraw --gap` close ([restore.leave], [restore.withdrawn]); `text-verify`'s two reports through the media index; 3c's two pins
  extended; the README's gate line, the release's runbook and Restoring (W.11).
- **Files.** The migration and the schema; `packages/contracts/src/staff.ts` (the step-up registry),
  `moderation.ts`, `orders.ts`; `packages/rules/src/statement.ts`; `apps/api/src/moderation/release.ts` (new),
  `dispatch.ts`, `author-repo.ts`, `index.ts`, `routes.ts` (the author's two reads), `cases.ts`, `alerts.ts`,
  `staff/routes.ts`, `staff/cases.ts`, `cli/custody.ts`, 3f's restore command, `auth/flows/notifiers.ts`
  (`AccountMessage`, `StaffMessage`), `auth/index.ts`, `mail/templates.ts`, `mail/mailer.ts` (`TemplateName`),
  `media/index.ts`, `quarantine.ts`; `apps/admin/src/screens/Case.tsx`, `Appeals.tsx`, `Home.tsx`, 3f's restore
  screen, `step-up.ts`'s callers, `messages.ts`; `apps/app/src/app/settings/cases/releases/[id].tsx` (new),
  `components/moderation/CasesLists.tsx`, `lib/moderation.ts` (the fetchers); the tests; `README.md`.
- **Tests.** Rows 16, 17 (for a seal's release), 18; `release_announce`, which as built answers
  `release_period_unset` and which, with `release_rules()` replaced inside a transaction that is rolled back,
  writes its row, checks the admin and reaches the `period` branch of the release with its three waits; the
  mail and the notice pinned; the browser check's runs of Task 2; its integration files; the whole suite.
- **Docker.** The stack rebuilt; the smoke test.
- **Leaves.** "3d's handling of sealed images" is complete for sealed posts: with 3f's order path and section
  17's list, the going-public gate can close. Tasks 3 to 8 are not part of the gate. No sealed file is destroyed
  on an assessment: without a recorded leave the release block offers no control.

### Task 3. The edge, and the guard on `test` adapters

- **First.** Read every writer of `post_media.moderation_state`, `erased_at`, `posts.moderation_level` and
  `posts.state` in the built code, and list them in the task's record: the table test of row 19 is written from
  that list and from `MEASURES`. Find every pin of the old header (`max-age=300`) in the tests and the scripts.
- **Migration.** `edge_purges`: the table and its two trigger functions.
- **Builds.** `APP_SITE` as a setting of the API (Compose hands it Caddy's variable) and the refusal to start
  with a `test` adapter while it is `open`: the guard is built here, with the first `test` adapter, so that no
  built state accepts one on an open site. The purge adapter with `off`, `test` and `cloudflare`, in a file of
  its own that imports nothing of the module; the outbox's job under the Valkey lock; the new header on public
  images, with every pin of the old one moved; `CaseView.purges` and the four purge lines on the case and on
  3f's order screen; `edge_purge_failed`; the README's zone settings and its check (W.11); the settings in
  `config.ts` and the two `.env.example` files, each `${...:-}` in Compose; the smoke test's header check.
- **Files.** The migration and the schema; `apps/api/src/media/edge-adapter.ts` and `edge.ts` (new),
  `media/flows/serve.ts`, `media/repo.ts`, `media/cases.ts`, `media/index.ts`, `config.ts`, `index.ts` (the job's
  start), `moderation/cases.ts` (`caseView`), `moderation/alerts.ts`; `packages/contracts/src/moderation.ts`,
  `media.ts`, `orders.ts`; `apps/admin/src/screens/Case.tsx`, `Order.tsx`, `messages.ts`; `infra/compose.yml`,
  `infra/.env.example`, `apps/api/.env.example`; `scripts/smoke-auth-stack.mjs`;
  `apps/api/test/integration/http-media.test.ts`, `media-serve.test.ts`, `media-gates.test.ts` and
  `media-sealed.test.ts` (their pins of the header), `test/architecture.test.ts` (no adapter's file imports a
  repository); the tests; `README.md`.
- **Tests.** Rows 19, 20, and 27 for the guard and for this adapter; its integration files (every `media-` and
  `http-media` file, by the rule) on an upgraded database; the smoke test.
- **Docker.** The header read through Caddy; the smoke test.
- **Leaves.** Every image that stops being public is queued for a purge, and with the adapter off the queue
  closes by itself. The lab on the owner's zone is the owner's (section 17).

### Task 4. The public figures and pages (batch end)

- **First.** LAB E as tests on the built code. Read 3f's `tco-counts` and write the order section of
  `transparency_figures` from its built statements.
- **Migration.** `transparency`: as section 6. It is built before the label `automated` exists, so its functions
  compare a kind as text (row 1).
- **Builds.** The API's seventh module, `transparency`, entered through its index and built by
  `createTransparency` after auth, with a job of its own named `transparency`; the two sketches, both fed from
  the auth module's `resolveSession` through a hook that the wiring fills late (the global rate limit runs
  before a session resolves and cannot know whether one will); the month's close and the daily
  `edition_publish` in the module's job, for the last closed year and every earlier year that has an edition;
  `GET /api/public/facts` (answered `no-cache`; a tool that no task has built yet prints `off`) and `GET
  /api/public/transparency`, mounted in `app.ts` before the session's resolution; the pages `/rules` and
  `/transparency` without the head's section, with `RULES_PAGE`, `TRANSPARENCY_PAGE`, `TOOL_TEXTS` whole and
  `RULES_CHANGES` for versions 1 to 3 (W.1, W.2); the links of 9.1; `recipients` and `edition`; the setting
  `RECIPIENTS_SIGNED_OUT`; the architecture test's entry for the module and its rule (a file under
  `transparency/` imports from `@korbat/db` only the names of `schema/transparency.ts` and `auditHead`); the
  smoke test's checks of the pages and of the facts; the README's section on the yearly edition, which replaces
  3f's manual report.
- **Files.** The migration and the schema (`packages/db/src/schema/transparency.ts`);
  `packages/contracts/src/transparency.ts` (new); `packages/rules/src/index.ts`; `apps/api/src/transparency/`
  (new: `index.ts`, `routes.ts`, `repo.ts`, `recipients.ts`, `editions.ts`), `index.ts`, `app.ts`,
  `auth/middleware.ts`, `auth/index.ts`, `config.ts`, `cli/figures.ts` (new), `cli/staff.ts`;
  `apps/api/test/architecture.test.ts`; `infra/compose.yml`, `infra/.env.example`, `apps/api/.env.example`;
  `scripts/smoke-auth-stack.mjs`; `apps/app/src/app/rules.tsx`, `transparency.tsx` (new), `terms.tsx`,
  `lib/public-pages.ts` (new), `lib/terms.ts` (the shared builders), `components/moderation/ReportForm.tsx`; the
  tests; `README.md`.
- **Tests.** Rows 21 (but its `automated` and `uploads` tables), 22, 23; the tables of 12.2 for the two pages;
  its integration files; the whole suite.
- **Docker.** The stack rebuilt; the two pages' lead sentences found in the web export that Caddy serves (12.2);
  the smoke test.
- **Leaves.** The pages are public and say, for every tool, that it is off. The first edition appears on the
  first 1 March after a closed year.

### Task 5. The head

- **Migration.** `head_publications`: as section 6.
- **Builds.** The daily value in the `transparency` module's job, its digest taken over the day, the place and
  the hash; the witness adapter with `off`, `test` and `rfc3161`, in a file of its own; the keeper's mail (W.8),
  for which the auth module gains one sender to the one configured address (today it mails an account, a
  notifier's contact or every staff account, and nothing else); `GET /api/public/head` and the page's section 6;
  `head-restore-mark`; `head_unwitnessed` and `head_missed`; the settings `HEAD_WITNESS`, `HEAD_WITNESS_URL` and
  `HEAD_KEEPER_MAIL`; the README's lines on the head, which replace "until sub-project 3d publishes the head".
- **Files.** The migration and the schema; `apps/api/src/transparency/head.ts` and `witness.ts` (new),
  `transparency/index.ts`, `routes.ts`, `repo.ts`, `cli/figures.ts`, `auth/flows/notifiers.ts`, `auth/index.ts`,
  `mail/templates.ts`, `mail/mailer.ts`, `config.ts`; `packages/contracts/src/transparency.ts`, `orders.ts`;
  `infra/compose.yml`, `infra/.env.example`, `apps/api/.env.example`; `apps/api/test/architecture.test.ts`;
  `apps/app/src/app/transparency.tsx`, `lib/public-pages.ts`; the tests; `README.md`.
- **Tests.** Rows 22, 24, and 27 for this adapter; its integration files on an upgraded database.
- **Docker.** The data services only.
- **Leaves.** Tasks 1 to 5 stand without Tasks 6 to 8: the orchestrator may stop here and lose only dormant code.
  The guard on `test` adapters has been in the build since Task 3, so stopping here leaves no state that accepts
  one on an open site.

### Task 6. The automated decision and the R1 seam (batch end)

- **First.** LAB A as tests on the built code (12.3). Read the built `decisions_record`, `decision_holds`,
  `strike_due` and every reader of `decisions.decided_by` in the API, the console and the app; each reader that
  assumed a staff member is listed in the task's record and changed here.
- **Migration.** `automated_decisions`: as section 6, under the enum-literal rule; `intakes_has_ground` is added
  again with its one arm for an `automated` intake, which alone may cite no rule.
- **Builds.** The automated step and its sweep; `AUTOMATION_RULES` with a cap for each rule and the two limits
  on unanswered measures (`unansweredMax` for each rule, `unansweredHours` under either); the statement's sentences for a score and for a program's measure, `viewed` and its two
  endings, the source sentence, and redress version 4 whole (W.3, W.4: an automated decision records the version
  whose `askPerson` it prints, so the version cannot wait for Task 8); the mail subjects of W.8; "Ask for a
  person" in the app and the objection on the case, its route among the writes 3e's suspension leaves; the
  queue's chips [queue.found], [queue.taken] and [queue.objected] and its order; [home.automated] and
  [home.objected]; `automated_objection`, `automated_waiting` and `automation_capped`; the worker's scorer seam
  with `off` and `test`, the marker's fixture, the model's name and digest as constants of
  `packages/media-protocol`, and result protocol version 2 in that package, in the worker and in `finalize`, with
  the fake worker of the API's tests and the worker's own tests moved to it; `imagesPublished`, called from
  `createPost` and starting its task unwaited; the guards of `AUTOMATION_DPIA_R1` and
  `AUTOMATION_DPIA_R1_ACTS`, and the refusal of a `test` adapter in the worker; `automation-status`;
  `audit-verify`'s check; `restore-import` reading an `automated_decided` line as a lost decision of 3f's
  classes, with [restore.program]; the facts route's members for R1; the edition's `automated` table tested.
- **Files.** The migration and the schema; `packages/contracts/src/automation.ts` (new), `moderation.ts`,
  `staff.ts`, `media.ts`, `orders.ts`, `transparency.ts`; `packages/media-protocol/src/result.ts`, `fixtures.ts`
  (new), `classifier.ts` (new: the model's name and the digest of its weights); `packages/rules/src/index.ts`, `statement.ts`; `apps/api/src/moderation/automated.ts` (new), `decide.ts`,
  `statement.ts`, `author.ts`, `author-repo.ts`, `cases.ts`, `repo.ts`, `routes.ts`, `dispatch.ts`, `alerts.ts`,
  `context.ts`, `index.ts`; `media/flows/status.ts` (`finalize`), `media/cases.ts`, `media/repo.ts`,
  `media/index.ts`; `social/flows/posts.ts` (`createPost`); `auth/flows/notifiers.ts`, `mail/templates.ts`,
  `mail/mailer.ts`; `staff/cases.ts`, `cli/staff.ts`, `cli/figures.ts`, 3f's restore command,
  `transparency/routes.ts`, `config.ts`, `index.ts` (the wiring); `apps/worker/src/pipeline.ts`, `loop.ts`,
  `config.ts`, `score.ts` (new); `infra/compose.yml` (what the worker and the API are handed),
  `infra/.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`;
  `apps/api/test/integration/media-harness.ts`, `apps/worker/test/loop.test.ts`;
  `apps/admin/src/screens/Queue.tsx`, `Case.tsx`, `Composer.tsx`, `Home.tsx`, 3f's restore screen, `messages.ts`,
  `words.ts`; `apps/app/src/components/moderation/DecisionDetail.tsx`, `CasesLists.tsx`,
  `lib/moderation-words.ts`, `lib/moderation.ts`; the tests.
- **Tests.** Rows 2 to 7, 12, 17 (a program's lost withhold), 21 (the `automated` table), 27, 28; the browser
  check's runs of Task 6; its integration files; the whole suite.
- **Docker.** The stack rebuilt; the smoke test with every adapter off, in which an upload goes through the real
  worker's result of version 2 and is ready.
- **Leaves.** The whole path of an automated R1 step works through the `test` scorer and is unreachable with the
  real settings: no classifier exists in the build. The real adapter is not a task of 3d (section 17).

### Task 7. Known material (batch end)

- **First.** LAB C as tests on the built code (12.3). Record in the task's record whether the owner has allowed
  the fetch of the reference's PDQ vectors: without it the worker's PDQ and the `pdq` member stay absent, and row
  11 says so.
- **Migration.** `known_material`: as section 6, with `match_listed` and `match_acting`, the column
  `decisions.match_answer_reason`, `upload_hold_replay`, and four functions replaced once more: the function of
  `releases_confirmed`, so that an upload's release passes its commit, `release_tellable`, `decision_holds`
  (its checks (b) and (c)) and `automated_signals_guard`.
- **Builds.**
  - *The hashes and the check.* The three hashes in `receive`, the API's upload stream, computed before the
    original bytes are discarded; the worker's own PDQ where allowed; the matcher's seam with `off` and `test`,
    in a file of its own, and its one request builder; the check in `finalize`, the retry, `matcher_down` and
    the limit of refusals an hour; an owner's removal of an upload whose check is pending.
  - *Which match acts.* Only a match its source reports as exact, with a classification on `MATCH_ACTING`. Every
    other match is recorded, refuses no upload and holds and seals nothing, in one of two kinds. With a
    classification on `MATCH_LISTED` and not exact: on a post, a finding citing R2 without a measure, which
    freezes and raises the urgent alert by 3c's rule ([case.matchNear]). With any other classification: an item
    of an `automated` intake that cites no rule, in lane 2, with no freeze and no alert ([queue.matchFlag],
    [case.matchFlag], [home.flags]).
  - *A refused upload.* The refusal and the hold with `UPLOAD_NOTICE` (W.5), its mails (W.8), the app's notice,
    "Object" (open until a release or an end as "No report", and left by 3e's suspension) and the composer's
    refusal; the refused upload out of the export and of every reader; the account's address held from the
    refusal as after a seal, by the refusal's own trigger, released by an end as "No report" when nothing
    else holds it, and set again, counted from the refusal, when that end is turned into "Report" inside its
    hours; Held uploads in the console with its two confirmed ends, worded neutrally and
    neither preselected, the delay of `noReportHours` before a deletion, `hold_ended_unreported` and
    [home.unreported]; the release of a held upload on a recorded leave; `upload-report`, also for an account
    that is gone; `restore-import` and `release-replay` extended to `upload_released` and `upload_hold_ended`
    lines (`upload_release_replay`, `upload_hold_replay`), with the gap's lines on After a restore.
  - *A match on a post.* The automatic seal through Task 6's step, under R2's own cap, with the statement's
    sentences for a match (W.3) and the match's record on the case; the staff image function refusing
    `image_matched` for an image that an unerased match record names, with [case.image.matched]; the reason an
    answer without a seal needs; [case.liftedMatch] and the variant of `moderation_csam_lifted`; the sentence for
    whoever reported when a decision is partly automated; [home.uploads]; the facts route's members for the
    matcher; the guards of `AUTOMATION_DPIA_MATCH` and `AUTOMATION_DPIA_MATCH_ACTS`; the edition's `uploads`
    table tested.
- **Files.** The migration and the schema; `packages/contracts/src/media.ts`, `moderation.ts`, `staff.ts`,
  `automation.ts`, `orders.ts`; `packages/media-protocol/src/fixtures.ts`, `result.ts`;
  `packages/rules/src/statement.ts`; `apps/api/src/media/files.ts` (`receive`), `media/flows/upload.ts`,
  `media/flows/status.ts` (`finalize`, `statusOf`), `media/flows/serve.ts`, `media/match-adapter.ts` and
  `match.ts` (new), `media/repo.ts` (`EXPORTABLE`, `readyImages`, `isExportable`, `deleteUnattached`),
  `media/sweeper.ts`, `media/cases.ts` (`staffImage` and the new members), `media/index.ts` (`onMatch`, the plain
  functions); `moderation/automated.ts`, `moderation/uploads.ts` (new), `moderation/release.ts`, `decide.ts`,
  `cases.ts`, `routes.ts`, `dispatch.ts`, `alerts.ts`, `staff/routes.ts`, `staff/cases.ts`, `cli/custody.ts`, 3f's
  restore command, `auth/flows/notifiers.ts`, `mail/templates.ts`, `mail/mailer.ts`, `transparency/routes.ts`,
  `config.ts`, `index.ts` (the wiring of `onMatch` and of the retry); `apps/worker/src/pipeline.ts` and `pdq.ts`
  (new, where allowed); `infra/compose.yml`, the three `.env.example` files; `apps/api/test/architecture.test.ts` (the
  `post_media` rule extended to the three tables of this migration); `apps/admin/src/screens/Uploads.tsx` (new),
  `Case.tsx`, `Queue.tsx`, `Home.tsx`, 3f's restore screen, `router.ts`, `nav.tsx`, `Layout.tsx`, `messages.ts`;
  `apps/app/src/app/settings/cases/uploads/[id].tsx` (new), the composer
  (`components/social/useImageUploads.ts`), the report's status page, `lib/moderation-words.ts`,
  `lib/moderation.ts`, `lib/api.ts`; the tests.
- **Tests.** Rows 3, 4, 6 (the upload's objection), 7 to 11, 15 (a program's seal), 17 (a held upload), 18
  (released refusals), 21 (the `uploads` table), 27; the browser check's runs of Task 7; its integration files;
  the whole suite.
- **Docker.** The stack rebuilt; the smoke test with every adapter off, in which an upload goes through the
  real worker and is ready, no hash is computed and no `media_hashes` row exists.
- **Leaves.** The whole path of a match works through the `test` matcher, on the repository's own fixtures,
  which are byte constants and no images of anything. No real source's adapter exists: it is a later task of a
  few files, after the owner's agreement.

### Task 8. The flag, the texts and the record (batch end)

- **Migration.** `signals_and_retention`: `case_flag`, `erase_automation_records`.
- **Builds.** The flag's chip and line and [case.sameSource]; the retention job's calls: the erasure of a match
  record with its refusal's account (`automation_records`), and the deletion of stored hashes and ratings while
  their tool is off (`tools_off`);
  rulebook version 4 with its line in `RULES_CHANGES` (W.4); the terms' sections and `RETENTION`'s printed list
  (W.9) with their table tests; the export's members (W.10); the README whole (W.11), with the line that the
  owner fills with counsel's advice on a held upload and with Before going public (section 17's list); the dated
  amendments of section 15 and this design's own amendments from the build.
- **Files.** The migration and the schema; `packages/contracts/src/moderation.ts`, `automation.ts`;
  `packages/rules/src/index.ts`; `apps/api/src/moderation/cases.ts`, `retention.ts`, `media/index.ts` and
  `media/repo.ts` (what the retention job deletes of the media module's tables), the export's files;
  `apps/admin/src/screens/Queue.tsx`, `Case.tsx`, `messages.ts`; `apps/app/src/lib/terms.ts`, `app/terms.tsx`;
  `README.md`; `docs/superpowers/specs/`.
- **Tests.** Rows 25, 26; every table and word test of 12.2 once more; the browser check over every screen of 8.9
  in one pass at 360 px; its integration files; the whole suite, in which the labs' cases run as the tests of
  Tasks 2, 6 and 7 on PostgreSQL 18.6.
- **The walk-through**, on a rebuilt stack with every real adapter off and the `test` adapters on, so with
  `APP_SITE` closed. How each side is driven: the console through its own site, which `APP_SITE` does not close;
  the app's side by requests to the API's development port, as the smoke test sends them (sign-up, upload, post,
  `GET /api/moderation/decisions/:id`, the objection, the notices, `GET /api/public/transparency`), since with
  the site closed Caddy answers 503 for every page of the app; the two public pages were read through Caddy in
  Task 4, with every adapter off. The steps: an upload scored by the `test` scorer, the finding, the measure
  with the setting on, the statement read as the author, "Ask for a person", a moderator's lift; an upload with
  a `near` match of the listed class, accepted and, once posted, a finding under R2 with the post frozen and
  nothing sealed; an upload with a match of another class, accepted, its flag on the case; a matched upload refused, objected to, ended as "No
  report", and still there until its delay has passed; a matched post sealed, an admin's seal for good, the
  files moved, the report and an assessment `illegal` recorded, the release refused without a leave, the leave
  recorded, the release, the files destroyed, `release-show`; an answer without a seal on another matched post,
  with its reason, and the image still refused to staff; a restore with that release replayed; the first
  edition on a `yearForTest` year, read from `GET /api/public/transparency`; the head's row of the day.
- **Docker.** The engine, for the walk-through's stack.
- **Leaves.** Sub-project 3 is complete. What remains is the owner's (section 17).

## 14. Success criteria

1. With every adapter off, which is how 3d ships, the stack, the whole suite and the smoke test pass; no setting
   of 3d is required for any Compose command; the public pages say of every tool that it is off; and no hash, no
   score and no outbound request to a third party exists anywhere.
2. The files of every image sealed for good can be moved to a volume that neither the API nor the worker mounts,
   and back, by a program that has no network, no database and no decoder, on a list the ledger prints. Each move
   is recorded with a digest, line by line; one bad line stops no run and no record; a file that is found in
   neither place has an end of its own, which its author is told; no file lies in the quarantine without a
   record; and staff are alerted daily while a move is due.
3. A seal for good ends for good only by an admin's confirmed release, on a recorded report, a recorded leave or
   instruction to destroy from an authority or a court, files wholly in the quarantine and no preservation for an
   order. An authority's assessment, `illegal` included, changes nothing about the files. No program, job or
   command releases, nothing is released by time while counsel's period is unset, and no text promises a
   destruction or a period.
4. A release is recorded as what it is: the image rows are erased at once, the quarantined files are destroyed
   afterwards by the one-shot service, each with a recorded digest; no text says "no longer holds" or "destroyed"
   before that, and the record says after which day no backup that is deleted on time holds them. Every staff
   account is told of a release and of a hold ended without a report. After a restore every recorded release and
   every recorded end of a hold is replayed or closed by a person before the app's site opens, a program's lost
   measure is a gap like any other, and a seal taken again freezes nothing of a released post.
5. Every image that stops being public, by any measure of 3c, 3e or 3f, by its author's deletion, by a purge or by
   a release, has an outbox row written in the same transaction. No purge delays, blocks or undoes a measure, and
   every text that states a bound states the header's: five minutes at the edge, one minute in a browser.
6. `/rules` shows the rulebook in force, the numbers korbat acts by, what each automated tool does today as the
   running server reports it, and a dated change log. `/transparency` shows yearly editions of banded counts that
   never change once published: a version added because an order's hold ended changes the order section alone.
   No public page or route holds a decision's row, an identifier, a decision's day or a figure under ten, except
   the order section's numbers, which the page names as the exception. Every sentence about a tool is true with
   the tool off, on, and off again after it ran.
7. The yearly figures that TCO Art. 7(2) asks for are published in the edition of a year that has them, and an
   order whose notice is held is in no public figure until its hold ends.
8. The figure of DSA Art. 24(2) can be printed on any day from numbers alone: korbat stores two numbers a month,
   and the page says what exists until a month has ended.
9. A value of the audit head is published every day, on korbat's page and in the keeper's mail, and with a witness
   on, with an outside proof anyone can verify. The value differs from day to day also when the log did not
   grow. The page says what the value does not prove. A restore is a public, dated row.
10. No program takes a final measure, removes anything, hides text, or suspends or restricts an account. What a
    program may do is one of two interim measures, each tied at commit to its signal and to an audit row of the
    system, capped by the hour and the day for each rule by itself, stopped while its measures or a request for a
    person wait unanswered, and off unless the owner has set the tool, its switch, and the date of the impact
    assessment for that tool and for that measure.
11. Whoever a program's measure concerns is told at once, in words that say that automated means found the image
    and took the measure, that name the rule, that claim nothing nobody knows, and that offer a person, also to a
    suspended account. One message reaches staff, puts the case first in its lane and alerts; a person's decision
    ends the measure.
12. A person's decision that follows a program's finding says so, to its author and to whoever reported; it says
    "partly automated" exactly when the person could not look and relied on a match, and "looked at the image"
    only when the record shows the look.
13. Only a match that its source reports as exact, with an entry it classifies as child sexual abuse material,
    refuses an upload or seals a post's images. A match with such an entry that is not exact refuses and seals
    nothing: on a post it is put before an admin as a finding under R2, which freezes the post and alerts. A
    match with an entry of another class is a flag in the queue that cites no rule, freezes nothing and alerts
    nobody. An upload with an acting match is never
    attached to a post, never served, in no export and never deleted by a timer; an admin ends its hold unseen,
    by "Report" or by "No report" with a reason from a closed list, on a screen that tells the admin neither;
    and a burst of matches refuses nobody beyond a published limit.
14. A source of known material receives hashes and nothing else, and its silence stops no upload. A match record
    names no account and is erased 180 days after its case closed, its hold ended or its images were released,
    and with it what tied a refusal to an account. Nobody at korbat opens an image that a match names, whatever
    was answered about it.
15. The flag "Possible coordinated reporting" is computed at read, shown to staff, and read by nothing else.
16. The eight tasks can be built in order by the lighter loop, each naming the files where its code lives today
    and each passing with every adapter off, and the build can stop after Task 5 without loss and without a
    state that accepts a `test` adapter on an open site.

**The going-public gate.** korbat is not opened to the public, and sign-up is not opened to people the operator
does not know, until three things are true: 3f's order path has shipped; Tasks 1 and 2 of this design have shipped
(criteria 2 to 4, with the replay); and the owner's list of section 17 is done as far as it is marked "before
going public". No adapter needs to be on for the gate: the gate is about what korbat must be able to do with
sealed images, not about finding them.

## 15. Changes to the main design and to the 2b, 2c, 3a, 3c, 3e and 3f designs

Task 8 writes each as a dated amendment: in the main design's section 9, and as a section "Changed by 3d" in each
other design. One is written before 3f is built (the first under "The 3f design"), and with it, if 3f's record of
a report cannot be opened without an account, the amendment that lets it.

**The main design** (`2026-09-03-korbat-design.md`).

- **Lines 110 and 187** (a public copy of every case; monthly counts, appeal and reversal rates): withdrawn. No
  table `transparency_log` and no public row of a decision exist. `/transparency` shows yearly editions of banded
  counts, by ground and by kind of measure and never their cross, published on or after 1 March and never
  changed; a rate appears only as two counts on a base of ten or more. Reason: on a service of some hundreds of
  accounts a dated row, or a small cell, is a statement about a known person (section 2, rows 1 to 3). Flagged
  for the owner.
- **Line 147** (reports weighted by reputation; brigading sends the case to a senior queue): one flag on a case,
  shown to staff, which orders nothing and protects by saying "this is not a finding". Reports are never
  weighted, as 3c decided.
- **Line 148** (ban-evasion signals): not built.
- **Line 167:** `/rules` exists, with a change log and the section "Automation".
- **Line 171** (R1: a score withholds): a score opens a finding for a moderator. It withholds that one image,
  never the post, only where the owner has set `AUTOMATION_R1_ACTS=on`; the default is off.
- **Line 172** (R2: Cloudflare's match removes, suspends, reports to NCMEC; the only automated removal): a match is
  korbat's own comparison of hashes with a source the owner has an agreement with. Only a match that the source
  reports as exact, with an entry it classifies as child sexual abuse material, lets a program act: on an
  upload it refuses and holds, and on a post, where the owner has switched that on, it seals the post's images
  until an admin answers. A match with such an entry, exact or not, on a post opens a finding under R2, which
  freezes the post and alerts an admin, as a moderator's own finding would. A match with an entry of another
  class is a flag for a person: it cites no rule, freezes nothing and alerts nobody. Nobody at korbat opens an image that a match names, whatever is answered. Nothing is removed by a
  program, no account is suspended by one, korbat makes no report to NCMEC, and no sealed image is destroyed
  without an authority's or a court's leave. There is no automated removal in korbat; there are two automated
  interim measures.
- **Lines 179, 180 and 184** (what automation may do): it may open a finding; where set, withhold one image under
  R1 or seal one post's images under R2, until a person decides; and flag. It may not raise a priority, remove
  anything, hide text, reduce reach, or suspend, restrict or end an account, R2 included. (A program's seal starts
  3f's record of a report and its hold of the account's address, as every seal does; the texts say so.) A flagged
  case stays in its lane.
- **Line 190** ("usually within 24h"): 24 hours is the published target for a person's answer after the author
  asked for one.
- **Lines 201 and 204:** the pages exist as section 9 has them; no panel shows live transparency figures.
- **Line 203 and line 291** (the composer's warning near the threshold): not built. A score before posting would
  tell a poster how to get past the check.
- **Line 156** (backups): the volume `media-quarantine` is in no backup, and the price is stated.
- **Line 293** (media serving): public images carry `public, max-age=60, s-maxage=300, must-revalidate,
  stale-if-error=0`. Cloudflare's scanning tool is not switched on (section 2, row 31).
- **Lines 23 and 38 to 42** (the stack): one more volume and one more one-shot service behind a profile; the API's
  outbound hosts grow only while an adapter is on.
- **Line 342 and section 6, row 3:** sub-project 3 is complete with 3d, and the gate is section 14's. Of line
  342's list: hashes are computed only while a matcher is on and are deleted with their image; the Cloudflare
  runbook says what its tool would do and leaves it off; the brigading signal is one flag.

**The 2b design** (images).

- **2.2, 2.3 and 4.2** (the file protocol; the worker; process): the result file has protocol version 2 with two
  optional members, `r1` and `pdq`; `finalize` refuses a version it does not know. The worker gains a scorer seam
  and, where allowed, its own PDQ; it keeps no network and its allow-list of dependencies is unchanged.
- **4.1 and 4.3** (upload; finalize): while a matcher is on, the API hashes the bytes as it streams them, before
  the original is discarded, and `finalize` asks the source once. While it is off neither happens, and the
  retention job deletes what was stored while it was on. "Nothing of the original is kept" gains the three
  hashes as its one exception (W.11).
- **4.4** (attach): the database refuses to attach an upload that a refusal names (`upload_refused`). An upload
  whose match does not act, of either kind, is attached like any other.
- **4.5 and 5.5** (serve): the header above. A `visible` image whose files are in the quarantine answers 404 and
  its owner's status reads "being restored"; an image whose files are recorded as lost reads "lost". The one
  function that serves staff an image refuses an image that an unerased match record names (`image_matched`).
- **4.6** (the owner's removal of an upload): while a matcher is on, an upload whose check has not answered is not
  deleted by its owner's removal; the composer forgets it, and the sweeper takes it once the check has answered
  and found no match.
- **4.7** (the sweeper): a held upload has `hold_until` `infinity` and is kept until an admin ends its hold;
  after an end as "No report" it is kept `noReportHours` longer.
- **The data export** (2b's and 3c's reader of ready images): it leaves out an image that a refusal names, on a
  post or not, whatever the hold's end (W.10).
- **2.6 and 9** (the boundary; infrastructure): `media-store` gains a fourth mount, the `quarantine` service,
  read-write, without network, started by hand. Its program belongs to no module, imports nothing under `./` and
  keeps a third copy of the naming rule, held equal by a unit test. The API's image creates the path
  `/media/quarantine`, owned by `node`, mode 0700, beside the two media paths, so that the new volume takes that
  owner and mode; the `api`, `migrate` and `worker` services mount nothing there.

**The 2c design** (Explore).

- **Section 2, the row "Signed out", and section 12:** a signed-out read of Explore, as of every read route, adds
  one keyed digest to the day's sketch of the recipients' count, under a salt that lives 26 hours. Nothing about
  the reader is stored and the answer is unchanged.
- **Sections 7 and 11:** the formula and How Explore works are unchanged by 3d.

**The 3a design** (the staff console).

- **Section 10:** `STAFF_STEP_UP_ACTIONS` gains `seal_released`, `upload_hold_ended` and `upload_released`, each an
  admin's. The system actor writes plain rows without a key: `automated_decided` and `edition_published` from the
  API, and from the command line `quarantine_recorded`, `release_leave_recorded`, `release_leave_withdrawn`,
  `release_replayed` and `head_restore_marked`; `audit-verify` checks the first against the decisions. The head's daily publication
  writes no audit row: it would move the head it publishes.
- **Section 9:** the router gains `uploads`.
- **Section 7 and the runbook's kept head:** the head's daily value is published and mailed to the keeper with its
  place and hash. The value is a digest of a tag, the day, the place and the hash (`korbat.head.v2`), so it
  differs from day to day also when no staff member confirmed anything: nobody can read quiet days off the
  page. The keeper's daily visit stays: only the keeper holds the place.
- **Section 4** ("publishing the audit head ... (3d)"): done here.
- **The API's modules:** a seventh, `transparency`, entered through its index; the architecture test lists it
  and pins what it may import. The auth module gains a hook that tells it of a resolved or an unresolved
  session, and one sender of a mail to the keeper's configured address.

**The 3c design.**

- **Section 17, "How the release fits"** (dated note; ruling O2): the release's mark is keyed on the post
  (`release_posts`), not on `seal_posts`' key. A seal for good taken again after a restore is a new row; with the
  mark on the seal's key it froze a released post again for good (`lab-3d`, D4).
- **Section 17, the release's ground** (dated note; ruling 1 of 3d's review): where 3c lets the release wait for
  "the authority's answer", it waits for a recorded leave or instruction to destroy, from the authority or from
  a court. An answer `illegal` is an assessment and changes nothing about the files; `not_illegal` supports the
  unsealing, as 3c has it ("a seal for good only on the authorities' answer"); no answer supports nothing. 3c's
  terms and runbook promise no destruction and no period.
- **6.1, 7.3, 7.5 and section 8, the look after an answer without a seal** (ruling 2 of 3d's review). 3c says of
  a case's images after an admin's answer without a seal that staff "may, and must the same day" open them. For
  an image that an unerased match record names this does not apply, on its case or on any other: gate V's one
  function, which serves staff an image, refuses it with `image_matched`, and the console prints
  [case.image.matched] in its place. Three texts of 3c get a variant for a case that holds a match and stand
  unchanged for every other case: the console's sentence for the admin ("After an answer without a seal the
  case's images may be opened: whoever is on duty opens the case's target the same day ...") becomes
  [case.liftedMatch] (8.4); the mail `moderation_csam_lifted` leaves out "staff may open them" and the look
  (W.8); and R2's sentence "staff may open them like any other image" gains its exception in rulebook version 4
  (W.4). An answer without a seal on a case with an acting match needs a reason from a closed list (8.4). The
  residual is stated in 11.3: after such an answer a matched image is public and no person at korbat has seen
  it.
- **Section 17, first paragraph:** the transparency pages are not "built from `decisions`" row by row: they print
  stored editions of counts. The Transparency Database is not fed, and no `puid` is published.
- **6.1:** the seal arm of `frozen_for` gains "and the post is not released". `decisions.decided_by` may be null,
  exactly for a decision whose `automated_decision` is `fully`; `intake_kind` gains `automated` and
  `intake_channel` gains `system`; an `automated` intake may cite no rule, which is how a match with an entry of
  another class than child sexual abuse material is put on a case (`intakes_has_ground`, added again with one
  more arm); `decisions` gains the column `match_answer_reason`. **6.2:** `decisions_record` and
  `decision_holds` are replaced as section 6 says. **6.5:** the two pins are extended (the writers of
  `post_media.erased_at`). **Section 10:** `CaseDecidedParams` gains `matchAnswerReason`, the reason an answer
  without a seal on an acting match needs; `decision_holds` holds it to the decision and to the case.
- **Section 2, the rows that defer and flag** (lines 26 and 40): the only deferral stays `MODERATION_DEFER_UNPROVEN`;
  3d adds a flag and no deferral.
- **Section 9 and 10:** R1's and R2's automation sentences return in rulebook version 4; the statement's fixed
  sentence "No automated means were used to find this or to decide it." is one of four kinds (W.3); redress
  version 4.
- **7.15:** `moderation_decision` gains two subjects (W.8). The update to whoever reported or notified
  (`notice_update`) and the status page of a report (3c 9) no longer print one fixed sentence for every line:
  the line gains the decision's `automatedDecision`, and for `partially` the sentence is
  `update.automated.partly` (W.3), since DSA Art. 16(6) binds a micro platform too. One table test renders
  an update for each of the three values.
- **Section 9, the terms' "Your data":** what korbat keeps "when someone reports a post or a profile" is also kept
  when a comparison finds, on an image of a post, a match with an entry that its source classes as child sexual
  abuse material, exact or not, and nobody reported anything (W.9): the finding cites R2 and freezes like any.
- **The data export** (3c's reader of ready images): it leaves out a refused upload (W.10; ruling 5 of the review).
- **Section 13, Task 12's runbook:** the R2 paragraph's "acts on the files only by hand" is replaced by W.11's
  quarantine and release; the hard gate's line reads as section 14 has it.

**The 3e design.**

- **Section 17** (a match may ask for a protective suspension): not built. The protective suspension rests on an
  admin's seal for good, as 3e built it; 3d adds no second basis (section 2, row 29).
- **Section 17** (the Transparency Database export gains the account measures): no export exists; the edition
  counts the account measures by kind.
- **W.4:** rulebook version 4 follows version 3; R6 is unchanged.
- **Section 6:** `strike_due` answers false for a decision without a decider (a test of Task 6 holds it).
- **7.3, the table of what a suspension leaves, and section 2, row 9:** the two objection routes of 3d (`POST
  /api/moderation/decisions/:id/objection`, `POST /api/moderation/uploads/:refusal/objection`) join the writes a
  suspension leaves, as the reply and an appeal are left, for a suspended account and for a terminated account
  whose termination is not yet final. Each gets its row in 3e's route table, so 3e's route walk passes, and
  Tasks 6 and 7 each send their objection from a suspended account. Without the rows the way to a person that a
  statement promises would be closed for the accounts whose case is gravest.

**The 3f design.**

- **6.5 and 8.11, before 3f is built** (ruling O1): `seal_report(action)` also returns the answer's word (`answer`)
  and the time the report was sent (`sent_at`), and is executable by 3d's `release_facts` alone. Four reads of
  3f's records remain in 3d's own definer functions: a hand-over's day, a held upload's record, whether an
  event of the report's record carries "not to the person" with an end that is open or ahead, and whether a
  record of the account is still owed, which `upload_hold_end` asks before it releases the address hold. One
  write is added, the address hold at a refusal (below). The edition's order section reads 3f's rows as `tco-counts`
  does; 3d reads and writes 3f's tables nowhere else.
- **7.13, the answer of an authority** (ruling 1 of 3d's review): `notification-answer` records an assessment and
  nothing more. No word of `NOTIFICATION_ANSWERS` releases or destroys anything; a leave or an instruction to
  destroy is a fact of 3d's own, recorded by `release-leave`.
- **7.13 step 6, "not to the person":** the mark that 3f records on an event of a notification record also holds
  the author's notice of a release of that seal or upload: while it stands, 3d sends nothing and shows nothing
  of the release, and sends the notice in the dispatch round that finds the mark ended. It is one of the three
  holds that section 6.2's `release_tellable` reads. The second is 3f's own too: 3f's hold on a decision about
  a post of the release while an order's notice is held (3f 6.3 step 10). The third is 3d's: the leave's own
  mark that the person is not to be told (`release_leaves.untold`, `untold_until`), which `release-leave`
  records and no table of 3f's holds.
- **7.13, 6.5 and 6.7, the account's address after a refused upload:** the trigger `upload_refusals_hold` writes
  the account's row of `auth.report_holds` itself at a refusal's insert, as 3f's `report_open()` writes it in
  its own body for a seal taken while deciding (3f offers no function to call), so that an uploader who is told
  of a held upload and deletes the account at once is still known for 3f's days when an admin chooses "Report".
  `upload_hold_end` releases that hold on "No report" when nothing else holds the address, and sets it again,
  counted from the refusal, when an admin turns that end into "Report" inside its hours; 3f's commands
  release it when the record that `upload-report` opens is sent or declined. 3f 6.7's pin on the writers of
  `auth.report_holds` gains these two functions. `upload-report` opens its record for the account that the
  refusal names, which after a deletion is an anonymised profile, and without an account only for a refusal
  that names none (3f's column allows it, or 3f's amendment before its build makes it nullable). The mail `account_deleted`'s sentence on the held
  address reads "If korbat has sealed images of this account, or holds an upload of it, ..." for every account,
  as 3f words it for every account. Which of the two the research left open, to hold the address or to accept
  that telling at once lets an uploader erase who they are, is flagged for counsel (section 17, E.2).
- **7.17, the import after a restore:** `restore-import` also reads the lines of 3d's actions above the restored
  head: `seal_released`, `upload_released`, `upload_hold_ended`, `release_leave_recorded` and
  `release_leave_withdrawn` as gaps of the class `release` (a `release_leave_recorded` line whose leave a
  later line withdraws gets none, and a withdrawal's line gets one only where the restored database holds
  the leave), and `automated_decided` as a lost decision of 3f's own class by its one action
  (`seal_interim` or `restriction`).
- **Section 16, "The purge of edge copies"** (dated note; ruling O3): the target of 55 minutes stays. A purge is
  fast, unconfirmed and can fail; the bound korbat can state is the header's. The order's screen shows whether
  each purge was accepted.
- **Section 16, "The hand-over's reader":** `handover` mounts the quarantine read-only beside the store, also
  read-only, and looks in the quarantine first: a seal taken while deciding still has its files in the store.
- **6.6 and 8.8:** `restore_gaps` gains the class `release`; `RestoreView.mayOpen` is false while one is open.
  **6.7, the pins:** the writers of `restore_gaps` gain the three replay functions (`release_replay`,
  `upload_release_replay`, `upload_hold_replay`) and `upload_hold_end`, and `release-leave` closes a gap as the
  migrator, as 3f's notification commands do with `--gap`; `post_preserved` gains a second caller,
  `release_facts`.
- **W.4:** twelve alert kinds join (W.7), and `moderation_urgent`'s mail gains its sentence for held uploads.
  **W.9, "The yearly counts", and W.10, item 10:** the manual report and the owner's page are replaced by the
  edition on `/transparency`; `tco-counts` stays for the authority.
- **W.9, "Restoring":** four steps join (W.11).

## 16. What sub-project 3 leaves for the sub-projects after it (scope only)

None of these is started without the owner. Each line is what the later design must take up, not how.

- **3b, import.** An imported image enters through the same upload path, so through the scorer's and the
  matcher's seams, the attach block and the outbox with no code of its own. What 3b decides: what an import does
  when one of its images is refused (the main design's line 243 said "aborts the whole import"; the hold and the
  notice are per upload); whether an import is paused while checks are `unchecked`; and the volume a burst of
  imports puts against the cap of a program's decisions and against a source's limits. 3d makes no backfill: an
  image uploaded before a tool was switched on has no hash and no score, and 3b inherits that.
- **2d, engagement.** Avatars and share cards are images outside `post_media`. A table that holds them must join
  3c's gates (3c 11), and for 3d: the quarantine's plan, the outbox's triggers (they sit on `post_media` and
  `posts` only), the hashing and the check, and the public header. Which measure a matched avatar meets is 2d's
  to design; no program acts on an account. If 2d builds a notification list, the four notices of 3d (a
  program's measure, a refused upload, a release, a lost image) are entries of it; their words stay 3d's, and a
  release's entry appears no earlier than its notice may be told.
- **4, hardening.** Counsel's review of the terms' sections of W.9, which 3d adds as drafts without a new
  `TERMS_VERSION`, and of every row of section 2 flagged for counsel; the impact assessment; the restore rehearsal
  with a release replayed and the quarantine outside the backup; the lab on the owner's zone (what the edge does
  with `max-age=0` beside `s-maxage`, and a purge timed to `MISS`); the period for sealed images an authority
  never answers (`silence_days`), with the notice of the day, its objection, their screen and route, and the
  terms' sentence, none of which 3d ships; whether anything but a recorded leave may ever support a destruction;
  and, only if the owner chooses them, the classifier's real adapter and a real source's adapter, each a task
  of a few files against its seam with its own supply-chain check.
- **4, if korbat grows.** Past the exemption of DSA Art. 19(1): the Transparency Database's submitter as section
  2, row 6 lists it, and the yearly report in the Commission's template. The editions' bands and the floor of ten
  are constants with a method number, so a later method is a new version, never a rewrite of a published edition.
- **5, native builds.** The two public pages, the notices and the two forms are routes of the same app. A native
  image cache is a copy the edge purge does not reach: 5 bounds it by the header's one minute or by a purge of its
  own. The composer's refusal of a matched upload must reach a native picker with the same words.

## 17. For the owner

The README's "Before going public" gains parts A and B below; parts C to E are the owner's when a tool is wanted.
A line that is missing here is a thing nobody does. So this is the one list: section 2's "For the owner" and "For
counsel" point here and repeat nothing, every row of section 2 that carries a flag has its line below, and the
README prints this section. With every line of C undone korbat runs as it ships: nothing is scored, hashed,
matched, purged or witnessed, and the public pages say so.

**A. Before going public** (the gate; none needs an adapter).

1. **The quarantine's disk.** The volume `media-quarantine` on the server's encrypted disk and in no backup. Its
   owner and mode (uid 1000, mode 0700) come from the API's image; read them once from inside the service.
   Accept the price in writing: a lost disk loses the sealed files (section 2, row 40), and an image lost that
   way is told to its author as lost.
2. **How backups are made.** Name the backup of `media-store` and its lifetime; it must equal
   `RETENTION.backupDays`, since a release prints the day after which no backup that is deleted on time holds a
   released file. Decide who destroys backups at once when an authority instructs it, and how a backup that is
   kept for an authority is marked and later destroyed by hand.
3. **One drill**, with harmless files: a seal for good on a test post, the move, the report and an assessment
   `illegal` recorded, the release refused for want of a leave, a leave recorded with `release-leave` under a
   test reference, the release, the destruction, `release-show`; then a restore from a backup taken before the
   release, `restore-import`, `release-replay`, the inventory, the files destroyed again, the site opened only then.
4. **Counsel, first question:** the period and the legal basis for keeping sealed images, who may destroy them and
   on whose word, and whether backups must be destroyed at a release (rows 41 and 46). Whatever the answer,
   nothing is released on an assessment: only on a recorded leave or instruction to destroy, from an authority
   or a court, with its reference (ruling 1 of the review). Until counsel answers, `silence_days` stays unset,
   nothing is released by time, and the terms promise no destruction and no period.
5. **The national intake, when korbat registers with it.** Ask the authority korbat will report to, and note the
   answers in the R2 records: does it answer a report with an assessment; does it say when it has the evidence
   it needs; does it instruct hosts to delete, in what form and under what reference; does it ask hosts not to
   tell the person, and for how long. The answers decide what `release-leave` will ever have to record. Name
   who records a leave: the command writes down what that person holds in writing and cannot check it, so a
   wrong leave and an admin's key together destroy. A recorded leave is never rewritten or deleted, so the
   target and the reference are checked before it is recorded; a leave that was recorded by mistake all the
   same is withdrawn (`release-leave --withdraw`) before any release rests on it, and after a release nothing
   takes it back; and when the authority asks that the person is
   not told, that is recorded with the leave (`--untold`) or on the report's record before any release.
6. **A second person at a destruction.** Decide whether a second person witnesses each release and each
   destruction. The design mails every staff account at a release and at a hold ended without a report and
   lists both on Home for 30 days; with one person these are one, and the keeper is then the only other reader.
7. **The pages.** Read `/rules` and `/transparency` as they will be public: yearly banded counts and no rows (rows
   1 to 3), the recipients' method (row 8), the head's place (row 9), and the main design's amended promises (row
   10). Each is yours to overturn before the first edition; after it, an edition is never changed.
8. **The keeper** receives the head's daily mail at an address the operator does not control, and keeps it.

**B. Before any tool is switched on.**

1. **The impact assessment** (GDPR Art. 35), for each tool by itself and again before its measure is switched on,
   with the balancing test for the legitimate interest and the privacy text of W.9 read against it. Four dates,
   four settings: `AUTOMATION_DPIA_R1` and `AUTOMATION_DPIA_MATCH` for the two tools, `AUTOMATION_DPIA_R1_ACTS`
   and `AUTOMATION_DPIA_MATCH_ACTS` for the withhold and for the automatic seal. The API refuses to start with
   a tool or a measure on and its own date unset, and `/rules` prints each date in its own tool's block: the
   assessment of one tool never passes the other, and the assessment of a flag never passes a measure (row 49).
2. **The automatic seal needs more than a date.** In the research's terms: the EDPB reads an automatic seal as a
   decision based solely on automated processing with a significant effect on the person, so GDPR Art. 22(1)
   applies and an exception of Art. 22(2) is needed (row 27). `AUTOMATION_R2_ACTS` is switched on only with the
   owner's impact assessment that covers the seal and with counsel's word (E.3). Its other value is the design's
   fallback: a match only raises an urgent item for an admin, and needs neither.
3. **The Member State and the operator's facts**: the legal form, staff and turnover. Every "does not bind" of
   this design rests on a micro or small enterprise (DSA Art. 19(1)).
4. `APP_SITE` open means no `test` adapter: the API refuses the combination.
5. **Who answers within the published 24 hours** (row 25). From the day a measure is switched on, 24 hours is a
   public commitment, and only an admin answers a seal. Name who answers a request for a person when the one
   admin is away. If nobody can, the measures stay off. A program also stops by itself under a rule while 20 of its measures under that rule
   wait for a person or a request is 72 hours old (row 18), which is a floor and not a plan.
6. **Who answers an objection to the processing** (GDPR Art. 21), which the terms offer "at the address under
   Contact": name the person and what they do with one.
7. **Counsel's advice on a held upload** (E.2), written by the owner into the README's line under "A held upload"
   before `MEDIA_MATCH` is on. The console tells an admin neither to report nor not to; that line is the only
   place where korbat's rule for it stands (ruling 7 of the review).

**C. For each adapter.**

| Adapter | Obtain | Decide | Configure | While it is off |
|---|---|---|---|---|
| Edge purge | the zone, with the tunnel (Foundation Task 16); an API token with the one permission Zone, Cache Purge, on that zone | whether the stated bound of five minutes at the edge and one in a browser is acceptable (row 12) | `EDGE_PURGE=cloudflare`, `EDGE_ZONE_ID`, `EDGE_API_TOKEN`, `EDGE_HOST`; in the zone: Browser Cache TTL "Respect Existing Headers", no Edge Cache TTL rule on `/api/media`, Always Online off; then the README's check | every outbox row closes as `off`; the header alone bounds a copy |
| R1 check | leave for a build step to fetch the pinned weights (one file, by digest) and to keep a copy; the model's card read on the day (row 50) | native or WebAssembly runtime; whether a score only flags (the default) or also withholds (`AUTOMATION_R1_ACTS`, rows 19 and 20); the threshold, after the build task has measured memory, time and the scores of benign fixtures | `R1_CLASSIFIER=onnx`, `AUTOMATION_DPIA_R1`; for the withhold `AUTOMATION_R1_ACTS` and `AUTOMATION_DPIA_R1_ACTS`; the threshold as a new version of `automation_rules()` | no image is scored and no rating is kept; R1 is report-driven, as 3c built it |
| Known material | an agreement with a source (the research names the Hash Check Service in the Netherlands, Arachnid Shield in Canada and NCMEC's list; the IWF is closed to a service of this size), after asking it the questions under this table | whether a hash-only query is inside "no moderation SaaS" (row 32); which matches act (row 28): by default only a match the source reports as exact, with its class for child sexual abuse material; a match of that class that is not exact refuses and seals nothing and is put before an admin as a finding under R2, which freezes its post; a match of another class is a flag (D); whether an exact match on MD5 or on SHA-1 alone should act, since two files with one MD5 or SHA-1 can be made on purpose by whoever makes both; whether an exact match that the source reports for a perceptual hash should act; whether a match seals (`AUTOMATION_R2_ACTS`, row 27, B.2); which "No report" reasons korbat accepts (row 35); leave to fetch the reference's PDQ test vectors | the adapter written against the seam for that source; `MEDIA_MATCH=<source>`, the source's settings, `AUTOMATION_DPIA_MATCH`; for the seal `AUTOMATION_R2_ACTS` and `AUTOMATION_DPIA_MATCH_ACTS`; the source's name and its acting classification in `MATCH_ACTING` | no hash is computed or kept, nothing is compared, and R2 is report-driven, as 3c built it |
| Head witness | a timestamp authority: a free one, or a qualified one under contract for the presumption of eIDAS Art. 41(2) | the place, or none (row 9) | `HEAD_WITNESS=rfc3161`, `HEAD_WITNESS_URL`; its certificate chain kept off the server, with the keeper | the value stands on korbat's page and in the keeper's mail only, and the page says what that proves |

**What to ask a source of known material** before an agreement: whether a small EU operator qualifies; which
hash types it holds; which of its classifications it names child sexual abuse material and which are other
classes; what it calls an exact match, for a cryptographic and for a perceptual hash, and the threshold of a
near one; what it logs and for how long; whether it reports a hit and to whom; what its terms oblige korbat
to do on a hit and by when; whether its answer may be acted on without a person viewing the image; and
whether korbat may name it on the rules page, in a statement and in a notice.

**D. Decide**, each with its cost in section 2.

- *The pages:* yearly banded counts and no public rows (1 to 3); one yearly report and no template (4); a held
  order is counted after its hold (5); no Transparency Database (6); the recipients' method, and whether
  signed-out readers are counted (`RECIPIENTS_SIGNED_OUT`, 8).
- *The edge:* 55 minutes stays (13).
- *A program's limits* (18): 20 measures an hour and 100 a day for each rule by itself, so that a burst of R1
  scores cannot use up the seal of a known match; no new measure under a rule while 20 measures under that rule
  wait for a person, and none under either while a request for a person is 72 hours old; 20 refused uploads an hour, over which a match refuses nobody until the
  operator has looked. No source gives any of these numbers.
- *The target of 24 hours* for a person's answer (25): yours to accept and to staff (B.5).
- *No composer warning* (21).
- *Which matches act* (28), and that an upload with such a match stays refused: no person at korbat can accept
  it, since nobody opens it, and the same file is refused again for as long as the source's entry stands (35).
- *A match of the source's own class that is not exact* (28, note 28) refuses no upload and seals nothing; on a
  post its finding, citing R2 like a moderator's own, freezes the post and raises the urgent alert until an
  admin has answered. The other reading of the review's ruling 4 is that such a match freezes nothing and
  alerts nobody, like a match of another class; the design keeps the finding, because of the two it destroys
  nothing and leaves the decision to a person. Yours to overturn, with counsel (E.4).
- *A match and the account* (29): nothing new; the protective suspension rests on an admin's seal for good.
- *An upload passes while the source is silent* (34).
- *After a hold ends without a report* the upload is deleted 24 hours later, and until then another admin can
  end it as "Report" (35).
- *The uploader's address is held* for 3f's days from a refusal, as after a seal; the other way is to accept that
  telling at once lets an uploader erase who they are (35, E.2).
- *When a tool is switched off* its stored fingerprints and ratings are deleted; the other way is to keep them
  and to say so in the terms and on the rules page (33).
- *What "defer" may do* (48): nothing new; a flag orders nothing.
- *The quarantine* holds only seals for good, moved by hand (38).
- *Cloudflare's scanning tool* stays off (31): switching it on makes Cloudflare file its own report with NCMEC
  about korbat's content.

**E. Counsel**, in order of how much waits.

1. The period and basis for sealed images; who may destroy and on whose word; whether korbat may destroy before
   the authority has taken or declined the evidence, and what it risks if it does (the research names
   obstruction offences); whether a leave must come from the authority korbat reported to; the backups (rows
   41, 46).
2. Whether a match obliges a report, on a post and on an upload that was never published, for an exact match;
   under which of 3f's duties `upload-report` opens its record; whether a held upload is lawful possession;
   whether korbat may hold the uploader's address from the refusal (rows 27, 35). The answer goes into the
   README's line (B.7).
3. GDPR Art. 22 for the automatic seal (B.2), for the withhold and for an admin's decision on images the admin
   cannot view; Art. 22(4) for an R1 score; users of 16 and 17 and solely automated decisions (recital 71) (rows
   19, 25, 27).
4. GDPR Art. 10 for the match record and its period; the transfer of a hash to a source abroad; whether korbat
   may act on a classification made under another country's definition; whether an exact match on MD5 or on
   SHA-1 alone, and an exact match that a source reports for a perceptual hash, may act without a person;
   whether a match that is not exact may open a finding under R2, which freezes a post and keeps its images
   against the author's deletion until an admin has answered; whether hashing public uploads is outside the ePrivacy Directive's transposition, so that Art. 6(1)(f)
   suffices (rows 28, 33, 37).
5. Whether an order under a non-disclosure decision may be counted, and which gives way, the report's date or the
   hold (row 5).
6. The basis of the daily digest for signed-out readers; whether a figure given as two bounds meets DSA Art.
   24(3) (row 8).
7. Whether an edge or a browser copy in its last minutes counts against the hour of a removal order (row 13).
8. What an author is told at a release (W.6 says what korbat did and that an authority's or a court's leave is
   its ground, and nothing of an assessment), and for how long that notice must wait when an authority asks;
   what a release does to a waiting appeal; what an uploader is told when an admin chose "Report" (rows 44, 35).
9. Whether exact order figures may stand in the edition (row 4).
10. Whether staff may ever view an image that a match names. The review's ruling 2 says never, also after an
    answer without a seal; the other direction (3c's look the same day) needs counsel first.
11. A match and the account (row 29); Cloudflare's tool (row 31); the quarantine's single copy (row 40).
12. With the source: whether korbat may name it in a public text and in a statement to a person.

## 18. The words (what sections 7 to 10 refer to by key)

Where each block belongs in the joined design: W.1 and W.2 in section 9; W.3 to W.6 in section 10 (constants of
`@korbat/rules`); W.7 and W.8 with section 7's alerts and mails; W.9 in section 9; W.10 with the export; W.11 is
the README's. The console's sentences are in section 8 and the app's short ones in section 9, under their keys.

Nine rules hold for every text of 3d.

1. **No text says more of a score or a match than is known.** A match shows that a file has the same, or a
   similar, fingerprint as one that a named body classified. No text says that an image "is" child sexual abuse
   material, that korbat "confirmed" it, or that an account "posted" such material. A score's sentence says that a
   program rated an image as likely within rule R1. "The same fingerprint" is said only of a cryptographic hash
   of a file's bytes; a perceptual hash is "a fingerprint of how the picture looks", whatever its source called
   the match. A program's own text to a person (the statement of its measure, a refused upload's notice) speaks
   only of a match of the acting kind (exact as its source reports it, with an entry the source classifies as
   child sexual abuse material): no other match refuses, holds or seals. Of the two kinds of match that do not
   act, the one with an entry of that class that is not exact reaches a person only through an admin's decision
   on its finding under R2, and the one with an entry of another class only through a person's decision that
   considered the flag; each has its clause in W.3, and neither clause says more than its record.
2. **No text says that nobody has seen an image**, which korbat cannot know (3e 18, rule 4), **and none says that
   somebody has**, unless the record shows it. Each says what is true: korbat's staff do not open an image that
   a match names, before an answer or after it, and korbat has not assessed it; a moderator "looked at the
   image" only where the access log holds that view.
3. **Every text about an automated step says that automated means were used, and how to reach a person.**
4. **A program's measure is never worded as a finding.** Its statement says under which rule it was taken, never
   "It breaks".
5. **A public page points at no person**: no handle, no post, no day of a decision, no figure under ten, except
   the figures on authorities' orders, which the law asks for as numbers and which the page names as the
   exception.
6. **Nothing is promised that the system does not fix.** The 24 hours are a target. A purge is "accepted", never
   "done". A mail is "sent". While no period for sealed images is set, the text says that none is set. A release
   is "released", never "no longer held" and never "destroyed": the files exist until a digest says otherwise,
   and a backup may hold them longer. No text promises a destruction, on an assessment or after a period
   (ruling 1 of the review).
7. **An authority's reference, a staff handle, a hash and a file's name** appear in nothing a person or the public
   receives. The authority is named by its role: "the authorities korbat reports this to"; a release's notice
   says "an authority or a court" and nothing of what any authority found. An alert carries counts and UTC times
   only (3f 18, rule 4). Every time prints as `utcMinute` does, and a day as "2026-10-16".
8. **No text tells an admin to report or not to report** (ruling 7 of the review). The console words each choice as what it
   does; what counsel advised is in the README, where the owner writes it.
9. **A text about a tool is true in every state the design builds:** with the tool off, on, on without its
   measure, and switched off again after it ran. "Told at once" is said of a measure, not of a finding.

### W.1 The rules page (`RULES_PAGE`, `TOOL_TEXTS`, `RULES_CHANGES`)

- [rules.lead]: "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it
  is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never
  a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the
  day of the decision."
- [rules.law]: "Illegal content. Anyone can tell korbat that something on it is illegal (Report). An authority or a
  court can order korbat to act (Terms, Authorities' orders). korbat cannot restrict for one country alone, so a
  restriction for illegality applies everywhere korbat is available."
- [rules.auto.lead]: "korbat's moderators are people. A program may do the few things listed here and nothing
  else. It never removes anything, never judges text, and never suspends or restricts an account. What a program
  does to a post lasts only until a person decides; the person a measure concerns is told at once, and can put
  it before a person with "Ask for a person". An upload that a program does not accept stays not accepted: a
  person decides what happens to the held file, and nobody at korbat can accept it, since nobody opens it. This
  list is printed by the running server: it says what is switched on today."
- [rules.auto.cap]: "A program takes at most {decisionsPerHour} measures an hour and {decisionsPerDay} a day
  under rule R1, and at most {r2DecisionsPerHour} an hour and {r2DecisionsPerDay} a day under rule R2. It takes
  no new measure under a rule while {unansweredMax} of its measures under that rule wait for a person, and
  none under either rule while a request for a person has waited longer than {unansweredHours} hours. It refuses at most {refusalsPerHour} uploads an hour. Over a limit
  it only reports to korbat's staff."
- [rules.auto.target]: "When you ask for a person, korbat's target is an answer within {objectionTargetHours}
  hours. It is a target that korbat publishes, not a time after which a measure ends."
- [rules.auto.dpia], inside a tool's block: "korbat's data protection impact assessment for this tool is dated
  {date}."
- [rules.auto.dpiaActs], inside the same block while the tool's measure is switched on: "The assessment that
  covers the measure it takes is dated {date}."
- [rules.auto.none]: "No tool that rates or compares images is switched on today."

`TOOL_TEXTS`, one text a tool and state. `{source}` and the model's facts are printed from the facts route.

| Tool, state | Text |
|---|---|
| `r1.off` | "Rating images against rule R1: off. No program rates any image, and korbat keeps no rating from a time when one did. What a program found while it was on is still put before a moderator. Otherwise a moderator looks at an image only after a report or on a finding of their own." |
| `r1.flags` (on, `AUTOMATION_R1_ACTS` off) | "Rating images against rule R1: on. A program rates every uploaded image and korbat keeps the rating with the image. An image it rates at or above the threshold is put before a moderator, who decides. The program hides nothing, and the image's author hears of it only if the moderator's decision restricts the post." |
| `r1.withholds` (on, the switch on) | "Rating images against rule R1: on. A program rates every uploaded image and korbat keeps the rating with the image. An image it rates at or above the threshold is put before a moderator, and korbat hides that one image from other people until the moderator has decided. The post's text stays, and its author still sees the image, is told at once and can ask for a person." |
| `r1.facts` (under either) | "The model: {model}. SHA-256 of its weights: {digest}. Threshold: {threshold}, version {thresholdVersion}. Its publisher states: "{publisherClaim}". korbat has not measured its error rate and claims none. The publisher does not disclose the training data, and korbat found no outside evaluation of bias. A rating says nothing about rule R2." |
| `match.off` | "Comparing uploads with known child sexual abuse material: off. korbat computes no fingerprint of any upload, compares nothing, and keeps no fingerprint from a time when it did, except the one in the record of a match (Terms, Your data). A match found while it was on is still put before korbat's staff. Otherwise rule R2 is applied on reports and on moderators' findings." |
| `match.alerts` (on, `AUTOMATION_R2_ACTS` off) | "Comparing uploads with known child sexual abuse material: on, with {source}. korbat computes fingerprints of every uploaded image, keeps them with the image, and sends them, and nothing else, to {source}: never the image, an address or an account. Only a match that {source} reports as exact, with an entry it classifies as child sexual abuse material, lets a program refuse or seal. Such an upload is not accepted, now or later, and is held unseen until an admin has decided what happens to the file. A match with such an entry, exact or not, on an image that is already on a post is put before an admin at once; the program seals nothing, and from then on korbat keeps that post's images, also if their author deletes the post or the account, until the admin has answered. A match with an entry of any other class only flags the image for a person: no upload is refused and no image is held, sealed or kept because of it. korbat's staff do not open an image that a match names." |
| `match.seals` (on, the switch on) | the text of `match.alerts` up to "what happens to the file.", then: "When an image that is already on a post matches in that way, korbat seals that post's images at once, for everyone, until an admin has answered; it keeps them until then, also if their author deletes the post or the account. The author is told at once and can ask for a person. A match with such an entry that {source} does not report as exact is put before an admin at once too: the program seals nothing on it, and korbat keeps that post's images until the admin has answered. A match with an entry of any other class only flags the image for a person: no upload is refused and no image is held, sealed or kept because of it. korbat's staff do not open an image that a match names, before the admin's answer or after it, and the admin's answer is a person's decision." |
| `edge.off` | "Dropping cached copies: off. When an image stops being public, a copy at korbat's network provider can be served for up to {edgeMinutes} minutes, and a copy in a browser for up to {browserMinutes} minute." |
| `edge.on` | "Dropping cached copies: on. When an image stops being public, korbat asks its network provider to drop its copy at once. The request can fail, so the bound korbat states is the same: up to {edgeMinutes} minutes at the provider, up to {browserMinutes} minute in a browser." |
| `witness.off` | "Outside timestamp for the audit log's daily value: off. The value stands on korbat's Transparency page and in a mail to a person who does not run the server." |
| `witness.on` | "Outside timestamp for the audit log's daily value: on. The Transparency page offers each day's proof and says how to check it." |

A `test` adapter prints its tool's "on" text with "(test adapter)" after "on"; it can run only while the app's
site is closed.

`RULES_CHANGES`, in `packages/rules/src/index.ts`: `{ version, date, summary }`, one a version. The date is the
day the version came into force, a literal written by the task that ships it (for versions 1 to 3, the day of the
commit that added each to this file).

| Version | Summary |
|---|---|
| 1 | "The six rules as first published." |
| 2 | "A person decides every case; the automated checks that R1 and R2 named are withdrawn until they exist. R2 says how reported images are handled without anyone opening them. R4 and R5 say who may hide content while a case is decided and who decides it. R6 names coordinated manipulation." |
| 3 | "R6 names repeated, plainly unfounded reporting." |
| 4 | "R1 and R2 say what an automated tool may do when one is switched on, and point to the list of what runs today." |

### W.2 The transparency page (`TRANSPARENCY_PAGE`)

- [tr.lead]: "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes
  counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a
  decision concerns gets its full reasons from korbat directly."
- [tr.read]: "How to read a figure. korbat prints 0, "1 to 9", or a number rounded to the nearest ten ("about
  60"). A line that would show fewer than ten is folded into "other". Each figure is rounded by itself, so the
  lines of a table need not add up to its total. The one exception is the section on authorities' orders: the
  law asks for those figures as numbers, so they are printed as numbers, small ones too. korbat publishes one
  edition for each calendar year, on or after 1 March of the next year, and never changes it: a correction is a
  new version beside it, marked and dated. The running year shows no figure, so nothing on this page moves when
  korbat takes one decision."
- [tr.edition]: "Edition {year}, version {version}, published {publishedOn}. It counts what was decided, received
  or answered from 1 January to 31 December {year}, UTC. Method {method}."
- [tr.versions]: "Earlier versions of this year, kept as they were published:" then a line each: "Version
  {version}, published {publishedOn}, replaced on {replacedOn}." The newest version's reason stands under its
  heading: [tr.reason.hold_ended] "This version adds an order that an authority's decision forbade korbat to
  disclose until now. Every other figure is the one first published: nothing else was counted again." or
  [tr.reason.correction] "This version corrects the version before it. Every table of the year was counted
  again on {publishedOn}, so a figure can differ for a reason other than the corrected one."
- [tr.none]: "korbat has published no edition yet. The first appears on or after 1 March of the year after
  korbat's first calendar year."

**The tables**, each a heading and its row labels; a figure is the edition's banded string.

| Heading | Rows |
|---|---|
| "Restrictions, by ground" | "Rule {id}: {title}" for each rule; "The law"; "Other grounds"; "All restrictions" |
| "Restrictions, by kind of measure" | each label of `MEASURES`; "Other measures" |
| "Decisions that found no breach" | one figure |
| "Reports and notices received" | "Reports under korbat's rules"; "Notices of illegal content (Article 16 of the Digital Services Act)"; "Findings by korbat's moderators"; "Findings by a program" |
| "Appeals answered in the year" | "Decision kept"; "Reversed in part"; "Reversed" |
| "Re-examinations answered in the year" | "Action taken"; "No action again" |
| "Measures on accounts" | each label of 3e's standing measures; "Other measures" |
| "Programs" | "Findings by a program under rule {id}"; "Measures a program took under rule {id}"; [tr.auto.rate] "Of {base} findings by a program under rule R1, a person then restricted {restricted}." or, on a base under ten, [tr.auto.few] "Too few findings to say what became of them." |
| "Uploads not accepted" | "Uploads refused on a match"; "Held for a report"; "Hold ended without a report" |

- [tr.orders], the heading "Authorities' orders" in a year that has the section: "An order is not korbat's
  decision: korbat gives no reasons of its own for it, publishes no statement of reasons for it, and counts it in
  none of the tables above. These are the figures that Article 7 of Regulation (EU) 2021/784 asks for, as
  numbers." Then 3f W.9's headings with `tco-counts`' figures, without the issuing state.
- [tr.ordersHeld], under every year: "Orders that an authority's decision forbids korbat to disclose are counted
  after that decision ends. A year can gain a second, marked version for that reason."
- [tr.recipients]: "Average monthly active recipients of korbat (Article 24(2) of the Digital Services Act), over
  the six months to {month}: between {low} and {high}." With the setting off: "at least {low}; korbat does not
  count readers without an account." Before six full months are counted: "korbat has not counted six full months
  yet."
- [tr.method]: "How korbat counts (method {method}). An account that was used while signed in during a month is
  counted once for that month. A reader without an account is counted once for each day they read korbat: korbat
  cannot tell whether Tuesday's reader is Monday's, because it keeps nothing that could tell. So the true number
  lies between the first figure, accounts alone, and the second, accounts plus the sum of each day's readers. To
  count, korbat feeds a counting sketch: a small summary that cannot list who was counted. For a reader without
  an account it is fed with a keyed digest of the network address and the browser's name, under a random key
  that exists for 26 hours in korbat's short-lived store and is written nowhere else. Until a month's sketch is
  deleted at the month's end, whoever runs korbat's server could still ask it whether one given account was
  probably counted in that month; after that korbat keeps two numbers and nothing else. A crawler is left out
  only when it names itself. korbat does not record where a reader is, so readers outside the European Union are
  counted too."
- [tr.head]: "Each day korbat publishes one value computed from the day and the newest entry of its staff audit
  log, the record of everything korbat's staff confirm with their keys. If an earlier entry were changed or
  removed later, the log would no longer lead to the values published since. A value shows neither how many
  entries the log has nor any entry, and it differs from one day to the next also when nothing was added to the
  log. A value on korbat's own page proves nothing against korbat's operator, who could change this page too: so
  the same value goes each day to a person who does not run the server, and, when the outside timestamp is on,
  to a timestamp authority."
- [tr.headMissing], in a day's row: "no value was published".
- [tr.verify], while a witness is on: "To check a day: download its proof, get the timestamp authority's
  certificates from the authority itself, and run: openssl ts -verify -digest {value} -in {day}.tsr -CAfile
  <certificates>. It answers "Verification: OK" when that authority signed this value at the time the proof
  states." Task 5 runs the printed command once against a proof made by a local test authority and writes the
  sentence as it verified there; `{value}` is the request's imprint only if section 5's template makes it so.
- [tr.restore], a `restore` row: "{day}: korbat restored its database from a backup. The newest value above that
  still fits the restored log is of {lastDay}." [tr.retired], on each value between: "retired by the restore of
  {day}: true when published, and fits no log now".
- [tr.tdb]: "korbat does not send its statements of reasons to the European Commission's DSA Transparency
  Database. That duty (Article 24(5) of the Digital Services Act) does not apply to micro and small enterprises
  (Article 19(1)), which korbat is, and a statement sent there cannot be taken back. Should korbat outgrow the
  exemption, this page will say from which day it sends them."

### W.3 The statement's new sentences (`STATEMENT_WORDS`, `packages/rules/src/statement.ts`)

3c 10's order stays: what was done; where and how long; the source; automation; the rule or the law; the facts;
the reason; redress. What the sentences read, each a member section 10 must list in `DecisionStatement`:
`automatedDetection`, `automatedDecision` (`not_automated`, `partially` or `fully`), and `signal`, null or `{ kind:
"r1_score" | "known_match", source, matchKind, listedAs, viewed }`, as section 10.2 defines them, where `source`
is the source's name as its adapter declares it. The statement holds no score, no hash, no hash type, no list version and no classification
string.

- **`matchKind` is derived, not copied.** It is `exact` only when the matched hash is a cryptographic hash of the
  file's bytes (`sha256`, `sha1`, `md5`), and `near` for every match of a perceptual hash (`pdq`), whatever its
  source called it: an equal perceptual hash says that two pictures look alike, not that two files are the same.
  What acts is another matter (section 6: a match its source reports as exact acts, of either kind of hash); the
  words follow what is known.
- **`listedAs`** is `csam` when the source itself classes the entry as child sexual abuse material
  (`match_listed` accepts the record's classification) and `other` otherwise. A program's own decision and a
  refusal always read `csam`, since only an acting match takes a measure or refuses. A person's decision reads
  `csam` for a finding citing R2, whether its match is acting or of that class and not exact, and `other` only
  when it considered a flag: a match of another class, which refuses, holds, seals and freezes nothing and
  cites no rule (ruling 3 of the review), and for which no notice exists. Its statement still says that
  automated means found the post, in the third clause below, which names neither the class nor what the image
  might be. The statement has no member for whether a match acted: what a program did is in the decision's own
  columns, and the clauses below are true of an acting match and of one that is not exact alike.
- **`viewed`** (a boolean, for a score) is true when the access log holds an `image_viewed` row of the decider
  for the signal's image on this case before the decision, and the decision is not stored as `unseen`. It is
  the only fact from which a statement may say that a moderator looked.

**The comparison**, a clause the match sentences share (`automated.comparison`):

| `listedAs`, `matchKind` | Clause |
|---|---|
| `csam`, `exact` | "an automated comparison found that an image of your post has the same fingerprint as one that {source} has classified as child sexual abuse material" |
| `csam`, `near` | "an automated comparison found that an image of your post has a fingerprint of how the picture looks that {source} reports as matching one it has classified as child sexual abuse material" (the source's answer is a match in both cases this clause serves: the exact one it reports for a perceptual hash, which acts, and one it does not call exact, which does not) |
| `other`, either | "an automated comparison of fingerprints with a list kept by {source} flagged an image of your post for korbat's staff" |

**The automation paragraph.** Exactly one stands where 3c's one sentence stood. There are four kinds (none,
found, partly, fully); two of them have a form for a score and a form for a match.

| Key | When | Paragraph |
|---|---|---|
| `automation` (3c's) | `automatedDetection` false | "No automated means were used to find this or to decide it." |
| `automated.found.r1.viewed` | detection true, `not_automated`, a score, `viewed` true | "Automated means were used to find this: a program rated an image of your post as likely within rule R1. They were not used to decide it: a moderator looked at the image and took this decision." |
| `automated.found.r1.unviewed` | the same, `viewed` false | the same first sentence, then "They were not used to decide it: a moderator took this decision without opening the image." |
| `automated.found.match` | detection true, `not_automated`, a match (an answer without a seal on a finding citing R2, whether its match is acting or not exact; any decision that considered a flag of another class) | "Automated means were used to find this: {comparison}. They were not used to decide it: a person at korbat took this decision, without opening the image that the comparison named." |
| `automated.partly` | `partially` | "Automated means were used to find this, and this decision rests on them in part: {comparison}. An admin took the decision without opening the images, on that comparison and on what korbat can read." |
| `automated.fully.r1` | `fully`, a score | "Automated means were used to find this and to take this measure: a program rated an image of your post as likely within rule R1, and korbat hid that image at once. No person took part in this measure, and no moderator has decided yet." |
| `automated.fully.match` | `fully`, a match | "Automated means were used to find this and to take this measure: {comparison}, and korbat sealed the post's images at once. No person took part in this measure, and no admin has decided yet." |

**Further sentences.**

| Key | Where | Sentence |
|---|---|---|
| `automated.notAssessed` | after every paragraph that holds the comparison | "korbat's staff do not open an image that is found this way, before a decision or after it, and korbat has not assessed it. The comparison shows that two files have the same fingerprint; it does not show what your image is." For a `near` match the second sentence reads "The comparison is of fingerprints of how a picture looks, which two different images can share, by accident or on purpose; it does not show what your image is." For a flag of another class (`listedAs` `other`) it reads "A flag is not a finding: it shows that a fingerprint is on a list or close to one that is, not what your image is." The first sentence is true of every decision since ruling 2 of the review: the function that serves staff an image refuses one that a match names, also after an answer without a seal. |
| `update.automated.partly` | the update to whoever reported or notified, by mail and on the report's status page, for a decision whose `automatedDecision` is `partially` | "This decision rests in part on an automated comparison of fingerprints; an admin took it without opening the images." (in place of 3c's "No automated means were used to decide.", which stays for every other decision) |
| `source.automated` | the source paragraph, when the source is `own_initiative` and `automatedDetection` is true | "What this decision is about was found by an automated check of korbat's own." (in place of "found by a moderator", which would be false) |
| `automated.ground` | the rule paragraph of a decision without a decider | "The rule this was done under: korbat rule {id}, "{title}": {text}" It never reads "It breaks": nobody has judged the image. |
| `automated.until.r1` | after the scope, for `fully` with a score | "This lasts until a moderator has decided. A program does nothing else: it removes nothing, hides no text, and does not suspend, limit or end your account." |
| `automated.until.match` | the same, with a match | "This lasts until an admin has answered. The admin either seals the images for good, in which case korbat keeps them only for the authorities it reports this to, or answers without a seal, in which case they are shown again. A program does nothing else: it removes nothing, and it does not suspend, limit or end your account. While images are sealed korbat keeps what a report to the authorities would need, as its terms say for every seal (Terms, Your data)." |

A decision without a decider renders, in order: 3c's `done.withhold_media` or `sealPost`; `scope.interim`; the
`until` sentence; `source.automated`; its `automated.fully` paragraph, with `automated.notAssessed` for a match;
`automated.ground`; and the redress `askPerson` or `askAdmin` (W.4). It has no facts and no reason paragraph: no
person wrote one, and the automation paragraph states the facts the measure rests on (DSA Art. 17(3)(b), (c)).

**The facts draft of a seal on a match** (`SEAL_DRAFTS.facts.match_post`, which 7.11 and 10.8 name): the text the
console's composer offers an admin who seals for good on a case whose only suspect items are a program's. It
says what the comparison found and not that anyone reported the images: "{Comparison, with "this post" for "your
post" and a capital letter}. korbat's staff do not open such an image, and korbat has not assessed it." The admin
may add what the post's text, its alt texts and the account's conduct show; the draft holds no hash, no list
version and no classification string.

A person's decision that ends a program's measure renders as 3c 10 has it (its `ended` paragraph names what
ended), with `automated.found` or `automated.partly` in the automation paragraph's place.

### W.4 Rulebook version 4 and redress version 4

**`RULEBOOKS[4]`; `RULES_VERSION` becomes 4** (Task 8). The type `Automation` gains `"flag_or_withhold"` and
`"seal_for_review"`; versions 1 to 3 keep their values and render as sent. Version 3 with three changes:

- **R2**, one sentence of version 3 changed (ruling 2 of the review): "After an admin has answered without a seal, staff may
  open them like any other image." becomes "After an admin has answered without a seal, staff may open them
  like any other image, except an image that an automated comparison matched: korbat's staff do not open such
  an image at any time."

- **R1**, `automation: "flag_or_withhold"`, text added at the end: "korbat may let a program rate uploaded images
  against this rule. An image it rates as likely within the rule is put before a moderator, and korbat may hide
  that one image from other people until the moderator has decided; its author still sees it, is told at once and
  can ask for a person. No program removes anything or judges text. Whether a program runs and what runs today
  is stated under Automation on the rules page."
- **R2**, `automation: "seal_for_review"`, text added at the end: "korbat may compare the fingerprint of an
  uploaded image with lists of images that a named body has classified as child sexual abuse material. An upload
  that the body reports as an exact match with such an entry is not accepted, now or later, and is held unseen
  until an admin has decided what happens to the file. When an image that is already on a post matches in that
  way, it is put before an admin at once, korbat keeps that post's images until the admin has answered, and
  korbat may seal them at once until then. A match with such an entry that the body does not report as exact
  refuses no upload and is never sealed by a program; on a post it is put before an admin in the same way, and
  korbat keeps that post's images until the admin has answered. A match is a comparison of fingerprints, not
  korbat's finding about an image; korbat's staff do not open an image that a match names; and nothing is
  removed by a program. Whether a comparison runs, with which body, and what runs today is stated under
  Automation on the rules page." The text speaks of the two kinds of match that this rule reaches: the match
  that acts, and the match of the same class that is not exact, whose finding cites this rule and freezes its
  post without a measure. A match of another class does nothing under this rule (ruling 3 of the review), so
  the rule does not name it; the rules page's block says what such a match does (W.1).

**`REDRESS_TEXTS[4]`; `REDRESS_VERSION` becomes 4** (Task 6). Version 3's texts stand word for word. Three join;
the number in them is a literal of this version, held to `AUTOMATION_RULES` by the table test.

- `askPerson` (a program's `withhold_media`): "You can ask for a person now: choose "Ask for a person" on this
  decision's screen under Settings, Cases, and write anything a person should know. You can send one message.
  korbat's target is that a moderator answers within 24 hours; the measure does not end by itself before a person
  has decided. A measure a program takes cannot be appealed as such: ask for a person instead. The moderator's
  decision can be appealed, if it restricts your post. You can also go to court, or complain to the Digital
  Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act)."
- `askAdmin` (a program's `seal_media`): the same, with "an admin" for "a moderator" and "The admin's decision
  can be appealed, if it seals the images for good; an appeal of a seal waits until the authorities have
  assessed the images." for its fifth sentence.
- `uploadObject` (a refused upload's notice, W.5): "You can object, free of charge: choose "Object" on this
  screen and write anything the admin should know. You can send one message, at any time before the hold is
  lifted or korbat has released the file, also after an admin has decided to report it. An admin, not a program,
  decides what happens to the file. Nobody at korbat can accept the image, since nobody opens it. You can also
  go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of
  the Digital Services Act)."

A decision without a decider gets `askPerson` or `askAdmin` in the place of `interim`; every other decision gets
what version 3 gave it.

### W.5 The refused upload's notice (`UPLOAD_NOTICE`, `packages/rules/src/statement.ts`)

Not a decision of 3c's ledger: `uploadNoticeParagraphs` renders it fresh from the refusal's row and its match, in
this order, each paragraph only when its condition holds. It reads section 10.2's `UploadRefusalView`:
`refusedAt`, the match's `source` and derived `matchKind` (W.3), `listedAs` (always `csam`), the objection's
`objectedAt`, `mayObject`, `endedAt`, `endAs`, `endReason`, `reportKept` (whether a record of a report under 3f
names the refusal), and `released`, from which it prints the release's time once a release exists that may be
told. `{comparison}` is W.3's clause for `csam`, with "the file you uploaded" for "an image of your post": only
an acting match is ever refused, so the notice has no clause for `other`.

| Key | When | Paragraph |
|---|---|---|
| `refused` | always | "korbat did not accept an image you uploaded on {refusedAt}. It is on no post, and nobody can see it, you included." |
| `automated` | always | "This was done by automated means, and no person took part: {comparison}." |
| `notAssessed` | always | W.3's `automated.notAssessed`, with "an upload" for "an image" |
| `rule` | always | "The rule this was done under: korbat rule R2, "{title}". What korbat compares, and with whom, is stated under Automation on the rules page." |
| `held` | the hold has not ended, or it ended as `no_report` and its delay of `noReportHours` has not passed (nothing is told early: until then an admin can still end it as "Report") | "korbat keeps the file, unopened, until an admin has decided what happens to it. The admin decides without opening it: either korbat reports it to the authorities and keeps it for them alone, or the hold ends and korbat deletes the file. Nobody at korbat can accept the image, since nobody opens it. No timer ends the hold. korbat tells you here, and by email when the hold is lifted. If you delete your account while the file is held, korbat keeps your email address, and nothing else of the account, for up to {reportHoldDays} days from the refusal (Terms, Your data)." |
| `object` | `mayObject`: the refusal has no objection, is not released and has not ended as `no_report` | `REDRESS_TEXTS[4].uploadObject` |
| `objected` | an objection exists | "You objected on {objectedAt}. An admin reads what you wrote and decides." |
| `ended.noReport` | ended as `no_report`, once the delay has passed and the end stands | "An admin ended the hold on {endedAt} without a report, and korbat deletes the file. {matchKeepDays} days after the hold ended korbat erases the fingerprint and the link between this record and your account; what it keeps after that is that an upload was refused on that day, with nothing that leads to you (Terms, Your data)." Then, when the reason is `source_withdrew`: "{source} withdrew or corrected its entry: you can upload the image again." For every other reason: "The image is still not accepted while {source}'s list holds a matching entry. If you think the entry is wrong, {source} is the body that can correct it: korbat cannot, since nobody at korbat opens the image." |
| `ended.report` | ended as `report` | "On {endedAt} an admin decided, without opening the file, that korbat reports it to the authorities. korbat keeps the file for them alone." Then, once `reportKept` is true: "The record of that report names your account and keeps its email address for as long as korbat keeps its records to authorities (Terms, Your data)." |
| `released` | a release exists and may be told | "korbat released the file on {releasedAt}, on the leave or instruction of an authority or a court: it will not give it back, and it destroys it." Not a word says what any authority found, and the paragraph does not exist while the release's notice is `held` (8.5). |

### W.6 The release's notice (`RELEASE_NOTICE`, the same file)

A notice, not a decision: `releaseNoticeParagraphs` reads section 10.2's `ReleaseNoticeView`: the release's
`basis`, `releasedAt`, `upload`, the posts' creation times and `postCount`, the number of image rows (`images`)
and `backupsClearAt`, and nothing else. It says what korbat did and on what ground, and nothing of what any
authority found: it never prints an authority's name, reference or assessment (ruling 1 of the review). It is
sent only to an account that still exists, and never while one of the three holds of 8.5 stands (the leave's
own mark that the person is not to be told, 3f's mark "not to the person" on the record of the report, 3f's
hold for an authority's order about a post of the release): the notice is then `held`, no route answers it and
no list shows it, and the dispatch job sends it in the round that finds the last hold ended (8.5). Every sentence says "released", none "no longer holds" or "destroyed": at the
commit the files are in the quarantine, and a backup may hold them longer.

| Key | When | Paragraph |
|---|---|---|
| `lead` | one post | "korbat has released the sealed images of your post of {createdAt} ({images} in all): it will not show them again or give them back." For several posts: "korbat has released the sealed images of {posts} of your posts ({images} in all): it will not show them again or give them back." For a held upload (`upload` true): "korbat has released an image that you uploaded and korbat did not accept: it will not give it back." |
| `basis.leave` | the ground `leave` | "An admin released them on {releasedAt}. The ground is the leave or instruction of an authority or a court to destroy them. korbat erased its record of the images and destroys the files. A backup of korbat's can hold them until {backupsClearAt}, and longer only where an authority has korbat keep one." |
| `basis.period` | the ground `period` | "The authority korbat had reported them to did not answer within the time korbat's terms give for that. An admin released them on {releasedAt}, as korbat told you beforehand: korbat erased its record of the images and destroys the files. A backup of korbat's can hold them until {backupsClearAt}, and longer only where an authority has korbat keep one." |
| `what` | always | "A person did this, not a program. It cannot be undone: the images cannot be shown again or given back. The text of your post is not touched." |
| `seal` | always | "The decision that sealed the images stays on record under Settings, Cases. If you appealed it, your appeal is still open and an admin reviews it; if you did not, that decision's screen says whether you still can. This notice is not a new decision about you, and nothing else changes with it." |
| `redress` | always | "You can write to korbat about this at the address under Contact in korbat's Terms. You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act)." |

**The day of a release by period** (`RELEASE_DAY_NOTICE`; dormant while `silence_days` is null): "The authority
korbat reported the sealed images of your post of {createdAt} to has not answered. Under korbat's terms an admin
may release them on or after {day}: korbat then erases its record of them and destroys the files, and that cannot
be undone. If you want them kept, object before that day, on this notice's screen under Settings, Cases: an
objection that is unanswered on that day holds the release until an admin has answered it." The objection is the
one section 6 records with the day's notice (`release_notices.objection`, answered by `objection_answered_at`),
not an appeal of the seal: the table, the function and this sentence name one thing. Its screen and its route
are built by the task that sets the period, with the terms' sentence; 3d ships none of the three, and the text
is sent to nobody while `silence_days` is null.

### W.7 Pushes and staff mails (`ALERT_TEXTS`)

Twelve kinds join 3f W.4's first table, each with `mail: "sentence"`, each to every staff account, each carrying
counts and UTC times only. A match of the listed class raises 3f's `moderation_urgent` and no kind of its own: on
a post through the finding that cites R2, whether the match is acting or not exact, and for a held upload (an
acting match alone) through the same alert, whose mail then prints a second
sentence from its fact `heldUploads`: "{heldUploads} matched uploads are held and wait for an admin, or hold an
objection that nobody has answered." (It counts the open holds and the refusals that ended as "Report", are not
released and hold an unanswered objection.) A match of another class, the flag, raises no alert at all.

| Kind | Title | Sentence | The mail's line of what to do |
|---|---|---|---|
| `quarantine_due` | "Sealed files are waiting to be moved" | "{count} images have waited more than 24 hours to be moved into the quarantine or back, the oldest since {oldestAt}." | "Whoever has the server runs the README's steps under Quarantine. This repeats daily until the move is recorded." |
| `release_undestroyed` | "Released files still exist" | "{count} released files are still recorded in the quarantine, the oldest release of {oldestAt}." | "Whoever has the server runs the same steps: the list's destroy lines. This repeats daily until each is recorded as destroyed." |
| `automated_objection` | "An author asked for a person" | "An author asked for a person about a measure a program took, at {at}. {count} such requests are open." | "A moderator opens the queue: the case stands first in its lane. Sealed images are an admin's." |
| `automated_waiting` | "A request for a person is waiting" | "{count} requests for a person have waited longer than {objectionTargetHours} hours, the oldest since {oldestAt}." | "korbat publishes that target. Lift the measure or decide the case today. This repeats daily." |
| `automation_capped` | "A program stopped taking measures" | one sentence for each value of the fact `limit`, then the same last one. `hour`: "A program reached its limit of measures an hour under one rule at {at}." `day`: "A program reached its limit of measures a day under one rule at {at}." `unanswered`: "At {at} {unansweredMax} measures of a program under one rule were waiting for a person, so it takes no new one under that rule." `waiting`: "At {at} a request for a person had waited longer than {unansweredHours} hours, so a program takes no new measure." Then: "{count} findings since then stand without a measure." | "Open the queue: these findings wait for a person like any report, and answering what waits lets the program act again. If nothing explains so many, tell the operator: the check or the server may be faulty, or in someone else's hands." |
| `matcher_down` | "The comparison of uploads needs the operator" | "Uploads are not being compared as usual. {count} are unchecked, the oldest since {since}. {refusalsCapped} matched within an hour over the limit of {refusalsPerHour} refusals and were not refused." | "Unchecked uploads are accepted meanwhile and checked again for 24 hours. An upload over the limit is neither refused nor accepted, and nobody was told of a match: so many matches at once are more likely a fault of the source's list or of the way to it. The operator checks both, and either sets MEDIA_MATCH=off or lets the check go on." |
| `edge_purge_failed` | "A cached copy could not be dropped" | "{count} purges at the network provider failed for 24 hours, the first of {oldestAt}." | "The measures themselves stand. A copy may have been served for up to {edgeMinutes} minutes after each. The operator checks the provider's token and zone." |
| `head_unwitnessed` | "A daily value has no outside timestamp" | "The audit log's value of {day} was published without an outside timestamp: the timestamp authority did not answer." | "Nothing to do for one day. If it repeats, the operator checks the authority's address." |
| `head_missed` | "No daily value was published" | "No value of the audit log was published for {day}." | "The operator checks that the API ran at the dispatch hour. The keeper notes the gap; the page shows it." |
| `seal_released` | "An admin released sealed images" | "An admin released sealed images at {at}: {posts} posts, {uploads} held uploads. The files are to be destroyed." | "This cannot be taken back. Every staff account gets this mail, the admin who did it too. If you did not expect it, look at the case or at Held uploads now and tell the operator: until the files are destroyed and the backups have aged out, a release that should not have happened can still be met by keeping them." |
| `hold_ended_unreported` | "A hold ended without a report" | "An admin ended the hold on a matched upload without a report at {at}. The upload is deleted after {until}." | "Every staff account gets this mail, the admin who did it too. Until the upload is deleted another admin can still end the hold as "Report" on Held uploads; after that nothing can." |
| `quarantine_lost` | "Sealed files are lost" | "{count} files that were to be kept apart are recorded as lost at {at}: they are in neither the image store nor the quarantine." | "Whoever has the server reads the README's section Quarantine, step 5. An image whose seal was lifted cannot be shown again, and its author is told; a file kept for an authority cannot be handed over, and the operator tells the authority." |

### W.8 Mails to a person, and the keeper's

- **`moderation_decision`** gains two subjects, chosen before 3c's: "korbat hid an image of yours until a person
  decides" for a decision without a decider that holds `withhold_media`, and "korbat sealed images of yours until
  a person decides" for one that holds `seal_media`. The body is the statement, as for every decision.
- **`upload_refused`**. Subject: "korbat did not accept an image you uploaded". The paragraphs of `UPLOAD_NOTICE`
  as they stand at sending, then "Read it, and object if you wish, in korbat under Settings, Cases. korbat's
  emails never contain a link to act on a notice."
- **`upload_hold_lifted`**. Subject: "korbat lifted the hold on an image you uploaded". `UPLOAD_NOTICE`'s
  `ended.noReport` and the same last paragraph without "and object if you wish". It is sent only once the
  delay of `noReportHours` has passed and the end still stands, so that the uploader is never told of an end
  that a second admin then turns into a report.
- **`release_notice`**. Subject: "korbat released sealed images of yours". The paragraphs of `RELEASE_NOTICE`,
  then "Read it in korbat under Settings, Cases." It is sent after the release's commit, or, while the notice is
  `held` (8.5), by the dispatch job in the round that finds the last hold ended, and never before it.
- **`release_day`**. Subject: "korbat may soon release sealed images of yours". `RELEASE_DAY_NOTICE`.
- **`image_lost`** (new; sent once, when a file of an image whose seal was lifted is recorded as lost). Subject:
  "korbat lost an image of yours". Its text is `IMAGE_LOST_NOTICE` (`packages/rules/src/statement.ts`), which the
  app's [image.lost] shares: "korbat lost the files of an image of your post of {createdAt} while they
  were kept apart from its other images. The image cannot be shown again. You can delete the post, or post the
  image again. This is korbat's fault, not a decision about you." Then "Read it in korbat under Settings,
  Cases."
- Each is built with `userMail`, so each ends with 3c's sentence on passwords and replies. None names a staff
  member, an authority, a reference or a file. A mail to a deleted account is not sent.
- **3c's update to whoever reported or notified** (`notice_update`, 3c 7.15) reads its fixed sentence from the
  decision: for a line whose decision is recorded as partly automated it prints `update.automated.partly`
  (W.3), and for every other line 3c's "No automated means were used to decide", with 3c's clause on links
  unchanged. A table test renders an update for each of the three values of `automatedDecision`.
- **3c's staff mail `moderation_csam_lifted`** gains a variant for a decision on a case that holds a match
  (ruling 2 of the review), which its staff message carries as `matched: true` (section 7.11). The variant
  holds no reason: the reason of an answer without a seal is on the decision, where the console shows it. Its second paragraph reads, in the place of "the
  images its case reaches are served again as before and staff may open them. After an answer without a seal,
  whoever is on duty opens them the same day (6.1) and, where one breaks a rule or the law, opens a finding on
  its post.": "the images its case reaches are served again as before. They stay closed to staff: an automated
  comparison matched an image of this case against a list of known material, and nobody at korbat opens an image
  that a match names, also after this answer. No person at korbat has looked at them, and nobody is asked to."
  Every other sentence of 3c's mail stands, and so does the whole mail for a case without a match.
- **`head_published`**, to the address `HEAD_KEEPER_MAIL` and to nobody else, built with `staffMail`. Subject:
  "korbat: the audit log's value of {day}". "Value: {value}. Place: {seq}. Hash: {hash}. Outside timestamp: {stored
  | none}." "Keep this mail. The value is public; the place and the hash are not: they let you check the value,
  and they go to you alone."

### W.9 The terms (`apps/app/src/lib/terms.ts`)

Drafts, without a new `TERMS_VERSION`, as 3c's, 3e's and 3f's sections; counsel reviews them in sub-project 4.
Each `{name}` is printed from a constant, and the table test holds each section to it.

**"Automated tools"** (new; DSA Art. 14(1), GDPR Art. 13(2)(f))

"korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation
which of them is switched on today.

The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched
on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image
from other people until the moderator has decided; the post's text stays and you still see the image.

The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as
child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body
reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin
has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post,
exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's
images, also if you delete the post or your account, until the admin has answered (Your data). On an exact
match korbat may also seal that post's images for everyone until then. A match is a comparison of
fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match
names, before the admin's answer or after it. A match with an entry of any other class only flags the image
for a person.

A program never removes anything, never judges text, and never suspends or restricts an account. It takes at
most {decisionsPerHour} measures an hour and {decisionsPerDay} a day under rule R1, and {r2DecisionsPerHour} and
{r2DecisionsPerDay} under rule R2, none under a rule while {unansweredMax} of its measures under that rule wait
for a person, and none at all while a request for a person has waited longer than {unansweredHours} hours. Every measure a program takes you are told at once,
with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person
there, and korbat's target is that one answers within {objectionTargetHours} hours. The person's decision is the
one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody
opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such
content from being shown, on the basis of its legitimate interest in a service that follows its rules and the
law; you can object to that at the address under Contact."

**"Transparency"** (new)

"korbat publishes its rules, with every change, on the rules page, and each year the counts of what its
moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a
decision, and no number small enough to point at a person, except the figures on authorities' orders, which the
law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how
many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it
counts and what exists until a month has ended."

**Changed sentences.**

- "How moderators decide": "a moderator, never a program, decides every case" becomes "a moderator decides every
  case; what a program may do until then is in Automated tools".
- "Appeals" gains: "What a program does while a person has not decided cannot be appealed; you can ask for a
  person at once, and the person's decision can be appealed."
- "Reports and notices" gains: "When many reports about one post arrive in a short time from accounts that follow
  one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor
  who decides; a moderator still judges the content itself."
- 3c's sentence in "Your data" on what korbat keeps "when someone reports a post or a profile" as child sexual
  abuse material gains "or a comparison finds a match of the kind Automated tools describes": the same keeping,
  also against the author's own deletion, starts on a program's match when nobody reported anything.
- 3c's sentences on sealed images in "Your data" gain: "Sealed images that korbat has reported are kept for the
  authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy
  them on its own judgement, and not because an authority has assessed them: only when an authority or a court
  has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells
  you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and
  they are shown again. An authority may never answer. korbat has set no time after which it then destroys
  them: they stay sealed and kept." The terms promise no destruction and no period (ruling 1 of the review): the period stays
  a setting that is unset, and a sentence that names one is written only with counsel's answer (section 17).

**"Your data" gains,** as one paragraph and `RETENTION`'s printed list: "While a comparison is switched on korbat
keeps fingerprints of each uploaded image for as long as it keeps the image; when the comparison is switched off
it deletes them all. While the check against rule R1 is switched on it keeps the program's rating of each image
the same way, and deletes the ratings when the check is switched off. It keeps the record of a match (the
image's id, the body, the kind of match and the fingerprint, never your account) for {matchKeepDays} days after
the case closed, the hold ended or the images were released. The record that an upload of yours was not accepted
names your account for the same time; after that korbat keeps only that an upload was refused on that day. If
korbat reported the upload, the record of that report names your account for as long as korbat keeps its records
to authorities. While an upload of yours is held korbat keeps your email address for up to {reportHoldDays} days
from the refusal, also if you delete your account, as it does when images are sealed. It keeps what you wrote
when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a
refused upload as long as that upload's record of a match. It keeps for {edgePurgeDays} days the record that a
cached copy was to be dropped, and for {recordKeepYears} years the record of a release, of the leave or
instruction it rests on, and the digests that prove a destruction."

| Member | Printed as |
|---|---|
| `matchKeepDays` | "the record of a match: 180 days after its case closed, its hold ended or its images were released, or, for an upload that was accepted and never posted, after the comparison; longer only while images sealed for good and not released, or a held upload, rest on it" |
| the refusal's record | "the record that an upload was not accepted: with your account until the record of its match is erased, and without it afterwards; when korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities" |
| `reportHoldDays` (3f's) | "your email address after an upload of yours was not accepted: up to 7 days from the refusal, also if you delete your account; less when the hold ends without a report" |
| `edgePurgeDays` (held to `EDGE_RULES.keepDays`) | "the record that a cached copy was to be dropped: 30 days after it closed" |
| the hashes | "fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off" |
| the rating | "the rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off" |
| the sketches | "the monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end, and the day's key after 26 hours" |
| the release's record | "the record of a release, of the leave or instruction it rests on, and of each destroyed file's digest: as korbat's records to authorities ({recordKeepYears} years)" |

### W.10 The export's members

- **`moderation.cases`.** A decision without a decider is an entry like any other: the statement's data, with
  `automatedDetection`, `automatedDecision` and `signal` as W.3 reads them, and the text of the objection the
  person sent, with its time.
- **`moderation.uploads`** (new): one entry a refused upload of the account: the notice's data as W.5 reads it,
  the objection and its time. No file and no hash.
- **`moderation.releases`** (new): one entry a release that concerned the account's posts or uploads: the ground
  and the time, as W.6 reads them, and only from the time the release may be told (W.6).
- **A held or refused upload is in no reader and no export** (ruling 5 of the review). The built export takes every ready image
  of the account, "on a post or not" (`media/repo.ts`, `EXPORTABLE`, `readyImages`, `isExportable`), and a matched
  upload is exactly such a row. So that predicate leaves out an image that a row of `upload_refusals` names,
  whatever the hold's end, until the image row is gone; the same holds for the image route, the owner's status
  beyond its `refused` variant, every list and every count that could hand the file or its sizes to anyone but
  the admin's screen. The export says what the notice says (`moderation.uploads`) and no more. A sealed image is
  in no export, as 3c has it; no line of the export says that either exists.

### W.11 The README's runbook

Task 8 writes these as sections of the README; Tasks 1 to 5 write theirs when their code lands. A number is
printed from its constant by the docs test's rule.

**Quarantine** (after every seal for good, after every lifted seal for good, after every release; the home screen
and a daily alert say when).

1. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-list > list`. Read the
   line it prints beside it: how many files move in, return, are destroyed, are for the operator. A post it
   leaves out is named there; the other posts' lines stand.
2. `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt`. It copies,
   compares digests, renames and only then removes; a `destroy` line takes the digest first and removes the file
   in the quarantine and, where the store holds one of the same name, there too. One bad line never stops it:
   it prints the line, goes on, and exits 1 at the end. If it is cut short, run steps 1 and 2 again: a file is
   never in neither place.
3. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-record < receipt`, then
   delete `list` and `receipt`: they name files. The record takes each line by itself and never refuses the
   others. A line that no longer fits the plan (a seal was lifted, or taken again, between the list and the
   move) is recorded where the file now is and printed, and the next list moves it back: run steps 1 to 3 again.
4. Nobody opens a file of the quarantine, on the server or off it. The volume is on the encrypted disk and is in
   no backup: a lost disk loses the sealed files, and no backup can bring a destroyed file back. Its owner and
   mode (uid 1000, mode 0700) come from the path `/media/quarantine` that the API's image creates; check them
   once after the first run (`stat`, from inside the service).
5. **A file in neither place** (`missing` on the receipt). Nothing is recorded for it yet, and the daily alert
   goes on. Look for it first: the disk, a run that was cut short, another volume. Only if it is gone, run step
   2 again with `--lost` appended, then step 3: the file is recorded as lost and every staff account is
   alerted. An image whose seal was lifted then reads "korbat lost this image" for its author, who is mailed
   once. If the file was kept for an authority, tell the authority, and note it.
6. **A file without a record** (a receipt that was lost before step 3, or a restore). `docker compose -f
   infra/compose.yml --profile quarantine run --rm -T quarantine --inventory > have`, then step 3 with `have`:
   every file the quarantine holds has its record again, and the next list returns it, destroys it, or prints
   it for the operator.

**A release.** An authority's assessment is not leave to destroy. Record it as 3f says (`notification-answer
--answer illegal`): it releases nothing, and it is a reason the authority may want the files kept. If the
authority asks for the files, hand them over (3f's runbook) and wait for its word. A release is possible only
after the report is recorded (`notification-sent`), the files are in the quarantine, and an authority or a court
has given korbat leave or an instruction to destroy them, in writing, with a reference. Record that as a fact of
its own: `staff.js release-leave <seal> --by <authority|court> --reference <text> --day <yyyy-mm-dd>`, with the
day the leave bears. If the authority asked that the person is not told, record that before any release: with
the leave (`--untold`, with `--until <instant>` or without an end; `release-leave --end-untold <leave>` ends
an open one later), or, when the request came apart from the leave, on the report's record as 3f says
(`notification-event`, with its end or without one). The author's notice then waits for the end of every such
mark. A recorded leave is never rewritten or deleted: check the seal and the reference before you record it.
A leave that you recorded by mistake all the same is withdrawn, `release-leave --withdraw <leave>`: it then
supports no release, and the right leave, if there is one, is recorded as a new one. Withdraw it at once: a
leave that a release already rests on cannot be withdrawn, and nothing takes a release back.
Then an admin confirms the release on the case, and every staff account is mailed that it happened. Then run the Quarantine steps, and
`release-show <release>`: it prints each destroyed file's digest and the day after which no backup that is
deleted on time holds the files. On an instruction to destroy at once, destroy the backups of the image store
taken before the move too, and note it; a backup kept for an authority is destroyed by hand when that authority
releases it. An answer "not illegal" is no release: an admin lifts the seal and the Quarantine steps return the
files. Silence ends nothing, and korbat promises nobody a destruction.

**Restoring** gains, with `APP_SITE=closed`, after 3f's `restore-import`:

1. `cat <the keeper's files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js
   release-replay`. Every release recorded after the backup is marked again, for sealed posts and for held
   uploads, and a held upload whose refusal the backup does not hold is kept from every post.
2. The Quarantine steps, beginning with step 6 (the inventory): the destroy lines name every released file that the
   restored store or the quarantine holds again. An `operator` line is a file the quarantine holds for an image
   the restored database does not know: a held upload or a sealed image from after the backup. Never destroy it
   on that line alone. Find the row of the keeper's files that names the image (`upload_hold_ended`,
   `upload_released`, `seal_released`). If it is held for a report, it stays where it is, and the operator's
   R2 records say so. If it was released, no list will ever print a `destroy` line for it, since the database
   cannot tie the file to its release: the operator writes that one line by hand (the `operator` line with
   `destroy` as its direction), runs steps 2 and 3 with it, and notes it.
3. On After a restore, a person closes what no command can: a lost end of a hold whose refusal is there is ended
   again by an admin, the same way (do not run `upload-report` a second time before the keeper's files have been
   checked for the record of the report); a measure a program had taken is taken again by a person, as 3f's
   classes say. A lost leave is closed by the operator: record it again from what korbat holds in writing,
   with `release-leave ... --gap <gap>`, which closes its gap. A lost withdrawal of a leave comes before
   anything else on its case: the restored database shows the mistaken leave as standing, so withdraw it
   again, with `release-leave --withdraw <leave> --gap <gap>`, before an admin reads the case.
4. `staff.js head-restore-mark <day>:<value> ...`, with the values of the keeper's mails for the days after the
   backup. The site opens only when After a restore shows no gap, the class "Releases and held uploads to
   replay" included.

**Backups.** The backup of `media-store` is deleted {backupDays} days after it was taken, without exception but
an authority's written demand. `media-quarantine` is never backed up.

**A measure a program took, and a request for a person.** The home screen lists both. A moderator lifts the
measure or decides the case, within {objectionTargetHours} hours of a request; the statement says that the
moderator looked at the image only if they opened it on the case first. Sealed images are an admin's and are
opened by nobody, and an image that a match names is opened by nobody at korbat at any time, also after an
answer without a seal: the console refuses it. A program stops taking measures by itself under a rule while
{unansweredMax} of its measures under that rule wait for a person, and under either rule while a request is
older than {unansweredHours} hours; if the only person who
can answer will be away longer than the published target, switch the measures off before leaving
(`AUTOMATION_R1_ACTS=off`, `AUTOMATION_R2_ACTS=off`): a program then only reports. "A program stopped taking
measures" with nothing to explain it means the check or the API is faulty or in someone else's hands: set the
same two settings, restart the API, and read `staff.js automation-status`.

**A held upload.** An admin ends the hold on Held uploads, unseen. The console does not say which way, and it
preselects neither: what counsel has advised korbat is written **here**, by the owner, in the place of this
line: "Counsel's advice of <day> on whether a match obliges korbat to report an upload that was never posted:
<not yet given>." (section 17, E.2). While it reads "not yet given", no admin ends a hold alone: decide with
whoever has the server, and write the ground into the operator's notes the same day. "Report": the Quarantine
steps, then `staff.js upload-report <refusal> --duty <duty>`, the report itself through the intake of 3f's
runbook, `notification-sent`, later `notification-answer`; the end is a release on a recorded leave to destroy
(above), never on an assessment. "No report" needs one of its three reasons; "another reason" is written into
the operator's notes the same day. The upload is deleted {noReportHours} hours after "No report"; every staff
account is mailed at once, and until the upload is deleted another admin can end the hold as "Report" instead.
When the uploader's account is gone, `upload-report` says so: the report then carries the file's facts and
times, and the address only while 3f still holds it ({reportHoldDays} days from the refusal).

**Switching a tool on.** Each needs section 17's lines done first, B before C: the tool's own impact assessment
and its date (`AUTOMATION_DPIA_R1` for the R1 check, `AUTOMATION_DPIA_MATCH` for the comparison), and, before a
tool's measure is switched on, the date of the assessment that covers the measure (`AUTOMATION_DPIA_R1_ACTS`,
`AUTOMATION_DPIA_MATCH_ACTS`) and, for the automatic seal, counsel's word on GDPR Art. 22. The API refuses to
start with a tool or a measure on and its date unset. Then set the tool's settings in `infra/.env` (an API
setting carries the prefix Compose maps), restart, and read `/rules`, which asks the server afresh: it must
print the tool as on, with its own date, and `staff.js automation-status` must agree. Switching off is the same
in reverse. The retention job then deletes, within its next rounds, every stored fingerprint but the one a match
record holds and every stored rating; what a program found before is still put before a person; nothing else
already recorded is deleted.

**Images** (two sentences of the README that 3d makes incomplete). "Nothing of the original is kept" gains: "but,
while the known material check is switched on, three hashes of the file as received, deleted with the image or
when the check is switched off; a match record keeps one of them for {matchKeepDays} days". "The worker is boxed
in" gains: "while a tool is switched on it also rates, or fingerprints, the decoded pixels, still without a
network".

**The edge.** In the zone: Browser Cache TTL "Respect Existing Headers"; no Edge Cache TTL rule on `/api/media`;
Always Online off; a token with the one permission Zone, Cache Purge. The check, once, with a test post: read the
image through the public hostname until its header shows a cache hit; hide the image in the console; read the
case's line "Edge copy: purge accepted"; read the image again and see that the copy is gone. Note the seconds.

**Cloudflare's scanning tool** stays off. Switching it on makes Cloudflare file its own reports with NCMEC about
content on korbat, which korbat itself does not make; a match would arrive as a path in a daily mail,
which a person would turn into a finding citing R2 by hand. Decide it only with counsel.

**The yearly edition, the monthly count and the daily value.** The edition publishes itself on or after 1 March;
`staff.js edition <year>` prints it, and `--correct` computes every table again and stores the result as a
corrected version beside it, which its line on the page says. `staff.js recipients`
prints the exact figure for an authority that asks; `tco-counts` stays for the authority too. The keeper keeps
each day's mail with the value, the place and the hash; "No daily value was published" is noted by the keeper.

**Before going public** gains section 17's parts A and B. Its first line reads: "korbat is not opened until
sub-project 3f's order path and sub-project 3d's quarantine and release have shipped and the lists below are
done." The paragraph "Who can rewrite the audit log" ends: "The head's daily value is public and goes to the
keeper each day; the keeper's daily visit stays."

## 19. Amendments from the dry run (2026-10-19)

The dry run built this design task by task in a scratch clone (2026-10-18 to 2026-10-19). Where the code had to differ from the text above, or the text left something open that the code settled, the rule the code follows is recorded here, in the order of the tasks that settled it (Tasks 1 to 8); where a bullet and an earlier section disagree, the bullet is the later and verified word. Migration numbers: 3f ended at `0032_orders_review.sql`, so each of this design's eight migrations is three higher than section 6 writes: `0033_quarantine.sql`, `0034_release.sql`, `0035_edge_purges.sql`, `0036_transparency.sql`, `0037_head_publications.sql`, `0038_automated_decisions.sql`, `0039_known_material.sql` and `0040_signals_and_retention.sql`; `--upgrade-from` names 32. The cases of the lab's runs D, A and C became tests on the built code in Tasks 2, 6 and 7 (O4, 12.3), and their codes are in the bullets that cite them.

- **The migration's number (6, 6.1, 13).** Task 1's migration is 0033_quarantine: 3f ended at 0032_orders_review, so every migration of 3d is section 6's number plus three (0034 the release, 0035 the edge outbox, and so on). Where a later task replaces alert_steps(), quarantine_plan(), quarantine_counts() or seal_custody(), it starts from 0033's text.
- **The day of quarantine_due is a constant (6.1, 7.1, 8.2, W.7).** The 24 hours after which a due move is alerted, and that [home.quarantine] and W.7's sentence print, is the contracts' QUARANTINE_RULES.dueHours (orders.ts, beside ALERT_RULES), which renderAlert fills a placeholder from as it fills ORDER_RULES, and the console prints. alert_steps() writes it as F's daily threshold, make_interval(days => 1), and a database test holds the two together by moving the seal's decision back by one hour less and one hour more than the constant. 3f's test of ALERT_TEXTS refuses a digit typed into a sentence kind, and 0030 has no rule function of its own for the number.
- **quarantine_lost's line of what to do names no step number (W.7).** It reads 'Whoever has the server reads the README's section Quarantine, on a file in neither place.' in the place of '..., step 5.': 3f's test of ALERT_TEXTS refuses a typed digit in a sentence kind, and step 5 of the README's Quarantine is the bold part 'A file in neither place', so the reference is the same.
- **quarantine_files' one policy (6.1).** The table has row level security with one policy, quarantine_files_api_none, FOR SELECT TO korbat_api USING (false), as 3f's records' tables have, in the place of no policy: the schema test holds every table to row level security and at least one policy. The API's role holds no grant on the table, which is what keeps it out.
- **The record's two triggers (6.1).** quarantine_files_insert forces moved_at (an imported row keeps a supplied time that is not after the clock), unknown, the three ends null but lost, and also post_id, from the image row when it exists (an imported row keeps the post it names for an image the database does not know), since the command line may not name the image table; a row written as lost gets lost_at at the record's time and no size or digest. A second trigger, quarantine_files_update, keeps a row's identity, post, mark and the digest it was moved with (a later line with another digest is the command's report, and the stored digest stays), stamps each end with the record's time when it is first set, and stamps moved_at anew when a returned row is moved again; a time already set may be moved by the migrator, which is how ageCustodyForTest moves a record back.
- **Two helpers of 0033 (6.1).** quarantine_sealed_for_good(post), a seal_media in force listing the post whose decision is not interim, and quarantine_lost_told(media), the state a lost file's notice is born in, both callable by nobody but their owner. A lost file's notice is pending only for an image row that is on a post, not erased, whose post is neither erased nor deleted by its author, and that is not sealed for good; otherwise none.
- **The receipt's words and forms (7.1, 8.10, 10.1).** QUARANTINE_WORDS holds refused for a destroy line too (a name outside the layout, or a file that is not a plain file), and the contracts gain QUARANTINE_DIRECTIONS (in, out, destroy, operator). A missing, lost or refused line, and a destroy line found in neither place (already), carry no size and no digest: '<direction> <id> <file> <word>'. The mover refuses (both files kept) a move whose source or destination is not a plain file, and one whose destination already holds another file of the same name. An operator line is left alone and prints nothing on standard output, only a note on standard error, so the receipt holds no line the record cannot take.
- **The service's entry point (5, 8.10, W.11).** The Compose service quarantine names `entrypoint: [node, dist/quarantine.js, /media/store, /media/quarantine]` and no command, so that `run --rm -T quarantine --lost` and `--inventory`, as W.11 types them, append their flag to the two roots; arguments after a service's name replace its command, and the image's entry point would then run `node --inventory`. Step 4's check is written `docker compose -f infra/compose.yml --profile quarantine run --rm --entrypoint stat quarantine -c '%u %a' /media/quarantine`, which prints `1000 700`.
- **What quarantine-list names (7.1, 8.10).** An image to move in names only its files not in the quarantine already (a lost file counts as there), and an image to return, to destroy or for the operator only its files whose rows have no end, so a line the mover would only answer `already` or `missing` is not printed. A post is compared with the count of every seal for good in force that lists it; a destroy line whose rows recorded a post that is left out is left out with it.
- **How quarantine-record takes a line (7.1, 8.10).** The receipt is taken under a SHARE ROW EXCLUSIVE lock of quarantine_files, one savepoint a line, so a line the database refuses is reported and the others stand. A line whose file is where its row already says writes nothing and is not reported, so a receipt recorded twice changes nothing; againstPlan counts only a line that wrote something. An in or have line for a returned or lost row records the move again (a lost file found), reporting the lost one; an out line for a lost row records the return; a line for a destroyed row is reported and writes nothing; a destroy line for a returned row records the destruction. The summary goes to standard output and each reported line to standard error; a receipt without a line is refused with 'the receipt holds no line ...; nothing changed'.
- **A seal's custody on its case (8.4, 10.3).** CaseDecision.custody is on every decision that is not interim and holds a seal_media, in force or lifted. [case.custody.in] stands only while that seal is in force; 'Files: not moved to the quarantine yet.' stands alone, and 'The others are still in the image store ...' is added only while some files but not all are moved, a lost file counting as accounted for (moved and lost under files). [case.custody.lost] takes its form from whether the seal is in force.
- **The owner's status and serve (7.1, 10.2).** The status asks the store first (both sizes present as plain files) and calls media_lost and media_quarantined only for a ready, visible image on a post whose files are missing; lost wins over restoring when both hold. serve asks the same two after a failed open of a visible image and logs an info line for either, the error line for neither.
- **The lost image's notice (7.14, 7.15, W.8).** Task 1 builds the dispatch round's step notices with the lost images alone (moderation/dispatch.ts, which section 13 does not name for Task 1): at most 50 a round through MediaForCases.lostUntold and lostTold, `none` for an image whose row or post is gone, given up as `failed` after RETENTION.mailGiveUpDays as 3c gives up, and counted in DispatchReport.lostNotices. The mail image_lost prints the post's time as the notices print one (noticeTime), and no stop of the address holds it back, since it is no mail about reports. IMAGE_LOST_NOTICE has two members, the mail's paragraph and the app's [image.lost], whose words differ in W.8 and 9.6.
- **The app's question (9.6).** An image of the reader's own post, in the grid and in the viewer, asks GET /api/media/:id at most once after a failed load (ImageFault.tsx: imageFaultOf, faultAsker, useImageFault, ImageFaultView); the answer is kept with the image it is about, since the viewer steps between images with one component, and a failed question shows the image as missing. Anyone else's image never asks.
- **The README (W.11).** Quarantine stands after Authorities' orders and Backups before Restoring; Upgrading gains a line for the profile quarantine, its volume and the hand-over's new read-only mount. The docs test holds the six steps in their order, the commands as the operator types them, and Backups' days to RETENTION.backupDays.
- **Counts in images (6.1, 10.3).** quarantine_counts() counts the images of each of the plan's sets, also `undestroyed`, and quarantine-list's line counts files; Task 2's [home.undestroyed], which says 'Released files', reads that count of images or replaces the function to count files.
- **The migration's number (6, 6.2, 13).** The design's 0031 is `0034_release.sql`: 3f ended at 0032 and Task 1's quarantine is 0033, so each later migration of 3d is section 6's number plus three (Task 3's edge outbox is 0035).
- **The seal's record and the three holds as helpers (6.2).** `seal_report(action)` answers the facts of a seal's record of a report and not its id, which a leave is recorded against and whose marks `release_tellable` reads. 0034 adds `seal_record(action) returns uuid`, written from `seal_report`'s own lateral (the record the seal opened, or the one open for the account when the seal was taken), and `release_may_tell(leave, report, posts) returns boolean`, the three holds in one place (the leave's own mark with an open or later end, an event `not_to_person` of the record with an open or later end, a decision about a post of the release with `informed_at` null), answering false for a leave the database does not hold. Both are callable by nobody but their owner; `release_facts`, `release_tellable`, `releases_notice` and `staff.js release-leave` use them.
- **What `releases_notice` reads at insert and of a gone author (6.2).** 'held while `release_tellable` answers false for the new row' cannot be read in a BEFORE INSERT trigger, since `release_tellable` takes a release's id and reads the row, which is not there yet; so the insert asks `release_may_tell` with the new row's leave, its record and its `post_ids`, the same three holds, and an update by every role but the migrator is held to `release_tellable(OLD.id)`. Being plain, the trigger runs at insert inside `seal_release` or `release_replay` as their owner, so the helpers need no grant to the API; a held notice moves only to `pending`, and nothing moves a notice back into `held`. 'An author who no longer exists' is a missing profile or one with `deleted_at` set, as `decisions_record` reads a deleted account (test fixtures and anonymised accounts have no live auth row to read).
- **No key closes a gap of the class `release` (7.3, 8.7).** 3f's `gap_close` would let an admin close any gap as 'Not needed'. 0034 replaces it from its 0031 text with one refusal, `gap_mismatch`, for a gap of the class `release`, before anything else is read; such a gap is closed only by `release-replay` (`imported`) or by `release-leave --gap` / `--withdraw --gap`. The console shows no control on it.
- **Where `release` stands among the gap classes (8.7, 10.1).** `GAP_CLASSES` holds `release` after `seal_interim`, as the console's table places it, so the CHECK on `restore_gaps.class` is re-added in that order. `GAP_SITE_CLASSES` are the first four (the import's 'gaps 1 to n' still holds) and `GAP_MEASURE_CLASSES` is written out as 3f's five measures: a release gap keeps the app's site closed but is no lost measure, so retention and the sweep may go back on while one is open.
- **`quarantine_counts().undestroyed` counts files (6.1, 6.2, 8.2).** Task 1 counted images; 0034 counts the files of the plan's destroy set still in the quarantine, since [home.undestroyed] reads 'Released files to destroy' and `release_undestroyed` and the receipt count files.
- **`release_undestroyed` (6.2, 7.2).** It counts every undestroyed file of the destroy set (a released file, or one of 6.1's third set) and alerts when the oldest of them has been due for longer than F's daily threshold, counted from its release (the release's `released_at`, a replay's original time) or from its record; facts `count` and `oldestAt`.
- **text-verify's quarantine report moves to quarantine-list (5, 8.10).** text-verify reads on the API's role, which row 14 keeps from `quarantine_files`. So text-verify reports `releasedUnerased` (a released post that still holds an unerased image row) through the media index, and the media index's `quarantineOrphans` (a file without an end, not marked unknown, whose image row is gone and that no release accounts for) is read by `quarantine-list`, as the migrator, which names each such image on standard error beside its destroy lines and does not fail for it.
- **release-leave's operator and its gaps (6.2, 8.10).** `--by` names the authority or the court, so the operator's name, which `recorded_by` and `withdrawn_by` hold as 3f's commands record theirs, is a required `--operator <name>` of the recording and of `--withdraw`. A recording is refused for a target that is not a seal for good in force (named by its ledger row) or whose record of a report is not sent, for a day after today, and for `--until` without `--untold`. `--end-untold <leave> [--until]` also takes `--gap`: a lost end of an open hold is a `release_leave_recorded` line, and `restore-import` writes no gap for such a line when the restored database holds the leave exactly as the line records it. A leave recorded again with `--gap` takes the id its line names and must be on the record the gap names. A refusal by the guard is printed `release-leave: leave_used: ...`.
- **What `release_replay` checks and answers (6.2, 7.3, 8.10).** It replays a release only when an open gap of the class `release` names it with these very params (posts, ground, leave and reference, as the line's metadata holds them), and refuses otherwise (`replay_no_gap`), so the facts come from the checked line and not from standard input; it answers `replayed <posts marked> <image rows erased>`. `release-replay` reads every `seal_released` line of the keeper's files (a line's metadata is the canonical JSON text the chain hashed), lets the function answer `present` for a line below the restored head or replayed already, runs one transaction a line with its audit row `release_replayed` (target the replay's row), reports a refused line on standard error and exits 1 after the others.
- **The release block's counts and a released seal's gap (8.5, 8.7, 10.3).** [release.done] prints the posts released and the image rows erased: `CaseDecision.release` gains `releasedPosts` and `releasedImages`, counted from `seal_posts.images` of the seal's released posts (which the disposal never changes). [restore.sealAgain] needs to know that a lost seal for good's post is released: `RestoreGap` gains an optional `released`, read from the lost row's target and `release_posts`.
- **What Task 2 builds of the lists of a later task (10.2, 10.3).** `AuthorNoticesPage.notices[].kind` is `release` alone (Task 7 adds `upload_refused`); `StaffOverview.destructive` has the three kinds of 10.3 and Task 2 writes `seal_released` alone; `AppealRow.released` and `CaseAppeal.released` are nullable and optional, and the API leaves them out when the appealed seal released nothing, so every other appeal's row reads as before (the console reads a null the same).
- **Two alert lines (W.7).** `release_undestroyed` is mailed alone, so its line reads 'Whoever has the server runs the README's steps under Quarantine: the list's destroy lines name them.' in the place of 'runs the same steps'. `seal_released`'s line says 'look at the case now' without 'or at Held uploads', which Task 7 adds with the screen.
- **`release_leaves_from` compares as text (6.2).** `authority` is also a value 3f added to `intake_channel`, and 3f's enum-literal rule refuses it as a literal outside a PL/pgSQL body, so the CHECK reads `leave_from::text in ('authority', 'court')`, as `productions_purposes` does.
- **The release in the app (9.6).** 'About you' lists the releases as a block 'Notices' above the decisions, each 'Sealed images released' with its day, rather than interleaved with the decisions by day; the notice's screen links the decision that sealed and prints [release.appeal] itself while that decision's appeal is pending (read from the decision, which the author may read), since `DecisionView` carries nothing of a release.
- **`release_announce`'s order and its day (6.2, 7.2).** It refuses in this order: `release_period_unset` while `silence_days` is null; `staff_confirmation_ended` and `admin_required` from the staff account's row; `release_not_open` unless the subject is a seal for good in force; `release_not_reported`. The day is the later of `silence_days` after the hand-over (or the report) and `period_notice_days` from now, as a UTC date; the row is written once. In `seal_release`'s `period` branch a notice counts as told when its `told` is `sent` or `folded`.
- **`seal_release`'s staff check and the backups' day (6.2).** A staff account that ended is refused `staff_confirmation_ended`, as `gap_close` does, which the route answers as an ended confirmation; `backups_clear_at` is the later of now and the newest `moved_at` of the posts' files, plus `backup_days`. The table's CHECK `releases_replay` holds that an admin's release names its admin and a replay names neither an admin nor a seal.
- **The notice's sending (7.2, 7.14, W.8).** The release's route sends the notice after the commit, and the dispatch round's step `notices` sends what that left (pending and older than the round's due margin) and moves a held notice to pending in the round that finds `release_tellable` true, mailing it at once; each send holds the release's row `FOR UPDATE`, so the two never both send. A pending notice is given up after `RETENTION.mailGiveUpDays`, counted from when it became pending. No stop of the address holds the mail back, as for `image_lost`: it is about the account's own posts. The mail's data are flat; its template renders the paragraphs with `releaseNoticeParagraphs`, whose input is the view's members it reads.
- **The README's R2 bullet (W.11).** The bullet that had the operator copy out or destroy sealed files by hand 'before sub-project 3d', with a read-only query of the image rows, and that told the authority korbat could neither hand over nor erase, now points to the hand-over and to Quarantine, A release; the hard gate's first sentence reads 3d's quarantine and release.
- **A round closes exactly the rows it read (6.3, 7.4).** The job reads the open rows of up to `EDGE_RULES.prefixes` images whose oldest open row is due, and after the purge it updates those rows by their ids, never 'an id at or under the highest it read': a row with a lower id whose transaction committed after the read (an identity value is taken at the insert, not at the commit) may stand for a hiding the purge did not cover, and it stays open for the next round like a row written while the request was out.
- **The adapter's interface (5, the adapters' table).** `edge-adapter.ts` builds the adapter with `edgeAdapterFrom(settings, { apiBase?, fetch? })`; besides `purge(prefixes)` the adapter shows its `mode` and `prefix(mediaId)`, which builds `<host>/api/media/<id>/`, so the job hands it nothing but prefixes it built itself. The `test` adapter also shows `sent`, the prefixes of each call, uses `edge.test` when EDGE_HOST is unset, and is refused by the builder too while APP_SITE is `open`, so a test that builds it in the process must close the site; the `off` adapter refuses a call, which the job never makes. `apiBase` is no setting: it points the `cloudflare` adapter at fakeEdge() in the tests. A call refuses more than `EDGE_RULES.prefixes` prefixes or none.
- **The settings' forms (10.8).** EDGE_ZONE_ID is the zone's id, 32 hexadecimal characters; EDGE_API_TOKEN is one word of 20 to 200 letters, digits, dashes and underscores, so its value can never carry a header line of its own; EDGE_HOST is a bare domain name, lowercased, with no scheme, port or path. The refusals of `test` on an open site and of `cloudflare` without one of the three hold in every environment, and a refusal never prints the token. The API's role also loses 0001's USAGE on the identity sequence `edge_purges_id_seq`, since it inserts no row.
- **How staff read the purges (5, 8.1, 10.3).** `MediaForCases` gains two members, `purges(mediaIds)` and `postPurges(postIds)`, over two statements of the media repository, so the moderation module never names `edge_purges`. A case's `purges` are those of the images its newest snapshot lists, and none while that snapshot is withheld (it shows no image, so a line would stand beside nothing). F's order screen reads its own member: `OrderItemView` gains `purges`, the same `EdgePurgeView` entries, for every image row of the item's post that has an outbox row, filled only for an item that was disabled; the screen prints one line an image under the item's state.
- **The words' numbers (10.1, W.7, 8.4).** The contracts gain `EDGE_WORDS` (`edgeMinutes`, the edge's bound in minutes from EDGE_CACHE, and `giveUpHours` from EDGE_RULES), beside EDGE_CACHE and EDGE_RULES in `media.ts`; `renderAlert` fills a placeholder from it as from ORDER_RULES and QUARANTINE_RULES, so W.7's sentence reads '{count} purges at the network provider failed for {giveUpHours} hours, the first of {oldestAt}.' and no digit is typed, and the console's four purge lines print `{edgeMinutes}` from it. `orders.ts` of the contracts now imports `media.ts`, which imports only `text.ts`. The four lines are `AUTOMATION_WORDS.purge(outcome, at)` in the console's `messages.ts`, a constant Task 3 creates for the later tasks to grow.
- **Row 19's table (12.1).** The table test holds a record over every action kind of MEASURES (a kind added later fails it until it is listed) and takes, each in a transaction that is rolled back, every measure on a post or an image, 3f's `disable_by_order`, both profile resets, a strike, a suspension at once, a retired handle, the lifts of a withhold, a removal, an image's removal and a seal, an author's deletion, the account's purge, an upload on no post, an R4 redaction, the disposal and a release. A termination, the two reporting measures, 3e's four reversals and `reinstate_by_order` are listed as writing none without being taken there, since their preconditions need a history of told and ended measures across days: their none rests on the writers' pin of `moderation-schema.test.ts` (only `moderation_apply` moves a post's level and state or an image's state, and the ledger calls it only for a row that names a post) and on the triggers firing on those columns alone.
- **The author's hidden image through Caddy (12.1 row 20, 12.2 Smoke).** The smoke test checks the new header on a public image's 200 and 304 and `no-store` on the 404 of a deleted image and of an unknown one, through Caddy; it has no staff key, so it hides no image. The header of an author's hidden image (`private, no-store`) and `no-store` for everyone else are read through Caddy by the Docker step's own script, which hides the image as the migrator, sees the trigger's outbox row closed as off by the job, shows it again and lets its author delete the post; the integration suite holds the same answers on the API itself.
- **Two rows an image for a measure on a post (6.3).** `moderation_apply` writes a post's level and its state in two statements, so `posts_purge` writes two rows for each image of a post a measure hides, and an author's deletion writes one from the post's state and one from each deleted image row; the job sends each image's prefix once a round and closes every row it read. When the state and the level leave `visible` in one statement, the state's cause is taken (`deleted` for `deleted_by_author`, else `state`).
- **Which orders the order section counts (6.4 step 5, 7.6).** transparency_order_ids(year, as_of) names the removal orders a year's section counts: recorded by as_of, not held at as_of, and with a row of the year that a figure counts (received in it, or opened in it without a receipt; an item disabled in it; an Annex III, a scrutiny or a reinstatement that took effect in it; an authority's access to its preserved content opened in it). transparency_orders(year, as_of) runs tco-counts' statements over those orders alone, so an item of a held order disabled in the next year stays out of that year too until the hold ends, and an authority's access to a held order's content is left out with the order. The member is present when that list is not empty or the year's order records were erased, and absent otherwise; nothing in it says whether an order was left out.
- **When a year gains a hold_ended version (6.4, edition_publish step 2).** The test reads the same rows by the same times as the section: a year gains a version when transparency_order_ids(year, the call's instant) names an order that transparency_order_ids(year, the newest version's computed_at) does not. An order counts as held at an instant T when one of its decisions was taken by T and not told by T (informed_at null or after T) and order_hold_until(order), as it reads now, lies after T. No order id is stored in the public JSON.
- **An edition's instant is the call's clock (6.4, edition_publish step 3).** computed_at, published_at and the as_of of the figures edition_publish stores are the call's clock_timestamp(), not now(), so that a version written after another in the same transaction (a test that ends a hold between two calls) has the later instant; in the job each call is its own transaction, and the two differ by milliseconds.
- **A correction, and the reasons a caller may give (6.4, 8.10).** edition_publish takes the reason first or correction; hold_ended is the function's own to choose and invalid_edition from a caller. A correction is the migrator's alone, judged by session_user (inside the definer function current_user is its owner); it answers edition_not_due before the year's due day and invalid_edition while no version of the year is stored, since the first version is the job's.
- **The figures refuse the running year by both clocks (6.4 step 1).** transparency_figures raises edition_not_due when as_of or clock_timestamp() lies before the due day, so neither an instant passed in nor any caller yields a figure of a year that is not due.
- **Public record is frozen by a trigger (6.4, 7.14).** transparency_frozen refuses every UPDATE of transparency_editions and of recipient_months for every role, the migrator included (edition_frozen), and every DELETE but the migrator's, which is a test's cleanup. The API's role holds SELECT on the editions, and SELECT with INSERT of the four columns month, signed_in, signed_out_days and method on the months: computed_at is forced by recipient_months_insert and cannot be supplied.
- **The tables' rows and labels (6.4 step 3, 10.6).** restrictions count the interim and final decisions that restrict, by rule or law, and by the ledger kind of each of their measures that reverses nothing; intakes are labelled rules (a user's report that alleges no illegality), illegal (a user's notice of illegality, the anonymous path's included), finding and automated (the kind compared as text); appeals by the result of those a decision of the year answered; re-examinations by the year of the answering decision, as action (restricted_rule, restricted_legal, partly_reversed, reversed) or no_action (every other outcome); accountMeasures are 3e's six kinds (strike, suspend, terminate, retire_handle, warn_reporting, restrict_reporting) on decisions that are not an order's; automated holds findings and measures by rule and, on a base of ten R1 findings or more, r1 with the base and the restricted as bands. A row of zero is dropped, the folded row is labelled other and printed last, and the contracts' FIGURE_LABELS hold each table's closed list. A table with no row reads TRANSPARENCY_PAGE.tableNone, 'None in this year.'
- **The recipients' member (6.4 step 6, 9.3, W.2).** The six months are the six calendar months before the month of the due day (September to February); all six must be stored, or the member is 'not recorded'. The two bounds go through band(), so a bound under ten reads '1 to 9' and never a number, and are stored as low and high, or low alone when one of the months did not count signed-out readers. The month the page names ('over the six months to {month}') follows from the year and is not stored. The six is RECIPIENT_RULES.months, written in the SQL with a comment, since transparency_rules() has no column for it.
- **A figure the order section cannot give (6.4 step 5, 9.3, 10.6).** As tco-counts does, a figure whose rows the retention job erased (the received orders, the items, the minutes, Annex III, scrutiny, reinstatements, the authority's accesses) is null in the stored section, not a number; OrderFigures allows null for those seven, and the page and staff.js edition print it 'not recorded', never 0.
- **The uploads member stays optional (6.4, 10.6).** An edition is never changed once stored, so a version stored before Task 7 has no uploads member for good; TransparencyFigures keeps it optional, and the page prints the table only where it is.
- **The transparency module's dependencies (5, the wiring).** createTransparency takes apiDb, redis, config and logger, and a clock for the tests: the auth module is not among them in Task 4, since nothing of it is used before the keeper's mail of Task 5, which adds AuthForTransparency. index.ts still builds the module after auth, registers auth.onSeen(transparency.forAuth) and starts its job, which the shutdown stops.
- **Where the public reads are matched (5, 7.5 step 2).** resolveSession calls seenSignedOut for every GET without a session; the transparency module matches the path against RECIPIENT_READ_ROUTES (a parameter matches one segment) before it touches Valkey, so the auth module holds no list of the social module's routes. TransparencyForAuth is the module's recipient counter: seen and seenSignedOut return at once and throw nothing, and resolveSession wraps the call in a try besides. The auth module's index exports clientNetwork for it.
- **The month's close (7.5 step 3).** Each round looks at the two months before the current one (a sketch lives 70 days). A month whose row is already stored only loses its keys, so a round that stopped between its insert and its delete leaves no sketch behind; the day salts are not deleted, they die after their 26 hours.
- **The crawler's pattern (10.1).** RECIPIENT_RULES.crawler is /bot|crawl|spider|slurp/i, one pattern on the agent's own words.
- **The rules page's caps and target (9.2 item 4, W.1).** [rules.auto.cap] and [rules.auto.target] are functions of the limits, and the page prints them only when it is given them: their constant, AUTOMATION_RULES, comes with Task 6, which passes it. Until then no tool that rates or compares images can be on, and the page prints [rules.auto.none]. While the facts are on their way the automation section holds its lead alone; [page.down] stands only once the route has failed.
- **What korbat can do, and when (9.2 item 3).** The rules page prints the terms' paragraph of measures (MEASURES_PARAGRAPH) and the terms' sections Strikes, Suspension and termination, Reporting in bad faith and Terrorist content, which lib/terms.ts exports with the builders that make them, so each number of STANDING_RULES and ORDER_RULES has one sentence in both places.
- **The order section on the page (9.3 item 4, W.2).** Under [tr.orders] the page prints five of the yearly report's headings (removal orders received; items disabled, and how fast; orders not carried out in time, with the ground; scrutiny and reinstatements; the measures korbat takes against terrorist content), each with tco-counts' figures in a sentence of TRANSPARENCY_PAGE.orderLines; the sixth, complaints and court proceedings, which no row holds, stays the operator's, as the README says.
- **Older versions, oldest first (9.3 item 2, 10.6).** PublicTransparency's older lists a year's earlier versions oldest first, each with the day the next version replaced it; the page opens each in place behind a button.
- **The words of staff.js recipients and edition (8.10).** recipients prints, after its header, a line for each of the months it was asked for, a missing one as '<month>: not recorded', then 'only <k> full months are recorded.' when some are missing and the average rounded to a whole number, or 'not recorded' with none; every line starts with 'recipients: '. edition prints a line for each row of each table in the command line's own words ('edition: restrictions by ground, R1: about 60', a table without rows as '...: none'), the order section as tco-counts' lines under 'edition: authorities' orders, ', and the recipients; --correct is refused 'edition: invalid_edition: ...' while the year has no edition.
- **The smoke test's lead sentences (12.2).** The smoke script holds the two lead sentences as literals, since it cannot import the app's TypeScript, and looks for them in the bundle Caddy serves under /_expo/ with an escaped apostrophe read back; an app test holds the two literals to RULES_PAGE.lead and TRANSPARENCY_PAGE.lead word for word.
- **LAB E7 on the built code (12.3, row E).** transparency_figures over 20,000 decisions took 76.6 ms, 126.2 ms and 130.1 ms in three runs on the dry run's busy machine, beside the lab's 21 ms for its one table: the built function computes every table, the order section and the recipients.
- **The links of 9.1 (9.1).** The terms page links 'The rules' and 'Transparency' after Contact and before the report form's link; the report form links 'The rules' under its list of rules on the ground of a rule; the decision screen links 'The rules page' after the statement when the decision, or the decision a review or correction reviewed, names a rule (an order's notice and a decision on the law alone carry none); both pages link each other and How Explore works.
- **The README (W.11, 15).** A section 'The yearly edition', after Quarantine, holds W.11's paragraph without the daily value, the setting API_RECIPIENTS_SIGNED_OUT and the three commands; 3f's bullet 'The yearly count.', 'The yearly counts.' and the owner's item 10 keep their titles, which the docs test pins, with bodies that point to the edition while tco-counts stays for the authority.
- **The migration's number (6, 6.5).** The head's migration is `0037_head_publications.sql`, the next free number after 3d's Tasks 1 to 4 (0033 to 0036), not the design's 0034; it changes no existing migration. It drops and adds `alert_outbox_kind` with `head_unwitnessed` and `head_missed` after Task 3's `edge_purge_failed`.
- **A keeper's value has no place (6.5, 7.7 step 7).** `head-restore-mark [<day>:<value> ...]` is given a day and a value, so the row it stores for a day the restored database lacks cannot hold the place. `chain_seq` is nullable, held by the CHECK `head_publications_place`: a place of zero or more on every row, or none on a `head` row that is retired. Such a row is published and retired at the mark's time, with the witness `none`; no check needs its place, since a value of a day after the backup fits no restored log.
- **The restore row names its last day (6.5, 9.3 item 6, 10.6; W.2 [tr.restore]).** No column held 'the newest published value whose place and hash the restored chain still holds', so `head_publications` gains `last_day date`, set only on a `restore` row (CHECK `head_publications_last_day`) by `head-restore-mark`: the newest day of a published `head` row that the mark left unretired, or null when none fits. `PublicHead`'s day entries gain `lastDay`, a day or null, which the page prints as [tr.restore]'s day; when it is null [tr.restore] ends 'No value above still fits the restored log.'
- **What a restore retires (6.5, 7.7 step 7, 8.10).** The design retires every stored value whose place is above the restored head. The command retires, of either kind, every unretired value whose place the restored chain no longer holds with a hash that gives the value: a place above the head, or a place whose hash (at the head itself or at that row of the log) does not give it through `head_value()`. It deletes none. It refuses before writing anything: a second restore the same day (`restore_marked`, since the row's key is the day), a keeper's day after today (`invalid_day`), and a keeper's value that differs from the one the database holds for that day (`head_mismatch`); a keeper's value the database holds already is counted as held. Its audit row `head_restore_marked` counts as `retired` the keeper's values stored and the values retired. It prints, before 8.10's line, 'head-restore-mark: <n> values of the keeper's mails stored, retired; <k> already held.' when values were given, and 'No published value still verifies.' in place of the last day when none does.
- **The first day misses nothing (7.7 step 6).** `head_missed` is written when the day before the database's today has no published `head` row while an earlier day has a `head` row: on the head's first day, and on a new installation, nothing is missed. 'The first round of a day' is the day's first pass of the head, which runs after the dispatch hour with the job's other daily part.
- **The alert fact `day` is a time (10.1).** A fact named `day` holds the day's first instant in UTC, as `alert_outbox`'s CHECK takes every time, so `isTimeFact` counts it (and the alert tick's mail and the push keep it a string); the new `isDayFact` makes `renderAlert` print it as the date ('2026-10-18', rule 7 of section 18) and never as a time of day. The job writes it as `<day>T00:00:00.000Z`.
- **The guard dates what it allows (6.5).** `head_publications_guard` lets the token, `witnessed_at` and `published_at` change only from null and nothing else change, as designed, and also sets `witnessed_at` and `published_at` to the clock's time when they are set from null, whatever the update supplied, so no token and no publication is dated before it happened.
- **The keeper's hash is checked before the mail (7.7 step 5).** The mail is sent from the round whose update set `published_at`. It carries the hash of the row's own place, read from `audit_head` while the head still stands there or from `audit_log`'s row of that place (a raw read of one column of one row, as `media/repo.ts` reaches the outbox; the architecture rule names imports only), and only when `head_value()` of the day, the place and that hash gives the stored value; otherwise no mail is sent and the error is logged. `mailKeeper` answers `sent`, `off` (no address), `refused` or `failed` and never throws; nothing retries a failed mail.
- **When the head's pass runs (7.7, 7.14).** The transparency job's round runs the head's pass after the dispatch hour, after the editions' daily pass, and again in each later round of the day until the day's value is published and either witnessed or never to be: a row born while `HEAD_WITNESS` was `off` is named `none`, takes no token (the CHECK `head_publications_token`), and is not asked of a witness switched on later that day. The round's result gains `head`, the pass's account, null when no pass ran. The row's day is the database's own, forced by the trigger; the dispatch-hour gate reads the job's clock.
- **The witness's answer (5, 7.7 step 3).** The `rfc3161` adapter keeps the whole TimeStampResp as received when its outer SEQUENCE spans the answer, its PKIStatusInfo opens with status 0 or 1 and a token follows; anything else, an HTTP error, a body over `HEAD_RULES.tokenMaxBytes` (refused by its length or while it is read), a redirect, a timeout or no connection answers null. The `test` adapter's fixed token is a 13-byte TimeStampResp whose token is the octet string 'test', which proves nothing. The `off` adapter throws when it is asked, since the job never asks it. `HEAD_WITNESS_URL` is held to https in every environment.
- **The request's imprint is the value (5; W.2 [tr.verify]).** The fixed TimeStampReq is 59 bytes: version 1, SHA-256 with its NULL parameters, the value read as the 32 bytes its hex spells, and certReq TRUE, so the token carries the authority's certificate; no nonce and no policy. [tr.verify]'s command was run once with OpenSSL 3.5.4 against a proof of a local test authority for such a request, where `openssl ts -verify -digest <value> -in <day>.tsr -CAfile <root>` answered 'Verification: OK', and failed for another value (imprint mismatch) and for another authority's certificate; the sentence stands as W.2 words it.
- **The page sends two requests (9.1, 9.3).** 9.1 says each public page sends its one GET; 9.3 has `/transparency` read `GET /api/public/transparency` and `GET /api/public/head`. The page sends both, each answered or failed alone: a head route that does not answer reads [page.down] in the head's section alone.
- **The head's section on the page (9.3 item 6; W.2).** A row is '<day>: <value>, with an outside timestamp', '..., without an outside timestamp' or, for a test adapter's token, '..., with a test adapter's timestamp, which proves nothing'; a retired value adds [tr.retired] with its day. [tr.headMissing] stands for each day between the newest and the oldest shown row that has no `head` row, after that day's restore row when it has one, and never before the first value or after the newest, whose value may not be published yet. [tr.verify] and the downloads stand while a shown row has a proof (a witness that was on), not only while one is on now; [tr.verify] is filled with the newest such day's value and file name, and each proof is offered as `<day>.tsr` on the web, where a browser can save a file. With no row yet the section says 'korbat has published no daily value yet.'
- **The README (W.11, section 15).** 'Until sub-project 3d publishes the head' is gone from both places: the kept head says the API publishes the daily value and mails it to `API_HEAD_KEEPER_MAIL`, and that the keeper's daily visit stays; 'Who can rewrite the audit log' says that a change is held against the values in the keeper's mail and, with `API_HEAD_WITNESS` on, a timestamp authority's proof, in place of 'With one person, nothing detects the operator's own changes until 3d', and ends with W.11's sentence. The yearly edition's paragraph is 'The yearly edition, the monthly count and the daily value', with the three settings and the openssl check. Restoring's step 4 is `head-restore-mark`. The staff console's comment in `apps/admin/src/screens/Audit.tsx` that names 'Until 3d publishes the head' is left, since the console is unchanged by this task.
- **The migration's number (6.6, 13).** The automated decision's migration is `0038_automated_decisions.sql`, the next free number after 3d's Tasks 1 to 5 (0033 to 0037), not the design's 0035; it changes no existing migration. It drops and adds `alert_outbox_kind` with `automated_objection`, `automation_capped` and `automated_waiting` after Task 5's `head_missed`, and `enum-literals.test.ts` reads it and every later file under 3e's rule for the labels `automated` and `system`.
- **The fact of `automation_capped` (6.6, 10.6's alerts table).** The design says the refusal's limit is one 'which the alert carries as its fact `limit`' and lists the facts as '`at`, `limit` (one of `CAP_LIMITS`), `count`'. `alert_outbox_facts` admits only counts and UTC instants, so the alert carries `at`, `count` and exactly one of `limitHour`, `limitDay`, `limitUnanswered` and `limitWaiting`, set to 1; W.7's sentence picks its clause by which of the four is present. The refusal's detail stays the contracts' `CAP_LIMITS` word.
- **A score from another model (5, the R1 adapter's row; 7.9).** `finalize` keeps `nsfw_score` only when a ready result of version 2 names the model this server runs (`R1_TEST_MODEL` under `R1_CLASSIFIER=test`, none while it is `off`); another model's score is dropped, logged without the score, and the image becomes ready all the same, rather than the result being refused. A result of version 1 is still read; a version the protocol does not know is ignored and the upload stays processing.
- **The classifier's digest (5, the R1 adapter's row).** The design says 'The model's name and the digest of its weights are constants of `packages/media-protocol` (`classifier.ts`); a wrong digest stops the worker at start'. `R1_MODEL` holds the name and the size and `sha256: null`: the research recorded only the ends of the digest and this task may fetch nothing, and `R1_CLASSIFIER=onnx` stops the API and the worker at start in this build anyway ('no such adapter in this build'). The owner's build task that adds the classifier sets the digest and its check.
- **`MediaForCases.signals` and `unsignalled` (5).** The design gives `signals(tx, postId)` each image's 'id, its score ... and its unerased match record's id with its `listed` and its `acting`' and `unsignalled(limit)`. In Task 6 `signals(q, postId)` answers `{ mediaId, score }` for each ready image, and `unsignalled(limit, { hours, r1 })` takes the sweep's window and the threshold (or null while no threshold applies), since the media module holds no setting of the moderation module's; the match members and the match enumeration come with Task 7.
- **`StaffOverview.automated` and `CaseView.signals` (10.3).** `automated` carries `waiting`, `oldestAt`, `objected`, `oldestObjectionAt`, `cases` and `objectedCases` and not `flags`, which comes with Task 7 and [home.flags]; a signal on the case answer is `{ itemId, kind, thresholdVersion }` and carries no match record until Task 7. `CaseHistoryEntry.intakeKind` gains `automated`, which the console's history words as 'a program's finding'.
- **`DecisionStatement`'s three members (10.2).** `automatedDetection`, `automatedDecision` and `signal` are optional, absent reading as before 3d (not found and not decided by automated means), so a statement drawn for a decision or a fixture of an earlier sub-project parses unchanged; the API always sends them for a decision of 3d.
- **A person's decision after a score that gives a strike (W.3, 7.10).** The found paragraph (`automated.found.r1` with its ending) replaces 3e's `automationStrike`, whose first sentence says that no automated means found the content; the second sentence of `automationStrike`, that the strike follows from korbat's published rule, follows the found paragraph as `automated.strikeRule`.
- **Where the statement's signal is read (7.10, 10.2).** The statement's `signal` is read by `statementSignal` in `moderation/automated-repo.ts`, the program's own queries, not in `statement-repo.ts`: the author's four files may name no table of reports, and the read joins `intake_items` to find what found a person's decision's items. It answers a kind and a yes or no only; `moderation-author.test.ts` pins `statement.ts`'s one import from that file.
- **`automation-status` (8.10).** The caps' line says 'in the last hour' and 'in the last 24 hours' where the design says 'this hour' and 'today', since `decisions_record` counts rolling windows; a program's findings 'today' are those since midnight UTC. Until Task 7 the known material's line prints 'automation-status: known material: off; no comparison is built in this version.'. The command runs in the api service with `loadConfig`, so a setting the API refuses is refused here with the same sentence, and reads in one REPEATABLE READ READ ONLY transaction as the API's role.
- **`audit-verify`'s check (8.10, 10.5).** The design says that it exits 1 with the sentence 'audit-verify: decision <id> has no decider and no automated_decided row in the chain'. That sentence is one of the problems the run lists under 'audit-verify: FAILED, <n> problems', as every problem of the walk is, without the command's prefix; a second such row, an `automated_decided` row that carries a key or was written by another actor, and any other row that names the decision as its `decisionId` are problems too. The line 'audit-verify: <n> decisions without a decider, each with its automated_decided row.' prints only when the chain holds.
- **`text-verify` (C 7.13).** `text-verify` also reads the system's `automated_decided` rows and holds a decision without a decider to its row as it holds a person's decision to its confirmed row: the system as the actor, `automated_decided` on its case, and the params member for member, with the snapshot it names checked; these rows are not counted among the confirmed rows. Without it every program's decision would be reported as one that no confirmed row names.
- **The console's preview and [case.auto] (8.4).** The composer's preview takes `viewed` from the images this person opened on this case in this page ('Show image', whose read the API logs as `image_viewed`), not from the access log; [case.auto]'s statement is drawn again in the console from the case answer's decision (`programStatementOf`), and is left out for a measure this version cannot word (Task 7's seal). Home's [home.automated] and [home.objected] link each case as 'case 1', 'case 2' after the sentence.
- **objection_not_open's words (9.7).** '[auto.decided] without the day' reads 'A person has decided since: the decision is listed under Settings, Cases.', worded by the app itself (`localWording`).
- **`askPerson` `decided` (10.2).** It names the decision that ended the program's measure: the told correction or review whose ledger row reversed one of its measures, else the case's first told final decision after it; while neither exists and no measure is in force, `askPerson` is null.
- **The settings' spelling (5, Further settings).** `R1_CLASSIFIER` is unprefixed in `infra/.env.example` and handed to both the api and the worker blocks of `infra/compose.yml`; the worker also gets `APP_SITE` (open unless set), which it reads only to refuse a test scorer on an open site; `API_AUTOMATION_R1_ACTS`, `API_AUTOMATION_DPIA_R1` and `API_AUTOMATION_DPIA_R1_ACTS` go to the api alone. The DPIA guards for a real classifier are written and unreachable in this build, since `onnx` is refused first.
- **The tests' fixtures (12, 12.3).** `yearForTest` grows a cell `automated: { findings, restrictedR1, measures }` (the R1 findings' items on the year's case, which a person's final restriction of the year restricted); LAB A8's caps are met on the built code with bulk history rows written as the migrator with the decision triggers off in transactions that roll back, filled up from what the database already counts; the contention lab's new rows run alone with `-t '3d Task 6'`, not the whole lab of large accounts.
- **The migration's number (6.7, 13).** The design names the migration 0036_known_material; Tasks 1 to 6 took 0033 to 0038, so it is packages/db/migrations/0039_known_material.sql, by AGENT_BRIEF's rule. Section 6.7's 'Replaced in 0036' reads 'replaced in 0039': every function it replaces is written from the newest built text (0034, 0036, 0038).
- **No PDQ in this build (5, 7.8, 12.1 row 11).** The owner has not allowed the fetch of the reference's PDQ vectors, so no pdq.ts exists: the worker computes no PDQ, media_hashes.pdq, pdq_quality and pdq_impl stay null, the request carries no pdq member and the result never has one. The worker therefore needs no MEDIA_MATCH; only the API reads it. Row 11's test states the member's absence; matchRequest still sends a pdq member when one is ever given.
- **The notice that a hold was lifted has its own state (6.7, 7.12, W.8).** upload_refusals gains lifted_told (a delivery_state, null unless the hold ended as no_report): upload_hold_end sets it pending with an end as no_report and null with an end as report, the dispatch step mails upload_hold_lifted once the delay of noReportHours has passed, the image row is gone and the end still stands, and the guard moves it only from pending. A CHECK keeps it null for any other end.
- **hold_ended_unreported's facts (W.7).** The design's sentence names {until}; the facts are at and deletesAt (the image row's hold_until), both times, so the push and the mail print 'The upload is deleted after {deletesAt}'.
- **upload_release_facts(refusal) (8.6, 10.3).** A definer function the design does not name: Held uploads' release block reads 3f's record of the report and the leaves, which the API's role cannot read, through it, as a seal's block reads release_facts. It answers the record's state, reference, answer and its time, the hand-over, whether both files are in the quarantine by record, the standing leave and whether the uploader's notice of a release would be held. Executable by korbat_api alone.
- **releases_notice and release_tellable for an upload (6.7).** Replaced with releases_confirmed and release_tellable: a release of a held upload names the refusal's owner as its author and the record upload-report opened (upload_refusals.notification_id) as its record, so its notice is held exactly as a seal's is.
- **The two definers that write auth.report_holds (6.7, 11).** upload_refusals_hold and upload_hold_end pin search_path to public, pg_temp and qualify every auth name, as report_open does, so the schema test's rule on every migrator function's search path holds unchanged.
- **RestoreGap.hold (8.7, [restore.holdEnd]).** RestoreView's gap of a lost upload_hold_ended line carries hold { endAs, present }: how the lost end ended and whether the restored database holds the refusal, which restoreView asks the media module (MediaForCases.held), since only it names upload_refusals. The console prints the line with Report or No report, and the link to Held uploads only while the refusal is there.
- **HeldUpload.reported (8.1, 8.6).** reported says that the record of a report is opened (notification_id set), as 8.1 lists it; the release block's own reported says that the record was sent. The state line [uploads.state.report] prints the first.
- **The figures' open row (6.4, W.2).** transparency_figures prints a refusal by its fate on the due day: report, no_report, or open when no admin had ended its hold by then. W.2 names no label for open; the app prints 'Held, not yet decided on the due day'. The contract's row list already held open.
- **An answer's reason only where it is asked for (8.4, note 26).** The console signs matchAnswerReason only on a final decision without a seal that answers an item of an acting match; on every other decision the member is absent from the params, so decisions confirmed before Task 7 and every other decision hash as before. An answer that needs it and has none is refused by the console before any request, with the reason's own sentence.
- **The composer holds a refused upload back (9.5).** describeState counts a refused tile as failed, so the composer offers no post while one is attached; the post route's upload_refused (422) and [upload.refusedPost] still answer a post sent another way. The tile shows no preview of the chosen file: nobody can see the image, its uploader included.
- **[upload.objected] (9.5, W.5).** The notice's own paragraph 'You objected on ...' (W.5 objected) stands on every read once an objection exists; [upload.objected] is printed once, under Object, right after the objection is sent, in place of the form.
- **The seal's facts draft on a match (W.3, SEAL_DRAFTS.facts.match_post).** The console fills {comparison} with W.3's clause for the first unanswered program item a match opened, with the subject 'an image of this post' and a capital letter; the draft is offered only on a case whose every unanswered suspect item is a program's.
- **Home's order (8.2).** [home.released] moved below the programs' lines, after [home.flags] and [home.uploads], as 8.2's table orders the block; a held upload's release and [home.unreported] link Held uploads.
- **The smoke test's fingerprint check (12, Task 7).** With every adapter off the smoke test reads, as the database's owner inside the postgres container, that no media_hashes row exists for its upload; the API answers nothing that would tell.
- **The test matcher's two answers for the flag file (5, 12).** The flag fixture answers a near match of the listed class by SHA-1 (adapter.flag = near, the default) or an exact match of the unlisted class by MD5 (flag = unlisted), so a near record and a flag record each carry the hash type that the console's [case.matchWeak] words; the acting fixture is an exact SHA-256 match.
- **The migration's number (6, 6.8, 13).** Task 8's migration is 0040_signals_and_retention, not 0037: 3f ended at 0032_orders_review and Tasks 1 to 7 took 0033 to 0039. It is written by hand through generate:custom and changes no table, so a second generate prints 'No schema changes'; enum-literals.test.ts reads it under the stricter form of the rule, and it names no kind or channel of an intake at all.
- **The flag's window and its numbers (6.8, 7.13, 10.1).** case_flag counts a window from an item's time up to, not including, windowMinutes later; among the windows the one with the most distinct reporters wins, then the one with more items, then the earliest. Its four numbers stand in one CTE of the function, `rules` (5, 5, 60 and 0.5), from which a test reads them and holds them to SIGNAL_RULES, beside behavioural tests one short of each number. It answers one row always: false with 0 and 0 for a case without an unanswered item of a signed-in reporter. The queue asks it for its page in one statement (unnest of the page's ids, lateral case_flag) after the page is read; the two reads are queueFlags and caseFlag in moderation/automated-repo.ts, which a source test holds to their two callers in moderation/cases.ts.
- **A seal for good that holds a match record (6.8 step 1).** The guard against erasing a record of a case reads every seal for good in force that lists a post not in release_posts and either belongs to the record's case or lists the case's own post: a seal taken for the same post in another case (an account's case, for one) keeps the record too. For a released post the days run from the release, read through the case's own post, since the disposal may have deleted the image row by then.
- **Requests for a person, by erase_statement_texts itself (6.8 step 2).** An objection's text is erased by calling 3c's erase_statement_texts on its decision in a subtransaction, for an objection whose subject's account is deleted at all: a decision without a decider has no text of its own, so the call erases nothing and answers only whether its texts are due (it raises not_due until the account has been deleted for 3c's months). No second copy of the twelve months is typed, and the function holds no interval literal.
- **Signals a statement reads (6.8 step 3, 6.10).** A signal that names a decision, or whose finding's item a decision answered or considered, is what DecisionStatement.signal is read from at every render: the statement of a program's decision cannot be rendered without it (programParagraphs refuses), and a person's automated finding loses its words. So such a signal is deleted under the design's conditions (a match's record erased, a score's intake erased) only once the texts of its case's decisions are due by the same test as the objections, the case's first decision standing for the case; a signal that no statement reads (handled as gone, with neither an item nor a decision) is deleted as the design says, a match's once its record is erased and a score's match_keep_days after it was handled. An unhandled signal is never deleted.
- **The retention job's three steps, and the switch (7.14).** The steps automation_records, edge_purges and tools_off run after restore_gaps and before the disposal, each a transaction of its own with one moderation_retention row of its step and count when it changed anything; RetentionReport gains automationRecords, edgePurges and toolsOff. tools_off is one transaction for both statements: forgetHashes while MEDIA_MATCH is off and forgetScores while R1_CLASSIFIER is off. Since tools_off is held by nothing but its tool's setting, moderation.startJobs now starts the retention job also while MODERATION_RETENTION is off (the warning is still logged at every start), and with the switch off each round runs tools_off alone. retentionRound reads the three settings from the configuration the job passes; called without one, as the other steps' tests call it, every step but tools_off runs.
- **The media module's three statements (5, 7.14).** MediaForCases gains forgetHashes(tx), forgetScores(tx) and forgetPurges(tx), each in the retention step's transaction so that its audit row is the transaction's last statement, each answering how many rows it changed. forgetPurges deletes the edge's outbox rows done more than EDGE_RULES.keepDays ago and never one still pending: the outbox is the media module's table, so its delete is a member too. forgetScores spares every image that an unhandled signal of either kind names.
- **The export's members (W.10, 10.2).** The built export names its decisions member `decisions`, not `moderation.cases`; each entry gains automatedDetection, automatedDecision and signal as the statement reads them (false, not_automated and null for a decision made before 3d) and objection, the text and time of the request for a person, or null; all four are always present. `moderation.uploads` holds each of the account's refusals as UploadRefusalView, the very view the notice's route answers (mayObject among its members), newest first. `moderation.releases` holds each release of the account's posts and of its refused uploads that may be told, as {id, basis, releasedAt, upload}. The account module writes both members in the format's order, and an account module without the moderation module writes them empty.
- **RETENTION's members and the terms' style (W.9, 10.1).** RETENTION gains three numbers, matchKeepDays (AUTOMATION_RULES.matchKeepDays), reportHoldDays (ORDER_RULES.reportHoldDays) and edgePurgeDays (EDGE_RULES.keepDays); the other entries of W.9's printed list (the refusal's record, the hashes, the rating, the sketches, the release's record) are phrases the terms compose, with the years of RETENTION.orderRecordYears and the hours of RECIPIENT_RULES.saltHours. The terms print every period as their other sections do, a number up to ten as a word ('up to seven days').
- **The terms' places and one more sentence (W.9, W.4).** 'Automated tools' stands after 'How moderators decide', which now points to it, and 'Transparency' after 'Contact point for authorities'. 3d's paragraph of 'Your data' and its printed list stand before 3f's. 3c's sentence of 'How moderators decide', 'After an admin has answered without a seal, staff may open them like any other image.', gains the exception rulebook version 4 gives R2's ('except an image that an automated comparison matched: korbat's staff do not open such an image at any time'), which W.9 did not list: without it the terms would say what review ruling 2 forbids. The CSAM paragraph reads 'the reported or matched post' and 'until an admin has answered'.
- **The README (W.11).** W.11's parts that the README lacked stand in a section of their own, Automated tools, between Quarantine and The yearly edition: its opening paragraph, A measure a program took, A held upload with the owner's line for counsel's advice word for word, Switching a tool on (the API's settings with their prefix, R1_CLASSIFIER and MEDIA_MATCH without one, and up -d api worker) and Cloudflare's scanning tool. Before going public gains section 17's parts A and B as lines A1 to A8 and B1 to B7, after the settings, and its gate reads 'the lists below are done'. Images' worker sentence says that the R1 check rates the decoded pixels and that this build computes no perceptual fingerprint (Task 7 built no PDQ). The Moderation runbook names the flag and the closed door on a matched image, and The edge the owner's lab on the zone before the purge is switched on.
- **What a restore loses of the public figures (7.3, W.11).** restore-import reads an edition_published line above the restored head and, when the restored database lacks that version of that year, prints one line for it ('edition <year> version <n>, published <time>, is not in the restored database ...'); it writes nothing and opens no gap. Restoring's paragraph The public figures after a restore says what follows: the job publishes a first version again from the restored database as of the same 1 March, and a hold_ended version when it meets the order again; a lost correction comes back only with edition --correct; a month closed after the backup is lost and reads 'not recorded', with no line or audit row to name it, so the runbook alone covers it.
- **The console's flag (8.3, 8.4, 8.9).** [queue.flag] is a mark of the queue's row like the other chips; [case.flag] stands under the case's header as the chip and the sentence in a span of its own, the minutes from SIGNAL_RULES.windowMinutes and the share as the word half while linkedShare is 0.5; [case.sameSource] follows the item's source line and says 'item' for one. The browser check gains one run at 360 by 740 px (79 runs): the queue with the flagged case where its lane and age put it, the case with both lines, then Home, the queue, Held uploads, After a restore and the case once more under the phone's rules.
- **TOOL_TEXTS in four states (12.2).** The texts are rendered in the app's test for each tool off from the start, on, on with its measure and off again after it ran, which reads as off; the database side is the retention integration test, in which a round with the tool on keeps every hash and rating, and a round with the tool off, also under MODERATION_RETENTION=off, leaves no media_hashes row and no nsfw_score but one an unhandled signal names, with its audit row.
