// The app's entry (package.json's main). zod is made jitless first, before expo-router reads the route files, whose
// layouts it loads while it builds the route tree and which build the contracts' schemas as they are imported; then
// expo-router's own entry starts the app. src/lib/zod-jitless.ts says why.
import "./src/lib/zod-jitless";
import "expo-router/entry";
