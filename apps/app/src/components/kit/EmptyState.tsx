import { View } from "react-native";
import type { Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { Button, TextLink } from "@/components/ui";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * What a screen shows when it has nothing to show (UI design, section 6.12): what it will hold and what to do next. The
 * title is a level-2 heading in the display face, under the screen's own title; the body is the screen's existing empty
 * sentence, word for word; one action at most, a link where it leads somewhere and a button where it does something
 * here.
 */
export type EmptyAction = { label: string; href: Href } | { label: string; onPress: () => void };

export function EmptyState({ icon, title, body, action }: { icon?: IconName; title: string; body?: string; action?: EmptyAction }) {
  return (
    <View className="items-center gap-3 px-6 py-12">
      {icon !== undefined ? <Icon name={icon} size={24} tone="low" /> : null}
      <Text as="h2" variant="display-3" className="text-center">
        {title}
      </Text>
      {body !== undefined ? (
        <Text tone="medium" className="max-w-[440px] text-center">
          {body}
        </Text>
      ) : null}
      {action === undefined ? null : "href" in action ? <TextLink label={action.label} href={action.href} /> : <Button label={action.label} tone="secondary" full={false} onPress={action.onPress} />}
    </View>
  );
}
