import { useEffect, useState } from "react";
import { View } from "react-native";
import { BIO_MAX_LENGTH, isRetiredPlaceholder, postLength, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { PROFILE_WORDS } from "@/lib/settings-words";
import { social } from "@/lib/social";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS } from "@/lib/ui-words";

/** The DisplayName contract's limit, in the code points the counter shows. */
const DISPLAY_NAME_MAX = 50;
/** The API lets a handle change again this long after the last change (1b design, section 7.2); mirrored so the date shows before a refused attempt. */
const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** A field's count against its limit, in danger-ink once it is over, as the composer's count is. */
function Counter({ length, max }: { length: number; max: number }) {
  return (
    <Text variant="meta" tone={length > max ? "danger" : "low"} className="mt-1 text-right">
      {`${length}/${max}`}
    </Text>
  );
}

/**
 * A sentence that holds the form back (3e: a refusal while a measure runs; the date of the next handle change): an alert
 * in the review tone with its icon, so it does not rely on its colour (UI design, section 4.8).
 */
function Held({ message, alert = false }: { message: string; alert?: boolean }) {
  return (
    <View accessibilityRole={alert ? "alert" : undefined} className="mt-4 flex-row items-start gap-2">
      <View className="pt-[3px]">
        <Icon name="review" size={16} tone="review-ink" />
      </View>
      <Text tone="review-ink" className="shrink">
        {message}
      </Text>
    </View>
  );
}

/** Display name and bio. /api/me carries no bio, so the form starts from the public profile, which has both. */
function ProfileForm({ handle, refresh }: { handle: string; refresh: Refresh }) {
  const [saved, setSaved] = useState<ProfileView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    social
      .profile(handle)
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDisplayName(profile.displayName);
        setBio(profile.bio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const name = displayName.trim();
  const text = bio.trim();
  const nameLength = postLength(name);
  const bioLength = postLength(text);
  const changed = saved !== null && (name !== saved.displayName || text !== saved.bio);
  const ready = changed && nameLength >= 1 && nameLength <= DISPLAY_NAME_MAX && bioLength <= BIO_MAX_LENGTH;

  // Enter in the bio calls this as the button does, so the button's conditions come first: nothing unchanged or invalid is
  // sent, and a second Enter while the first request is out sends nothing.
  async function save() {
    if (!saved || !ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Only what changed is sent: the contract refuses an empty edit, and the server records an event per call.
      const { profile } = await social.editProfile({ ...(name !== saved.displayName ? { displayName: name } : {}), ...(text !== saved.bio ? { bio: text } : {}) });
      setSaved(profile);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setDone("Profile saved.");
      // The shell's Profile link and the profile page read the session, so it follows the new name.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? (
      <ErrorText message={error} />
    ) : (
      <Text tone="low" className="mt-3">
        {PROFILE_WORDS.loading}
      </Text>
    );
  }
  return (
    <View>
      <Body>{PROFILE_WORDS.formBody}</Body>
      <Field label="Display name" autoComplete="name" value={displayName} onChangeText={setDisplayName} />
      <Counter length={nameLength} max={DISPLAY_NAME_MAX} />
      {/* The Bio contract refuses control characters, which a line break is, so the field stays single-line. */}
      <Field label="Bio" value={bio} onChangeText={setBio} onSubmitEditing={() => void save()} />
      <Counter length={bioLength} max={BIO_MAX_LENGTH} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}

/**
 * The handle and its 30-day rule. The change needs fresh authentication, so it runs through useReauth. While the profile
 * holds a placeholder (3e design, section 9.5) the section says that korbat retired the handle and that the wait does not
 * apply: the retirement cleared the change time, so the form is open at once. Exported for the server-rendered check.
 */
export function HandleSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const current = me.profile?.handle ?? "";
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The moment a handle_cooldown answer named through Retry-After; until one comes, the last change plus 30 days says it.
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const fromLastChange = me.profile?.handleChangedAt ? new Date(me.profile.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS : null;
  const until = refusedUntil ?? fromLastChange;
  const allowedAt = until !== null && until > Date.now() ? new Date(until) : null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  // Keyed on the placeholder's form; while /me carries a running measure the sentence waits for its end (Task 3).
  const retired = isRetiredPlaceholder(current.toLowerCase());
  const running = runningMeasure(me.standing);
  const ready = normalized.length > 0 && normalized !== current.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function change() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        const { profile } = await social.changeHandle(normalized);
        setHandle("");
        setRefusedUntil(null);
        setDone(`Your handle is now @${profile.handle}. The old one stays reserved for you.`);
        // The shell's Profile link and this screen's heading read the session.
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_cooldown") setRefusedUntil(err.retryAfter ? Date.now() + err.retryAfter * 1000 : fromLastChange);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // 3e (design, sections 9.4 and 9.5): while a suspension or termination runs, the form is replaced by the refusal's
  // sentence (a terminated account never chooses one, so it reads that sentence alone).
  if (running !== null) {
    return (
      <View>
        {retired && running.kind === "suspend" ? <Notice message={STANDING_TEXTS.handle.retiredSuspended} /> : null}
        <Body>{STANDING_TEXTS.handle.standing(current)}</Body>
        <Held message={refusalSentence(me.standing)} alert />
      </View>
    );
  }
  return (
    <View>
      {retired ? <Notice message={STANDING_TEXTS.handle.retired} /> : null}
      <Body>{STANDING_TEXTS.handle.standing(current)}</Body>
      {allowedAt ? <Held message={PROFILE_WORDS.nextChange(allowedAt.toLocaleDateString())} /> : null}
      <Field label="New handle" mono autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} onSubmitEditing={() => void change()} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Change handle" onPress={() => void change()} busy={busy} disabled={!ready} />
    </View>
  );
}

/**
 * Settings, Profile (1b and 3e designs; UI design, section 8.8): the name and bio, and the handle with its 30-day rule.
 * UI Task 8 keeps its sections, words and flows on the tokens: the title and the settings row in ScreenHeader, the
 * handle in the mono face under it, each section a card of fields on ScreenScroll.
 */
export default function ProfileSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsProfile");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;
  // The settings layout sends an account without a handle to onboarding, so the profile is there; the type still allows null.
  if (!me.profile) return <Loading />;

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.profile"]}>
        <SettingsNav current="profile" />
      </ScreenHeader>
      <ScreenScroll screen="profile">
        <Text variant="mono" tone="medium" className="mt-2">{`@${me.profile.handle}`}</Text>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed the handle change: the screen stays as it is and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Name and bio">
          {/* 3e (design, section 9.4): while a suspension or termination runs, the form is replaced by the refusal's sentence. */}
          {runningMeasure(me.standing) !== null ? (
            <Held message={refusalSentence(me.standing)} alert />
          ) : (
            <ProfileForm handle={me.profile.handle} refresh={refresh} />
          )}
        </Section>
        <Section title="Handle">
          <HandleSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}
