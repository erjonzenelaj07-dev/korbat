import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ImportSource, type ImportView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ArchiveButton, type ChosenFile } from "@/components/import/UploadProgress";
import { SourcePicker } from "@/components/import/SourcePicker";
import { ErrorState } from "@/components/kit/ErrorState";
import { ListRow } from "@/components/kit/ListRow";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { Button, ErrorText, SectionRows } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { IMPORT_WORDS } from "@/lib/import-words";
import { formatBytes, importErrorMessage, imports, startUpload, type ImportList } from "@/lib/imports";
import { usePageTitle } from "@/lib/page-title";
import { localDay } from "@/lib/time";
import { fill } from "@/lib/ui-words";

/**
 * Settings, Import posts (3b design, sections 10.1 and 10.2): what an import is and the two sentences of decision 28,
 * Where from? with the sources the site has on, then for the chosen source how to get its archive and what korbat reads,
 * never reads and lets the person delete first; Choose your archive, which checks the file before anything is sent; and
 * with a good file, its name and size and Upload and read, which creates the import, starts the upload and moves to the
 * import's screen. Your imports lists the account's imports below. The web is the only platform for now: on iOS and
 * Android the screen says so and offers no file (sub-project 5 brings the picker there).
 */
export function ImportStart({ sources, imports: list, initialSource = null }: { sources: readonly ImportSource[]; imports: readonly ImportView[]; initialSource?: ImportSource | null }) {
  const [source, setSource] = useState<ImportSource | null>(initialSource !== null && sources.includes(initialSource) ? initialSource : null);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (source === null || file === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await imports.create(source, file.size);
      // The upload goes on in this tab while the person is on the import's screen, which follows it.
      startUpload(created, file);
      router.push(`/settings/import/${created.id}`);
    } catch (err) {
      setError(importErrorMessage(err, { source, during: "create" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text className="mt-2">{IMPORT_WORDS["import.intro"]}</Text>
      <Text tone="medium" className="mt-3">
        {IMPORT_WORDS["import.found"]}
      </Text>
      <Text tone="medium" className="mt-3">
        {IMPORT_WORDS["import.unchecked"]}
      </Text>
      {Platform.OS !== "web" ? (
        <Text className="mt-6">{IMPORT_WORDS["import.webOnly"]}</Text>
      ) : (
        <>
          <SourcePicker
            sources={sources}
            chosen={source}
            onChoose={(next) => {
              setSource(next);
              setFile(null);
              setError(null);
            }}
          />
          {source !== null && sources.includes(source) ? (
            <View className="mt-4">
              <ArchiveButton
                source={source}
                onFile={(chosen) => {
                  setFile(chosen);
                  setError(null);
                }}
              />
              {file !== null ? (
                <>
                  <Text className="mt-3">{fill(IMPORT_WORDS["import.chosen"], { name: file.name, size: formatBytes(file.size) })}</Text>
                  <Button label={IMPORT_WORDS["import.start"]} busy={busy} full={false} onPress={() => void start()} />
                  <ErrorText message={error} />
                </>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      {list.length > 0 ? (
        <View className="mt-8 overflow-hidden rounded-card border border-line-low bg-surface-1 p-4">
          <Text as="h2" variant="title">
            {IMPORT_WORDS["import.yours"]}
          </Text>
          <SectionRows end>
            {list.map((item) => (
              <ListRow
                key={item.id}
                label={IMPORT_WORDS[`import.source.${item.source}`]}
                description={fill(IMPORT_WORDS["import.row"], { state: IMPORT_WORDS[`import.state.${item.status}`], date: localDay(item.createdAt) })}
                icon="import"
                href={`/settings/import/${item.id}`}
              />
            ))}
          </SectionRows>
        </View>
      ) : null}
    </View>
  );
}

export default function ImportStartScreen() {
  const title = usePageTitle("title.import");
  // "Import the text only" after a refused image opens this screen with its source chosen (10.5).
  const { source } = useLocalSearchParams<{ source?: string }>();
  const [list, setList] = useState<ImportList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    imports.list().then(setList, setError);
  }, []);
  useEffect(load, [load]);
  const asked = ImportSource.safeParse(source);
  return (
    <AppShell>
      {title}
      <ScreenHeader title={IMPORT_WORDS["import.title"]}>
        <SettingsNav current="import" />
      </ScreenHeader>
      <ScreenScroll screen="import">
        {error !== null ? (
          <ErrorState message={errorMessage(error)} onRetry={load} />
        ) : list === null ? (
          <Skeleton.Page />
        ) : (
          <ImportStart sources={list.sources} imports={list.imports} initialSource={asked.success ? asked.data : null} />
        )}
      </ScreenScroll>
    </AppShell>
  );
}
