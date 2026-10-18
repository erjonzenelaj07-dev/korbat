# The contention lab of moderation decisions

`contention.lab.ts` measures what a decision's transaction costs and what it meets (3c design, sections 2 and 12),
against the test database with migration 0016. The design names no place for it; it lives here.

It is a database lab. It issues its statements itself, as SQL: a decision is the lock on its subject's profile row, its
row in `decisions` and its rows in `decision_actions`, whose triggers do the rest; a like, a follow, the author's
deletion and the purge are the statements the social and media repositories issue; the purge's delete is the ordered
delete by owner (`delete from post_media where id in (select id from post_media where owner_id = $1 order by id for
update) returning id`). An intake is the moderation module's `recordIntake`. It uses no code of a later task.

Every measured transaction is rolled back, so the lab leaves no decision, and writes no audit row but one: the R4
removal that the redaction's rounds need committed (the last section) is a real, confirmed decision. The accounts it commits
(the large ones, written in bulk by the migrator, and the pair for the two-session rounds) are removed when it ends.

## Running it

From `apps/api`, with the scratch stack's data services up and the test database migrated:

    node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts

No suite includes it (its file ends in `.lab.ts`). It takes three to four minutes. Each measurement is one line of JSON
in `.data/lab-contention.jsonl` at the repository's root (or the file `LAB_OUT` names), with `busyPercent`: the share of
processor time, over all cores, that was not idle in the second and a half before the measurement.

## The numbers of 2026-10-04, first run: a saturated machine

PostgreSQL 18 in the scratch stack's container on a Windows machine shared with other work. The machine was saturated
throughout: `busyPercent` read 94 to 99 before every measurement, most of it other projects' containers. These numbers
are upper bounds for this hardware; the second run below, on a quieter machine, is the one the design asks for.

### An account's seal (one session; one image on each post)

| image posts | busy | decision row | seal taken while deciding | answer that ends it | seal for good | lifting it |
|---|---|---|---|---|---|---|
| 1,000 | 97% | 104 ms | 180 ms | 254 ms | 282 ms | 232 ms |
| 5,000 | 99% | 18 ms | 1,123 ms | 1,057 ms | 1,131 ms | 995 ms |

- The seal taken while deciding locks the account's image rows in id order, writes one row of `seal_posts` for each post
  and writes every image row once. At 5,000 image posts the decision and its seal take 1.1 s, 0.19% of the ten minutes a
  step-up challenge lives.
- The seal for good that follows writes every image row twice in one transaction: the answer ends the first seal (each
  row back to visible, 1.06 s at 5,000), and the new seal seals each again (1.13 s). Lifting it is a fourth write (1.0 s).
- No post row is locked by any of them.

### The purge of an account (one session)

| image rows | frozen | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|
| 5,000 | no | 99% | 436 ms | 2,228 ms | 5,000 | 2.7 s |
| 5,000 | yes | 98% | 390 ms | 1,862 ms | 0 | 2.3 s |
| 20,000 | no | 94% | 1,471 ms | 6,090 ms | 20,000 | 7.6 s |
| 20,000 | yes | 97% | 1,724 ms | 5,821 ms | 0 | 7.6 s |

- The keep trigger reads the freeze once for each row: about 0.3 to 0.45 ms a row under this load, whether the row is
  then kept or deleted. The research lab's figures under load were 2 to 4 s at 5,000 rows and 7 to 16 s at 20,000; these
  lie at their lower end.
- "Frozen" is an unanswered report of child sexual abuse material about the account: every row is kept, and the delete
  answers none.

### A decision against everything else (two sessions, 40 rounds a pair, each side first in half of them)

Three decisions (an interim withhold of a post; a final removal that closes the post's case; a seal on the author's
account's case followed in the same transaction by the answer that ends it) against six other transactions (a like of
the post; a follow of the author; the author's deletion of the post; the author's purge; a notice of child sexual abuse
material that names the post and its author's account; a report of the post under a rule). Each side holds its locks for
15 ms before it rolls back. `busyPercent` was 96.

| decision | against | both completed | deadlocks | lock timeouts | longest transaction |
|---|---|---|---|---|---|
| interim withhold | like | 40 of 40 | 0 | 0 | 236 ms |
| interim withhold | follow | 40 of 40 | 0 | 0 | 116 ms |
| interim withhold | author's deletion | 40 of 40 | 0 | 0 | 158 ms |
| interim withhold | purge | 40 of 40 | 0 | 0 | 232 ms |
| interim withhold | notice naming post and account | 40 of 40 | 0 | 0 | 409 ms |
| interim withhold | report under a rule | 40 of 40 | 0 | 0 | 318 ms |
| closing removal | like | 40 of 40 | 0 | 0 | 183 ms |
| closing removal | follow | 40 of 40 | 0 | 0 | 145 ms |
| closing removal | author's deletion | 40 of 40 | 0 | 0 | 194 ms |
| closing removal | purge | 40 of 40 | 0 | 0 | 171 ms |
| closing removal | notice naming post and account | 40 of 40 | 0 | 0 | 207 ms |
| closing removal | report under a rule | 40 of 40 | 0 | 0 | 231 ms |
| account's seal and its answer | like | 40 of 40 | 0 | 0 | 254 ms |
| account's seal and its answer | follow | 40 of 40 | 0 | 0 | 210 ms |
| account's seal and its answer | author's deletion | 40 of 40 | 0 | 0 | 233 ms |
| account's seal and its answer | purge | 40 of 40 | 0 | 0 | 419 ms |
| account's seal and its answer | notice naming post and account | 40 of 40 | 0 | 0 | 264 ms |
| account's seal and its answer | report under a rule | 40 of 40 | 0 | 0 | 206 ms |

- 720 rounds, no deadlock and no lock timeout. The purge met none here either: the deadlock the design expects of it is
  with an intake that locks the account's image rows, which the intake does not do before Task 3.
- What makes this hold: a decision takes its subject's profile row first, as the author's deletion and the purge do; a
  like and a follow take that row in a mode a decision's does not conflict with; a seal locks image rows only; and an
  intake takes its cases in one order and each post's row only to read it.
- A finding the lab led to, now a test (`moderation-races.test.ts`): a report that arrives while a decision is closing
  its target's case waits where it opens a case (`insert into cases ... on conflict do nothing` waits for the transaction
  that is changing the conflicting row), and then opens a new case without a retry. The retry on `case_closed` is needed
  only when the decision has locked the case and not yet closed it when the report reads it.

## The numbers of 2026-10-04, second run: the final migration, a quieter machine

Run again after the review added a second deferred check to 0016 (queued by every row of the ledger, it runs at COMMIT,
which the lab's rolled-back transactions never reach). `busyPercent` read 17 to 28.

| image posts | busy | decision row | seal taken while deciding | answer that ends it | seal for good | lifting it |
|---|---|---|---|---|---|---|
| 1,000 | 19% | 35 ms | 70 ms | 115 ms | 110 ms | 107 ms |
| 5,000 | 17% | 7 ms | 420 ms | 463 ms | 503 ms | 465 ms |

At 5,000 image posts the seal taken while deciding takes 0.43 s with its decision, 0.07% of the challenge's ten minutes;
the seal for good that follows it writes every image row twice in under a second.

| image rows | frozen | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|
| 5,000 | no | 28% | 182 ms | 888 ms | 5,000 | 1.1 s |
| 5,000 | yes | 24% | 108 ms | 791 ms | 0 | 0.9 s |
| 20,000 | no | 22% | 680 ms | 2,488 ms | 20,000 | 3.2 s |
| 20,000 | yes | 27% | 576 ms | 2,366 ms | 0 | 2.9 s |

The keep trigger costs about 0.12 to 0.18 ms a row here.

The two-session rounds at 24% busy: the same 18 pairs of 40 rounds each, every transaction completed, no deadlock and no
lock timeout, the longest transaction 124 ms.

# The lab of the intake's lock statement

`hold.lab.ts` measures what an intake's hold costs and what it meets (3c design, sections 5 and 12, Task 3), at the
repository: `MediaForCases.hold` with an owner pair, which is the statement that locks every image row on an account's
posts when a report of child sexual abuse material names the account
(`select ... from post_media m join posts p on p.id = m.post_id where m.post_id = any($1) or m.owner_id = any($2) order
by m.id for key share of m`). It also times the disposal's two statements over the same accounts, and runs the purge
against a notice about a post that quotes its author's own post. It runs against the test database with migration 0016,
through the media repository and the moderation module's own `recordIntake`; the purge is the social repository's
`purgeProfile` with the media repository's `purgeOwner` as its last act. Every measured transaction is rolled back; the
accounts it commits are removed when it ends.

    node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/hold.lab.ts

It takes about a minute and a quarter. Each measurement is one line of JSON in `.data/lab-hold.jsonl` (or the file
`LAB_OUT` names), with `busyPercent` as above. `LAB_ROUNDS` sets how many rounds the two sessions meet by chance (40
unless said).

## The numbers of 2026-10-04

Three runs on the shared Windows machine, PostgreSQL 18 in the scratch stack's container: two before the review of
Task 3 and one after its fixes. The machine was never quiet, most of the load other projects' containers:
`busyPercent` read 14 to 40 before the lock statement's runs of the first run (up to 100 before its last measurements),
14 to 83 before those of the second and 15 to 40 throughout the third. The times are upper bounds.

### The lock statement (`hold` with one owner pair; one image on each post; three runs each, a transaction of its own each)

| attached rows | run | busy | lock statement | WAL written |
|---|---|---|---|---|
| 5,000 | first | 29 to 40% | 36, 25 and 21 ms | 288, 274 and 274 kB |
| 5,000 | second | 64 to 83% | 90, 65 and 26 ms | 288, 274 and 274 kB |
| 5,000 | third | 23 to 31% | 46, 31 and 28 ms | 288, 274 and 274 kB |
| 20,000 | first | 14 to 19% | 114, 80 and 69 ms | 1,153, 1,097 and 1,097 kB |
| 20,000 | second | 14 to 76% | 102, 180 and 198 ms | 1,408, 1,097 and 1,097 kB |
| 20,000 | third | 23 to 31% | 151, 123 and 102 ms | 1,153, 1,097 and 1,097 kB |

- The research lab's figures (`lab-gate-k`, H) were 77 ms and 287 kB at 5,000 rows and 102 ms and 1.1 MB at 20,000:
  these agree. The lock writes its mark to each row it takes, though no column changes: about 55 bytes of WAL a row.
- The plan is LockRows over a Sort on `m.id` over a hash join of `post_media` and `posts`, as the design says of the
  owner form. In the test database the lab's account owns most image rows, so `post_media` is scanned whole; the sort
  took 0.6 MB of memory at 5,000 rows and 2.5 MB at 20,000.
- A whole notice on the path for child sexual abuse material that names the account (its rows, the copy of the profile,
  the hold and the snapshot) took 72, 95 and 77 ms at 5,000 rows and 104, 238 and 147 ms at 20,000; one that names a
  post of the account as well took 85, 91 and 80 ms at 5,000 and 743 (at 90% busy), 299 and 147 ms at 20,000.
- The purge's ordered delete (`purgeOwner`) right after such a notice, in the same transaction, deleted no row: 1.4,
  1.6 and 1.3 s at 5,000 rows, 5.6 and 5.5 s (73 to 100% busy) and 3.2 s (31% busy) at 20,000, the keep trigger reading
  the freeze once for each row.

### The disposal's two statements (one batch of `dropDisposable`, and `overdueDeletions`)

The account's rows are all attached. In the first two lines nothing of the account is disposable: its posts are
visible. In the last, the account is reported on the path for child sexual abuse material and every post of it is
deleted, so every row carries a mark of disposal and none may go.

| what | attached rows | busy | `dropDisposable` | `overdueDeletions` |
|---|---|---|---|---|
| nothing disposable, the freeze a condition of its own (as first built) | 5,000 | 100% | 3,332 ms | 3,332 ms |
| | 20,000 | 97% | 14,226 ms | 13,863 ms |
| nothing disposable, the marks tested first (as built now) | 5,000 | 24% | 18 ms | 8 ms |
| | 20,000 | 40% | 62 ms | 19 ms |
| every row marked and frozen (as built now) | 5,000 | 18% | 1,285 ms | 1,174 ms |
| | 20,000 | 26% | 4,148 ms | 3,666 ms |

- As first built, the predicate was `... and (marks) and (m.post_id is null or not public.post_frozen(m.post_id))`.
  The second condition names `post_media` alone, so the planner made it the filter of that table's scan and called the
  freeze for every attached image row in the table before a mark was tested. The review measured 0.9 s at 5,000 rows
  and 3.4 s at 20,000 on a quieter machine; the first two lines are the same statement on a saturated one.
- Now the marks and the freeze are one condition, `case when (marks) then (m.post_id is null or not
  public.post_frozen(m.post_id)) else false end`: it names all three tables, so it runs where they are joined, and the
  freeze is read only for a row that carries a mark. `media-cases.test.ts` pins that no scan's filter names the
  predicate, under the planner's own plan and under each join method alone.
- What remains is the last pair of lines: a frozen account whose posts are all deleted (a purged account under an
  unanswered report, or under a seal for good) costs one read of the freeze for each kept row, about 0.2 ms, at every
  round of the disposal and at every count of overdue rows, for as long as the freeze lasts.

### The purge against a notice about a post that quotes its author's own post

A report of child sexual abuse material about a post that quotes another is taken in as two items, so a notice about a
post that quotes its author's own post holds two posts of one account for share, in id order, while the purge writes
both. The lab's account has such a pair, four images on each post; the notice names the quoting post and the account.
The notice's side counts the runs the moderation module made, so a deadlock it absorbed by running again shows; nothing
runs a purge again, so a deadlock that picks the purge shows as its error.

By chance (two sessions, each side first in half the rounds, a few milliseconds ahead, each holding its locks for
15 ms before it rolls back):

| purge | rounds | busy | purge | notice | deadlocks | longest transaction |
|---|---|---|---|---|---|---|
| as first built (counters, then the posts in id order) | 200 | 95% | 200 of 200 | 200 of 200, each in one run | 0 | 528 ms |
| as built now (every post locked first, in id order) | 40 | 25% | 40 of 40 | 40 of 40, each in one run | 0 | 139 ms |

Staged (ten rounds a shape: the notice has copied the first of the two posts and is held there, the purge comes to
wait, the notice goes on to the second post):

| purge | the quoting post has the lower id | the quoted post has the lower id and was deleted by its author |
|---|---|---|
| as first built: the counters of what its posts quote, then the posts in id order | 10 of 10: the purge ends with 40P01 | not run |
| the account's posts that are not deleted locked first, in id order | 10 of 10: both complete | 10 of 10: the purge ends with 40P01 |
| every post of the account locked first, in id order (as built now) | 10 of 10: both complete | 10 of 10: both complete |

- As first built, the purge's quote counter wrote the quoted post before the ordered statement asked for the quoting
  one, which the notice held: each waited for the other. The window is one statement of the notice wide, so 200 rounds
  by chance never met it, and every staged round did. PostgreSQL ended the purge each time: a session looks for a
  deadlock once it has waited a second, and the purge was the first to wait. The notice went through in one run. A purge
  that ends this way is finished by the purge job within five minutes.
- Locking only the posts that are not deleted leaves the same wait in the second shape: a live post that quotes (or
  replies to) its author's own deleted post has that post's counter written by the purge, and a report of child sexual
  abuse material holds a deleted post like any other. So the purge locks every post of the account first.
- What stays unordered: the counters of other accounts' posts that the purged account replied to, quoted, liked or
  reposted, which the purge writes after its own posts; and the author's deletion of one post, which writes the post
  and then the post it replied to or quoted.
- Before the review this pair ran with two plain posts (and with the purge as first built): 40 of 40 on both sides in
  both runs, no deadlock, the longest transaction 307 ms at 64% busy and 200 ms at 23%.
- What the two-session tests add (`media-cases.test.ts`): when the notice locks first, the purge waits and then keeps
  every attached row; when the purge deletes first, the notice waits, locks nothing and is stored without an error.

### The contention lab again

`contention.lab.ts` issues the purge's statements as the repositories issue them since Task 3: every post of the
account locked in id order (`select id from posts where author_id = $1 order by id for update`), then the tombstones,
and the ordered delete of the image rows last. Three runs on 2026-10-04 with the intake locking image rows and placing
its holds. The first, before the review, still tombstoned by one ordered statement and met a machine at 9 to 14% busy
(53 and 93 before the two purges of 20,000 rows). The second and the third issue the statements above: the second met
a saturated machine (93 to 100% throughout), so its times say more about the machine than about the change; the third
a quiet one (6 to 16%). "Tombstones" is the lock statement and the update together.

| image rows | frozen | run | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|---|
| 5,000 | no | first | 9% | 170 ms | 891 ms | 5,000 | 1.1 s |
| 5,000 | yes | first | 14% | 120 ms | 827 ms | 0 | 1.0 s |
| 20,000 | no | first | 53% | 603 ms | 4,019 ms | 20,000 | 4.6 s |
| 20,000 | yes | first | 93% | 1,440 ms | 4,249 ms | 0 | 5.7 s |
| 5,000 | no | second | 100% | 481 ms | 3,136 ms | 5,000 | 3.6 s |
| 5,000 | yes | second | 100% | 309 ms | 3,423 ms | 0 | 3.8 s |
| 20,000 | no | second | 100% | 1,934 ms | 8,112 ms | 20,000 | 10.1 s |
| 20,000 | yes | second | 100% | 2,249 ms | 8,467 ms | 0 | 10.7 s |
| 5,000 | no | third | 16% | 91 ms | 827 ms | 5,000 | 0.9 s |
| 5,000 | yes | third | 6% | 103 ms | 730 ms | 0 | 0.8 s |
| 20,000 | no | third | 13% | 442 ms | 2,207 ms | 20,000 | 2.7 s |
| 20,000 | yes | third | 13% | 481 ms | 1,977 ms | 0 | 2.5 s |

Locking the posts first costs nothing that shows: at 5,000 posts the lock statement and the update together took 91
and 103 ms, where the one ordered statement took 170 and 120 ms.

The 18 pairs of 40 rounds: in every run each transaction completed, with no deadlock and no lock timeout; the longest
transaction was 137 ms in the first (12% busy), 562 ms in the second (100% busy) and 116 ms in the third (13% busy).
The account's seal taken while deciding: 84 ms at 1,000 image posts and 2.2 s at 5,000 in the first run (13% busy; 0.4
and 1.1 s in Task 2's runs), 361 ms and 3.3 s in the second, 58 and 156 ms in the third.

### What the lab's tests found

- **A batch that was not one.** `dropDisposable` as the design writes it (`delete from post_media where id in (select
  ... order by id limit $1 for update)`) can delete more than its limit. When the planner joins the delete's rows to
  the sub-select by a nested loop, the sub-select runs again for every row; each run skips the rows this statement has
  deleted already and lets the next ones in. On a fresh test database one call deleted all 60 disposable rows under a
  limit of 25, and with hash joins, merge joins, materialising, hashed aggregation and sorting switched off it deleted
  33 of 36. The repository therefore chooses the batch in a materialized common table expression, which runs once
  whatever the plan (`with batch as materialized (select ... order by m.id limit $1 for update of m) delete from
  post_media where id in (select id from batch) returning id`); `media-cases.test.ts` holds the bound under those
  planner settings. The ordered deletes of the author's deletion and the purge have no limit, so the same re-run changes
  nothing they delete.
- **The freeze read for every row.** The disposal's two statements, above.
- **The purge and its own posts.** The staged rounds, above.

## The numbers of 2026-10-09: the R4 redaction (migration 0018)

`contention.lab.ts` gains one test for `redact_r4_body` (3c design, sections 2 and 6.4): the redaction takes its
decision's case, then the post, then the post's images in id order, the order of `moderation_apply` and of an intake's
locks, and the design asks for it to be measured against both. The post has four images. Its R4 removal is the one
thing this lab confirms with a real staff key (the software authenticator, as `decideForTest` does), because a
redaction acts only on a committed decision; it is dated back seven months, so that it is final for its author. The
redaction itself, and everything that runs against it, is rolled back in every round, so each round finds the decision
due again. The removal's case goes with the lab's accounts at the end; its one audit row stays, as every real
decision's does. Run alone with `-t "the R4 redaction"`.

Two runs: the test alone on a machine busy with other work (`busyPercent` 82), then the whole file on a quieter one
(`busyPercent` 22; the whole file took 122 s).

| the redaction against | rounds | redaction | other side | longest transaction, busy | longest, quieter |
|---|---|---|---|---|---|
| (alone, one session) | 1 | ok | | 67 ms | 29 ms |
| an interim withhold on the post's other, open case, whose trigger runs `moderation_apply` on the post | 40 | 40 ok | 40 ok | 233 ms | 68 ms |
| a report under a rule, which locks the post `FOR SHARE` and holds its images | 40 | 40 ok | 40 ok | 125 ms | 104 ms |
| a notice of child sexual abuse material naming the post and its author's account, which locks the images through both | 40 | 40 ok | 40 ok | 123 ms | 83 ms |

- No deadlock and no refusal in 120 rounds of either run, each side first in half of them. The redaction and a decision on the post's
  other case meet at the post's row, which both take `FOR UPDATE` before any image row; the redaction and a report meet
  there too (`FOR UPDATE` against `FOR SHARE`); a notice that reaches the images through the account takes them
  `FOR KEY SHARE`, which the redaction's `FOR NO KEY UPDATE` does not wait for.
- That last pair is the one the design accepts as a race and not as a wait (6.4): a report about the author's account
  that commits between the redaction's check of the freeze and its erasure of the snapshots leaves the body blank, the
  snapshots kept and the decision unmarked, and the round after the answer finishes it. The database test of
  `redact_r4_body` stages exactly that.

## orders/: the lab of authorities' orders (sub-project 3f)

`orders/` is the lab the 3f design rests on (its section 3, LAB A to F), copied here unchanged but for its line ends from
`korbat-scratch/research-3e/lab-3f/`, which lies outside the repository: `RUN.txt` holds every command and the machine it
ran on, `make_proto.py` and `20-tables.sql` the prototype of the design's sections 6.2 and 6.3, `21-helpers.sql` the
API's statements, the lettered SQL files the labs themselves, and `out-*.txt` their raw outputs. It ran on a throwaway
cluster of PostgreSQL 18.1 over the migrations 0000 to 0016. The task that builds the ledger's migration of 3f runs it
again on the 18.6 image, as `RUN.txt` lists it, and compares the outputs.
