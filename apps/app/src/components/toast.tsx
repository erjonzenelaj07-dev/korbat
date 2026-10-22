import { AccessibilityInfo } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster as NativeToaster, toast as nativeToast } from "sonner-native";
import { useMotion } from "@/lib/motion";
import { TOAST_LIMIT, toastDuration, toastOffset, useComposeButtonShown, type ToastInput } from "@/lib/toast-rules";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/ThemeProvider";
import { ToastCard } from "./ToastCard";

/**
 * Toasts on iOS and Android (UI design, section 5.4), through sonner-native 0.27.0, with the API of toast.web.tsx. A
 * toast is also announced to the screen reader, with its action's word, since a native toast is no live region; its
 * timer pauses while it is touched, and it can be swiped away.
 */
let next = 0;

export const toast = {
  show(input: ToastInput): void {
    next += 1;
    const id = `korbat-${next}`;
    nativeToast.custom(
      <ToastCard
        message={input.message}
        tone={input.tone}
        action={input.action?.label}
        onAction={
          input.action === undefined
            ? undefined
            : () => {
                input.action?.onPress();
                nativeToast.dismiss(id);
              }
        }
      />,
      { id, duration: toastDuration(input), unstyled: true },
    );
    AccessibilityInfo.announceForAccessibility(input.action === undefined ? input.message : `${input.message} ${input.action.label}`);
  },
};

/** The fade that replaces a toast's movement under korbat's own "Reduce motion: Always" (150 ms, opacity only). */
const STILL = { enter: FadeIn.duration(150), exit: FadeOut.duration(150) };

/**
 * The one toaster, mounted in the root layout inside the theme: bottom centre, at most three, above the tab bar and the
 * compose button on phones. sonner-native drops its own movement under the system's reduced motion (it reads
 * Reanimated's useReducedMotion()); under korbat's "Always" it is given the fade instead.
 */
export function Toaster() {
  const theme = useTheme();
  const motion = useMotion();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const composeButton = useComposeButtonShown();
  return (
    <NativeToaster
      position="bottom-center"
      visibleToasts={TOAST_LIMIT}
      theme={theme.scheme}
      gap={8}
      offset={toastOffset({ layout, bottomInset: insets.bottom, composeButton })}
      animation={motion.reduced ? STILL : undefined}
    />
  );
}
