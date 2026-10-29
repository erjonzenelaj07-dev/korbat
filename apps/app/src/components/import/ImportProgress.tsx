import { useState, type ReactNode, type Ref } from "react";
import { Pressable, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { ImportView } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { ProgressBar } from "@/components/kit/ProgressBar";
import { Sheet } from "@/components/kit/Sheet";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Notice } from "@/components/ui";
import { IMPORT_WORDS, ruleWords } from "@/lib/import-words";
import { formatCount, importErrorMessage, imports } from "@/lib/imports";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The parts every view of an import shares (3b design, sections 10.1 and 10.5), and the progress of an import that
 * prepares, publishes or removes its posts.
 */

/**
 * The level-2 heading each state's view starts with (10.1). It can take the focus (tabIndex -1), so the screen moves the
 * focus to it when a change of state removed the element that held it; it shows the kit's ring then.
 */
export function StateHeading({ children, headingRef, variant = "display-3" }: { children: string; headingRef?: Ref<View>; variant?: "display-3" | "title" }) {
  return (
    // The title variant heads the preview's first card, inside its padding; the others start a view.
    <Text as="h2" variant={variant} className={cn(variant === "title" ? undefined : "mt-6", "self-start rounded-sm", FOCUS_RING)} {...({ ref: headingRef, tabIndex: -1 } as object)}>
      {children}
    </Text>
  );
}

/** A sentence of a view, in ink-medium unless it is the view's news. */
export function Line({ children, tone = "medium" }: { children: string; tone?: "high" | "medium" }) {
  return (
    <Text tone={tone} className="mt-3">
      {children}
    </Text>
  );
}

/** A real link inside a view: accent-ink and underlined, 44 px tall, as TextLink is but at the start of its line. */
export function ViewLink({ label, href }: { label: string; href: Href }) {
  return (
    <Link href={href} asChild>
      <Pressable className={cn("mt-3 min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING)}>
        <Text tone="accent" className="underline web:underline-offset-2">
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/**
 * A question asked once in a Sheet before an action that cannot be taken back (10.3: Cancel import; 10.5: Stop import,
 * Remove imported posts): the question names the dialog, the action in danger, the way back as a second button. A
 * refusal is said under them; the sheet stays open for another try.
 */
export function AskSheet({
  open,
  title,
  description,
  confirm,
  keep,
  busy,
  error,
  onConfirm,
  onClose,
  onClosed,
}: {
  open: boolean;
  title: string;
  /** 2d (10.5): a sentence under the question, as Sheet's description (the avatar's removal says what goes). */
  description?: string;
  confirm: string;
  keep: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title={title} description={description}>
      <View className="px-5 pb-4">
        <ErrorText message={error} />
        <View className="flex-row flex-wrap gap-x-2">
          <Button label={confirm} tone="danger" full={false} busy={busy} onPress={onConfirm} />
          <Button label={keep} tone="secondary" full={false} onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}

/**
 * An action asked once (AskSheet) behind a secondary button, which then answers the import as it now stands: the view's
 * Cancel import, Stop import and Remove imported posts. `onAsk` runs as the sheet opens (the warning haptic of Remove).
 */
export function AskedAction({
  label,
  question,
  confirm,
  keep,
  act,
  onView,
  onAsk,
}: {
  label: string;
  question: string;
  confirm: string;
  keep: string;
  act: () => Promise<ImportView>;
  onView: (next: ImportView) => void;
  onAsk?: () => void;
}) {
  const [sheet, setSheet] = useState({ mounted: false, open: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await act();
      setSheet({ mounted: true, open: false });
      onView(next);
    } catch (err) {
      setError(importErrorMessage(err, { during: "act" }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        label={label}
        tone="secondary"
        full={false}
        onPress={() => {
          onAsk?.();
          setError(null);
          setSheet({ mounted: true, open: true });
        }}
      />
      {sheet.mounted ? (
        <AskSheet
          open={sheet.open}
          title={question}
          confirm={confirm}
          keep={keep}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setSheet({ mounted: true, open: false })}
          onClosed={() => setSheet({ mounted: false, open: false })}
        />
      ) : null}
    </>
  );
}

/** A phase's bar with its words above it as its value text ("Publishing posts: 800 of 1,240"). */
function Phase({ words, done, total }: { words: string; done: number; total: number }) {
  const text = fill(words, { done: formatCount(done), total: formatCount(total) });
  return (
    <View className="mt-4 gap-2">
      <Text variant="body-strong">{text}</Text>
      <ProgressBar label={text} value={done} max={total} valueText={text} />
    </View>
  );
}

/**
 * Preparing and publishing (10.5): a bar per phase, You can leave this page, and Stop import, asked once; while the author
 * is suspended, the notice that the import is paused (its bars stand still, since nothing moves). Removing (10.5): the
 * bar of the posts removed, and when korbat's staff ended the import, their sentence with the link to the decision (8.7).
 */
export function ImportProgress({ view, headingRef, onView }: { view: ImportView; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  const { progress } = view;
  if (view.status === "undoing") {
    return (
      <View>
        <StateHeading headingRef={headingRef}>{IMPORT_WORDS["import.state.undoing"]}</StateHeading>
        {view.endedByStaff !== null ? <StaffEnded view={view} /> : null}
        <Phase words={IMPORT_WORDS["import.removing"]} done={progress.postsRemoved} total={progress.postsPublished} />
      </View>
    );
  }
  return (
    <View>
      <StateHeading headingRef={headingRef}>{IMPORT_WORDS[view.status === "preparing" ? "import.state.preparing" : "import.state.publishing"]}</StateHeading>
      {view.paused ? <Notice message={IMPORT_WORDS["import.paused"]} /> : null}
      {view.status === "preparing" ? <Phase words={IMPORT_WORDS["import.preparing"]} done={progress.imagesSettled} total={progress.imagesTotal} /> : null}
      <Phase words={IMPORT_WORDS["import.publishing"]} done={progress.postsPublished} total={progress.postsTotal} />
      <Line>{IMPORT_WORDS["import.leave"]}</Line>
      <View className="mt-2">
        <AskedAction
          label={IMPORT_WORDS["import.stop"]}
          question={IMPORT_WORDS["import.stop.ask"]}
          confirm={IMPORT_WORDS["import.stop"]}
          keep={IMPORT_WORDS["import.stop.keep"]}
          act={() => imports.stop(view.id)}
          onView={onView}
        />
      </View>
    </View>
  );
}

/** korbat's staff ended the import (8.7): their rule, and the decision, which can be appealed, under the person's Cases. */
export function StaffEnded({ view }: { view: ImportView }): ReactNode {
  return (
    <View>
      <Line tone="high">{fill(IMPORT_WORDS["import.endedByStaff"], { rule: ruleWords(view.endedByStaff ?? "") })}</Line>
      {view.staffDecisionId !== null ? <ViewLink label={UI_WORDS["reach.decision"]} href={`/settings/cases/${view.staffDecisionId}`} /> : null}
    </View>
  );
}
