import { Linking, Platform, Text } from "react-native";
import { Link } from "expo-router";
import { externalLink } from "@/lib/links";

/** Links and @handles become real links; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

export function RichText({ body, className = "text-base leading-6 text-zinc-100" }: { body: string; className?: string }) {
  const parts = body.split(TOKEN);
  return (
    <Text className={className}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Text key={index} className="text-sky-400 underline" {...externalLink(part)} onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(part)}>
              {part}
            </Text>
          );
        }
        if (/^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Link key={index} href={`/u/${part.slice(1).toLowerCase()}`} asChild>
              <Text className="text-sky-400">{part}</Text>
            </Link>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}
