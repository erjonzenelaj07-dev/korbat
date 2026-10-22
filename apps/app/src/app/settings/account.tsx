import { useEffect, useRef, useState, type RefObject } from "react";
import { Platform, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { ACCOUNT_DELETION_WORDS, BadgeVerifyResponse, DeleteStartResponse, EmailChangeResponse, FlowResponse, type MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { api, ApiError, apiResponse, errorMessage } from "@/lib/api";
import { exportFilename, saveBlob } from "@/lib/download";
import { DELETE_HOLD } from "@/lib/orders";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { ACCOUNT_WORDS } from "@/lib/settings-words";
import { STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS } from "@/lib/ui-words";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/**
 * Expo inlines this public value into the web bundle at export time (WEB_BADGE in infra/.env). The
 * badge routes answer badge_unavailable when the API's verification provider is off, and there is no
 * harmless read to probe that with, so the section is shown only by a build that says "on"; the API's
 * provider is off by default, and so is this.
 */
const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";

const CODE = /^\d{6}$/;

/** One request at a time for a section, through the re-authentication hook, with its busy, error and done texts. */
function useAction(run: Run, describe: (err: unknown) => string = errorMessage) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Enter in a field calls the action as the button does, so the button's busy rule is here too: a second Enter while a request is out sends nothing.
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(action);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, done, setDone, act };
}

/**
 * Moves the focus to `target` when `away` turns false after being true: the section went back to the
 * step `target` is in, and the control that had the focus (Start over, Cancel, Change, Verify, Remove
 * badge) left the tree with the step it was in, which would drop the focus to the page body.
 */
function useFocusOnReturn(away: boolean, target: RefObject<{ focus(): void } | null>) {
  const wasAway = useRef(away);
  useEffect(() => {
    if (!away && wasAway.current) target.current?.focus();
    wasAway.current = away;
  }, [away, target]);
}

/** A new address gets a code; the account moves to it once the code is entered, and every session stays signed in. */
function EmailSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, setError, done, setDone, act } = useAction(run);
  const emailRef = useRef<TextInput>(null);
  // The code field takes the focus itself (autoFocus); Change and Start over bring the address field back, which takes it here.
  useFocusOnReturn(flowId !== null, emailRef);
  // The API would answer a generic invalid_request for the account's own address; it is refused here in its own words instead.
  const current = email.trim().toLowerCase() === me.user.email.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function start() {
    if (email.trim().length === 0) return;
    if (current) {
      setDone(null);
      setError("That is already your email address.");
      return;
    }
    await act(async () => {
      const flow = await api("/api/auth/email/change/start", { json: { email: email.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      const changed = await api("/api/auth/email/change/verify", { json: { flowId, code: code.trim() }, schema: EmailChangeResponse });
      setFlowId(null);
      setEmail("");
      setCode("");
      setDone(`Your email address is now ${changed.email}.`);
      // The address shown here and on the security screen reads the session.
      await refresh();
    });
  }

  return (
    <View>
      <Body>{ACCOUNT_WORDS.emailBody(me.user.email)}</Body>
      {flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.emailSent(email.trim())}</Body>
          <Field label="Code from the email" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Change" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={emailRef} label="New email address" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={() => void start()} />
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />
        </>
      )}
    </View>
  );
}

/** The API reuses the email flows' code errors, whose wording points at an email; the badge's code came by text message. */
function badgeMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_code") return "That code is not right. Check the text message.";
  if (err instanceof ApiError && err.code === "code_expired") return "That code has expired. Send a new one.";
  return errorMessage(err);
}

/** Holding the badge, verifying a number, or removing it; each needs fresh authentication. */
function BadgeSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [phone, setPhone] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run, badgeMessage);
  const verified = me.profile?.verified === true;
  const phoneRef = useRef<TextInput>(null);
  const removeRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus). Start over and a removed badge bring the phone field back, and a verified
  // badge brings Remove badge: each takes the focus when its step returns.
  useFocusOnReturn(verified || flowId !== null, phoneRef);
  useFocusOnReturn(!verified, removeRef);

  // Enter in the field calls this as the button does, so the button's condition comes first.
  async function start() {
    if (phone.trim().length === 0) return;
    await act(async () => {
      const flow = await api("/api/auth/badge/start", { json: { phone: phone.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      await api("/api/auth/badge/verify", { json: { flowId, code: code.trim() }, schema: BadgeVerifyResponse });
      setFlowId(null);
      setPhone("");
      setCode("");
      setDone("Your account is now verified.");
      // The chip on posts and the profile, and this section, read the session.
      await refresh();
    });
  }

  const remove = () =>
    act(async () => {
      await api("/api/auth/badge", { method: "DELETE" });
      setDone("The badge was removed.");
      await refresh();
    });

  return (
    <View>
      <Body>{ACCOUNT_WORDS.badgeBody}</Body>
      {verified ? (
        <>
          <Body>{ACCOUNT_WORDS.badgeHeld}</Body>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button ref={removeRef} label="Remove badge" onPress={() => void remove()} busy={busy} tone="danger" />
        </>
      ) : flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.badgeSent(phone.trim())}</Body>
          <Field label="Code from the text message" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={phoneRef} label="Phone number" autoComplete="tel" inputMode="tel" placeholder="+447911123456" value={phone} onChangeText={setPhone} onSubmitEditing={() => void start()} />
          <Text variant="meta" tone="low" className="mt-1">
            {ACCOUNT_WORDS.phoneHint}
          </Text>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={phone.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The export's own words for its daily limit: the generic "wait a moment" would be wrong for a window of a day. */
export function exportMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "rate_limited" && err.retryAfter) {
    const hours = Math.ceil(err.retryAfter / 3600);
    return hours <= 1 ? "You exported your data today already. You can export again in about an hour." : `You exported your data today already. You can export again in about ${hours} hours.`;
  }
  return errorMessage(err);
}

/**
 * The ZIP comes back as the response body, so the raw response is turned into a file the browser saves;
 * native has no downloads folder to offer. The API fails the body when the archive breaks off part way,
 * so res.blob() rejects and the section shows an error, never the note that the export was downloaded.
 */
function ExportSection({ run }: { run: Run }) {
  const { busy, error, done, setDone, act } = useAction(run, exportMessage);

  const download = () =>
    act(async () => {
      const res = await apiResponse("/api/account/export", { method: "POST" });
      saveBlob(await res.blob(), exportFilename(res.headers.get("content-disposition")));
      setDone("Your export was downloaded.");
    });

  return (
    <View>
      <Body>{ACCOUNT_WORDS.exportBody}</Body>
      {Platform.OS === "web" ? (
        <>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Download my data" onPress={() => void download()} busy={busy} />
        </>
      ) : (
        <Body>{ACCOUNT_WORDS.exportNative}</Body>
      )}
    </View>
  );
}

/** Deletion needs an emailed code and the handle typed back; the API takes the account down at once and this session with it. */
function DeleteSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, act } = useAction(run);
  const handle = me.profile?.handle ?? "";
  const typedHandle = typed.trim().replace(/^@/, "").toLowerCase();
  // The API compares the typed handle case-insensitively and answers a mismatch as a generic invalid request; the same rule here keeps the button off until it matches.
  const matches = typedHandle.length > 0 && typedHandle === handle.toLowerCase();
  const sendRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus); Cancel brings "Send me a code" back, which takes it here.
  useFocusOnReturn(flowId !== null, sendRef);

  const start = () =>
    act(async () => {
      const flow = await api("/api/account/delete/start", { method: "POST", schema: DeleteStartResponse });
      setCode("");
      setTyped("");
      setFlowId(flow.flowId);
    });

  // The button's condition comes first, as in every other action of this screen.
  async function confirm() {
    if (!CODE.test(code.trim()) || !matches) return;
    await act(async () => {
      await api("/api/account/delete/confirm", { json: { flowId, code: code.trim(), handle: typedHandle } });
      // The API cleared the cookies: the session reloads as signed out, and the home page is public.
      await refresh();
      router.replace("/");
    });
  }

  return (
    <View>
      <Body>
        {ACCOUNT_DELETION_WORDS} {ACCOUNT_WORDS.deleteMore}
      </Body>
      {/* 3f Task 5 ([delete.hold]): what the law can oblige korbat to keep for a time, said to every account beforehand. */}
      <Body>{DELETE_HOLD}</Body>
      {flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.deleteSent(me.user.email)}</Body>
          <Field label="Code from the email" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} />
          <Field label="Type your handle to confirm" autoCapitalize="none" autoComplete="off" placeholder={`@${handle}`} value={typed} onChangeText={setTyped} />
          <ErrorText message={error} />
          <Button label="Delete my account" onPress={() => void confirm()} busy={busy} disabled={!CODE.test(code.trim()) || !matches} tone="danger" />
          <Button
            label="Cancel"
            onPress={() => {
              setFlowId(null);
              setCode("");
              setTyped("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button ref={sendRef} label="Send me a code" onPress={() => void start()} busy={busy} tone="secondary" />
        </>
      )}
    </View>
  );
}

/**
 * Settings, Account (1b, 3e and 3f designs; UI design, section 8.8): the email address, the Verified badge where the
 * build offers it, the data export and the account's deletion. UI Task 8 keeps its sections, words and flows on the
 * tokens: the title and the settings row in ScreenHeader, the handle in the mono face under it, each section a card of
 * fields on ScreenScroll, and the codes in the mono face.
 */
export default function AccountSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsAccount");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.account"]}>
        <SettingsNav current="account" />
      </ScreenHeader>
      <ScreenScroll screen="account">
        <Text variant="mono" tone="medium" className="mt-2">{`@${me.profile?.handle ?? ""}`}</Text>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed an action here: the screen stays, with the field for the code it mailed, and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Email address">
          <EmailSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        {BADGE_SHOWN ? (
          <Section title="Verified badge">
            <BadgeSection me={me} run={reauth.run} refresh={refresh} />
          </Section>
        ) : null}
        <Section title="Data export">
          <ExportSection run={reauth.run} />
        </Section>
        <Section title="Delete account">
          {/* 3e Task 4 (design, section 9.2): [terminate.delete], while /me carries a termination. */}
          {me.standing?.measure?.kind === "terminate" ? <Body>{STANDING_TEXTS.terminateDelete}</Body> : null}
          <DeleteSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}
