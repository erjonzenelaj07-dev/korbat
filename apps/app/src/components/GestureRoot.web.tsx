import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * The gesture root on the web: a plain View, as react-native-gesture-handler's own root view is there (its web file only
 * adds a context that its GestureDetector does not ask for on the web). Importing the package's index for it would put
 * the whole of gesture handler into the web bundle, about 55 KB gzip, for nothing; a screen whose gestures need the
 * package on the web brings it with them. GestureRoot.tsx is the package's root view on iOS and Android.
 */
export function GestureHandlerRootView({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View style={style ?? { flex: 1 }}>{children}</View>;
}
