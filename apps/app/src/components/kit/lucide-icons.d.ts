/**
 * lucide-react 1.55.0 publishes one module per icon (dist/esm/icons/<name>.mjs), each exporting the icon as its default,
 * but types only for its main entry. kit/Icon.web.tsx imports the icons one module at a time, so the web bundle holds
 * only the icons korbat draws; this declaration gives each module the main entry's own LucideIcon type.
 */
declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type { LucideIcon } from "lucide-react";
  const icon: LucideIcon;
  export default icon;
}
