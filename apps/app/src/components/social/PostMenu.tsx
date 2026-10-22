import { useState, type RefObject } from "react";
import { Platform, type View } from "react-native";
import type { MeResponse, PostView } from "@korbat/contracts";
import { Menu, MenuPanel, type MenuItem } from "@/components/kit/Menu";
import { toast } from "@/components/toast";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { useLayout } from "@/theme/layout";
import { WhoSeesThis } from "./WhoSeesThis";

/**
 * A post's More menu (UI design, section 6.6 and decision 12): Who sees this, with its one-line summary; Copy link, on the
 * web, which says "Link copied"; Delete for the post's author, in danger; and Report for everyone else, signed in or out,
 * as a link to the report form, since the form is a page of its own. Report left the visible row for this menu.
 */
export function postMenuItems(post: PostView, me: MeResponse | null, handlers: { onDelete: () => void; onWhoSees: () => void }): MenuItem[] {
  const own = me !== null && post.author.id === me.user.id;
  const items: MenuItem[] = [{ label: UI_WORDS["post.whoSees"], icon: "who-sees", description: reach(post, me).summary, onSelect: handlers.onWhoSees }];
  // Native shares through the system's sheet, which sub-project 5 brings; a link to copy is the web's.
  if (Platform.OS === "web") items.push({ label: UI_WORDS["post.copyLink"], icon: "copy-link", onSelect: () => void copyLink(post.id) });
  if (own) items.push({ label: UI_WORDS["post.delete"], icon: "delete", tone: "danger", onSelect: handlers.onDelete });
  else items.push({ label: REPORT_WORDS.control, icon: "report", href: reportHref({ post: post.id }) });
  return items;
}

/** The post's address on this site, on the clipboard; a browser that refuses the clipboard is told nothing went there. */
async function copyLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/post/${id}`);
    toast.show({ message: UI_WORDS["toast.linkCopied"] });
  } catch {
    // Without the clipboard there is nothing to confirm; the post's own link is still in the card.
  }
}

/** The menu drawn open, for the render tests: the items a reader gets for this post. */
export function PostMenuPanel({ post, onDelete, onWhoSees }: { post: PostView; onDelete: () => void; onWhoSees: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const layout = useLayout() === "phone" ? "phone" : "wide";
  return <MenuPanel label={UI_WORDS["post.more"]} items={postMenuItems(post, me, { onDelete, onWhoSees })} layout={layout} onPick={() => undefined} />;
}

/**
 * The More button and what it opens. `triggerRef` is the card's, which the delete question gives the focus back to when
 * it is withdrawn; Who sees this opens once the menu has closed, so its sheet hands the focus back to More too.
 */
export function PostMenu({ post, onDelete, triggerRef }: { post: PostView; onDelete: () => void; triggerRef: RefObject<View | null> }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  // Who sees this is mounted while it is open or leaving, as the menus are (kit/Menu.tsx says why).
  const [seeing, setSeeing] = useState({ mounted: false, open: false });
  return (
    <>
      <Menu label={UI_WORDS["post.more"]} icon="more" items={postMenuItems(post, me, { onDelete, onWhoSees: () => setSeeing({ mounted: true, open: true }) })} triggerRef={triggerRef} />
      {seeing.mounted ? (
        <WhoSeesThis post={post} open={seeing.open} onClose={() => setSeeing({ mounted: true, open: false })} onClosed={() => setSeeing({ mounted: false, open: false })} />
      ) : null}
    </>
  );
}
