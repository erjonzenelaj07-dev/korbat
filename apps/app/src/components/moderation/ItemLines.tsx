import { Text, View } from "react-native";
import { itemOutcomeWords, type NoticeItemStatus } from "@korbat/contracts";
import { externalLink } from "@/lib/links";
import { itemRedress, utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";

/**
 * One item of a report as its sender reads it, on the notice status page and in Your reports alike (3c design, section
 * 9). Its link is the address the report named, an account's under the handle as named. Once its outcome is released it
 * reads the words the mail reads (the contracts' one composition, from the item's own facts), and beside them what the
 * sender can still do: ask for a re-examination while that is open, or go to court; a changed outcome and a
 * re-examination's answer are final within korbat. Until then it says only that it is not decided.
 */
function ItemLine({ item }: { item: NoticeItemStatus }) {
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
          {redress === "reexamination" && item.reexamination ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.reexaminationOpen(utcMinute(item.reexamination.until))}</Text> : null}
          {redress === "final" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.final}</Text> : null}
          {redress === "courts" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.courts}</Text> : null}
        </>
      )}
    </View>
  );
}

/** A report's items in the order the API lists them: by position, an added item directly after the item it was added for. */
export function ItemLines({ items }: { items: readonly NoticeItemStatus[] }) {
  return (
    <View>
      {items.map((item, index) => (
        // A re-examination shares its item's position, so the place in the list is the key.
        <ItemLine key={index} item={item} />
      ))}
    </View>
  );
}
