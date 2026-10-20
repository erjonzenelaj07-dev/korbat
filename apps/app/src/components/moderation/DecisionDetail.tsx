import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { OBJECTION_TEXT_MAX, STATEMENT_MAX, type DecisionAppeal, type DecisionContent, type DecisionStatement, type DecisionView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import { Button, ErrorText, Field, Section } from "@/components/ui";
import { SEALED_IMAGE } from "@/components/social/HiddenImage";
import { clampRatio } from "@/components/social/MediaGrid";
import { API_BASE } from "@/lib/api";
import { errorMessage } from "@/lib/api";
import { appealWaitWords, CONTACT_EMAIL, dailyLimitFailure, utcMinute } from "@/lib/moderation";
import { AUTO_WORDS, CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { ORDER_TEXTS } from "@/lib/orders";
import { nowSentence, replyStandsLine, reportingNowLine, restsOnLine, STANDING_TEXTS, standingMeasureOf, strikeLine } from "@/lib/standing";

const Line = ({ children, strong = false }: { children: string; strong?: boolean }) => <Text className={`mt-3 text-base leading-6 ${strong ? "font-semibold text-zinc-100" : "text-zinc-200"}`}>{children}</Text>;
const Note = ({ children }: { children: string }) => <Text className="mt-3 text-sm leading-5 text-zinc-400">{children}</Text>;

/** One field of an account as korbat copied it. */
function FieldValue({ label, value }: { label: string; value: string }) {
  return (
    <Text className="mt-3 text-base leading-6 text-zinc-200">
      <Text className="font-semibold text-zinc-100">{label}</Text> {value.length > 0 ? value : DECISION_WORDS.empty}
    </Text>
  );
}

/**
 * The content a decision was made on, or the reason it is not shown (3c design, section 7.6). A post's text is never
 * sealed, so it stands beside its sealed images, each drawn as the placeholder that tells the author nobody is shown it.
 * The images of a post its author deleted are kept for the case and shown to nobody. Every other image comes from the
 * app's own image route, which serves the author their withheld and removed images too.
 */
function Content({ content }: { content: DecisionContent }) {
  if (content.kind === "r4_redacted") return <Note>{DECISION_WORDS.r4Redacted}</Note>;
  if (content.kind === "erased") return <Note>{content.postKept ? `${DECISION_WORDS.erased(content.contentErasedOn)} ${DECISION_WORDS.postKept}` : DECISION_WORDS.erased(content.contentErasedOn)}</Note>;
  if (content.kind === "account") {
    return (
      <View>
        <FieldValue label={DECISION_WORDS.handle} value={`@${content.handle}`} />
        <FieldValue label={DECISION_WORDS.displayName} value={content.displayName} />
        <FieldValue label={DECISION_WORDS.bio} value={content.bio} />
      </View>
    );
  }
  return (
    <View>
      {content.deletedByAuthor ? <Note>{DECISION_WORDS.deleted}</Note> : null}
      {content.body.length > 0 ? <Line>{content.body}</Line> : <Note>{DECISION_WORDS.noText}</Note>}
      {content.imagesHidden === "sealed"
        ? Array.from({ length: content.imageCount }, (_, index) => (
            <View key={index} className="mt-3 items-center justify-center rounded-lg bg-zinc-900 px-3 py-6">
              <Text className="text-center text-sm leading-5 text-zinc-400">{SEALED_IMAGE}</Text>
            </View>
          ))
        : null}
      {content.imagesHidden === "deleted_by_author" && content.imageCount > 0 ? <Note>{DECISION_WORDS.deletedImages}</Note> : null}
      {content.images.map((image) => (
        <View key={image.id} className="mt-3">
          <View className="overflow-hidden rounded-xl border border-zinc-800" style={{ aspectRatio: clampRatio(image.width, image.height) }}>
            {/* On the web expo-image takes the <img alt> from accessibilityLabel, not from alt. */}
            <Image source={{ uri: `${API_BASE}${image.small}` }} contentFit="cover" accessibilityLabel={image.alt} style={{ width: "100%", height: "100%" }} />
          </View>
          <Text className="mt-1 text-sm leading-5 text-zinc-300">{image.alt}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The statement's paragraphs, or null when this build's rulebook does not hold the version the decision was made under: it
 * is then never rendered as another. An order's notice (3f) reads its authority's words and its erasure fresh with it.
 */
function paragraphsOf(view: DecisionStatement & Partial<Pick<DecisionView, "orderTexts" | "erasedOn">>): string[] | null {
  try {
    return statementParagraphs(view, { texts: view.orderTexts ?? null, erasedOn: view.erasedOn ?? null });
  } catch {
    return null;
  }
}

/** The authority's words a notice holds, each under its label (W.2), in the order the notice names them. */
function authorityWords(view: DecisionView): { label: string; text: string }[] {
  const texts = view.orderTexts ?? null;
  if (texts === null) return [];
  const labelled: [string | null, string][] = [
    [texts.reasons, ORDER_NOTICE.reasonsLabel],
    [texts.redress, ORDER_NOTICE.redressLabel],
    [texts.scope, ORDER_NOTICE.scopeLabel],
  ];
  return labelled.flatMap(([text, label]) => (text === null ? [] : [{ label, text }]));
}

/**
 * 3f (design, section 9.3): the notice of an authority's order, and of the reinstatement after one. Its title says what it
 * is; its paragraphs are ORDER_NOTICE's, rendered by statementParagraphs from the statement's data read fresh; the
 * authority's words stand whole in a block of their own; the post is never shown while the order's measure stands; and no
 * appeal is offered: in its place, where the order can be challenged, how korbat's own mistake is put right, and that
 * the notice grows.
 */
function OrderNotice({ view }: { view: DecisionView }) {
  const paragraphs = paragraphsOf(view);
  const words = authorityWords(view);
  return (
    <View role="article">
      <Text accessibilityRole="header" aria-level={1} className="text-lg font-semibold text-zinc-50">
        {ORDER_TEXTS.notice.title}
      </Text>
      {view.post ? <Text className="mt-1 text-base text-zinc-300">{DECISION_WORDS.post(utcMinute(view.post.createdAt))}</Text> : null}
      <View className="mt-2">{paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}</View>
      {words.length > 0 ? (
        <View role="group" aria-label={ORDER_NOTICE.wordsBlock} className="mt-4 rounded-lg border border-zinc-700 px-3 pb-3">
          <Text className="mt-3 text-sm font-semibold text-zinc-300">{ORDER_NOTICE.wordsBlock}</Text>
          {words.map((entry) => (
            <View key={entry.label}>
              <Line strong>{entry.label}</Line>
              <Line>{entry.text}</Line>
            </View>
          ))}
        </View>
      ) : null}
      {view.content === null ? (
        // 3f's review (people5): a DSA order that does not withhold leaves the post to its author, and the note says so.
        <Note>{view.order?.withholdAuthor === false ? ORDER_TEXTS.notice.noContentRemoved : ORDER_TEXTS.notice.noContent}</Note>
      ) : (
        <Section title={DECISION_WORDS.content}>
          <Content content={view.content} />
        </Section>
      )}
      <Note>{ORDER_TEXTS.notice.noAppeal}</Note>
      {view.kind === "order" ? <Note>{ORDER_TEXTS.notice.wrongItem(CONTACT_EMAIL)}</Note> : null}
      <Note>{ORDER_TEXTS.notice.fresh}</Note>
    </View>
  );
}

/**
 * The appeal's form (3c design, section 9): an optional statement, free of form, and the button. The request is a POST
 * the screen sends; a refusal is worded under the button, and what was written stays.
 */
function AppealForm({ onAppeal }: { onAppeal: (statement: string) => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAppeal(statement);
    } catch (err) {
      setError(dailyLimitFailure(err, "appeals"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Note>{DECISION_WORDS.appealHint}</Note>
      <Field label={DECISION_WORDS.appealStatement} value={statement} onChangeText={setStatement} multiline maxLength={STATEMENT_MAX} />
      <Button label={DECISION_WORDS.appeal} onPress={() => void send()} busy={busy} />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * An answered appeal: the day, and the statement of the decision that answered it (the review, or the correction that
 * reversed everything before a review came), rendered as every statement is, with a link to that decision's own screen.
 */
function AppealAnswer({ appeal }: { appeal: Extract<DecisionAppeal, { state: "answered" }> }) {
  const paragraphs = paragraphsOf(appeal.statement);
  return (
    <View>
      <Line strong>{DECISION_WORDS.appealAnswered(appeal.answeredOn)}</Line>
      <Note>{DECISION_WORDS.appealAnswer}</Note>
      {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
      <Link href={`/settings/cases/${appeal.answeredBy}`} asChild>
        <Pressable className="mt-3 self-start">
          <Text className="text-sm text-sky-400 underline">{DECISION_WORDS.answerScreen}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * Where the appeal of a decision stands (3c design, sections 7.7 and 9), the first that applies: the answer to an appeal
 * that was answered; for one that waits, that it waits for a reviewer, or why nobody at korbat can review it now; while
 * none was filed, until when one can be, with the form when the screen can send it; or that a restriction reversed in
 * full leaves nothing to appeal.
 */
function Appeal({ view, onAppeal }: { view: DecisionView; onAppeal?: (statement: string) => Promise<void> }) {
  const { appeal } = view;
  if (appeal?.state === "answered") return <AppealAnswer appeal={appeal} />;
  if (appeal?.state === "pending") {
    return (
      <View>
        <Line>{DECISION_WORDS.appealFiled(appeal.filedAt.slice(0, 10))}</Line>
        <Line strong>{appealWaitWords(view) ?? DECISION_WORDS.appealWaiting}</Line>
      </View>
    );
  }
  if (view.appealUntil) {
    return (
      <View>
        <Line>{DECISION_WORDS.appealUntil(utcMinute(view.appealUntil))}</Line>
        {onAppeal ? <AppealForm onAppeal={onAppeal} /> : null}
      </View>
    );
  }
  return <Line>{DECISION_WORDS.reversed(view.reversedOn ?? "")}</Line>;
}

/**
 * 3d Task 6 (design, sections 7.10 and 9.4): "Ask for a person" on a program's decision, from DecisionView.askPerson read
 * fresh: the button while the measure is in force and no request exists, which opens one field under [auto.askLead]; the
 * request as sent with korbat's published target ([auto.asked]); and once a person has decided, [auto.decided] with a
 * link to that decision. A refusal is worded under the button and what was written stays; objection_not_open reads as
 * [auto.decided] without the day. A suspended account can ask: nothing here reads its standing.
 */
function AskPerson({ view, onAsk }: { view: DecisionView; onAsk?: (text: string) => Promise<void> }) {
  const ask = view.askPerson ?? null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ask === null) return null;

  async function send() {
    if (busy || onAsk === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(text);
    } catch (err) {
      // objection_not_open and rate_limited in the app's own words (9.7), anything else as elsewhere.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={AUTO_WORDS.ask}>
      {ask.state === "asked" ? (
        <View>
          <Line strong>{AUTO_WORDS.asked(utcMinute(ask.createdAt))}</Line>
          <Line>{ask.text}</Line>
        </View>
      ) : null}
      {ask.state === "decided" ? (
        <View>
          <Line strong>{AUTO_WORDS.decided(utcMinute(ask.decidedAt))}</Line>
          <DecisionLink id={ask.decisionId} label={AUTO_WORDS.decidedLink} />
        </View>
      ) : null}
      {ask.state === "open" && onAsk !== undefined ? (
        open ? (
          <View>
            <Note>{AUTO_WORDS.askLead}</Note>
            <Field label={AUTO_WORDS.askField} value={text} onChangeText={setText} multiline maxLength={OBJECTION_TEXT_MAX} />
            <Button label={AUTO_WORDS.ask} onPress={() => void send()} busy={busy} />
            <ErrorText message={error} />
          </View>
        ) : (
          <Button label={AUTO_WORDS.ask} onPress={() => setOpen(true)} />
        )
      ) : null}
    </Section>
  );
}

/** A link to another decision's screen, as a line of its own. */
function DecisionLink({ id, label }: { id: string; label: string }) {
  return (
    <Link href={`/settings/cases/${id}`} asChild>
      <Pressable className="mt-3 self-start">
        <Text className="text-sm text-sky-400 underline">{label}</Text>
      </Pressable>
    </Link>
  );
}

/** The states in which a measure ended before its time, by a decision the block links to. */
const ENDED_BY_A_DECISION = new Set(["never", "lifted", "basis_ended"]);

/**
 * 3e Task 4 (design, section 9.2): "Where it stands now", under the statement of a decision that holds a suspension or a
 * termination, from DecisionView.standing read fresh: the sentence of its state, with a link to the decision that ended
 * it before its time; the strikes it rests on (or the decision, for a measure taken at once), each a link to its own
 * screen; "Reply" while the reply is open; and once the person replied, their text while korbat keeps it and where the
 * reply stands.
 */
function StandingNow({ view }: { view: DecisionView }) {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null) return null;
  const protective = measure.basis === "protective";
  const strikes = standing.restsOn.filter((entry) => entry.state !== null);
  const decisions = standing.restsOn.filter((entry) => entry.state === null);
  const reply = standing.reply;
  const stands = replyStandsLine(standing);
  return (
    <Section title={STANDING_TEXTS.now.title}>
      <Line strong>{nowSentence(standing, measure.kind, protective, view.appealUntil)}</Line>
      {ENDED_BY_A_DECISION.has(standing.state) && standing.endedBy !== null ? <DecisionLink id={standing.endedBy} label={STANDING_TEXTS.now.endedBy} /> : null}
      {strikes.map((entry) => (
        <DecisionLink key={entry.decisionId} id={entry.decisionId} label={restsOnLine(entry)} />
      ))}
      {strikes.length > 0 ? <Note>{STANDING_TEXTS.rests.hint}</Note> : null}
      {decisions.map((entry) => (
        <DecisionLink key={entry.decisionId} id={entry.decisionId} label={protective ? STANDING_TEXTS.rests.seal(entry.decidedAt) : STANDING_TEXTS.rests.decision(entry.decidedAt)} />
      ))}
      {decisions.length > 0 ? <Note>{protective ? `${STANDING_TEXTS.rests.basis} ${STANDING_TEXTS.rests.basisProtective}` : STANDING_TEXTS.rests.basis}</Note> : null}
      {standing.replyOpen ? (
        <Link href={`/settings/cases/${view.id}/reply`} asChild>
          <Pressable accessibilityRole="button" className="mt-4 self-start rounded-lg border border-zinc-500 px-4 py-2">
            <Text className="text-base font-semibold text-zinc-50">{STANDING_TEXTS.reply.button}</Text>
          </Pressable>
        </Link>
      ) : null}
      {reply ? (
        <View>
          <Line>{STANDING_TEXTS.reply.replied(reply.filedAt)}</Line>
          {reply.text !== null ? <Line>{reply.text}</Line> : reply.erasedAt !== null ? <Note>{STANDING_TEXTS.reply.erased(reply.erasedAt)}</Note> : null}
          {stands ? <Line>{stands.text}</Line> : null}
          {stands?.link ? <DecisionLink id={stands.link} label={STANDING_TEXTS.reply.answer} /> : null}
        </View>
      ) : null}
    </Section>
  );
}

/**
 * 3e Task 5 (design, section 9.2): "Where it stands now" under the statement of a decision that restricts the account's
 * reports, from DecisionView.reportingStanding read fresh, since it can end before its date: it runs, it ended, korbat
 * lifted it, or it ended with the warning it rested on; the last two link to the decision that did it.
 */
function ReportingNow({ view }: { view: DecisionView }) {
  const standing = view.reportingStanding ?? null;
  if (standing === null) return null;
  const line = reportingNowLine(standing);
  return (
    <Section title={STANDING_TEXTS.reporting.title}>
      <Line strong>{line.text}</Line>
      {line.link !== null ? <DecisionLink id={line.link} label={STANDING_TEXTS.now.endedBy} /> : null}
    </Section>
  );
}

/**
 * 3e Task 4 (design, section 9.2): what the appeal of a standing measure adds above D 9's control: [appeal.early] while an
 * announced measure has not started, [appeal.again] after a kept answer to a reply sent before the start, and
 * [terminate.delete] beside a termination's appeal.
 */
function StandingAppealNotes({ view }: { view: DecisionView }) {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null) return null;
  const open = view.appealUntil !== null && view.appeal === null;
  const notStarted = standing.state === "unfixed" || standing.state === "announced" || standing.state === "held";
  const reply = standing.reply;
  const keptAfterReply = reply !== null && reply.onTime && reply.answeredAt !== null && !ENDED_BY_A_DECISION.has(standing.state);
  return (
    <View>
      {open && notStarted ? <Note>{STANDING_TEXTS.appeal.early}</Note> : null}
      {open && keptAfterReply && reply.answeredAt !== null && view.appealUntil !== null ? <Line>{STANDING_TEXTS.appeal.again(reply.answeredAt, view.appealUntil)}</Line> : null}
      {measure.kind === "terminate" && (open || view.appeal?.state === "pending") ? <Note>{STANDING_TEXTS.terminateDelete}</Note> : null}
    </View>
  );
}

/**
 * One decision as its author reads it (3c design, section 9): the statement of reasons, rendered by the same function
 * that rendered its mail, from the same data; what the decision is about and the content it was made on; and where its
 * appeal stands. A decision that ends or lifts a field reset links the decision that reset the field while korbat still
 * keeps the old value there. With `onAppeal` a decision that can still be appealed carries the appeal's form.
 */
export function DecisionDetail({ view, onAppeal, onAsk }: { view: DecisionView; onAppeal?: (statement: string) => Promise<void>; onAsk?: (text: string) => Promise<void> }) {
  // 3f: an order's notice, and the reinstatement after one, render as a notice and offer no appeal.
  if (view.order) return <OrderNotice view={view} />;
  const paragraphs = paragraphsOf(view);
  // The decisions whose screens still show a reset field's old value: of the resets this decision lifts, and of those that ended with it.
  const resets = [...new Set([...view.reversals, ...view.endedMeasures].flatMap((entry) => (entry.oldValueKept && entry.resetDecisionId ? [entry.resetDecisionId] : [])))];
  return (
    <View>
      {/* The screen's own title is "Cases": this heading and the sections under it are one level below it. */}
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {DECISION_WORDS.title}
      </Text>
      <Text className="mt-1 text-base text-zinc-300">{view.post ? DECISION_WORDS.post(utcMinute(view.post.createdAt)) : CASES_WORDS.profile}</Text>
      {/* 3d Task 6 (section 9.4): [auto.chip] beside the day of a decision a program took; nothing on a post says "program". */}
      {view.automatedDecision === "fully" ? <Text className="mt-1 self-start rounded border border-zinc-600 px-2 py-0.5 text-sm text-zinc-200">{`${AUTO_WORDS.chip}, ${view.decidedAt.slice(0, 10)}`}</Text> : null}

      <Section title={DECISION_WORDS.statement}>
        {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
        {/* 3d (design, section 9.1): after the rule a statement names, its own or the reviewed decision's, the rules page. */}
        {(view.ruleId ?? view.reviewed?.ruleId ?? null) !== null ? (
          <Link href="/rules" asChild>
            <Pressable className="mt-3 self-start">
              <Text className="text-sm text-sky-400 underline">{DECISION_WORDS.rulesPage}</Text>
            </Pressable>
          </Link>
        ) : null}
        {/* 3e (design, section 9.2): where the strike this decision gave stands now, read fresh. */}
        {view.strike ? <Line strong>{strikeLine(view.strike)}</Line> : null}
        {resets.map((decisionId) => (
          <Link key={decisionId} href={`/settings/cases/${decisionId}`} asChild>
            <Pressable className="mt-3 self-start">
              <Text className="text-sm text-sky-400 underline">{DECISION_WORDS.resetDecision}</Text>
            </Pressable>
          </Link>
        ))}
      </Section>

      <AskPerson view={view} onAsk={onAsk} />
      <StandingNow view={view} />
      <ReportingNow view={view} />

      <Section title={DECISION_WORDS.content}>
        {view.content === null ? <Note>{ORDER_TEXTS.notice.noContent}</Note> : <Content content={view.content} />}
      </Section>

      {view.appeal || view.appealUntil || view.reversedOn ? (
        <Section title={DECISION_WORDS.appeal}>
          <StandingAppealNotes view={view} />
          <Appeal view={view} onAppeal={onAppeal} />
        </Section>
      ) : null}
    </View>
  );
}
