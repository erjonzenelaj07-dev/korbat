import { Text, View } from "react-native";
import type { NoticeStatus } from "@korbat/contracts";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { messageFor } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/**
 * Where a notice stands (3c design, section 9): its reference, when korbat received it, and each item with its outcome
 * once released. The contact's part shows only when the page was opened from a mail's link: the answer then carries
 * whether the address is confirmed or stopped, and the page offers "I sent this" and "stop", each a button that posts with
 * the same token, never a link that acts when it is merely opened. A stopped address reads so, with the one button that
 * undoes it. Opened from the link shown on screen, the answer says neither, and the page shows no contact buttons.
 */
export function NoticeStatusView({ status, onContact, busy = false, error = null }: { status: NoticeStatus; onContact?: (choice: "confirm" | "stop") => void; busy?: boolean; error?: string | null }) {
  const contact = status.contact !== null && status.contact.confirmed !== null && status.contact.stopped !== null ? status.contact : null;
  return (
    <View>
      <Title>{STATUS_WORDS.title}</Title>
      <Body>{STATUS_WORDS.reference(status.ref)}</Body>
      <Body>{STATUS_WORDS.received(utcMinute(status.receivedAt))}</Body>
      <ItemLines items={status.items} />
      {contact ? (
        <View className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
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
              <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.stopHint}</Text>
            </>
          )}
          <ErrorText message={error} />
        </View>
      ) : null}
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}

/** One sentence for a wrong reference and a wrong token alike: the page never says which was wrong. */
export function NoticeNotFound() {
  return (
    <View>
      <Title>{STATUS_WORDS.title}</Title>
      <Text accessibilityRole="alert" className="mt-4 text-base text-zinc-200">
        {messageFor("notice_not_found")}
      </Text>
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}
