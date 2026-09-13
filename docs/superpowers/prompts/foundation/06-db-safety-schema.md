# korbat Foundation — Task 6 of 16: `@korbat/db` trust and safety tables

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat's credibility rests on transparent moderation. Content is actioned only for one of six public rules. Every action is a `case` with a rule ID and a `public_reason` the author reads verbatim; the author can file exactly one `appeal` per case, reviewed by a different moderator; every closed case is copied, without any user identifier, into a public `transparency_log`; every moderator or admin action is written to an append-only `audit_log`. Reports carry a `weight` from reporter reputation; a report spike from accounts that follow each other sets `brigading_flag` and routes the case to the senior queue to protect the target.

The backend is a self-owned TypeScript API (Hono + Drizzle ORM) on our own Postgres 16; the public API role is `korbat_api`. This task adds the six trust-and-safety tables. `audit_log` gets INSERT and SELECT policies only; Task 7's grants migration additionally revokes UPDATE/DELETE/TRUNCATE.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: drizzle-orm 0.45.2, vitest 4.1.11, typescript 5.9.3.

## Preconditions

`git log --oneline -1` must show `feat(db): identity and content tables`. `pnpm --filter @korbat/db test` passes 5 tests. If `packages/db/src/schema/safety.ts` exists, compare with this prompt, fix drift, run steps 4 and 5, and report.

## Rules (read twice)

1. Copy every file below byte for byte.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine. A different test count, any unexpected `error TS` or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not modify the other schema files or existing tests.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files

### Append to the END of `packages/db/test/schema.test.ts`
```ts

describe("trust and safety schema", () => {
  test("there are 20 tables in total", () => {
    expect(tables.length).toBe(20);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
  });
});
```

### Create `packages/db/src/schema/safety.ts`
```ts
import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgPolicy, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const targetType = pgEnum("target_type", ["post", "profile"]);
export const reportStatus = pgEnum("report_status", ["open", "merged", "closed"]);
export const caseAction = pgEnum("case_action", ["none", "withhold", "remove", "strike", "suspend"]);
export const appealStatus = pgEnum("appeal_status", ["open", "upheld", "denied"]);

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull().default("none"),
    /** Shown verbatim to the author. Required for any action other than none. */
    publicReason: text("public_reason").notNull().default(""),
    moderatorId: uuid("moderator_id").references(() => profiles.id, { onDelete: "set null" }),
    senior: boolean("senior").notNull().default(false),
    brigadingFlag: boolean("brigading_flag").notNull().default(false),
    /** Sum of reporter weights, used for queue ordering. */
    weight: integer("weight").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [index("cases_open_idx").on(t.closedAt, t.weight, t.createdAt), index("cases_target_idx").on(t.targetType, t.targetId), fullAccess("cases_api_all", apiRole)],
).enableRLS();

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    details: text("details").notNull().default(""),
    /** Derived from reporter reputation at report time. */
    weight: integer("weight").notNull().default(1),
    status: reportStatus("status").notNull().default("open"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_reporter_target_idx").on(t.reporterId, t.targetType, t.targetId),
    index("reports_target_idx").on(t.targetType, t.targetId),
    fullAccess("reports_api_all", apiRole),
  ],
).enableRLS();

export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    status: appealStatus("status").notNull().default("open"),
    /** Must differ from cases.moderator_id; enforced in the API and covered by an integration test. */
    reviewerId: uuid("reviewer_id").references(() => profiles.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
  },
  (t) => [uniqueIndex("appeals_case_idx").on(t.caseId), fullAccess("appeals_api_all", apiRole)],
).enableRLS();

export const strikes = pgTable(
  "strikes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("strikes_user_active_idx").on(t.userId, t.expiresAt), fullAccess("strikes_api_all", apiRole)],
).enableRLS();

/** Public, anonymised copy of every closed case. No user ids by design. */
export const transparencyLog = pgTable(
  "transparency_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull(),
    targetType: targetType("target_type").notNull(),
    decidedAt: ts("decided_at").notNull(),
    appealed: boolean("appealed").notNull().default(false),
    appealOutcome: appealStatus("appeal_outcome"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("transparency_decided_idx").on(t.decidedAt), fullAccess("transparency_api_all", apiRole)],
).enableRLS();

/** Append-only. UPDATE/DELETE are also revoked at the grant level in migration 0001. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  () => [
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();
```

### Append to the END of `packages/db/src/schema/index.ts`
```ts
export * from "./safety";
```

## Steps

1. Append the tests.
2. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: `Tests  4 failed | 5 passed (9)`, including `AssertionError: expected 14 to be 20`. If all 9 pass, STOP.
3. Create `safety.ts`; append the export line to `index.ts`.
4. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: `Tests  9 passed (9)`.
5. Run:
   ```bash
   pnpm --filter @korbat/db typecheck
   ```
   Expected: no `error TS` lines.
6. Commit:
   ```bash
   git add -A && git commit -m "feat(db): trust and safety tables, append-only audit log

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
7. Run `git log --oneline -1`. Expected subject: `feat(db): trust and safety tables, append-only audit log`.

## Report format (mandatory)

```
TASK 6 REPORT
Files created/modified: <list>
Step 2 output (Tests line + the 'expected 14 to be 20' line): <paste>
Step 4 output (Tests line): <paste>
Step 5 output: <paste or "clean">
Step 7 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
