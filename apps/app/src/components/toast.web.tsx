import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster as Sonner, toast as sonner } from "sonner";
import { useMotion } from "@/lib/motion";
import { TOAST_LIMIT, toastDuration, toastOffset, useComposeButtonShown, type ToastInput } from "@/lib/toast-rules";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/ThemeProvider";
import { ToastCard } from "./ToastCard";

/**
 * Toasts on the web (UI design, section 5.4), through sonner 2.0.8. sonner places, stacks, times and swipes them, and its
 * region is a polite live region whose hotkey, Alt+T, moves the focus into it, so a toast's action is reachable from the
 * keyboard; korbat draws each toast itself (ToastCard), since sonner's own look has a shadow and a 24 px action button.
 * Timers pause while a toast is hovered, while the focus is inside the toaster and while the page is hidden (sonner's
 * own behaviour). toast.tsx is the same API on iOS and Android.
 */
export const toast = {
  show(input: ToastInput): void {
    sonner.custom(
      (id) => (
        <ToastCard
          message={input.message}
          tone={input.tone}
          action={input.action?.label}
          onAction={
            input.action === undefined
              ? undefined
              : () => {
                  input.action?.onPress();
                  sonner.dismiss(id);
                }
          }
        />
      ),
      { duration: toastDuration(input) },
    );
  },
};

/**
 * The one toaster, mounted in the root layout inside the theme: bottom centre, at most three, above the tab bar and the
 * compose button on phones. Under reduced motion (the system's, which sonner also follows, or korbat's own Always) every
 * toast takes the class k-still, whose rule in theme/fonts.web.ts's style element keeps it from moving: it only fades.
 */
export function Toaster() {
  const theme = useTheme();
  const motion = useMotion();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const composeButton = useComposeButtonShown();
  const bottom = toastOffset({ layout, bottomInset: insets.bottom, composeButton });
  return (
    <Sonner
      position="bottom-center"
      visibleToasts={TOAST_LIMIT}
      theme={theme.scheme}
      gap={8}
      // sonner switches to its mobile offset below 600 px; korbat's phone layout runs to 768 px, so both are set.
      offset={{ bottom }}
      mobileOffset={{ bottom, left: 16, right: 16 }}
      toastOptions={{ className: motion.reduced ? "k-still" : undefined }}
    />
  );
}
