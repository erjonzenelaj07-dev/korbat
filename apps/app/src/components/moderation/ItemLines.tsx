import { useState } from "react";
import { Text as Inline, View } from "react-native";
import { STATEMENT_MAX, itemOutcomeWords, type NoticeItemStatus } from "@korbat/contracts";
import { STATEMENT_WORDS } from "@korbat/rules";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Field } from "@/components/ui";
import { externalLink } from "@/lib/links";
import { dailyLimitFailure, itemRedress, quotedExaminedToo, utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { STANDING_TEXTS } from "@/lib/standing";
import { cn } from "@/theme/cn";

/**
 * "Ask for a re-examination" (3c design, section 9): an optional statement, free of form, and the button. The request
 * is a POST its caller sends; a refusal is worded under the button, and what was typed stays. Once it is taken the list
 * is read again, and the item no longer offers the control.
 */
function ReexamineControl({ both, onAsk }: { both: boolean; onAsk: (statement: string) => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(statement);
    } catch (err) {
      setError(dailyLimitFailure(err, "reexaminations"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {/* A report of child sexual abuse material about a post that quotes another: korbat examines both posts again. */}
      {both ? (
        <Text variant="meta" tone="medium" className="mt-2">
          {STATUS_WORDS.reexamineBoth}
        </Text>
      ) : null}
      <Field label={STATUS_WORDS.reexamineStatement} value={statement} onChangeText={setStatement} multiline maxLength={STATEMENT_MAX} />
      <Button label={STATUS_WORDS.reexamine} onPress={() => void ask()} busy={busy} tone="secondary" />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * One item of a report as its sender reads it, on the notice status page and in Your reports alike (3c design, section
 * 9). Its link is the address the report named, an account's under the handle as named. Once its outcome is released it
 * reads the words the mail reads (the contracts' one composition, from the item's own facts), and beside them what the
 * sender can still do: ask for a re-examination while that is open, with the control when the screen can send one, or go
 * to court; a changed outcome and a re-examination's answer are final within korbat. Until then it says only that it is
 * not decided. 3e Task 5 (design, section 9.4): on the sender's own list, an item a moderator marked "manifestly
 * unfounded" says so while the mark counts, once its outcome is released; the status page's items carry no mark.
 *
 * UI Task 7 (section 8.7): each item a row on ListRow's measures (its padding, a line-low divider), headed by the item
 * and its link in body-strong, its outcome and what the sender can do under it. It is no ListRow itself: a ListRow is a
 * control, and an item holds its own (the link, the re-examination's form).
 */
function ItemLine({ item, both, onAsk }: { item: NoticeItemStatus & { unfounded?: boolean }; both: boolean; onAsk?: (statement: string) => Promise<void> }) {
  const words = itemOutcomeWords(item);
  const redress = itemRedress(item);
  return (
    <View className="py-3">
      {item.quotedBy !== null ? (
        // An item korbat added for the post a named post quotes: its heading says so, with the quoted post's address.
        <Text variant="body-strong">{STATUS_WORDS.added(item.quotedBy, item.link)}</Text>
      ) : (
        <Text variant="body-strong">
          {STATUS_WORDS.item(item.position)}
          {item.reexamines ? ` (${STATUS_WORDS.reexaminationLabel})` : ""}:{" "}
          {/* A link inside the line: its words break anywhere, so a long address never pushes the page sideways. */}
          <Inline {...externalLink(item.link)} className={cn("rounded-sm font-normal text-accent-ink underline web:break-all", FOCUS_RING)}>
            {item.link}
          </Inline>
        </Text>
      )}
      {words === null || item.decidedOn === null ? (
        <Text tone="medium" className="mt-1">
          {STATUS_WORDS.waiting}
        </Text>
      ) : (
        <>
          <Text className="mt-1">
            {STATUS_WORDS.decided(item.decidedOn)} {words}
          </Text>
          {/* 3d Task 7 (9.6, W.3): a decision recorded as partly automated says so, as the mail does. */}
          {item.automatedDecision === "partially" ? <Text className="mt-2">{STATEMENT_WORDS.update.automated.partly}</Text> : null}
          {item.unfounded === true ? (
            // "You can ask for a re-examination" only while one is open (3e's review, people8). The review tone with its
            // icon, so the mark is never told by its colour alone (section 4.8).
            <View className="mt-2 flex-row items-start gap-1.5">
              <View className="pt-[3px]">
                <Icon name="review" size={16} tone="review-ink" />
              </View>
              <Text tone="review-ink" className="shrink">
                {redress === "reexamination" ? STANDING_TEXTS.reports.marked : STANDING_TEXTS.reports.markedClosed}
              </Text>
            </View>
          ) : null}
          {redress === "reexamination" && item.reexamination ? (
            <>
              <Text tone="medium" className="mt-2">
                {STATUS_WORDS.reexaminationOpen(utcMinute(item.reexamination.until))}
              </Text>
              {onAsk ? <ReexamineControl both={both} onAsk={onAsk} /> : null}
            </>
          ) : null}
          {redress === "final" ? (
            <Text tone="medium" className="mt-2">
              {STATUS_WORDS.final}
            </Text>
          ) : null}
          {redress === "courts" ? (
            <Text tone="medium" className="mt-2">
              {STATUS_WORDS.courts}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * A report's items in the order the API lists them: by position, an added item directly after the item it was added for.
 * With `onReexamine` each item whose answer can still be examined again carries the control; the caller sends the
 * request for the item it is handed (by its position on the status page, by its id in Your reports).
 */
export function ItemLines<T extends NoticeItemStatus>({ items, onReexamine }: { items: readonly T[]; onReexamine?: (item: T, statement: string) => Promise<void> }) {
  return (
    <View>
      {items.map((item, index) => (
        // A re-examination shares its item's position, so the place in the list is the key. A line-low rule between two
        // items, none above the first or under the last, which the card or the report's own rule closes.
        <View key={index} className={index > 0 ? "border-t border-line-low" : undefined}>
          <ItemLine item={item} both={quotedExaminedToo(items, index)} onAsk={onReexamine ? (statement) => onReexamine(item, statement) : undefined} />
        </View>
      ))}
    </View>
  );
}
