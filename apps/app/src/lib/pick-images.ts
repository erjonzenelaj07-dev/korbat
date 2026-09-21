import { Platform } from "react-native";
import { MEDIA_ACCEPTED_TYPES } from "@korbat/contracts";

/** Whether this platform can choose image files. The web can; native gets a picker with the native builds. */
export const canPickImages = Platform.OS === "web";

/**
 * Opens the browser's file dialog, limited to the image types korbat accepts, and resolves with the
 * chosen files. Dismissing the dialog resolves with none. The input element is created for one use
 * and never attached to the page.
 */
export function pickImages(): Promise<File[]> {
  if (!canPickImages) return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MEDIA_ACCEPTED_TYPES.join(",");
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
