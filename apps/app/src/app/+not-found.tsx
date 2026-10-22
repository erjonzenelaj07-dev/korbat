import { ScrollView } from "react-native";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/kit/EmptyState";
import { usePageTitle } from "@/lib/page-title";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * What a mistyped address shows (UI design, section 8.11). Caddy answers every path with the app's page (try_files), so
 * this screen, inside the shell, is what the reader sees: "This page doesn't exist", its one heading, with Go to Home.
 */
export default function NotFound() {
  const title = usePageTitle("title.notFound");
  return (
    <AppShell>
      {title}
      {/* The column does not scroll by itself: at the largest text the words and the link must still be reachable. */}
      <ScrollView contentContainerClassName="flex-grow justify-center">
        <EmptyState level={1} icon="info" title={UI_WORDS["notFound.title"]} action={{ label: UI_WORDS["notFound.action"], href: "/" }} />
      </ScrollView>
    </AppShell>
  );
}
