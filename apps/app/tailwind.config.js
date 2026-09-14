/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  // "class" (not the default "media"): the theme is switched by the app, and NativeWind's web
  // runtime throws in dev mode under "media" when Metro injects the stylesheet.
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
