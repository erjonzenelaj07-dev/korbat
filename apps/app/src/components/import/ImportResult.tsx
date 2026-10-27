import type { Ref } from "react";
import { Pressable, View } from "react-native";
import { Link, type Href } from "expo-router";
import { IMPORT_IMAGE_SKIPS, type ImportView } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { ListRow } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { buttonFace, LABEL_TONE } from "@/components/ui";
import { useHaptics } from "@/lib/haptics";
import { IMPORT_WORDS, ruleWords, sourceName } from "@/lib/import-words";
import { formatCount, imports } from "@/lib/imports";
import { utcDay } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { AskedAction, Line, StaffEnded, StateHeading, ViewLink } from "./ImportProgress";
import type { CardAuthor } from "./PostList";

/**
 * An import that has ended (3b design, sections 10.3 and 10.5): done, with what was left out while it published, the way
 * to the Imported tab and Remove imported posts; stopped, by its reason (a refused image with the post's day and first
 * words, the notice and the text only; the person's Stop or the time, with the published count and Remove; korbat's
 * staff, with the rule); removed, cancelled, expired and failed, one sentence each and the way to start again. Remove
 * asks once in a Sheet, with the warning haptic as it opens; the screen plays success when the removal ends.
 */

/** "See your Imported tab" (10.5): a link drawn with the primary Button's face, since it goes somewhere. */
function PrimaryLink({ label, href }: { label: string; href: Href }) {
  return (
    <Link href={href} asChild>
      <Pressable className={`mt-4 self-start ${buttonFace({ face: "primary", size: "md" })}`}>
        <Text variant="body-strong" tone={LABEL_TONE.primary}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/** Remove imported posts, asked once (10.5): it deletes them for everyone and cannot be undone. */
function RemovePosts({ view, onView }: { view: ImportView; onView: (next: ImportView) => void }) {
  const haptic = useHaptics();
  return (
    <AskedAction
      label={IMPORT_WORDS["import.remove"]}
      question={fill(IMPORT_WORDS["import.remove.ask"], { n: formatCount(view.progress.postsPublished) })}
      confirm={IMPORT_WORDS["import.remove.confirm"]}
      keep={IMPORT_WORDS["import.remove.keep"]}
      act={() => imports.undo(view.id)}
      onView={onView}
      onAsk={() => haptic("warning")}
    />
  );
}

/** The stopped import's sentence, by its reason (10.5). */
function stoppedWords(view: ImportView): string {
  const n = formatCount(view.progress.postsPublished);
  switch (view.stopReason) {
    case "refused_image":
      return fill(IMPORT_WORDS["import.stopped.refused_image"], { date: view.refusedAt === null ? "" : utcDay(view.refusedAt), words: view.refusedWords ?? "" });
    case "by_staff":
      return fill(IMPORT_WORDS["import.stopped.by_staff"], { rule: ruleWords(view.endedByStaff ?? ""), n });
    case "time_ran_out":
      return fill(IMPORT_WORDS["import.stopped.time_ran_out"], { n });
    default:
      return fill(IMPORT_WORDS["import.stopped.by_author"], { n });
  }
}

export function ImportResult({ view, author, headingRef, onView }: { view: ImportView; author: CardAuthor | null; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  const again = <ViewLink label={IMPORT_WORDS["import.again"]} href="/settings/import" />;
  const heading = <StateHeading headingRef={headingRef}>{IMPORT_WORDS[`import.state.${view.status}`]}</StateHeading>;

  if (view.status === "done") {
    const leftOut = IMPORT_IMAGE_SKIPS.map((reason) => [reason, view.progress.imagesLeftOut[reason] ?? 0] as const).filter(([, count]) => count > 0);
    return (
      <View>
        {heading}
        <View className="mt-4 flex-row items-start gap-3 rounded-card border border-line-low bg-surface-1 px-4 py-3">
          <View className="pt-[2px]">
            <Icon name="done" size={20} tone="accent" />
          </View>
          <Text className="flex-1">{fill(IMPORT_WORDS["import.done"], { n: formatCount(view.progress.postsPublished) })}</Text>
        </View>
        {leftOut.length > 0 ? (
          <View className="mt-3 overflow-hidden rounded-card border border-line-low bg-surface-1">
            <View className="-mb-px">
              {leftOut.map(([reason, count]) => (
                <ListRow key={reason} info label={IMPORT_WORDS[`import.image.${reason}`]} value={formatCount(count)} />
              ))}
            </View>
          </View>
        ) : null}
        {author !== null ? <PrimaryLink label={IMPORT_WORDS["import.done.view"]} href={`/u/${author.handle}?tab=imported`} /> : null}
        {view.undoable ? (
          <>
            <View className="mt-6 h-px bg-line-low" />
            <View className="mt-2">
              <RemovePosts view={view} onView={onView} />
            </View>
          </>
        ) : null}
      </View>
    );
  }

  if (view.status === "stopped") {
    return (
      <View>
        {heading}
        <Line tone="high">{stoppedWords(view)}</Line>
        {view.stopReason === "refused_image" ? (
          <>
            {view.refusalId !== null ? <ViewLink label={IMPORT_WORDS["import.stopped.notice"]} href={`/settings/cases/uploads/${view.refusalId}`} /> : null}
            <ViewLink label={IMPORT_WORDS["import.stopped.textOnly"]} href={`/settings/import?source=${view.source}`} />
          </>
        ) : null}
        {view.stopReason === "by_staff" && view.staffDecisionId !== null ? <ViewLink label={UI_WORDS["reach.decision"]} href={`/settings/cases/${view.staffDecisionId}`} /> : null}
        {view.undoable && view.stopReason !== "by_staff" ? (
          <View className="mt-2">
            <RemovePosts view={view} onView={onView} />
          </View>
        ) : null}
      </View>
    );
  }

  if (view.status === "failed") {
    return (
      <View>
        {heading}
        <View className="mt-4 flex-row items-start gap-2">
          <View className="pt-[3px]">
            <Icon name="error" size={16} tone="danger" />
          </View>
          <Text accessibilityRole="alert" tone="danger" className="shrink">
            {fill(IMPORT_WORDS[`import.failure.${view.failure ?? "unreadable"}`], { source: sourceName(view.source) })}
          </Text>
        </View>
        <ViewLink label={IMPORT_WORDS["import.startAgain"]} href="/settings/import" />
      </View>
    );
  }

  return (
    <View>
      {heading}
      {view.status === "undone" && view.endedByStaff !== null ? (
        <StaffEnded view={view} />
      ) : (
        <Line tone="high">{IMPORT_WORDS[view.status === "undone" ? "import.removed" : view.status === "cancelled" ? "import.cancelled" : "import.expired"]}</Line>
      )}
      {again}
    </View>
  );
}
