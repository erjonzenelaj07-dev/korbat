import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, type MeResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Notice } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { createPasskey, passkeysSupported } from "@/lib/passkeys";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** What the registration's verify and a rename answer: the passkey as the list shows it. */
const PasskeyResponse = z.object({ passkey: PasskeyView });

/** The PasskeyName contract's limit (the display-name rules). */
const NAME_MAX = 50;

/** The separator of a row's facts, the middle dot the sessions list uses, spelled by its code so the file stays ASCII. */
const DOT = " " + String.fromCharCode(183) + " ";

/** Ids come from the API's list; only a UUID may become part of a path. */
const passkeyPath = (id: string) => `/api/auth/passkeys/${encodeURIComponent(z.uuid().parse(id))}`;

/**
 * A short tag beside a passkey's name. It is an image to assistive technology, as the verified chip is: ARIA forbids
 * naming a generic element, and the label says what the one word means.
 */
function Tag({ label, meaning, tone = "plain" }: { label: string; meaning: string; tone?: "plain" | "good" | "bad" }) {
  const surface = tone === "good" ? "bg-emerald-950" : tone === "bad" ? "bg-red-950" : "bg-zinc-800";
  const text = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-300";
  return (
    <View role="img" accessibilityLabel={`${label}: ${meaning}`} className={`rounded-full px-2 py-0.5 ${surface}`}>
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </View>
  );
}

/** A small action inside a row, an underlined text like the sessions list's Sign out. */
function RowButton({ label, onPress, disabled, tone = "plain" }: { label: string; onPress: () => void; disabled: boolean; tone?: "plain" | "danger" }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className="mr-4 py-1">
      <Text className={`text-sm underline ${disabled ? "text-zinc-500" : tone === "danger" ? "text-red-400" : "text-zinc-300"}`}>{label}</Text>
    </Pressable>
  );
}

/** One passkey of the list: its name and tags, its dates and device, and its actions; the rename is a field in place. */
export function PasskeyItem({
  passkey,
  busy,
  onRename,
  onRemove,
  onNotMine,
}: {
  passkey: PasskeyView;
  busy: boolean;
  /** Answers whether the new name was saved; the field stays for a retry otherwise. */
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
  onNotMine: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== passkey.name;

  // Enter in the field saves as the button does, so the button's conditions come first.
  async function save() {
    if (!ready || busy) return;
    if (await onRename(trimmed)) setRenaming(false);
  }

  return (
    <View className="mt-3 rounded-lg border border-zinc-800 px-4 py-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-base text-zinc-50">{passkey.name}</Text>
        {passkey.current ? <Tag label="used for this session" meaning="it signed you in here" tone="good" /> : null}
        {passkey.isNew ? <Tag label="new" meaning="added in the last 7 days" /> : null}
        {passkey.suspended ? <Tag label="suspended" meaning="switched off because a copy of it may exist" tone="bad" /> : null}
        {passkey.synced ? <Tag label="synced" meaning="backed up by your password manager to your other devices" /> : null}
      </View>
      <Text className="mt-1 text-xs text-zinc-400">
        added {new Date(passkey.createdAt).toLocaleDateString()}
        {DOT}
        {passkey.lastUsedAt ? `last used ${new Date(passkey.lastUsedAt).toLocaleString()}` : "never used"}
        {passkey.createdOn ? `${DOT}added on ${passkey.createdOn}` : null}
      </Text>
      {renaming ? (
        <>
          <Field label="Name" autoComplete="off" maxLength={NAME_MAX} value={name} onChangeText={setName} onSubmitEditing={() => void save()} />
          <View className="mt-2 flex-row flex-wrap">
            <RowButton label="Save" onPress={() => void save()} disabled={!ready || busy} />
            <RowButton
              label="Cancel"
              onPress={() => {
                setRenaming(false);
                setName(passkey.name);
              }}
              disabled={busy}
            />
          </View>
        </>
      ) : (
        <View className="mt-2 flex-row flex-wrap">
          <RowButton
            label="Rename"
            onPress={() => {
              // The field starts from the name the list shows now, not from an earlier edit.
              setName(passkey.name);
              setRenaming(true);
            }}
            disabled={busy}
          />
          <RowButton label="Remove" onPress={onRemove} disabled={busy} tone="danger" />
          {passkey.isNew ? <RowButton label="This wasn't me" onPress={onNotMine} disabled={busy} tone="danger" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * The dialog behind Add a passkey (1c design, section 9): the name korbat shows, optional, and the name the password
 * manager shows, prefilled with the handle, with one sentence on what that name reveals. Nothing is sent until Create.
 */
export function AddPasskeyDialog({
  handle,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  handle: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string | undefined, label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState(handle);
  const dialog = useRef<View>(null);
  // The dialog appears in reply to the Add button; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (dialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  const ready = label.trim().length > 0 && label.trim().length <= NAME_MAX && name.trim().length <= NAME_MAX;

  // Enter in a field creates as the button does, so the button's conditions come first.
  async function create() {
    if (!ready || busy) return;
    await onCreate(name.trim().length > 0 ? name.trim() : undefined, label.trim());
  }

  return (
    <View ref={dialog} role="dialog" aria-labelledby="add-passkey-title" tabIndex={-1} className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <Text nativeID="add-passkey-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
        Add a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">Your browser or password manager will ask you to confirm with your fingerprint, face, PIN or security key.</Text>
      <Field label="Name" autoComplete="off" maxLength={NAME_MAX} placeholder="For example Laptop or Phone" value={name} onChangeText={setName} />
      <Text className="mt-1 text-xs text-zinc-400">Optional: what korbat calls this passkey in the list.</Text>
      <Field label="Name in your password manager" autoComplete="off" maxLength={NAME_MAX} value={label} onChangeText={setLabel} onSubmitEditing={() => void create()} />
      <Text className="mt-1 text-xs text-zinc-400">Your password manager shows this name to anyone who can see this device.</Text>
      <ErrorText message={error} />
      <Button label="Create passkey" onPress={() => void create()} busy={busy} disabled={!ready} />
      <Button label="Cancel" onPress={onCancel} tone="secondary" />
    </View>
  );
}

/**
 * The Passkeys section of the Security screen (1c design, sections 7.3 and 7.5): the list, Add a passkey, Rename,
 * Remove, and "This wasn't me" on a new passkey, which explains the lockdown before running it. Adding and removing may
 * need level 2 on an account with two-factor, so they run through the re-authentication hook.
 */
export function PasskeysSection({ me, run, refresh, openAdd }: { me: MeResponse; run: Run; refresh: Refresh; openAdd: boolean }) {
  const supported = passkeysSupported();
  const [passkeys, setPasskeys] = useState<PasskeyView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The home screen's card opens the dialog at once; without support there is nothing to open.
  const [adding, setAdding] = useState(openAdd && supported);
  const [notMine, setNotMine] = useState<PasskeyView | null>(null);
  const lockdownDialog = useRef<View>(null);
  // The lockdown question appears in reply to "This wasn't me"; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    if (notMine) (lockdownDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [notMine]);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api("/api/auth/passkeys", { schema: PasskeyListResponse })).passkeys);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One request at a time for the section, through the re-authentication hook; answers whether the action went through, with its failure shown where `show` puts it. */
  async function act(action: () => Promise<void>, show: (message: string) => void = setError): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setDialogError(null);
    setDone(null);
    try {
      await run(action);
      return true;
    } catch (err) {
      show(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** A verify that fails after the browser created the passkey leaves one in the password manager that korbat does not know; the message says so. */
  function kept(err: unknown): ApiError {
    const sentence = " Your password manager may have kept a passkey that korbat does not know; you can delete it there.";
    return err instanceof ApiError ? new ApiError(err.status, err.code, err.message + sentence, err.retryAfter, err.details) : new ApiError(0, "internal", errorMessage(err) + sentence);
  }

  const create = (name: string | undefined, label: string) =>
    act(async () => {
      const { options } = await api("/api/auth/passkeys/register/options", { json: { label }, schema: PasskeyOptionsResponse });
      const response = await createPasskey(options);
      // The prompt was closed: the dialog stays, with nothing to say.
      if (response === null) return;
      try {
        await api("/api/auth/passkeys/register/verify", { json: { ...(name ? { name } : {}), response }, schema: PasskeyResponse });
      } catch (err) {
        throw kept(err);
      }
      setAdding(false);
      setDone("Passkey added. An email about it is on its way, with a link that removes it in case this was not you.");
      await load();
      // The count in the session decides whether the home screen suggests a passkey and the panel offers one.
      await refresh();
    }, setDialogError);

  const rename = (passkey: PasskeyView, name: string) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "PATCH", json: { name }, schema: PasskeyResponse });
      await load();
    });

  const remove = (passkey: PasskeyView) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "DELETE" });
      setDone(`The passkey named ${passkey.name} was removed.`);
      await load();
      await refresh();
    });

  const lockDown = (passkey: PasskeyView) =>
    act(async () => {
      await api(`${passkeyPath(passkey.id)}/not-mine`, { method: "POST" });
      // The API signed this session out with every other and cleared its cookies; the session reloads as signed out.
      await refresh();
      router.replace("/signin");
    });

  return (
    <View>
      <Body>A passkey signs you in with your fingerprint, face, PIN or a security key, and cannot be phished. You can have up to 10.</Body>
      {passkeys === null ? <Text className="mt-3 text-sm text-zinc-400">Loading passkeys...</Text> : null}
      {passkeys?.length === 0 ? <Text className="mt-3 text-sm text-zinc-400">You have no passkeys yet.</Text> : null}
      {passkeys?.map((passkey) => (
        <PasskeyItem key={passkey.id} passkey={passkey} busy={busy} onRename={(name) => rename(passkey, name)} onRemove={() => void remove(passkey)} onNotMine={() => setNotMine(passkey)} />
      ))}
      {notMine ? (
        <View ref={lockdownDialog} role="dialog" aria-labelledby="not-mine-title" tabIndex={-1} className="mt-4 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="not-mine-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
            Lock down your account?
          </Text>
          {/* What the lockdown reaches, as it is: from the day before this passkey to now, which can be a week, the person's own additions since included. */}
          <Text className="mt-1 text-sm text-zinc-300">
            If you did not add the passkey named {notMine.name}, confirm below. Every session is signed out, including this browser, your password is removed, and every
            passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it, so only someone
            with your email can get back in.
          </Text>
          <Button label="Sign out everywhere and lock down" onPress={() => void lockDown(notMine)} busy={busy} tone="danger" />
          <Button label="Cancel" onPress={() => setNotMine(null)} tone="secondary" />
        </View>
      ) : null}
      <ErrorText message={error} />
      <Notice message={done} />
      {!supported ? (
        <Body>This browser cannot add a passkey. Use a recent browser on a device with a screen lock, or a password manager that stores passkeys.</Body>
      ) : adding ? (
        <AddPasskeyDialog
          handle={me.profile?.handle ?? ""}
          busy={busy}
          error={dialogError}
          onCreate={async (name, label) => {
            await create(name, label);
          }}
          onCancel={() => {
            setAdding(false);
            setDialogError(null);
          }}
        />
      ) : (
        <Button label="Add a passkey" onPress={() => setAdding(true)} tone="secondary" />
      )}
    </View>
  );
}
