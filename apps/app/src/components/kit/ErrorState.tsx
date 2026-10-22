import { useEffect } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { UI_WORDS } from "@/lib/ui-words";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * What a list or a screen shows when it could not load (UI design, sections 6.12 and 8.11): what happened, as an alert,
 * and "Try again". Offline it says so in its own words, "You're offline", with the same Try again, and when the browser
 * reports that the connection is back it tries once by itself.
 */

/** The browser's navigator, typed locally and read only where there is one: Node and native have none with onLine. */
const runtime = globalThis as unknown as { navigator?: { onLine?: boolean } };

/** A request that got no answer at all (lib/api.ts throws ApiError status 0, "network"), or a browser that says it is offline. */
export function isOffline(error?: unknown): boolean {
  if (error instanceof ApiError && error.status === 0) return true;
  return runtime.navigator?.onLine === false;
}

/** Where the "online" event fires: the window on the web; anything without addEventListener (native, Node) fires none. */
interface OnlineTarget {
  addEventListener?: (type: "online", listener: () => void) => void;
  removeEventListener?: (type: "online", listener: () => void) => void;
}

/** Calls `retry` once, the first time `target` says the connection is back; the function returned stops waiting. */
export function retryWhenOnline(retry: () => void, target: OnlineTarget = globalThis as unknown as OnlineTarget): () => void {
  if (typeof target.addEventListener !== "function") return () => undefined;
  let waiting = true;
  const once = () => {
    if (!waiting) return;
    waiting = false;
    target.removeEventListener?.("online", once);
    retry();
  };
  target.addEventListener("online", once);
  return () => {
    waiting = false;
    target.removeEventListener?.("online", once);
  };
}

export function ErrorState({ message, onRetry, offline = isOffline() }: { message: string; onRetry: () => void; offline?: boolean }) {
  useEffect(() => (offline ? retryWhenOnline(onRetry) : undefined), [offline, onRetry]);
  return (
    <View className="items-center gap-3 px-6 py-12">
      <Icon name={offline ? "offline" : "error"} size={24} tone={offline ? "low" : "danger"} />
      {offline ? (
        <View accessibilityRole="alert" className="items-center gap-2">
          <Text as="h2" variant="display-3" className="text-center">
            {UI_WORDS["offline.title"]}
          </Text>
          <Text tone="medium" className="max-w-[440px] text-center">
            {UI_WORDS["offline.body"]}
          </Text>
        </View>
      ) : (
        <Text accessibilityRole="alert" tone="danger" className="max-w-[440px] text-center">
          {message}
        </Text>
      )}
      <Button label={UI_WORDS["error.retry"]} tone="secondary" full={false} onPress={onRetry} />
    </View>
  );
}
