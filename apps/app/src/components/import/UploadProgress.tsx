import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, View } from "react-native";
import Animated from "react-native-reanimated";
import type { ImportSource, ImportView } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { ProgressBar } from "@/components/kit/ProgressBar";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { Button, ErrorText } from "@/components/ui";
import { IMPORT_WORDS, sourceName } from "@/lib/import-words";
import { archiveProblem, formatBytes, imports, startUpload, stopUpload, uploadFile, type UploadRunState } from "@/lib/imports";
import { useMotion, useSpin } from "@/lib/motion";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { AskedAction, Line, StateHeading } from "./ImportProgress";

/**
 * The archive on its way in and being read (3b design, sections 4.2 and 10.3): the button that picks the file and checks
 * it before anything is sent, the upload's bar, the resume after a reload, and the reading screen. The file is held in
 * this tab's memory only (lib/imports.ts's runs); nothing is kept on the device.
 */

/** A file the browser handed over: a Blob with its name. */
export type ChosenFile = Blob & { name: string };

/** The browser's document, typed locally: the picker is an input element made for one choice and removed after it. */
interface PickerDocument {
  createElement(tag: "input"): {
    type: string;
    accept: string;
    style: { display: string };
    files: ArrayLike<ChosenFile> | null;
    addEventListener(type: "change" | "cancel", listener: () => void): void;
    click(): void;
    remove(): void;
  };
  body: { appendChild(node: unknown): void };
}

/** Opens the browser's file picker for one file of `accept` (10.2 step 4); null when the person picked none. */
function pickFile(accept: string): Promise<ChosenFile | null> {
  const doc = (globalThis as unknown as { document?: PickerDocument }).document;
  if (!doc) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files && input.files.length > 0 ? input.files[0]! : null;
      input.remove();
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    doc.body.appendChild(input);
    input.click();
  });
}

/** The archives each source gives (10.2 step 4): a zip for X and Mastodon, a CAR for Bluesky. */
const ACCEPT: Record<ImportSource, string> = { x: ".zip", mastodon: ".zip", bluesky: ".car" };

/** The first bytes the check reads (4.2 step 2), as many as the API's own check. */
const HEAD_BYTES = 16;

/**
 * "Choose your archive" (10.2 step 4, 10.3's resume): the browser's file picker, then the checks of 4.2 step 2 before
 * anything is sent, the size (at most 2 GB, or exactly the size the upload started with when it goes on) and the first
 * bytes; a problem is said at once under the button as an alert. A file that passes is handed to `onFile`.
 */
export function ArchiveButton({ source, expectedBytes, onFile }: { source: ImportSource; expectedBytes?: number; onFile: (file: ChosenFile) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async () => {
    const file = await pickFile(ACCEPT[source]);
    if (file === null) return;
    if (expectedBytes !== undefined && file.size !== expectedBytes) {
      setProblem(IMPORT_WORDS["import.wrongFile"]);
      return;
    }
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    const found = archiveProblem(source, file.size, head);
    setProblem(found === null ? null : fill(IMPORT_WORDS[found], { source: sourceName(source) }));
    if (found === null) onFile(file);
  };
  return (
    <View>
      <Button label={IMPORT_WORDS["import.choose"]} tone="secondary" icon="import" full={false} onPress={() => void choose()} />
      <ErrorText message={problem} />
    </View>
  );
}

/** Cancel import, asked once (10.3), stopping this tab's upload first. */
function CancelImport({ view, onView }: { view: ImportView; onView: (next: ImportView) => void }) {
  return (
    <AskedAction
      label={IMPORT_WORDS["import.cancel"]}
      question={IMPORT_WORDS["import.cancel.ask"]}
      confirm={IMPORT_WORDS["import.cancel"]}
      keep={IMPORT_WORDS["import.cancel.keep"]}
      act={() => {
        stopUpload(view.id);
        return imports.cancel(view.id);
      }}
      onView={onView}
    />
  );
}

/** The upload's value text: "120 MB of 840 MB". */
const uploaded = (done: number, total: number): string => fill(IMPORT_WORDS["import.uploaded"], { done: formatBytes(done), total: formatBytes(total) });

/**
 * Uploading (10.3). With the upload running in this tab: the bar, its value text, Keep this page open, and Cancel
 * import; a polite status says the value text at each tenth, not at every chunk. Its refusal is said with Try again,
 * which goes on with the same file from what the API holds. With no file in hand (a reload, another tab): where the upload
 * stopped and the file button, which takes only a file of the size it started with. The web is the only platform: on iOS
 * and Android the view says so.
 */
function Uploading({ view, run, headingRef, onView }: { view: ImportView; run: UploadRunState | null; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  const received = run?.receivedBytes ?? view.receivedBytes;
  const tenth = Math.floor((received / Math.max(1, view.declaredBytes)) * 10);
  const [said, setSaid] = useState("");
  const lastTenth = useRef(tenth);
  useEffect(() => {
    if (tenth !== lastTenth.current) setSaid(uploaded(received, view.declaredBytes));
    lastTenth.current = tenth;
  }, [tenth, received, view.declaredBytes]);
  const again = async () => {
    const file = uploadFile(view.id);
    // The import as the API holds it now, so the upload goes on from its stored bytes.
    const fresh = await imports.get(view.id).catch(() => null);
    if (fresh === null) return;
    if (fresh.status !== "uploading" || file === null) {
      onView(fresh);
      return;
    }
    startUpload(fresh, file);
  };
  const inHand = run !== null && (run.running || run.error !== null);
  return (
    <View>
      <StateHeading headingRef={headingRef}>{IMPORT_WORDS["import.state.uploading"]}</StateHeading>
      {Platform.OS !== "web" ? (
        <Line>{IMPORT_WORDS["import.webOnly"]}</Line>
      ) : inHand ? (
        <>
          <View className="mt-4 gap-2">
            <Text variant="body-strong" aria-hidden>
              {uploaded(received, view.declaredBytes)}
            </Text>
            <ProgressBar label={IMPORT_WORDS["import.bar.upload"]} value={received} max={view.declaredBytes} valueText={uploaded(received, view.declaredBytes)} />
          </View>
          <VisuallyHidden role="status">{said}</VisuallyHidden>
          <Line>{IMPORT_WORDS["import.uploading"]}</Line>
          {run.error !== null ? (
            <>
              <ErrorText message={run.error.message} />
              <Button label={UI_WORDS["error.retry"]} tone="secondary" full={false} onPress={() => void again()} />
            </>
          ) : null}
        </>
      ) : (
        <>
          <Line>{fill(IMPORT_WORDS["import.resume"], { done: formatBytes(view.receivedBytes), total: formatBytes(view.declaredBytes) })}</Line>
          <View className="mt-2">
            <ArchiveButton source={view.source} expectedBytes={view.declaredBytes} onFile={(file) => startUpload(view, file)} />
          </View>
        </>
      )}
      <View className="mt-2">
        <CancelImport view={view} onView={onView} />
      </View>
    </View>
  );
}

/**
 * Reading (10.3): an indeterminate spinner, named by the sentence it stands for, turning as the auth screens' does, and
 * under reduced motion the import icon standing still in its place; the sentence, and Cancel import.
 */
function Reading({ view, headingRef, onView }: { view: ImportView; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  const motion = useMotion();
  const spin = useSpin();
  return (
    <View>
      <StateHeading headingRef={headingRef}>{IMPORT_WORDS["import.state.scanning"]}</StateHeading>
      <View className="mt-4 flex-row items-start gap-3">
        <View role="progressbar" aria-label={IMPORT_WORDS["import.reading"]} className="h-7 w-7 items-center justify-center">
          {motion.reduced ? (
            <View {...({ dataSet: { reading: "still" } } as object)}>
              <Icon name="import" size={24} tone="accent" />
            </View>
          ) : (
            <Animated.View style={spin} {...({ dataSet: { reading: "spin" } } as object)}>
              <View className="h-7 w-7 rounded-full border-[3px] border-x-accent border-b-accent border-t-accent/20" />
            </Animated.View>
          )}
        </View>
        <Text tone="medium" className="flex-1">
          {IMPORT_WORDS["import.reading"]}
        </Text>
      </View>
      <View className="mt-2">
        <CancelImport view={view} onView={onView} />
      </View>
    </View>
  );
}

/** An import that uploads or is being read. */
export function UploadProgress({ view, run, headingRef, onView }: { view: ImportView; run: UploadRunState | null; headingRef?: Ref<View>; onView: (next: ImportView) => void }) {
  return view.status === "scanning" ? <Reading view={view} headingRef={headingRef} onView={onView} /> : <Uploading view={view} run={run} headingRef={headingRef} onView={onView} />;
}
