import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type AccountStanding, type CsamKeywordChoice, type NoticeResponse, type ReportRuleId } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import { RULES_PAGE } from "@/lib/public-pages";
import { Body, Button, ErrorText, Field, TextButton, TextLink, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  moderation,
  noticeFrom,
  profileOnly,
  reportFailure,
  ruleLine,
  statusLink,
  tooManyProfiles,
  type GivenTarget,
  type Ground,
  type NoticeCategoryChoice,
  type ReportDraft,
} from "@/lib/moderation";
import { CATEGORY_LABELS, REPORT_WORDS } from "@/lib/moderation-words";
import { reportsRestrictedUntil, runningMeasure, STANDING_TEXTS } from "@/lib/standing";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** One entry of a list of choices: a choice with its label and an optional line under it, or a line of text that stands in a choice's place. */
type ChoiceEntry<T extends string> = { value: T; label: string; hint?: string; disabled?: string } | { note: string };

/**
 * One question with its answers, of which one is chosen: a radio group, each answer a radio that says whether it is
 * checked. Every answer has the same weight on the page; a note among them is plain text and no control.
 */
function Choice<T extends string>({ label, entries, value, onChange }: { label: string; entries: ChoiceEntry<T>[]; value: T | null; onChange: (value: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" aria-label={label} className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      {entries.map((entry) =>
        "note" in entry ? (
          <Text key={entry.note} className="mt-2 rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm leading-5 text-zinc-400">
            {entry.note}
          </Text>
        ) : (
          <Pressable
            key={entry.value}
            accessibilityRole="radio"
            aria-checked={value === entry.value}
            aria-disabled={entry.disabled !== undefined}
            disabled={entry.disabled !== undefined}
            onPress={() => onChange(entry.value)}
            className={`mt-2 rounded-lg border px-4 py-3 ${value === entry.value ? "border-zinc-50 bg-zinc-900" : "border-zinc-700"}`}
          >
            <Text className={`text-base ${entry.disabled !== undefined ? "text-zinc-500" : value === entry.value ? "font-semibold text-zinc-50" : "text-zinc-200"}`}>{entry.label}</Text>
            {entry.hint ? <Text className="mt-1 text-sm leading-5 text-zinc-400">{entry.hint}</Text> : null}
            {/* A disabled choice keeps its reason as text beside it (9.8). */}
            {entry.disabled !== undefined ? <Text className="mt-1 text-sm leading-5 text-amber-300">{entry.disabled}</Text> : null}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** A statement the person may tick: a checkbox that says whether it is checked. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} className="mt-6 flex-row items-start gap-3">
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${checked ? "border-zinc-50 bg-zinc-50" : "border-zinc-500"}`}>
        {checked ? <Text className="text-xs font-bold text-zinc-950">x</Text> : null}
      </View>
      <Text className="flex-1 text-base leading-6 text-zinc-200">{label}</Text>
    </Pressable>
  );
}

const Hint = ({ children }: { children: string }) => <Text className="mt-2 text-sm leading-5 text-zinc-400">{children}</Text>;

/** The rules a report may cite, each with its title and one line; R2 is no choice: in its place stands the pointer to the anonymous path. */
function ruleEntries(withPointer: boolean): ChoiceEntry<ReportRuleId>[] {
  const reportable: readonly string[] = REPORT_RULE_IDS;
  return RULES.flatMap((rule): ChoiceEntry<ReportRuleId>[] => {
    if (reportable.includes(rule.id)) return [{ value: rule.id as ReportRuleId, label: `${rule.id}: ${rule.title}`, hint: ruleLine(rule) }];
    return withPointer ? [{ note: REPORT_WORDS.r2Instead }] : [];
  });
}

const GROUNDS: ChoiceEntry<Ground>[] = [
  { value: "rule", label: REPORT_WORDS.grounds.rule },
  { value: "illegal", label: REPORT_WORDS.grounds.illegal },
  { value: "csam", label: REPORT_WORDS.grounds.csam },
];
const CATEGORIES: ChoiceEntry<NoticeCategoryChoice>[] = [
  { value: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", label: REPORT_WORDS.categoryNotSure },
  ...TDB_FORM_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];
const KEYWORDS: ChoiceEntry<CsamKeywordChoice>[] = (Object.keys(REPORT_WORDS.keywords) as CsamKeywordChoice[]).map((keyword) => ({ value: keyword, label: REPORT_WORDS.keywords[keyword] }));
/** The illegal ground's optional rule: none, or one of the rules a report may cite. */
const NO_RULE = "none";

/** "The rules", the public rules page, beside the list of rules (3d design, section 9.1). */
function RulesLink() {
  return (
    <Link href="/rules" asChild>
      <Pressable className="mt-2 self-start">
        <Text className="text-sm text-sky-400 underline">{RULES_PAGE.title}</Text>
      </Pressable>
    </Link>
  );
}

/** What the form was opened on, as a link to it; a form opened without an item asks for its link instead. */
function GivenItem({ given }: { given: GivenTarget }) {
  const [href, label] = given.kind === "post" ? [`/post/${given.id}`, given.mediaId ? REPORT_WORDS.itemImage : REPORT_WORDS.itemPost] : [`/u/${given.handle}`, REPORT_WORDS.itemProfile(given.handle)];
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{REPORT_WORDS.item}</Text>
      <Link href={href} asChild>
        <Pressable className="mt-2 self-start">
          <Text className="text-base text-sky-400 underline">{label}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The report form (3c design, section 9): what is wrong, with three grounds of equal weight, then what that ground
 * needs. It builds the request from what is filled in (noticeFrom), says what is still missing in place of sending, and
 * shows the answer's screen once korbat took the report. `given` is the post, image or profile "Report" was pressed on,
 * or null for a form opened on its own, which asks for the link. Signed out, every ground needs the human check.
 * `initial` is what a test starts the form with.
 */
export function ReportForm({ signedIn, given, initial, standing = null }: { signedIn: boolean; given: GivenTarget | null; initial?: Partial<ReportDraft>; standing?: AccountStanding | null }) {
  // 3e (design, section 9.6): read from /me before anything is sent. While a suspension runs, or (Task 5) a restriction of
  // the account's reports, the first choice is disabled with its sentence, the suspension's first as the intake refuses
  // it first; a notice of illegality and the path for child sexual abuse material stay open.
  const running = runningMeasure(standing);
  const restrictedUntil = reportsRestrictedUntil(standing);
  const ruleClosed =
    running !== null
      ? running.kind === "suspend" && running.endsAt !== null
        ? STANDING_TEXTS.report.suspended(running.endsAt)
        : STANDING_TEXTS.refused.terminated
      : restrictedUntil !== null
        ? STANDING_TEXTS.report.restricted(restrictedUntil)
        : undefined;
  const grounds = GROUNDS.map((entry) => ("value" in entry && entry.value === "rule" && ruleClosed !== undefined ? { ...entry, disabled: ruleClosed } : entry));
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [draft, setDraft] = useState<ReportDraft>({ ...EMPTY_DRAFT, ...initial });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<NoticeResponse | null>(null);
  const set = (patch: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const built = noticeFrom(draft, given, { signedIn, turnstileToken: token });
  const anonymous = draft.ground === "csam";

  async function send() {
    if (busy || !("request" in built)) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await moderation.send(built.request);
      setSent(answer);
    } catch (err) {
      setError(reportFailure(err, draft.ground === "csam"));
      // A token of the human check is good for one request: the next try needs a fresh one.
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <ReportSent answer={sent} signedIn={signedIn} origin={(globalThis as { location?: { origin?: string } }).location?.origin ?? ""} />;

  const setOther = (index: number, url: string) => set({ others: draft.others.map((other, at) => (at === index ? url : other)) });
  return (
    <View>
      <Title>{REPORT_WORDS.title}</Title>
      {given ? <GivenItem given={given} /> : <Field label={REPORT_WORDS.link} autoCapitalize="none" inputMode="url" value={draft.link} onChangeText={(link) => set({ link })} />}

      <Choice label={REPORT_WORDS.question} entries={grounds} value={draft.ground} onChange={(ground) => set({ ground })} />

      {draft.ground === "rule" ? (
        <>
          <Choice label={REPORT_WORDS.whichRule} entries={ruleEntries(true)} value={draft.ruleId} onChange={(ruleId) => set({ ruleId })} />
          {/* 3d (design, section 9.1): every rule in full, with what it allows, beside the list. */}
          <RulesLink />
          <Field label={REPORT_WORDS.explanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
        </>
      ) : null}

      {draft.ground === "illegal" ? (
        <>
          <Choice label={REPORT_WORDS.category} entries={CATEGORIES} value={draft.category} onChange={(category) => set({ category })} />
          <Hint>{REPORT_WORDS.csamInstead}</Hint>
          <Field label={REPORT_WORDS.citedLaw} maxLength={NOTICE_LIMITS.citedLawMax} value={draft.citedLaw} onChangeText={(citedLaw) => set({ citedLaw })} />
          <Field label={REPORT_WORDS.whyIllegal} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Choice
            label={REPORT_WORDS.alsoRule}
            entries={[{ value: NO_RULE, label: REPORT_WORDS.noRule }, ...ruleEntries(false)]}
            value={draft.ruleId ?? NO_RULE}
            onChange={(ruleId) => set({ ruleId: ruleId === NO_RULE ? null : (ruleId as ReportRuleId) })}
          />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          {signedIn ? null : (
            <>
              <Field label={REPORT_WORDS.name} autoComplete="name" value={draft.name} onChangeText={(name) => set({ name })} />
              <Field label={REPORT_WORDS.email} autoComplete="email" autoCapitalize="none" inputMode="email" value={draft.email} onChangeText={(email) => set({ email })} />
              <Hint>{REPORT_WORDS.contactHint}</Hint>
            </>
          )}
        </>
      ) : null}

      {draft.ground === "csam" ? (
        <>
          <Choice label={REPORT_WORDS.which} entries={KEYWORDS} value={draft.keyword} onChange={(keyword) => set({ keyword })} />
          {profileOnly(draft, given) ? <Hint>{REPORT_WORDS.profileOnly}</Hint> : null}
          <Field label={REPORT_WORDS.csamExplanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          <Hint>{REPORT_WORDS.anonymous}</Hint>
        </>
      ) : null}

      <View className="mt-8">
        <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-100">
          {REPORT_WORDS.otherItems}
        </Text>
        <Hint>{REPORT_WORDS.otherItemsHint}</Hint>
        {draft.others.map((other, index) => (
          <View key={index}>
            <Field label={REPORT_WORDS.otherLink(index + 1)} autoCapitalize="none" inputMode="url" value={other} onChangeText={(url) => setOther(index, url)} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${REPORT_WORDS.removeLink}: ${REPORT_WORDS.otherLink(index + 1)}`} onPress={() => set({ others: draft.others.filter((_, at) => at !== index) })} className="mt-2 self-start">
              <Text className="text-sm text-zinc-400 underline">{REPORT_WORDS.removeLink}</Text>
            </Pressable>
          </View>
        ))}
        {draft.others.length < OTHER_LINKS_MAX ? <TextButton label={REPORT_WORDS.addLink} onPress={() => set({ others: [...draft.others, ""] })} /> : null}
        {/* Said before anything is sent: the anonymous path's one report reaches every image of the profile it names. */}
        {tooManyProfiles(draft, given) ? <ErrorText message={REPORT_WORDS.oneProfile} /> : null}
      </View>

      <Text className="mt-8 text-sm leading-5 text-zinc-400">
        {/* Who sees the sender is not said on the anonymous path, which records none. */}
        {[REPORT_WORDS.privacy.use, ...(anonymous ? [] : [REPORT_WORDS.privacy.sender]), REPORT_WORDS.privacy.access].join(" ")}
      </Text>
      {signedIn ? null : (
        <View className="mt-6">
          <Turnstile
            ref={turnstile}
            siteKey={SITE_KEY}
            options={{ theme: "dark", refreshExpired: "manual" }}
            onSuccess={setToken}
            onExpire={() => {
              setToken(null);
              turnstile.current?.reset();
            }}
            onError={() => setError(reportFailure(new ApiError(403, "human_check_failed", ""), anonymous))}
          />
          <Hint>{REPORT_WORDS.turnstile}</Hint>
        </View>
      )}

      <ErrorText message={error} />
      {/* What is still missing, in place of a button that silently does nothing; the one-profile sentence stands above already. */}
      {"problem" in built && built.problem !== REPORT_WORDS.oneProfile ? <Hint>{built.problem}</Hint> : null}
      <Button label={REPORT_WORDS.send} onPress={() => void send()} busy={busy} disabled={!("request" in built)} />
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}

/**
 * What the form shows once korbat took the report: its reference and how to follow it. A report sent signed out, or on
 * the anonymous path, is followed with a link that is shown only now, its token in the fragment, which no server is sent;
 * a signed-in report on a rule or on the law is in the account's own list. The answer carries a token exactly in the
 * first case, so the token decides.
 */
export function ReportSent({ answer, signedIn, origin }: { answer: { ref: string; token?: string }; signedIn: boolean; origin: string }) {
  const [copied, setCopied] = useState(false);
  const link = answer.token ? statusLink(origin, answer.ref, answer.token) : null;

  async function copy() {
    if (!link) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
    try {
      await clipboard?.writeText(link);
      setCopied(clipboard !== undefined);
    } catch {
      // The browser refused the clipboard: the link stays on screen to be selected.
      setCopied(false);
    }
  }

  return (
    <View>
      <Title>{REPORT_WORDS.sent}</Title>
      <Body>{REPORT_WORDS.reference(answer.ref)}</Body>
      {link ? (
        <>
          <Body>{REPORT_WORDS.keepLink}</Body>
          <Text selectable className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
            {link}
          </Text>
          <Button label={copied ? REPORT_WORDS.copied : REPORT_WORDS.copy} onPress={() => void copy()} tone="secondary" />
        </>
      ) : signedIn ? (
        <>
          <Body>{REPORT_WORDS.followInSettings}</Body>
          <TextLink label={REPORT_WORDS.yourReports} href="/settings/cases?tab=reports" />
        </>
      ) : null}
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}
