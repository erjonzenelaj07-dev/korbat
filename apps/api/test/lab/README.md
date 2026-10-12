# The contention lab of moderation decisions

`contention.lab.ts` measures what a decision's transaction costs and what it meets (3c design, sections 2 and 12),
against the test database with migration 0016. The design names no place for it; it lives here.

It is a database lab. It issues its statements itself, as SQL: a decision is the lock on its subject's profile row, its
row in `decisions` and its rows in `decision_actions`, whose triggers do the rest; a like, a follow, the author's
deletion and the purge are the statements the social and media repositories issue; the purge's delete is the ordered
delete by owner (`delete from post_media where id in (select id from post_media where owner_id = $1 order by id for
update) returning id`). An intake is the moderation module's `recordIntake`. It uses no code of a later task.

Every measured transaction is rolled back, so the lab leaves no decision and writes no audit row. The accounts it commits
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
