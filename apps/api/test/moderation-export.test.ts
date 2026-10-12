import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ExportFormat, OUTCOME_PHRASES, UNSEEN_NO_ACTION, itemOutcomeWords, type DecisionStatement, type NoticeItemStatus } from "@korbat/contracts";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createModeration, type CreateModerationOptions } from "../src/moderation";
import { exportedDecision } from "../src/moderation/author";
import { exportedItem } from "../src/moderation/reports";

/**
 * The export's moderation member without a database (3c design, sections 7.11 and 11): which files it is built in, so
 * that a decision's entry can never reach a report; how one decision and one item of a report are written from what the
 * account's own screens read; and that the module hands the member's read to the account module. The reads themselves
 * run on PostgreSQL in test/integration/moderation-export.test.ts.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("where the member is built", () => {
  test("its decisions come from the author's reads and its reports from the reporter's list's file; the file that joins them holds no query and names no table of reports", () => {
    const joined = read("moderation/export.ts");
    expect(joined).toMatch(/import \{ exportedDecisions \} from "\.\/author";/);
    expect(joined).toMatch(/import \{ exportedReports \} from "\.\/reports";/);
    expect(joined).not.toMatch(/\bsql\b|drizzle-orm|from "\.\/(repo|author-repo|intake|access)"/);
    expect(/\b(intakes|intakeItems|intake_items)\b/.test(joined)).toBe(false);
    // The author's file builds the decisions' entries, and it may name no report (test/moderation-author.test.ts holds it to that).
    expect(read("moderation/author.ts")).toMatch(/export async function exportedDecisions\(/);
    expect(read("moderation/reports.ts")).toMatch(/export async function exportedReports\(/);
  });

  test("a decision's entry is built from the list's row and the statement's data alone: what its author's screens show", () => {
    const author = read("moderation/author.ts");
    const built = author.slice(author.indexOf("export async function exportedDecisions("));
    expect(built).toMatch(/authorDecisions\(/);
    expect(built).toMatch(/decisionStatement\(/);
  });

  test("the module hands the account module its two operations: forgetting a deleted account's reports, and the export's member", () => {
    const untouched = new Proxy({}, { get: () => () => Promise.reject(new Error("nothing is read while the module is built")) });
    const options: CreateModerationOptions = {
      apiDb: untouched as CreateModerationOptions["apiDb"],
      auth: untouched as CreateModerationOptions["auth"],
      social: untouched as CreateModerationOptions["social"],
      media: untouched as CreateModerationOptions["media"],
      rateLimitStore: new MemoryStore(),
      config: { APP_ORIGIN: "http://localhost:8081" } as CreateModerationOptions["config"],
      logger: pino({ level: "silent" }),
    };
    expect(Object.keys(createModeration(options).forAccount).sort()).toEqual(["exportFor", "forgetAccount"]);
    // The server hands that interface to the account module.
    expect(read("index.ts")).toMatch(/createAccount\(\{[^}]*\bmoderation: moderation\.forAccount\b/);
  });
});

describe("one decision as the export writes it", () => {
  const statement: DecisionStatement = {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R3",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post calls for a named group to be excluded.",
    reason: "That is an attack on people for what they are.",
    source: "report",
    decidedAt: "2026-09-12T08:30:00.000Z",
    post: { id: id(2), createdAt: "2026-09-01T10:00:00.000Z" },
    measures: [
      { kind: "remove", mediaId: null, noEffect: null, sealed: null },
      { kind: "seal_media", mediaId: null, noEffect: "already", sealed: { posts: 1, images: 2, deletedImages: 0 } },
    ],
    reversals: [],
    endedMeasures: [{ kind: "withhold", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }],
    reviewed: null,
  };
  const row = { id: id(10), decidedOn: "2026-09-12", post: { id: id(2), createdAt: "2026-09-01T10:00:00.000Z" }, appeal: null };
  const inFormat = (entry: unknown) => ExportFormat.shape.moderation.shape.decisions.element.parse(entry);

  test("it carries the day, the post, the kind, the outcome, the ground, the rule and its version, each measure with whether it changed anything, and the statement's texts; the format reads it whole", () => {
    const entry = exportedDecision(row, statement);
    expect(entry).toEqual({
      id: id(10),
      decidedOn: "2026-09-12",
      postId: id(2),
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 2,
      measures: [
        { kind: "remove", mediaId: null, noEffect: null },
        { kind: "seal_media", mediaId: null, noEffect: "already" },
      ],
      reversals: [],
      facts: statement.facts,
      reason: statement.reason,
      legalReference: null,
      appeal: null,
    });
    expect(inFormat(entry)).toStrictEqual(entry);
    // The statement's source, its time to the second, what a seal covered and what ended with it are the screen's, not the export's.
    expect(Object.keys(entry)).toEqual(["id", "decidedOn", "postId", "kind", "outcome", "ground", "ruleId", "rulesVersion", "measures", "reversals", "facts", "reason", "legalReference", "appeal"]);
  });

  test("a decision about the account names no post; a correction's reversals are listed, and a text the statement does not hold is null", () => {
    const correction: DecisionStatement = { ...statement, kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: null, post: null, measures: [], reversals: [{ kind: "restore_bio", mediaId: null, resetDecisionId: id(11), oldValueKept: true, resetRuleId: "R6" }], endedMeasures: [] };
    const entry = exportedDecision({ ...row, post: null }, correction);
    expect(entry).toMatchObject({ postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null });
    expect(inFormat(entry)).toStrictEqual(entry);
    // The reset's facts (the decision that reset the field, its rule) are the statement's sentence, not a member of the entry.
    expect(JSON.stringify(entry)).not.toContain(id(11));
  });

  test("the appeal is pending without a result, or answered with the review's result", () => {
    expect(exportedDecision({ ...row, appeal: "pending" }, statement).appeal).toEqual({ state: "pending", result: null });
    for (const result of ["kept", "partly_reversed", "reversed"] as const) {
      const entry = exportedDecision({ ...row, appeal: result }, statement);
      expect(entry.appeal).toEqual({ state: "answered", result });
      expect(inFormat(entry)).toStrictEqual(entry);
    }
  });
});

describe("one item of a report as the export writes it", () => {
  const waiting: NoticeItemStatus = { position: 1, link: `http://localhost:8081/post/${id(3)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
  const inFormat = (entry: unknown) => ExportFormat.shape.moderation.shape.reports.element.shape.items.element.parse(entry);

  test("before the daily release it carries its place and its link and nothing of an outcome, decided or not", () => {
    const entry = exportedItem(waiting);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null });
    expect(inFormat(entry)).toStrictEqual(entry);
  });

  test("released, it carries the outcome, the words the list of reports reads for it, and whether a re-examination is open", () => {
    const released: NoticeItemStatus = { ...waiting, outcome: "no_violation", decidedOn: "2026-09-12", reexamination: { open: true, until: "2027-03-12T00:00:00.000Z" } };
    const entry = exportedItem(released);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: false, outcome: "no_violation", outcomeText: `${OUTCOME_PHRASES.no_violation}.`, reexaminationOpen: true });
    expect(entry.outcomeText).toBe(itemOutcomeWords(released));
    expect(inFormat(entry)).toStrictEqual(entry);
    // Asked already, or past its window: no longer open.
    expect(exportedItem({ ...released, reexamination: { open: false, until: "2027-03-12T00:00:00.000Z" } }).reexaminationOpen).toBe(false);
    // An outcome that cannot be examined again at all.
    const restricted: NoticeItemStatus = { ...waiting, outcome: "restricted_rule", decidedOn: "2026-09-12", rule: { id: "R3", title: "No targeted hatred or harassment based on protected traits" } };
    expect(exportedItem(restricted)).toMatchObject({ outcome: "restricted_rule", outcomeText: "access restricted: it breaks korbat rule R3 (No targeted hatred or harassment based on protected traits).", reexaminationOpen: false });
  });

  test("an answer given while nobody could open the post's images reads as the list reads it, never as a finding of no breach; a re-examination is marked", () => {
    const unseen: NoticeItemStatus = { ...waiting, unseen: true, reexamines: true, outcome: "no_violation", decidedOn: "2026-09-12", reexamination: { open: true, until: "2027-03-12T00:00:00.000Z" } };
    const entry = exportedItem(unseen);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: true, outcome: "no_violation", outcomeText: UNSEEN_NO_ACTION, reexaminationOpen: true });
    expect(inFormat(entry)).toStrictEqual(entry);
  });
});
