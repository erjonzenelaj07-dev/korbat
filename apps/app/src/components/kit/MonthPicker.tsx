import { useId, useState } from "react";
import { Pressable, View } from "react-native";
import { buttonFace, Button, LABEL_TONE } from "@/components/ui";
import { IMPORT_WORDS } from "@/lib/import-words";
import { monthWords } from "@/lib/time";
import { Icon } from "./Icon";
import { ListRow, RadioGroup } from "./ListRow";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * The months of a list as a radio group (3b design, section 10.1): one ListRow radio a month, written out ("March 2019"),
 * the chosen one the group's one tab stop, the arrows choosing at once (kit/ListRow.tsx's RadioGroup). Named by the
 * element whose id is `labelledBy`.
 */
export function MonthChoices({ labelledBy, months, value, onChange }: { labelledBy: string; months: readonly string[]; value: string; onChange: (month: string) => void }) {
  return (
    <RadioGroup labelledBy={labelledBy}>
      {months.map((month) => (
        <ListRow key={month} label={monthWords(month)} control={{ kind: "radio", checked: month === value, onSelect: () => onChange(month) }} />
      ))}
    </RadioGroup>
  );
}

/**
 * A month chosen from the scan's months (3b design, sections 10.1 and 10.4): a button that shows its label and the chosen
 * month ("From April 2019") and opens a Sheet holding MonthChoices and a Done button, since React Native has no native
 * select on its three platforms. A choice is taken at once, so the arrows can walk the months, and Done, Escape or the
 * scrim close the sheet; the focus then returns to the button. The sheet is mounted only while it is open or closing.
 */
export function MonthPicker({ label, months, value, onChange }: { label: string; months: readonly string[]; value: string; onChange: (month: string) => void }) {
  const [sheet, setSheet] = useState({ mounted: false, open: false });
  const groupId = useId();
  const close = () => setSheet({ mounted: true, open: false });
  return (
    <>
      <Pressable accessibilityRole="button" aria-haspopup="dialog" aria-expanded={sheet.open} onPress={() => setSheet({ mounted: true, open: true })} className={buttonFace({ face: "secondary", size: "md" })}>
        <Text variant="body-strong" tone={LABEL_TONE.secondary}>
          {label}
        </Text>
        <Text tone="medium" className="shrink">
          {monthWords(value)}
        </Text>
        <Icon name="next" size={16} tone="low" />
      </Pressable>
      {sheet.mounted ? (
        <Sheet open={sheet.open} onClose={close} onClosed={() => setSheet({ mounted: false, open: false })} title={label} size="tall" initialFocus="first">
          <VisuallyHidden nativeID={groupId}>{label}</VisuallyHidden>
          <MonthChoices labelledBy={groupId} months={months} value={value} onChange={onChange} />
          <View className="px-4 pb-4">
            <Button label={IMPORT_WORDS["import.month.done"]} tone="secondary" onPress={close} />
          </View>
        </Sheet>
      ) : null}
    </>
  );
}
