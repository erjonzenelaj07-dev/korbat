import "./zod-jitless";
import { createRoot } from "react-dom/client";
import { createStaffApi } from "./api";
import { App } from "./App";
import type { SignalApi } from "./enroll";
import { systemClock } from "./idle";
import { createConsoleStore } from "./store";
import "./app.css";

// The staff console's entry (3a design, section 9). The first import makes zod jitless before the contracts build their
// schemas; esbuild keeps that order in the bundle. The page talks only to /api/staff/* on its own origin.

const api = createStaffApi({ fetch: (input, init) => window.fetch(input, init), cookie: () => document.cookie });
const store = createConsoleStore({ api, history: window.history, clock: systemClock, path: window.location.pathname });
window.addEventListener("popstate", () => store.popped(window.location.pathname));

const container = document.getElementById("root");
if (!container) throw new Error("the console's page has no #root element");
// The Signal API is a static method of PublicKeyCredential where the browser has it; the enrolment page checks for it.
const signal = (window as unknown as { PublicKeyCredential?: SignalApi }).PublicKeyCredential;
createRoot(container).render(<App store={store} credentials={navigator.credentials} signal={signal} />);
void store.start();
