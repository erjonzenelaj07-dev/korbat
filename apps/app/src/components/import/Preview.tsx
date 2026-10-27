import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View } from "react-native";
import { IMPORT_IMAGE_SKIPS, IMPORT_RULES, IMPORT_SKIP_REASONS, type ImportChoice, type ImportView } from "@korbat/contracts";
import { Checkbox } from "@/components/kit/Checkbox";
import { dataAttribute } from "@/components/kit/interaction";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { MonthPicker } from "@/components/kit/MonthPicker";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { toast } from "@/components/toast";
import { Button, buttonFace, ErrorText, LABEL_TONE, SectionRows } from "@/components/ui";
import { IMPORT_WORDS, sourceName } from "@/lib/import-words";
import { chosenTotals, formatCount, foundImages, imagesOn, importErrorMessage, imports, leftOutCounts, startingChoice, undescribedCount } from "@/lib/imports";
import { fullDate, monthWords } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { AskedAction, StateHeading, ViewLink } from "./ImportProgress";
import { PostListPanel, StaticCard, type CardAuthor } from "./PostList";

/**
 * The preview and the choice (3b design, section 10.4), in one column of four cards: What we found (the counts, the three
 * newest posts as static cards and See every post), What will be left out (one row a reason with its count, posts then
 * images), Choose (the range, replies, long posts, warnings, protected posts, images, and the live result), and Confirm
 * (the rules, decision 28's two sentences again, the statement and Publish). The counts are the app's own, from the
 * month table and the picks, as the API counts them (lib/imports.ts's chosenTotals), so Publish says exactly what will
 * happen. The choice lives on this screen only: nothing is kept on the device.
 */

/** A card of the preview with its level-2 heading; the first one's heading is the view's (StateHeading). */
function Card({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return <View className="mt-6 overflow-hidden rounded-card border border-line-low bg-surface-1 p-4">{heading}{children}</View>;
}

function CardTitle({ children, id }: { children: string; id?: string }) {
  return (
    <Text as="h2" variant="title" nativeID={id}>
      {children}
    </Text>
  );
}

/** A count's row in What will be left out: the reason's words, and the count at its end. */
function CountRow({ words, count }: { words: string; count: number }) {
  return <ListRow info label={words} value={formatCount(count)} />;
}

/** How long the preview waits after the person stops changing the choice before its result is said (10.4). */
const SAY_AFTER_MS = 500;

export function Preview({ view, author, headingRef, onView }: { view: ImportView; author: CardAuthor | null; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  const [choice, setChoice] = useState<ImportChoice>(() => startingChoice(view));
  const [range, setRange] = useState(() => choice.from !== null || choice.to !== null);
  const [picks, setPicks] = useState(view.picks);
  const [statement, setStatement] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const statementRef = useRef<View>(null);
  const publishRef = useRef<View>(null);
  const reasonId = useId();
  const chooseId = useId();
  const longId = useId();
  const scan = view.scan;
  const tables = { scan, picks };
  const on = imagesOn(view);
  const bring = on && choice.images;
  const totals = chosenTotals(tables, choice, bring);
  const result = fill(IMPORT_WORDS["import.choose.result"], { posts: formatCount(totals.posts), images: formatCount(totals.images) });

  // The result is said politely once the person has stopped changing the choice for 500 ms, never as the preview opens.
  const opened = useRef(true);
  useEffect(() => {
    if (opened.current) {
      opened.current = false;
      return;
    }
    const timer = setTimeout(() => setSaid(result), SAY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [result]);

  // Publish stays a tab stop while it cannot publish (10.4). react-native-web draws a role=button as a native button and
  // makes any disabled state of its own (disabled, aria-disabled, accessibilityDisabled) the native disabled attribute,
  // which takes it out of the tab order; so the state is written on the element itself, which React then leaves alone.
  const blocked = !(statement && totals.posts > 0);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = publishRef.current as unknown as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (blocked) node?.setAttribute?.("aria-disabled", "true");
    else node?.removeAttribute?.("aria-disabled");
  }, [blocked, scan]);

  if (scan === null) {
    return (
      <View>
        <StateHeading headingRef={headingRef}>{IMPORT_WORDS["import.found.title"]}</StateHeading>
        <ErrorText message={IMPORT_WORDS["import.wrongState"]} />
      </View>
    );
  }

  const change = (patch: Partial<ImportChoice>) => setChoice((current) => ({ ...current, ...patch }));
  const months = scan.months.map(({ month }) => month);
  const images = foundImages(scan);
  const appSkips = leftOutCounts(tables, choice);
  const postRows = IMPORT_SKIP_REASONS.map((reason) => [reason, (scan.skipped[reason] ?? 0) + (appSkips[reason as keyof typeof appSkips] ?? 0)] as const).filter(([, count]) => count > 0);
  const missing = bring ? undescribedCount(tables, choice) : 0;
  // While images come with the import, those of the chosen posts that the choice does not bring, or that lack a description.
  const appImages: Partial<Record<(typeof IMPORT_IMAGE_SKIPS)[number], number>> = {
    not_chosen: on && !choice.images ? chosenTotals(tables, choice, true).images + undescribedCount(tables, choice) : 0,
    no_description: missing,
  };
  const imageRows = IMPORT_IMAGE_SKIPS.map((reason) => [reason, (scan.imagesSkipped[reason] ?? 0) + (appImages[reason] ?? 0)] as const).filter(([, count]) => count > 0);
  const can = statement && totals.posts > 0;
  const reason = !statement ? IMPORT_WORDS["import.publish.needStatement"] : totals.posts === 0 ? IMPORT_WORDS["import.publish.nothing"] : null;
  const keptUntil = fullDate(new Date(Date.parse(view.createdAt) + IMPORT_RULES.previewHours * 3_600_000).toISOString());

  const publish = async () => {
    // Pressed while it cannot publish, it takes the person to what is missing: the statement (10.4).
    if (!statement) {
      statementRef.current?.focus();
      return;
    }
    if (totals.posts === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await imports.confirm(view.id, { ...choice, images: bring });
      // The person is already on the import's screen: the toast announces, with no action (UI design, 5.4).
      toast.show({ message: IMPORT_WORDS["import.started"] });
      onView(next);
    } catch (err) {
      setError(importErrorMessage(err, { during: "act" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Card
        heading={
          <StateHeading headingRef={headingRef} variant="title">
            {IMPORT_WORDS["import.found.title"]}
          </StateHeading>
        }
      >
        <Text className="mt-2">{fill(IMPORT_WORDS["import.found.posts"], { n: formatCount(scan.posts), first: scan.first === null ? "" : monthWords(scan.first), last: scan.last === null ? "" : monthWords(scan.last) })}</Text>
        {(scan.imagesSkipped.images_off ?? 0) > 0 ? (
          <Text tone="medium" className="mt-1">
            {IMPORT_WORDS["import.found.imagesOff"]}
          </Text>
        ) : view.source !== "bluesky" && images.n > 0 ? (
          <Text className="mt-1">{fill(IMPORT_WORDS["import.found.images"], { n: formatCount(images.n), kept: formatCount(images.kept) })}</Text>
        ) : null}
        {view.samples.length > 0 && author !== null ? (
          <>
            <Text as="h3" variant="body-strong" className="mt-5">
              {IMPORT_WORDS["import.samples"]}
            </Text>
            <View {...dataAttribute("samples")}>
              {view.samples.map((sample) => (
                <StaticCard key={`${sample.at} ${sample.text}`} author={author} source={view.source} at={sample.at} text={sample.text} />
              ))}
            </View>
            <View {...dataAttribute("samples-end")} />
          </>
        ) : null}
        {listOpen && author !== null ? (
          <PostListPanel view={view} choice={choice} images={bring} author={author} onPicks={setPicks} />
        ) : (
          <Button label={IMPORT_WORDS["import.seeAll"]} tone="secondary" full={false} onPress={() => setListOpen(true)} />
        )}
      </Card>

      <Card heading={<CardTitle>{IMPORT_WORDS["import.left.title"]}</CardTitle>}>
        <SectionRows end={scan.cleaned === 0 && scan.sourceLinks === 0}>
          {postRows.map(([skip, count]) => (
            <CountRow key={skip} words={IMPORT_WORDS[`import.skip.${skip}`]} count={count} />
          ))}
          {imageRows.map(([skip, count]) => (
            <CountRow key={skip} words={IMPORT_WORDS[`import.image.${skip}`]} count={count} />
          ))}
        </SectionRows>
        {scan.cleaned > 0 ? (
          <Text tone="medium" className="mt-3">
            {fill(IMPORT_WORDS["import.cleaned"], { n: formatCount(scan.cleaned) })}
          </Text>
        ) : null}
        {scan.sourceLinks > 0 ? (
          <Text tone="medium" className="mt-2">
            {fill(IMPORT_WORDS["import.sourceLinks"], { source: sourceName(view.source) })}
          </Text>
        ) : null}
      </Card>

      <Card heading={<CardTitle id={chooseId}>{IMPORT_WORDS["import.choose.title"]}</CardTitle>}>
        <SectionRows>
          <RadioGroup labelledBy={chooseId}>
            <ListRow
              label={IMPORT_WORDS["import.choose.all"]}
              control={{
                kind: "radio",
                checked: !range,
                onSelect: () => {
                  setRange(false);
                  change({ from: null, to: null });
                },
              }}
            />
            <ListRow
              label={IMPORT_WORDS["import.choose.range"]}
              control={{
                kind: "radio",
                checked: range,
                onSelect: () => {
                  setRange(true);
                  change({ from: choice.from ?? scan.first, to: choice.to ?? scan.last });
                },
              }}
            />
          </RadioGroup>
        </SectionRows>
        {range && choice.from !== null && choice.to !== null ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            <MonthPicker label={IMPORT_WORDS["import.choose.from"]} months={months} value={choice.from} onChange={(from) => change({ from, to: choice.to !== null && choice.to < from ? from : choice.to })} />
            <MonthPicker label={IMPORT_WORDS["import.choose.to"]} months={months.filter((month) => month >= (choice.from ?? ""))} value={choice.to} onChange={(to) => change({ to })} />
          </View>
        ) : null}
        <SectionRows>
          <ListRow label={IMPORT_WORDS["import.choose.replies"]} description={IMPORT_WORDS["import.choose.replies.desc"]} control={{ kind: "switch", value: choice.replies, onValueChange: (replies) => change({ replies }) }} />
          {scan.warnings > 0 ? (
            <ListRow
              label={IMPORT_WORDS["import.choose.warnings"]}
              description={fill(IMPORT_WORDS["import.warnings"], { n: formatCount(scan.warnings) })}
              control={{ kind: "switch", value: choice.warnings, onValueChange: (warnings) => change({ warnings }) }}
            />
          ) : null}
          {view.source === "x" && scan.protectedPosts > 0 ? (
            <ListRow label={IMPORT_WORDS["import.choose.protected"]} description={IMPORT_WORDS["import.choose.protected.desc"]} control={{ kind: "switch", value: choice.protected, onValueChange: (value) => change({ protected: value }) }} />
          ) : null}
          {on && images.kept > 0 ? (
            <ListRow label={IMPORT_WORDS["import.choose.images"]} description={IMPORT_WORDS["import.choose.images.desc"]} control={{ kind: "switch", value: choice.images, onValueChange: (value) => change({ images: value }) }} />
          ) : null}
        </SectionRows>
        {bring && missing > 0 ? (
          <Text tone="medium" className="mt-3">
            {fill(IMPORT_WORDS["import.choose.images.noAlt"], { n: formatCount(missing) })}
          </Text>
        ) : null}
        <Text as="h3" variant="body-strong" nativeID={longId} className="mt-5">
          {IMPORT_WORDS["import.choose.long"]}
        </Text>
        <SectionRows>
          <RadioGroup labelledBy={longId}>
            <ListRow label={IMPORT_WORDS["import.choose.long.leave"]} control={{ kind: "radio", checked: choice.long === "leave", onSelect: () => change({ long: "leave" }) }} />
            <ListRow label={IMPORT_WORDS["import.choose.long.shorten"]} control={{ kind: "radio", checked: choice.long === "shorten", onSelect: () => change({ long: "shorten" }) }} />
          </RadioGroup>
        </SectionRows>
        <Text variant="body-strong" className="mt-4">
          {result}
        </Text>
        <VisuallyHidden role="status">{said}</VisuallyHidden>
      </Card>

      <Text tone="medium" className="mt-6">
        {fill(IMPORT_WORDS["import.keptUntil"], { time: keptUntil })}
      </Text>
      <Card heading={<CardTitle>{IMPORT_WORDS["import.confirm.title"]}</CardTitle>}>
        <Text className="mt-2">{IMPORT_WORDS["import.rules"]}</Text>
        <ViewLink label={IMPORT_WORDS["import.rules.link"]} href="/rules" />
        <Text tone="medium" className="mt-2">
          {IMPORT_WORDS["import.found"]}
        </Text>
        <Text tone="medium" className="mt-2">
          {IMPORT_WORDS["import.unchecked"]}
        </Text>
        <Checkbox ref={statementRef} label={IMPORT_WORDS["import.statement"]} checked={statement} onChange={setStatement} className="mt-4" />
        <Text tone="medium" className="pl-8">
          {IMPORT_WORDS["import.statement.after"]}
        </Text>
        {/* Publish stays a tab stop while it cannot be used (aria-disabled), its reason under it, tied by aria-describedby. */}
        <View className="mt-6 self-stretch">
          <Pressable
            ref={publishRef}
            accessibilityRole="button"
            tabIndex={0}
            aria-describedby={reason === null ? undefined : reasonId}
            aria-busy={busy}
            onPress={() => void publish()}
            className={buttonFace({ face: can ? "primary" : "inactive", size: "lg" })}
          >
            <Text variant="body-strong" tone={LABEL_TONE[can ? "primary" : "inactive"]} className="shrink text-center">
              {busy ? UI_WORDS["button.busy"] : fill(IMPORT_WORDS["import.publish"], { n: formatCount(totals.posts) })}
            </Text>
          </Pressable>
        </View>
        {reason !== null ? (
          <Text nativeID={reasonId} tone="medium" className="mt-2">
            {reason}
          </Text>
        ) : null}
        <ErrorText message={error} />
        <View className="mt-2">
          <AskedAction label={IMPORT_WORDS["import.cancel"]} question={IMPORT_WORDS["import.cancel.ask"]} confirm={IMPORT_WORDS["import.cancel"]} keep={IMPORT_WORDS["import.cancel.keep"]} act={() => imports.cancel(view.id)} onView={onView} />
        </View>
      </Card>
    </View>
  );
}
