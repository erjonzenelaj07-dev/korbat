import { assertTestTargets } from "./test-env";

// Runs in every test worker before its suites. The environment a suite really sees is checked here,
// whatever the shell exported, so no suite can reach development data.
assertTestTargets(process.env);
