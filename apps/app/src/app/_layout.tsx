import "../../global.css";
import { Stack } from "expo-router";
import { SessionProvider } from "@/lib/session";
import { installFonts } from "@/theme/fonts";
import { ThemeProvider } from "@/theme/ThemeProvider";

// The font rules go in before the first render, so text set in korbat's faces asks for its file at once (web only).
installFonts();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </ThemeProvider>
  );
}
