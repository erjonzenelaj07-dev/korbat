import "../../global.css";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { Icon } from "@/components/kit/Icon";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { ComposeHost } from "@/components/social/ComposeHost";
import { Text } from "@/components/kit/Text";
import { Toaster } from "@/components/toast";
import { Button, TextLink } from "@/components/ui";
import { SessionProvider } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { installFonts } from "@/theme/fonts";
import { ThemeProvider } from "@/theme/ThemeProvider";

// The font rules go in before the first render, so text set in korbat's faces asks for its file at once (web only).
installFonts();

/**
 * What a screen that threw shows instead of itself (UI design, section 8.11): the public frame with "Something went wrong
 * on this screen", "Try again" (expo-router's retry, which renders the screen again) and "Go to Home". It promises
 * nothing it cannot check, since the boundary does not know what the broken screen had sent, and nothing about the error
 * is shown or leaves the device: korbat has no crash reporting (section 1.7). It renders in place of the layout, so it
 * needs none of the providers below; Text and the theme read the appearance store themselves.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // The error stays in this function: React has already written it to the browser's own console, and that is all.
  void error;
  return (
    <PublicFrame>
      <View className="items-center gap-3 py-12">
        <Icon name="error" size={24} tone="danger" />
        <Text as="h1" variant="display-2" className="text-center">
          {UI_WORDS["crash.title"]}
        </Text>
        <Text tone="medium" className="text-center">
          {UI_WORDS["crash.body"]}
        </Text>
        <Button label={UI_WORDS["crash.retry"]} full={false} onPress={() => void retry()} />
        <TextLink label={UI_WORDS["notFound.action"]} href="/" />
      </View>
    </PublicFrame>
  );
}

/**
 * The root of every screen: the gesture root and the safe areas outside everything (section 7.4), the theme inside them,
 * the session inside the theme, and the one Toaster beside the screens, inside the theme so toasts take its tokens. The
 * app's one New post sheet (Task 6) sits beside the screens inside the session, which it needs for the drafts.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <ComposeHost />
          </SessionProvider>
          <Toaster />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
