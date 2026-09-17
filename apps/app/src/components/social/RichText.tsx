import { Linking, Text } from "react-native";
import { router } from "expo-router";

/** Links and @handles become tappable; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

export function RichText({ body, className = "text-base leading-6 text-zinc-100" }: { body: string; className?: string }) {
  const parts = body.split(TOKEN);
  return (
    <Text className={className}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Text key={index} accessibilityRole="link" className="text-sky-400 underline" onPress={() => void Linking.openURL(part)}>
              {part}
            </Text>
          );
        }
        if (/^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Text key={index} accessibilityRole="link" className="text-sky-400" onPress={() => router.push(`/u/${part.slice(1).toLowerCase()}`)}>
              {part}
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}
