# korbat Foundation — Task 6 of 16: `@korbat/db` trust and safety tables

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform whose credibility rests on transparent moderation. Content is actioned only for one of six public rules (R1 sexual content, R2 CSAM, R3 targeted hatred on protected traits, R4 doxxing, R5 direct threats, R6 spam/impersonation). Every action is a `case` with a rule ID and a `public_reason` the author reads verbatim; the author can file exactly one `appeal` per case, reviewed by a different moderator; every closed case is copied, without any user identifier, into a public `transparency_log`; and every moderator or admin action is written to an append-only `audit_log`. Reports carry a `weight` derived from reporter reputation; a spike of reports from accounts that follow each other marks a case with `brigading_flag` and routes it to the senior queue to protect the target rather than punish them.

The backend is a self-owned TypeScript API (Hono + Drizzle ORM) on our own Postgres 16 with three roles; the public API role is `korbat_api`. RLS is on for every table. This task adds the six trust-and-safety tables to `@korbat/db`. The `audit_log` gets INSERT and SELECT policies only, and Task 7's grants migration additionally revokes UPDATE/DELETE/TRUNCATE from `korbat_api`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: drizzle-orm 0.45.2, vitest 4.1.11, typescript 5.9.3.
- Drizzle notes: `pgPolicy(name, { for: "insert" | "select" | "all", to: role, using?, withCheck? })`; policy objects returned by `getTableConfig(t).policies` expose `.for`; `getTableConfig(t).indexes[i].config` has `.name` and `.unique`; `bigserial("id", { mode: "number" })` and `jsonb("metadata")` come from `drizzle-orm/pg-core`.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 6).

## Preconditions

`git log --oneline -1` must show `feat(db): identity and content tables`. `packages/db/src/schema/{helpers,auth,identity,content}.ts` must exist and `pnpm --filter @korbat/db test` must pass with 5 tests. If `safety.ts` already exists, verify it matches, fix drift, run tests, skip to the report.

## Rules

1. Test first: append the tests, run, see the table-count test fail (14 instead of 20), implement, run, see all pass.
2. Exact file contents below; keep snake_case column names exactly.
3. Do not add tables beyond `cases`, `reports`, `appeals`, `strikes`, `transparency_log`, `audit_log`.
4. Do not modify the other schema files.
5. LF line endings, 2-space indentation.
6. Verify before claiming; paste real output.
7. Commit exactly once with the given message and trailer.

## Files

### Append to `packages/db/test/schema.test.ts` (FIRST)
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

### Append to `packages/db/src/schema/index.ts`
```ts
export * from "./safety";
```

## Steps

1. Append the tests.
2. Run `pnpm --filter @korbat/db test`. Expected: the "20 tables" test fails with 14; the other three new tests fail on undefined.
3. Create `safety.ts`; append the export to `index.ts`.
4. Run `pnpm --filter @korbat/db test`. Expected: `Tests  9 passed`.
5. Run `pnpm --filter @korbat/db typecheck`. Expected: exits 0.
6. Commit:
```bash
git add -A && git commit -m "feat(db): trust and safety tables, append-only audit log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created/modified
- Output of the failing run (step 2), passing run (step 4), typecheck (step 5)
- Deviations and why (e.g. if `policies[i].for` is named differently in this drizzle version, say what you used)
- Anything blocked or uncertain
