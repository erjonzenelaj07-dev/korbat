import { useState } from "react";
import { Text, View } from "react-native";
import { OBJECTION_TEXT_MAX, type UploadRefusalView } from "@korbat/contracts";
import { getRedress, getRule, REDRESS_VERSION, RULES_VERSION, uploadNoticeParagraphs } from "@korbat/rules";
import { Button, ErrorText, Field, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";

/**
 * 3d Task 7 (design, sections 7.12 and 9.5; W.5): the notice of an upload korbat did not accept, on its screen under
 * Settings, Cases. Its paragraphs are UPLOAD_NOTICE's, rendered from the refusal's view by the one function the mails use,
 * with the rule's current title and the current redress texts, so the state paragraph follows the hold. No image is
 * shown: nobody can see it, its uploader included. "Object" stands while the view says an objection is open: one field
 * under [upload.objectLead]; once sent, [upload.objected]. A suspended account can object: nothing here reads its standing.
 */
export function UploadNoticeDetail({ view, onObject }: { view: UploadRefusalView; onObject?: (text: string) => Promise<void> }) {
  const rule = getRule("R2", RULES_VERSION);
  const redress = getRedress(REDRESS_VERSION);
  const paragraphs = rule && redress ? uploadNoticeParagraphs(view, rule.title, redress) : [];
  return (
    <View>
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {UPLOAD_TEXTS.title}
      </Text>
      {paragraphs.map((paragraph, index) => (
        <Text key={index} className="mt-3 text-base leading-6 text-zinc-200">
          {paragraph}
        </Text>
      ))}
      <ObjectControl view={view} onObject={onObject} />
    </View>
  );
}

/** "Object": the button while an objection is open, which opens one field; a refusal is worded under it and what was written stays. */
function ObjectControl({ view, onObject }: { view: UploadRefusalView; onObject?: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function send() {
    if (busy || onObject === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onObject(text);
      setSent(new Date().toISOString());
    } catch (err) {
      // objection_not_open in this screen's own words (9.7); anything else as elsewhere.
      setError(err instanceof ApiError && err.code === "objection_not_open" ? UPLOAD_TEXTS.notOpen : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null && view.objection !== null) {
    return (
      <Section title={UPLOAD_TEXTS.object}>
        <Text className="mt-2 text-base leading-6 text-zinc-100">{UPLOAD_TEXTS.objected(utcMinute(view.objection.objectedAt))}</Text>
      </Section>
    );
  }
  if (!view.mayObject || onObject === undefined) return null;
  return (
    <Section title={UPLOAD_TEXTS.object}>
      {open ? (
        <View>
          <Text className="mt-2 text-sm leading-5 text-zinc-400">{UPLOAD_TEXTS.objectLead}</Text>
          <Field label={UPLOAD_TEXTS.objectField} value={text} onChangeText={setText} multiline maxLength={OBJECTION_TEXT_MAX} />
          <Button label={UPLOAD_TEXTS.object} onPress={() => void send()} busy={busy} />
          <ErrorText message={error} />
        </View>
      ) : (
        <Button label={UPLOAD_TEXTS.object} onPress={() => setOpen(true)} />
      )}
    </Section>
  );
}
