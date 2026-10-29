import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Link, router } from "expo-router";
import { MEASURES, type DecisionView, type MeResponse, type PostView } from "@korbat/contracts";
import { STATEMENT_WORDS, getRedress, getRule } from "@korbat/rules";
import { ErrorState } from "@/components/kit/ErrorState";
import { dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { LABEL_TONE, buttonFace } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { appealWaitWords, chipText, moderation, utcMinute } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS as W } from "@/lib/moderation-words";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { fullDate } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { AskPerson } from "./DecisionDetail";
import { CaseLink, leaveBy } from "./parts";

/**
 * The details sheet of the author's moderation chip (UI design, sections 6.8, 6.13 and 8.7; decision 11): what korbat
 * decided about the reader's own post, read from GET /api/moderation/decisions/:id each time the sheet opens and kept in
 * this component's state only (no store, no cache), as the post's own data carries only the chip's facts. Each fact is a
 * labelled block, in the design's order: Rule, What it does, Applies to, Who can see it now, Decided by, When, Statement,
 * Appeal; while an appeal can still be filed, Appeal comes first, with the one action the sheet offers. Its words are the
 * decision screen's and the rulebook's, never new judgements: the rule at the version the decision was made under, the
 * statement's own "korbat removed your post of ..." sentences, and "Decided by" in role terms only (review ruling 5).
 */

/** The blocks, by key; `data-status-block` names each on the web, so a test reads their order. */
export type StatusBlockKey = "appeal" | "rule" | "does" | "appliesTo" | "whoSees" | "decidedBy" | "when" | "statement";

/**
 * Where the appeal stands, the first that applies: an order's notice offers no appeal (3f; OrderNotice), an answered or
 * a pending appeal, one that can still be filed (`appealUntil` set, none filed), a decision reversed in full, a decision
 * taken while korbat decides (its interim redress sentence), or nothing to say.
 */
export type AppealState = "none" | "open" | "pending" | "answered" | "reversed" | "interim";

export function appealState(view: DecisionView): AppealState {
  if (view.source === "order" || view.order) return "none";
  if (view.appeal?.state === "answered") return "answered";
  if (view.appeal?.state === "pending") return "pending";
  if (view.appealUntil !== null) return "open";
  if (view.reversedOn !== null) return "reversed";
  if (view.kind === "interim") return "interim";
  return "none";
}

/**
 * "Decided by" in role terms (review ruling 5): an authority's order for an order; korbat's automated check only for a
 * decision DecisionView marks fully automated, a decision without a decider, never because the field is merely set
 * ("partially" is a restriction an admin took on a program's finding); otherwise a korbat moderator. No name, ever.
 */
export function decidedBy(view: Pick<DecisionView, "source" | "automatedDecision">): string {
  if (view.source === "order") return W["status.byOrder"];
  if (view.automatedDecision === "fully") return W["status.byProgram"];
  return W["status.byPerson"];
}

/** The scope said out loud: the account for a decision about no post, the image for a measure on one image, else the post. */
export function appliesTo(view: Pick<DecisionView, "post" | "measures">): string {
  if (view.post === null) return W["status.appliesAccount"];
  if (view.measures.some((measure) => measure.kind.endsWith("_media"))) return W["status.appliesImage"];
  return W["status.appliesPost"];
}

/**
 * The rule as the rulebook named it at the decision's version (a review's or a correction's, the decision it reviewed),
 * or "Illegal content" with the legal reference for a decision on the law. An order names no rule and no law of korbat's
 * judgement (3f), as its row in About you does not; nor does a decision that rests on neither.
 */
export function ruleOf(view: DecisionView): { title: string; reference: string | null } | null {
  if (view.source === "order" || view.order) return null;
  const ruleId = view.ruleId ?? view.reviewed?.ruleId ?? null;
  if (ruleId !== null) {
    const version = view.ruleId !== null ? view.rulesVersion : (view.reviewed?.rulesVersion ?? view.rulesVersion);
    const rule = getRule(ruleId, version);
    return { title: rule ? `${rule.id}: ${rule.title}` : CASES_WORDS.rule(ruleId), reference: null };
  }
  const reference = view.legalReference ?? view.reviewed?.legalReference ?? null;
  if (view.ground === "illegal" || view.reviewed?.ground === "illegal" || reference !== null) return { title: W["status.illegal"], reference };
  return null;
}

/**
 * What the decision does, one sentence a measure, in the statement's own words where the statement has them (the post's
 * and the image's measures, a reset, a seal), and in the measure's label for the account's measures the statement words
 * at length (the decision's screen has them whole).
 */
export function measureLines(view: DecisionView): string[] {
  const post = view.post ? utcMinute(view.post.createdAt) : "";
  const done = STATEMENT_WORDS.done;
  return view.measures.map((measure) => {
    switch (measure.kind) {
      case "withhold":
      case "remove":
      case "withhold_media":
      case "remove_media":
        return done[measure.kind](post);
      case "reset_display_name":
        return done.reset("display_name", view.kind === "interim");
      case "reset_bio":
        return done.reset("bio", view.kind === "interim");
      // 2d Task 4 (7.7): the profile picture, the third field an account case resets.
      case "reset_avatar":
        return done.reset("avatar", view.kind === "interim");
      case "seal_media": {
        const sealed = measure.sealed ?? { posts: 0, images: 0, deletedImages: 0 };
        return view.post ? STATEMENT_WORDS.sealPost(post, sealed.images) : STATEMENT_WORDS.sealAccount(sealed.images, sealed.posts);
      }
      default:
        return MEASURES[measure.kind].label;
    }
  });
}

/** A blank line, which parts a reason's paragraphs; built in code so the file stays free of escapes. */
const BLANK_LINE = String.fromCharCode(10, 10);

/** The reason's first paragraph, which the sheet quotes; the rest is on the decision's screen. */
export function statementLead(view: Pick<DecisionView, "reason">): string | null {
  const first = view.reason?.split(BLANK_LINE)[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}

/** The blocks a decision shows, in their order: Appeal first while it can be filed, else last; a block with nothing to say is left out. */
export function statusBlocks(view: DecisionView): StatusBlockKey[] {
  const blocks: StatusBlockKey[] = [];
  if (ruleOf(view) !== null) blocks.push("rule");
  if (view.measures.length > 0) blocks.push("does");
  blocks.push("appliesTo", "whoSees", "decidedBy", "when", "statement");
  const appeal = appealState(view);
  // A program's decision offers "Ask for a person" in the Appeal block, beside its interim sentence.
  const program = appeal !== "none" || ((view.askPerson ?? null) !== null && view.source !== "order");
  if (appeal === "open") blocks.unshift("appeal");
  else if (program) blocks.push("appeal");
  return blocks;
}

/** One labelled block: its label a level-3 heading in the meta size, which names the group, and what it says under it. */
function Block({ name, label, divided = true, children }: { name: StatusBlockKey; label: string; divided?: boolean; children: ReactNode }) {
  const labelId = useId();
  return (
    <View role="group" aria-labelledby={labelId} {...dataAttribute("status-block", name)} className={cn("gap-1 py-3", divided ? "border-t border-line-low" : undefined)}>
      <Text as="h3" variant="meta" tone="low" nativeID={labelId}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * The Appeal block's content. Open: the deadline and the primary action, a link drawn as the primary Button (it opens
 * the decision's screen with the appeal's field focused, ?appeal=1); interim: the redress sentence of the decision's own
 * version; pending or answered: the decision screen's words; and a program's decision adds "Ask for a person", as the
 * decision's screen offers it.
 */
function AppealContent({ view, onAsk, onLeave }: { view: DecisionView; onAsk?: (text: string) => Promise<void>; onLeave?: (href: string) => void }) {
  const state = appealState(view);
  const appeal = view.appeal;
  return (
    <View className="gap-1">
      {state === "open" && view.appealUntil !== null ? (
        <>
          <Text>{fill(W["status.appealUntil"], { date: fullDate(view.appealUntil) })}</Text>
          <Link href={`/settings/cases/${view.id}?appeal=1`} onPress={leaveBy(`/settings/cases/${view.id}?appeal=1`, onLeave)} asChild>
            <Pressable {...dataAttribute("status-appeal")} className={cn(buttonFace({ face: "primary", size: "md" }), "mt-3 self-start active:opacity-90")}>
              <Text variant="body-strong" tone={LABEL_TONE.primary}>
                {W["status.appeal"]}
              </Text>
            </Pressable>
          </Link>
        </>
      ) : null}
      {state === "interim" ? <Text tone="medium">{getRedress(view.redressVersion)?.interim ?? ""}</Text> : null}
      {state === "pending" && appeal?.state === "pending" ? (
        <>
          <Text tone="medium">{DECISION_WORDS.appealFiled(appeal.filedAt.slice(0, 10))}</Text>
          <Text variant="body-strong">{appealWaitWords(view) ?? DECISION_WORDS.appealWaiting}</Text>
        </>
      ) : null}
      {state === "answered" && appeal?.state === "answered" ? (
        <>
          <Text variant="body-strong">{DECISION_WORDS.appealAnswered(appeal.answeredOn)}</Text>
          <CaseLink href={`/settings/cases/${appeal.answeredBy}`} label={DECISION_WORDS.answerScreen} onLeave={onLeave} />
        </>
      ) : null}
      {state === "reversed" ? <Text tone="medium">{DECISION_WORDS.reversed(view.reversedOn ?? "")}</Text> : null}
      <AskPerson view={view} onAsk={onAsk} framed={false} onLeave={onLeave} />
    </View>
  );
}

/** The blocks of a decision the sheet has read. */
function Blocks({ view, post, me, onAsk, onLeave }: { view: DecisionView; post: PostView; me: MeResponse | null; onAsk?: (text: string) => Promise<void>; onLeave?: (href: string) => void }) {
  const rule = ruleOf(view);
  const lead = statementLead(view);
  const open = appealState(view) === "open";
  // Who can see the post now, in Who sees this's sentences (reach(), section 6.14), without the line that repeats the
  // chip's words, which are the sheet's title; their links stay with Who sees this, since Statement links the decision.
  const chip = post.moderation ? chipText(post.moderation) : null;
  const seen = reach(post, me).lines.filter((line) => line.text !== chip);
  const content: Record<StatusBlockKey, ReactNode> = {
    appeal: <AppealContent view={view} onAsk={onAsk} onLeave={onLeave} />,
    rule: rule ? (
      <>
        <Text variant="body-strong">{rule.title}</Text>
        {rule.reference !== null ? <Text tone="medium">{rule.reference}</Text> : null}
      </>
    ) : null,
    does: (
      <>
        {measureLines(view).map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </>
    ),
    appliesTo: <Text>{appliesTo(view)}</Text>,
    whoSees: (
      <>
        {seen.map((line, index) => (
          <Text key={line.text} tone={index === 0 ? "high" : "medium"}>
            {line.text}
          </Text>
        ))}
      </>
    ),
    decidedBy: <Text>{decidedBy(view)}</Text>,
    when: <Text>{fullDate(view.decidedAt)}</Text>,
    statement: (
      <>
        {lead !== null ? <Text tone="medium">{lead}</Text> : null}
        <CaseLink href={`/settings/cases/${view.id}`} label={W["status.readAll"]} onLeave={onLeave} />
      </>
    ),
  };
  const labels: Record<StatusBlockKey, string> = {
    appeal: W["status.appeal"],
    rule: W["status.rule"],
    does: W["status.does"],
    appliesTo: W["status.appliesTo"],
    whoSees: W["status.whoSees"],
    decidedBy: W["status.decidedBy"],
    when: W["status.when"],
    statement: W["status.statement"],
  };
  return (
    <View className="px-5 pb-3">
      {statusBlocks(view).map((key) =>
        // While it can be filed the appeal stands first, on a raised wash above the other blocks: the sheet's one action.
        key === "appeal" && open ? (
          <View key={key} className="mb-2 rounded-card border border-line-low bg-surface-2 px-4 pb-1">
            <Block name={key} label={labels[key]} divided={false}>
              {content[key]}
            </Block>
          </View>
        ) : (
          <Block key={key} name={key} label={labels[key]}>
            {content[key]}
          </Block>
        ),
      )}
    </View>
  );
}

/** While the decision is read: block shapes hidden from assistive technology, and one polite status in their place. */
function LoadingBlocks() {
  return (
    <View className="px-5 pb-3">
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      {(["38%", "52%", "30%", "64%"] as const).map((width, index) => (
        <View key={index} aria-hidden className="gap-2 border-t border-line-low py-3">
          <Skeleton.Text width="24%" variant="meta" />
          <Skeleton.Text width={width} />
        </View>
      ))}
    </View>
  );
}

export type StatusLoad = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "shown"; view: DecisionView };

/**
 * What the sheet holds, by where its read stands: the loading blocks, ErrorState with "Try again", or the blocks. The
 * Modal draws nothing on a server, so render tests draw this. `onLeave` is a link pressed inside the open sheet.
 */
export function StatusSheetBody({
  load,
  post,
  me,
  onRetry,
  onAsk,
  onLeave,
}: {
  load: StatusLoad;
  post: PostView;
  me: MeResponse | null;
  onRetry: () => void;
  onAsk?: (text: string) => Promise<void>;
  onLeave?: (href: string) => void;
}) {
  if (load.kind === "loading") return <LoadingBlocks />;
  if (load.kind === "failed") return <ErrorState message={load.message} onRetry={onRetry} />;
  return <Blocks view={load.view} post={post} me={me} onAsk={onAsk} onLeave={onLeave} />;
}

/**
 * The sheet, named by the chip's words (`title`, chipText()), which section 8.7 gives no title of its own. It reads the
 * decision each time it opens, and again on "Try again"; "Ask for a person" sends the one message through the decision's
 * objection route and shows the decision as the answer reads it. A link pressed in it closes it, and once it has closed
 * (and the focus is back on the chip) the route changes.
 */
export function StatusSheet({ post, decisionId, title, open, onClose, onClosed }: { post: PostView; decisionId: string; title: string; open: boolean; onClose: () => void; onClosed?: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const [load, setLoad] = useState<StatusLoad>({ kind: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ kind: "loading" });
    moderation.decision(decisionId).then(
      (view) => {
        if (current) setLoad({ kind: "shown", view });
      },
      (err: unknown) => {
        if (current) setLoad({ kind: "failed", message: errorMessage(err) });
      },
    );
    return () => {
      current = false;
    };
  }, [open, decisionId, round]);

  const ask = async (text: string) => {
    const view = await moderation.objection(decisionId, text);
    setLoad({ kind: "shown", view });
  };

  const pending = useRef<string | null>(null);
  const leave = (href: string) => {
    pending.current = href;
    onClose();
  };
  const closed = () => {
    onClosed?.();
    const href = pending.current;
    pending.current = null;
    if (href !== null) router.push(href);
  };

  return (
    <Sheet open={open} onClose={onClose} onClosed={closed} title={title} size="tall">
      <StatusSheetBody load={load} post={post} me={me} onRetry={() => setRound((count) => count + 1)} onAsk={ask} onLeave={leave} />
    </Sheet>
  );
}
