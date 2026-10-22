import type { ThemeName } from "./tokens";

/**
 * On web the variables come from global.css, switched by the class `light`, `dim` or `dark` on the html element or on a
 * forced scope's own element, so a View needs no style for them (scope.ts is the native side).
 */
export function scopeStyle(_theme: ThemeName): undefined {
  return undefined;
}
