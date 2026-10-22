import { closeNewPost, useNewPostOpen } from "@/lib/composing";
import { insertPosted } from "@/lib/feed-cache";
import { useSession } from "@/lib/session";
import { ComposeSheet } from "./ComposeSheet";

/**
 * The app's one New post sheet (UI design, sections 7.2, 7.3 and 8.6), mounted once in the root layout beside the
 * screens, as the Toaster is: the nav's New post and the phone's compose button open it from any screen
 * (lib/composing.ts). A post sent from it goes on top of Home's Following and Latest (lib/feed-cache.ts, which also
 * tells a Home still mounted under the screen), and the composer's toast says where it is. A reader who is signed out
 * has no sheet.
 */
export function ComposeHost() {
  const open = useNewPostOpen();
  const { state } = useSession();
  if (state.status !== "signed-in") return null;
  const reader = state.me.user.id;
  return <ComposeSheet open={open} onClose={closeNewPost} onPosted={(post) => insertPosted(reader, post)} />;
}
