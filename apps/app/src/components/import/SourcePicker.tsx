import { useId } from "react";
import { View } from "react-native";
import type { ImportSource } from "@korbat/contracts";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { SectionRows } from "@/components/ui";
import { IMPORT_WORDS } from "@/lib/import-words";

/**
 * Where from? (3b design, section 10.2, steps 2 and 3): a radio group of ListRows, one per source the site has on (the
 * `sources` of GET /api/imports, so Bluesky only when the owner turned it on, decision 16), each with its line; once a
 * source is chosen, how to get its archive as numbered steps, what korbat reads and never reads, the transit, and what
 * the person may delete from the archive first (decisions 4 and 28).
 */

/** The steps of import.how.<source>, written as "1. ... 2. ...", as a list of their sentences. */
export function howSteps(source: ImportSource): string[] {
  return IMPORT_WORDS[`import.how.${source}`]
    .split(/(?:^|\s)[0-9]+\.\s/)
    .map((step) => step.trim())
    .filter((step) => step !== "");
}

/** A heading inside the start's card, level 3, under Where from?'s level 2. */
function Subheading({ children }: { children: string }) {
  return (
    <Text as="h3" variant="body-strong" className="mt-5">
      {children}
    </Text>
  );
}

export function SourcePicker({ sources, chosen, onChoose }: { sources: readonly ImportSource[]; chosen: ImportSource | null; onChoose: (source: ImportSource) => void }) {
  const headingId = useId();
  return (
    <View className="mt-8 overflow-hidden rounded-card border border-line-low bg-surface-1 p-4">
      <Text as="h2" variant="title" nativeID={headingId}>
        {IMPORT_WORDS["import.whereFrom"]}
      </Text>
      {sources.length === 0 ? (
        <Text tone="medium" className="mt-2">
          {IMPORT_WORDS["import.unavailable"]}
        </Text>
      ) : (
        <SectionRows end={chosen === null}>
          <RadioGroup labelledBy={headingId}>
            {sources.map((source) => (
              <ListRow key={source} label={IMPORT_WORDS[`import.source.${source}`]} description={IMPORT_WORDS[`import.source.${source}.desc`]} control={{ kind: "radio", checked: source === chosen, onSelect: () => onChoose(source) }} />
            ))}
          </RadioGroup>
        </SectionRows>
      )}
      {chosen === null ? null : (
        <View>
          <Subheading>{IMPORT_WORDS["import.how.title"]}</Subheading>
          <View role="list" className="mt-2 gap-2">
            {howSteps(chosen).map((step, index) => (
              <View key={step} role="listitem" className="flex-row gap-2">
                <Text tone="medium" aria-hidden>
                  {`${index + 1}.`}
                </Text>
                <Text className="flex-1">{step}</Text>
              </View>
            ))}
          </View>
          <Subheading>{IMPORT_WORDS["import.reads.title"]}</Subheading>
          <Text tone="medium" className="mt-1">
            {IMPORT_WORDS["import.reads.body"]}
          </Text>
          <Subheading>{IMPORT_WORDS["import.never.title"]}</Subheading>
          <Text tone="medium" className="mt-1">
            {IMPORT_WORDS[`import.never.${chosen}`]}
          </Text>
          <Text tone="medium" className="mt-4">
            {IMPORT_WORDS["import.transit"]}
          </Text>
          <Text tone="medium" className="mt-2">
            {IMPORT_WORDS[`import.trim.${chosen}`]}
          </Text>
        </View>
      )}
    </View>
  );
}
