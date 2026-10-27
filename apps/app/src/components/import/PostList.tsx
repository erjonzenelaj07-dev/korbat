import { useCallback, useEffect, useId, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import type { ImportChoice, ImportLineView, ImportSource, ImportView } from "@korbat/contracts";
import { Avatar } from "@/components/kit/Avatar";
import { Checkbox } from "@/components/kit/Checkbox";
import { Icon } from "@/components/kit/Icon";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Field } from "@/components/ui";
import { IMPORT_WORDS, importedLabel } from "@/lib/import-words";
import { formatCount, importErrorMessage, imports, marksPass, monthInChoice, shortened } from "@/lib/imports";
import { UI_WORDS, fill } from "@/lib/ui-words";

/**
 * The list of posts (3b design, section 10.4): every offered line of the archive as it will read, 50 a page, in the
 * archive's order, each with "Leave this one out", the lines the current choice leaves out drawn in ink-low with their
 * reason, and, while images are brought, each image with a field for a description where its source gave none. Each
 * change is saved at once (PUT /api/imports/:id/lines/:ref), so a reload loses nothing; nothing is kept on the device.
 * Samples and lines are not PostViews, so they are drawn as a static card: the person's own name, the label, and the
 * words as plain text, no link, no mention, no action.
 */

/** Who the preview's cards are by: the person importing, as their profile names them. */
export interface CardAuthor {
  displayName: string;
  handle: string;
}

/**
 * A post of the archive as it will read on korbat (10.4): the person's avatar, name and handle, the provenance label as
 * text (the source and the archive's day; ", shortened on import" when the choice cuts it), and the words, plain.
 * `dimmed` draws it in ink-low, for a line the choice leaves out.
 */
export function StaticCard({ author, source, at, text, long = false, cut = false, dimmed = false }: { author: CardAuthor; source: ImportSource; at: string; text: string; long?: boolean; cut?: boolean; dimmed?: boolean }) {
  const shown = long && cut ? shortened(text) : { body: text, cut: false };
  const label = importedLabel({ source, at, shortened: shown.cut });
  const tone = dimmed ? "low" : "high";
  return (
    <View className="flex-row gap-2 py-3">
      <View aria-hidden className="h-11 w-11 items-center justify-center">
        <Avatar account={{ id: author.handle, displayName: author.displayName }} size={40} />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center gap-x-1.5">
          <Text variant="body-strong" tone={tone}>
            {author.displayName}
          </Text>
          <Text variant="mono" tone="low">
            {`@${author.handle}`}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 py-1">
          <Icon name="import" size={16} tone={dimmed ? "low" : "medium"} />
          <Text variant="meta" tone={dimmed ? "low" : "medium"} className="shrink">
            {label.text}
          </Text>
        </View>
        {shown.body !== "" ? (
          <Text variant="post" tone={tone} className="mt-1 web:break-words">
            {shown.body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const MARK_WORDS = [
  [1, "import.dimmed.reply"],
  [2, "import.dimmed.long"],
  [4, "import.dimmed.warning"],
  [8, "import.dimmed.protected"],
] as const;

/** Why the choice leaves a line out, in import.list.dimmed's words; null when it keeps it (a pick by hand is the checkbox's). */
export function dimmedReason(line: Pick<ImportLineView, "at" | "marks">, choice: ImportChoice): string | null {
  if (!monthInChoice(line.at.slice(0, 7), choice)) return IMPORT_WORDS["import.dimmed.month"];
  const refused = MARK_WORDS.find(([bit]) => (line.marks & bit) !== 0 && !marksPass(bit, choice));
  return refused ? IMPORT_WORDS[refused[1]] : null;
}

/** One line of the list, with its checkbox and, while images are brought, its images and their description fields. */
function LineRow({ importId, source, line, choice, images, author, onPick }: { importId: string; source: ImportSource; line: ImportLineView; choice: ImportChoice; images: boolean; author: CardAuthor; onPick: (ref: number, leftOut: boolean, alts: (string | null)[]) => void }) {
  const reasonId = useId();
  const reason = dimmedReason(line, choice);
  const [alts, setAlts] = useState<string[]>(() => line.media.map((_, index) => line.alts[index] ?? ""));
  const saved = (next: string[]) => next.map((alt) => (alt.trim() === "" ? null : alt.trim()));
  return (
    <View {...({ dataSet: { line: String(line.ref) } } as object)} className="border-b border-line-low">
      <StaticCard author={author} source={source} at={line.at} text={line.text} long={(line.marks & 2) !== 0} cut={choice.long === "shorten"} dimmed={reason !== null || line.leftOut} />
      {reason !== null ? (
        <Text nativeID={reasonId} variant="meta" tone="medium" className="pl-[52px]">
          {fill(IMPORT_WORDS["import.list.dimmed"], { reason })}
        </Text>
      ) : null}
      {images && line.media.length > 0 ? (
        <View className="gap-3 pl-[52px] pt-2">
          {line.media.map((media, index) => (
            <View key={media.file} className="gap-1">
              <Image
                source={{ uri: imports.mediaUri(importId, media.file) }}
                accessibilityLabel={media.alt ?? (alts[index]?.trim() || IMPORT_WORDS["import.list.imageNoAlt"])}
                contentFit="cover"
                style={{ width: 120, height: 90, borderRadius: 8 }}
              />
              {media.alt === null ? (
                <Field
                  label={IMPORT_WORDS["import.list.describe"]}
                  value={alts[index] ?? ""}
                  maxLength={1000}
                  multiline
                  onChangeText={(text) => setAlts((current) => current.map((alt, at) => (at === index ? text : alt)))}
                  onBlur={() => onPick(line.ref, line.leftOut, saved(alts))}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View className="pl-[52px]">
        <Checkbox label={IMPORT_WORDS["import.list.leaveOut"]} checked={line.leftOut} describedBy={reason !== null ? reasonId : undefined} onChange={(leftOut) => onPick(line.ref, leftOut, saved(alts))} />
      </View>
    </View>
  );
}

/**
 * The lines loaded so far, with the range they cover and the way to the next page. Presentational: the panel below reads
 * the pages and saves the picks.
 */
export function PostList({
  importId,
  source,
  lines,
  pages,
  page,
  choice,
  images,
  author,
  onPick,
  onPage,
  total,
}: {
  importId: string;
  source: ImportSource;
  lines: readonly ImportLineView[];
  pages: number;
  /** The last page loaded, from 0. */
  page: number;
  choice: ImportChoice;
  images: boolean;
  author: CardAuthor;
  onPick: (ref: number, leftOut: boolean, alts: (string | null)[]) => void;
  onPage: () => void;
  total?: number;
}) {
  return (
    <View className="mt-3">
      {total !== undefined && lines.length > 0 ? (
        <Text variant="meta" tone="medium">
          {fill(IMPORT_WORDS["import.list.range"], { from: "1", to: formatCount(lines.length), total: formatCount(total) })}
        </Text>
      ) : null}
      {lines.map((line) => (
        <LineRow key={line.ref} importId={importId} source={source} line={line} choice={choice} images={images} author={author} onPick={onPick} />
      ))}
      {page + 1 < pages ? <Button label={IMPORT_WORDS["import.list.more"]} tone="secondary" full={false} onPress={onPage} /> : null}
    </View>
  );
}

/**
 * See every post's panel: reads the pages of GET /api/imports/:id/lines one after the other, and saves each pick at once,
 * handing the picks' new counts to the preview (`onPicks`), so its totals stay exact. A pick refused is said under the
 * list and its line keeps what the API holds.
 */
export function PostListPanel({ view, choice, images, author, onPicks }: { view: ImportView; choice: ImportChoice; images: boolean; author: CardAuthor; onPicks: (picks: ImportView["picks"]) => void }) {
  const [lines, setLines] = useState<ImportLineView[]>([]);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (next: number) => {
      setLoading(true);
      setError(null);
      try {
        const answer = await imports.lines(view.id, next);
        setLines((current) => [...current, ...answer.lines.filter((line) => !current.some((held) => held.ref === line.ref))]);
        setPages(answer.pages);
        setPage(next);
      } catch (err) {
        setError(importErrorMessage(err, { during: "act" }));
      } finally {
        setLoading(false);
      }
    },
    [view.id],
  );
  useEffect(() => {
    void load(0);
  }, [load]);
  const pick = async (ref: number, leftOut: boolean, alts: (string | null)[]) => {
    setLines((current) => current.map((line) => (line.ref === ref ? { ...line, leftOut } : line)));
    try {
      const answer = await imports.pick(view.id, ref, { leftOut, alts: alts.slice(0, 4) });
      setLines((current) => current.map((line) => (line.ref === ref ? { ...line, leftOut: answer.leftOut, alts: answer.alts } : line)));
      onPicks(answer.picks);
    } catch (err) {
      setLines((current) => current.map((line) => (line.ref === ref ? { ...line, leftOut: !leftOut } : line)));
      setError(importErrorMessage(err, { during: "act" }));
    }
  };
  return (
    <View>
      <PostList
        importId={view.id}
        source={view.source}
        lines={lines}
        pages={pages}
        page={page}
        choice={choice}
        images={images}
        author={author}
        onPick={(ref, leftOut, alts) => void pick(ref, leftOut, alts)}
        onPage={() => void load(page + 1)}
        total={view.scan?.posts}
      />
      {loading ? <Skeleton.Page /> : null}
      <ErrorText message={error} />
      {error !== null && page < 0 ? <Button label={UI_WORDS["error.retry"]} tone="secondary" full={false} onPress={() => void load(0)} /> : null}
    </View>
  );
}
