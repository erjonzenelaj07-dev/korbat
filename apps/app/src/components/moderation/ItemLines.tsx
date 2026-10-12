import { useState } from "react";
import { Text, View } from "react-native";
import { STATEMENT_MAX, itemOutcomeWords, type NoticeItemStatus } from "@korbat/contracts";
import { Button, ErrorText, Field } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { externalLink } from "@/lib/links";
import { itemRedress, quotedExaminedToo, utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";

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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {/* A report of child sexual abuse material about a post that quotes another: korbat examines both posts again. */}
      {both ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.reexamineBoth}</Text> : null}
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
 * not decided.
 */
function ItemLine({ item, both, onAsk }: { item: NoticeItemStatus; both: boolean; onAsk?: (statement: string) => Promise<void> }) {
  const words = itemOutcomeWords(item);
  const redress = itemRedress(item);
  return (
    <View className="mt-4 rounded-lg border border-zinc-800 px-4 py-3">
      {item.quotedBy !== null ? (
        // An item korbat added for the post a named post quotes: its heading says so, with the quoted post's address.
        <Text className="text-sm font-semibold text-zinc-100">{STATUS_WORDS.added(item.quotedBy, item.link)}</Text>
      ) : (
        <Text className="text-sm font-semibold text-zinc-100">
          {STATUS_WORDS.item(item.position)}
          {item.reexamines ? ` (${STATUS_WORDS.reexaminationLabel})` : ""}:{" "}
          <Text {...externalLink(item.link)} className="font-normal text-sky-400 underline">
            {item.link}
          </Text>
        </Text>
      )}
      {words === null || item.decidedOn === null ? (
        <Text className="mt-2 text-sm text-zinc-400">{STATUS_WORDS.waiting}</Text>
      ) : (
        <>
          <Text className="mt-2 text-sm leading-5 text-zinc-200">
            {STATUS_WORDS.decided(item.decidedOn)} {words}
          </Text>
          {redress === "reexamination" && item.reexamination ? (
            <>
              <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.reexaminationOpen(utcMinute(item.reexamination.until))}</Text>
              {onAsk ? <ReexamineControl both={both} onAsk={onAsk} /> : null}
            </>
          ) : null}
          {redress === "final" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.final}</Text> : null}
          {redress === "courts" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.courts}</Text> : null}
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
        // A re-examination shares its item's position, so the place in the list is the key.
        <ItemLine key={index} item={item} both={quotedExaminedToo(items, index)} onAsk={onReexamine ? (statement) => onReexamine(item, statement) : undefined} />
      ))}
    </View>
  );
}
