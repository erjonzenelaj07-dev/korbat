# korbat Foundation — Task 3 of 16: `@korbat/rules`

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform where content is removed only for one of six public rules, always by a human who cites the rule and writes a reason the author can read and appeal. `@korbat/rules` is the rulebook as data: the app renders it, every moderation case stores a `rule_id` from it, and the public transparency page groups counts by it. This task creates the package with the six rules, their examples, and their automation policy (the contract for what software may do without a human).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: vitest 4.1.11, typescript 5.9.3. No runtime dependencies.

## Preconditions

`git log --oneline -1` must show `feat(contracts): error envelope, health and pagination schemas`. If `packages/rules/` already exists, compare with this prompt, fix drift, run steps 5 to 7, and report.

## Rules (read twice)

1. Copy every file below byte for byte. The rule text is product policy; do not reword it.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine: timings, colours, the pnpm progress line, the `npm warn Unknown project config "node-linker"` line, git's CRLF warnings. A different test count, any unexpected `error`, `ERR_`, or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Never commit `.env` files or `node_modules`.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `packages/rules/package.json`
```json
{
  "name": "@korbat/rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "5.9.3" }
}
```

### `packages/rules/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

### `packages/rules/test/rules.test.ts`
```ts
import { describe, expect, test } from "vitest";
import { RULES, getRule, isRuleId } from "../src/index";

describe("rulebook", () => {
  test("has exactly six rules R1..R6 in order", () => {
    expect(RULES.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
  test("every rule has text and at least one example on each side", () => {
    for (const r of RULES) {
      expect(r.title.length, r.id).toBeGreaterThan(5);
      expect(r.text.length, r.id).toBeGreaterThan(40);
      expect(r.notAllowed.length, r.id).toBeGreaterThan(0);
      expect(r.allowed.length, r.id).toBeGreaterThan(0);
    }
  });
  test("only R2 is fully automated; only R1 is auto-withheld", () => {
    expect(RULES.filter((r) => r.automation === "auto_remove").map((r) => r.id)).toEqual(["R2"]);
    expect(RULES.filter((r) => r.automation === "withhold_for_review").map((r) => r.id)).toEqual(["R1"]);
  });
  test("getRule and isRuleId", () => {
    expect(getRule("R3")?.title).toMatch(/hatred/i);
    expect(getRule("R9")).toBeUndefined();
    expect(isRuleId("R6")).toBe(true);
    expect(isRuleId("x")).toBe(false);
  });
});
```

### `packages/rules/src/index.ts`
```ts
/**
 * The public rulebook. This is the complete list of reasons content can be
 * actioned on korbat. Opinions are never a reason. Every moderation case
 * cites exactly one of these IDs.
 */
export type Automation =
  | "none"                 // report-driven, human decides
  | "withhold_for_review"  // automation may hide from others pending a human
  | "auto_remove";         // automation may remove (R2 only)

export interface Rule {
  id: string;
  title: string;
  text: string;
  allowed: string[];
  notAllowed: string[];
  automation: Automation;
  seniorQueue: boolean;
}

export const RULES = [
  {
    id: "R1",
    title: "No sexual or pornographic content",
    text: "Images or text whose primary purpose is sexual arousal are not allowed. This includes nudity presented sexually, explicit sexual acts, and sexualised depictions of anyone. Images that score high on the automated check are hidden from others until a person reviews them; the author can always see their own post.",
    allowed: ["Medical or educational discussion of sexuality without explicit imagery", "Art with non-sexual nudity in a clearly artistic or historical context", "Frank discussion of sexual politics or policy"],
    notAllowed: ["Pornographic images or video", "Sexually explicit text posted for arousal", "Links whose preview is pornographic"],
    automation: "withhold_for_review",
    seniorQueue: false,
  },
  {
    id: "R2",
    title: "No child sexual abuse material",
    text: "Any sexualised depiction of a minor is removed automatically on a hash match, the account is suspended, and the material is reported to the relevant authority. This is the only rule enforced without a human decision first. Appeals are reviewed by a senior moderator.",
    allowed: ["Reporting or discussing child safety issues without imagery", "News about arrests or legislation"],
    notAllowed: ["Any sexualised image of a minor, real or generated", "Links to such material", "Solicitation"],
    automation: "auto_remove",
    seniorQueue: true,
  },
  {
    id: "R3",
    title: "No targeted hatred or harassment based on protected traits",
    text: "Attacking a person or group because of race, ethnicity, national origin, religion, disability, sex, sexual orientation, or gender identity is not allowed. Criticising ideas, beliefs, policies, institutions, public figures, or the actions of groups is allowed, even harshly. The line is attacking people for what they are, not disagreeing with what they think or do.",
    allowed: ["Criticism of any religion's doctrine or any government's policy", "Arguing that a political movement is wrong or harmful", "Blunt, offensive, or unpopular opinions about ideas"],
    notAllowed: ["Slurs directed at a person or group", "Calling for a protected group to be harmed or excluded", "Sustained pile-ons against one person because of a protected trait"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R4",
    title: "No doxxing",
    text: "Publishing someone's private information without consent is not allowed: home address, phone number, private email, workplace details intended to enable harassment, financial or ID documents, or private images. When a report is credible the post is hidden from others while a person decides, because the harm is immediate.",
    allowed: ["Public business contact details", "Information a public figure has published about themselves", "Linking to public court records in a news context"],
    notAllowed: ["Posting someone's home address or phone number", "Sharing private messages or images without consent", "Coordinating to find where someone lives"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R5",
    title: "No direct threats of violence",
    text: "Stating an intent to physically harm a specific person or group, or calling for others to do so, is not allowed. Hyperbole, dark humour, and discussion of violence in news, history, or fiction are allowed. Cases go to the senior queue.",
    allowed: ["Discussing wars, crimes, or historical violence", "Obvious hyperbole ('I could kill for a coffee')", "Fiction and satire"],
    notAllowed: ["'I will hurt you' directed at a person", "Calling for a named person to be attacked", "Posting a target list"],
    automation: "none",
    seniorQueue: true,
  },
  {
    id: "R6",
    title: "No spam, scams, or impersonation",
    text: "Repetitive unsolicited posting, deceptive schemes, malware links, and pretending to be another person or organisation are not allowed. Parody and fan accounts are fine when clearly labelled.",
    allowed: ["Promoting your own work in your own posts", "Clearly labelled parody accounts", "Sharing a link once in a relevant thread"],
    notAllowed: ["Posting the same link across many threads", "Phishing or crypto giveaway scams", "An account presenting itself as a real person or brand it is not"],
    automation: "none",
    seniorQueue: false,
  },
] as const satisfies readonly Rule[];

export type RuleId = (typeof RULES)[number]["id"];

const byId = new Map<string, Rule>(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule | undefined {
  return byId.get(id);
}

export function isRuleId(id: string): id is RuleId {
  return byId.has(id);
}
```
(This file typechecks as written under TypeScript 5.9.3; it was verified. Do not change `string[]` to `readonly string[]`.)

## Steps

1. Create `packages/rules/package.json`, `packages/rules/tsconfig.json`, `packages/rules/test/rules.test.ts`. Do not create `src/index.ts` yet.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`.
3. Run:
   ```bash
   pnpm --filter @korbat/rules test
   ```
   Expected: FAILS with `Failed to resolve import "../src/index"` (or `Cannot find module`). If it passes, STOP.
4. Create `packages/rules/src/index.ts`.
5. Run:
   ```bash
   pnpm --filter @korbat/rules test
   ```
   Expected: `Tests  4 passed (4)`.
6. Run:
   ```bash
   pnpm --filter @korbat/rules typecheck
   ```
   Expected: no `error TS` lines.
7. Run:
   ```bash
   pnpm test
   ```
   Expected: contracts `Tests  6 passed (6)` and rules `Tests  4 passed (4)`.
8. Commit:
   ```bash
   git add -A && git commit -m "feat(rules): public rulebook R1-R6 as data

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
9. Run `git log --oneline -1`. Expected subject: `feat(rules): public rulebook R1-R6 as data`.

## Report format (mandatory)

```
TASK 3 REPORT
Files created: <list>
Step 3 output (the failure line): <paste>
Step 5 output (Tests line): <paste>
Step 6 output: <paste or "clean">
Step 9 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
