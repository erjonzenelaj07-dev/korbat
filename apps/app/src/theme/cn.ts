import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names, dropping the false and empty ones, for NativeWind's className (UI design, section 6.1). There is
 * no merge step: variants written with class-variance-authority never set the same property twice, so two classes
 * never fight over one value.
 */
export function cn(...classes: ClassValue[]): string {
  return clsx(classes);
}
