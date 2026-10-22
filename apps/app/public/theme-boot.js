// korbat's first frame (UI design, section 4.2). The page's policy allows no inline script, so this plain file runs
// first in the head, before the bundle and its stylesheet: it reads the reader's appearance as src/lib/appearance.ts
// stores it, resolves System with the system's scheme, and marks the html element with the theme's class, the text
// step and the font. The stylesheet that holds the colours has not arrived yet, so the page's surface and ink-high
// are carried here too (test/contrast.test.ts holds them equal to src/theme/tokens.ts). Any failure leaves the default.
(function () {
  var COLOURS = { light: ["#F6F5F9", "#15131B"], dim: ["#1B1A24", "#F1EFF6"], dark: ["#100F16", "#F3F1F7"] };
  var stored = {};
  try {
    var parsed = JSON.parse(window.localStorage.getItem("korbat.appearance") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
  } catch (error) {
    stored = {};
  }
  var pick = function (value, choices, fallback) {
    return choices.indexOf(value) >= 0 ? value : fallback;
  };
  var theme = pick(stored.theme, ["system", "light", "dim", "dark"], "system");
  if (theme === "system") {
    var dark = false;
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (error) {
      dark = false;
    }
    theme = dark ? pick(stored.darkStyle, ["dim", "dark"], "dark") : "light";
  }
  var root = document.documentElement;
  root.classList.remove("light", "dim", "dark");
  root.classList.add(theme);
  root.setAttribute("data-text-step", pick(stored.textStep, ["smaller", "default", "larger", "largest"], "default"));
  root.setAttribute("data-font", pick(stored.font, ["korbat", "system"], "korbat"));
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  root.style.backgroundColor = COLOURS[theme][0];
  root.style.color = COLOURS[theme][1];
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", COLOURS[theme][0]);
})();
