import { View } from "react-native";
import type { NoticeItemStatus, NoticeStatus } from "@korbat/contracts";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, TextLink } from "@/components/ui";
import { messageFor } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { REPORT_WORDS, STATUS_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/**
 * Where a notice stands (3c design, section 9): its reference, when korbat received it, and each item with its outcome
 * once released. The contact's part shows only when the page was opened from a mail's link: the answer then carries
 * whether the address is confirmed or stopped, and the page offers "I sent this" and "stop", each a button that posts with
 * the same token, never a link that acts when it is merely opened. A stopped address reads so, with the one button that
 * undoes it. Opened from the link shown on screen, the answer says neither, and the page shows no contact buttons. With
 * `onReexamine` each item whose answer can still be examined again carries "Ask for a re-examination".
 *
 * UI Task 7 (section 8.7): the page's title, "Your report", is its ScreenHeader's (app/notice/[ref].tsx); here the
 * reference and the day lead a card of the report's items, a row each, and the emails' part is a card of its own.
 */
export function NoticeStatusView({
  status,
  onContact,
  onReexamine,
  busy = false,
  error = null,
}: {
  status: NoticeStatus;
  onContact?: (choice: "confirm" | "stop") => void;
  onReexamine?: (item: NoticeItemStatus, statement: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  const contact = status.contact !== null && status.contact.confirmed !== null && status.contact.stopped !== null ? status.contact : null;
  return (
    <View>
      <Text variant="mono">{STATUS_WORDS.reference(status.ref)}</Text>
      <Body>{STATUS_WORDS.received(utcMinute(status.receivedAt))}</Body>
      {status.items.length > 0 ? (
        <View className="mt-6 rounded-card border border-line-low bg-surface-1 px-4 pb-1">
          <ItemLines items={status.items} onReexamine={onReexamine} />
        </View>
      ) : null}
      {contact ? (
        <View className="mt-8 rounded-card border border-line-low bg-surface-1 p-5">
          <Text as="h2" variant="title">
            {STATUS_WORDS.contact}
          </Text>
          {contact.stopped ? (
            <>
              <Body>{STATUS_WORDS.stopped}</Body>
              <Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
            </>
          ) : (
            <>
              <Body>{contact.confirmed ? STATUS_WORDS.confirmed : STATUS_WORDS.unconfirmed}</Body>
              <Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
              <Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")} busy={busy} tone="secondary" />
              <Text variant="meta" tone="medium" className="mt-2">
                {STATUS_WORDS.stopHint}
              </Text>
            </>
          )}
          <ErrorText message={error} />
        </View>
      ) : null}
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}

/** One sentence for a wrong reference and a wrong token alike: the page never says which was wrong. */
export function NoticeNotFound() {
  return (
    <View>
      <Text accessibilityRole="alert">{messageFor("notice_not_found")}</Text>
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}
