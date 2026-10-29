import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { BIO_MAX_LENGTH, isRetiredPlaceholder, postLength, type AvatarView, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { AskSheet } from "@/components/import/ImportProgress";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { refusal } from "@/components/social/useImageUploads";
import { toast } from "@/components/toast";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { avatarShape, cropChoices, pickerFocus, previewName, sendAvatar, type AvatarOutcome, type CropChoice } from "@/lib/avatar";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { AVATAR_WORDS, PROFILE_WORDS } from "@/lib/settings-words";
import { social } from "@/lib/social";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

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

/** A chosen file, before it is sent: its blob: address, which the page's img-src allows, and its size for the choices. */
export interface ChosenPicture {
  url: string;
  width: number;
  height: number;
}

/** A picture refused before anything is sent (a HEIC photo, a type korbat does not take, over 20 MB): 2b's sentences. */
type PickerError = Exclude<AvatarOutcome, { status: "set" }> | { status: "notice"; message: string };

export interface AvatarCardViewProps {
  avatar: AvatarView | null;
  displayName: string;
  chosen: ChosenPicture | null;
  choice: CropChoice | null;
  step: "uploading" | "processing" | null;
  error: PickerError | null;
  onChoose: () => void;
  onPart: (choice: CropChoice) => void;
  onUse: () => void;
  onCancel: () => void;
  onRemove: () => void;
  chooseRef?: Ref<View>;
  errorRef?: Ref<View>;
}

/** An error line's words: 3d's refusal, the failure, the reset's sentence, or the API's own for anything else. */
function errorWords(error: PickerError): string {
  if (error.status === "refused") return UPLOAD_TEXTS.refused;
  if (error.status === "failed") return AVATAR_WORDS.failed;
  if (error.status === "reset") return AVATAR_WORDS.resetRecently;
  if (error.status === "notice") return error.message;
  return errorMessage(error.error);
}

/**
 * The card "Profile picture" (2d design, section 10.5), drawn from what AvatarCard holds: the picture at 96 px (or the
 * monogram) with the sentence on who sees it, "Choose a picture" or "Choose another picture" and "Remove picture"; with a
 * file chosen, its 96 px preview in the avatar's disc at the part kept, named by it, "Which part to keep" (none for a
 * square), "Use this picture" and "Cancel"; the polite status line while it uploads and is prepared; and an error line,
 * an alert that takes the focus, with the refusal's "Why" link next.
 */
export function AvatarCardView({ avatar, displayName, chosen, choice, step, error, onChoose, onPart, onUse, onCancel, onRemove, chooseRef, errorRef }: AvatarCardViewProps) {
  const choices = chosen ? cropChoices(avatarShape(chosen.width, chosen.height)) : [];
  return (
    <Section title={AVATAR_WORDS.section}>
      <Body>{AVATAR_WORDS.explain}</Body>
      <View className="mt-4 flex-row items-center gap-4">
        {chosen ? (
          <View className="h-24 w-24 overflow-hidden rounded-full border border-line-low bg-surface-2">
            <Image source={{ uri: chosen.url }} contentFit="cover" contentPosition={choice?.position ?? "center"} accessibilityLabel={previewName(choice)} style={{ width: "100%", height: "100%" }} />
          </View>
        ) : (
          <Avatar account={{ id: "me", displayName }} size={96} src={avatar} />
        )}
      </View>
      {chosen && choices.length > 0 ? (
        <View className="mt-4">
          <Text variant="body-strong" nativeID="avatar-keep">
            {AVATAR_WORDS.keep}
          </Text>
          <SectionRowsInline>
            <RadioGroup labelledBy="avatar-keep">
              {choices.map((item) => (
                <ListRow key={item.crop} label={item.label} control={{ kind: "radio", checked: choice?.crop === item.crop, onSelect: () => onPart(item) }} />
              ))}
            </RadioGroup>
          </SectionRowsInline>
        </View>
      ) : null}
      <View role="status" aria-live="polite">
        {step ? (
          <Text tone="medium" className="mt-3">
            {step === "uploading" ? AVATAR_WORDS.uploading : AVATAR_WORDS.processing}
          </Text>
        ) : null}
      </View>
      {error ? (
        <View ref={errorRef} tabIndex={-1} accessibilityRole="alert" className={cn("mt-3 flex-row items-start gap-2 rounded-control", FOCUS_RING)}>
          <View className="pt-[3px]">
            <Icon name="error" size={16} tone="danger" />
          </View>
          <Text tone="danger" className="shrink">
            {errorWords(error)}
          </Text>
        </View>
      ) : null}
      {error?.status === "refused" ? (
        <Link href={`/settings/cases/uploads/${error.refusalId}`} asChild>
          <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {UPLOAD_TEXTS.why}
            </Text>
          </Pressable>
        </Link>
      ) : null}
      <View className="flex-row flex-wrap gap-x-2">
        {chosen ? (
          <>
            <Button label={AVATAR_WORDS.use} onPress={onUse} busy={step !== null} full={false} />
            <Button label={AVATAR_WORDS.cancel} onPress={onCancel} tone="secondary" full={false} />
          </>
        ) : (
          <>
            <Button ref={chooseRef} label={avatar ? AVATAR_WORDS.change : AVATAR_WORDS.choose} onPress={onChoose} tone="secondary" full={false} />
            {avatar ? <Button label={AVATAR_WORDS.remove} onPress={onRemove} tone="secondary" full={false} /> : null}
          </>
        )}
      </View>
    </Section>
  );
}

/** The radio rows from edge to edge of the card, under a line-low rule, as SectionRows draws them, inside the card's flow. */
function SectionRowsInline({ children }: { children: ReactNode }) {
  return <View className="-mx-4 mt-2 border-y border-line-low">{children}</View>;
}

/** The size of a chosen file, read by the browser before anything is sent, for the choices of its shape. */
function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

/**
 * The picker's state and its actions (10.5): one image through the existing file picker, checked as the composer checks
 * one; the preview at Middle; "Use this picture" through lib/avatar.ts's sendAvatar, then the toast and the focus on
 * "Choose another picture"; a refusal (whose preview goes, as the composer's refused tile shows none), a failure or a
 * reset as an error line that takes the focus; Cancel, which lets the
 * blob: address go and gives the focus back to "Choose a picture"; and "Remove picture", asked once in the AskSheet,
 * since the files go after the commit, with its toast and the focus back on "Choose a picture". /api/me carries the
 * picture, so the session is read again after a change, and the shell's and the profile's avatars follow.
 */
function AvatarCard({ me, refresh }: { me: MeResponse; refresh: Refresh }) {
  const [chosen, setChosen] = useState<(ChosenPicture & { file: File }) | null>(null);
  const [choice, setChoice] = useState<CropChoice | null>(null);
  const [step, setStep] = useState<"uploading" | "processing" | null>(null);
  const [error, setError] = useState<PickerError | null>(null);
  const [asking, setAsking] = useState({ mounted: false, open: false });
  const [removing, setRemoving] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const removed = useRef(false);
  const chooseRef = useRef<View>(null);
  const errorRef = useRef<View>(null);
  const [focus, setFocus] = useState<"choose" | "change" | "error" | null>(null);
  const shown = useRef<string | null>(null);
  shown.current = chosen?.url ?? null;
  // The preview's address goes with the card.
  useEffect(() => () => void (shown.current && URL.revokeObjectURL(shown.current)), []);
  // The focus moves once the control it names is drawn.
  useEffect(() => {
    if (focus === null) return;
    (focus === "error" ? errorRef : chooseRef).current?.focus();
    setFocus(null);
  }, [focus]);

  const drop = () => {
    if (chosen) URL.revokeObjectURL(chosen.url);
    setChosen(null);
  };
  const choose = async () => {
    const [file] = await pickImages({ multiple: false });
    if (!file) return;
    const why = refusal(file);
    if (why) {
      setError({ status: "notice", message: why });
      setFocus("error");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const size = await measure(url);
      drop();
      setError(null);
      setChosen({ url, file, ...size });
      setChoice(cropChoices(avatarShape(size.width, size.height))[1] ?? null);
    } catch {
      URL.revokeObjectURL(url);
      setError({ status: "failed" });
      setFocus("error");
    }
  };
  const use = async () => {
    if (!chosen || step !== null) return;
    setError(null);
    const outcome = await sendAvatar(social, chosen.file, choice?.crop ?? "centre", setStep);
    setStep(null);
    if (outcome.status === "set") {
      drop();
      toast.show({ message: AVATAR_WORDS.updated });
      await refresh();
    } else {
      // A refused upload is shown to nobody, its uploader included (3d): its preview goes, and its notice says why.
      if (outcome.status === "refused") drop();
      setError(outcome);
    }
    setFocus(pickerFocus(outcome));
  };
  const remove = async () => {
    setRemoving(true);
    setAskError(null);
    try {
      await social.removeAvatar();
      removed.current = true;
      setAsking({ mounted: true, open: false });
      toast.show({ message: AVATAR_WORDS.removed });
      await refresh();
    } catch (err) {
      setAskError(errorMessage(err));
    } finally {
      setRemoving(false);
    }
  };
  return (
    <>
      <AvatarCardView
        avatar={me.avatar}
        displayName={me.profile?.displayName ?? ""}
        chosen={chosen}
        choice={choice}
        step={step}
        error={error}
        onChoose={() => void (canPickImages ? choose() : undefined)}
        onPart={setChoice}
        onUse={() => void use()}
        onCancel={() => {
          drop();
          setError(null);
          setFocus(pickerFocus("cancel"));
        }}
        onRemove={() => setAsking({ mounted: true, open: true })}
        chooseRef={chooseRef}
        errorRef={errorRef}
      />
      {asking.mounted ? (
        <AskSheet
          open={asking.open}
          title={AVATAR_WORDS.confirmTitle}
          description={AVATAR_WORDS.confirmBody}
          confirm={AVATAR_WORDS.confirm}
          keep={AVATAR_WORDS.cancel}
          busy={removing}
          error={askError}
          onConfirm={() => void remove()}
          onClose={() => setAsking({ mounted: true, open: false })}
          onClosed={() => {
            setAsking({ mounted: false, open: false });
            // After a removal "Choose a picture" takes the focus; a sheet closed without one gives it back to Remove picture.
            if (removed.current) setFocus(pickerFocus("removed"));
            removed.current = false;
          }}
        />
      ) : null}
    </>
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

        {/* 2d (10.5): the picture's card, above the display name. */}
        <AvatarCard me={me} refresh={refresh} />
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
