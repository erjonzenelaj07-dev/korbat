import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { STATEMENT_MAX, type DecisionAppeal, type DecisionContent, type DecisionStatement, type DecisionView } from "@korbat/contracts";
import { statementParagraphs } from "@korbat/rules";
import { Button, ErrorText, Field, Section } from "@/components/ui";
import { SEALED_IMAGE } from "@/components/social/HiddenImage";
import { clampRatio } from "@/components/social/MediaGrid";
import { API_BASE } from "@/lib/api";
import { appealWaitWords, dailyLimitFailure, utcMinute } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { strikeLine } from "@/lib/standing";

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

/** The statement's paragraphs, or null when this build's rulebook does not hold the version the decision was made under: it is then never rendered as another. */
function paragraphsOf(view: DecisionStatement): string[] | null {
  try {
    return statementParagraphs(view);
  } catch {
    return null;
  }
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
 * One decision as its author reads it (3c design, section 9): the statement of reasons, rendered by the same function
 * that rendered its mail, from the same data; what the decision is about and the content it was made on; and where its
 * appeal stands. A decision that ends or lifts a field reset links the decision that reset the field while korbat still
 * keeps the old value there. With `onAppeal` a decision that can still be appealed carries the appeal's form.
 */
export function DecisionDetail({ view, onAppeal }: { view: DecisionView; onAppeal?: (statement: string) => Promise<void> }) {
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

      <Section title={DECISION_WORDS.statement}>
        {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
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

      <Section title={DECISION_WORDS.content}>
        <Content content={view.content} />
      </Section>

      {view.appeal || view.appealUntil || view.reversedOn ? (
        <Section title={DECISION_WORDS.appeal}>
          <Appeal view={view} onAppeal={onAppeal} />
        </Section>
      ) : null}
    </View>
  );
}
