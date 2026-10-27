/**
 * The contract between the API and the importer (3b design, section 7.1), which talk only through files on two volumes:
 * the API writes import-archives and the importer only reads it; the importer writes import-work and the API only reads
 * it, through openWorkFile, as hostile input. The shapes of what they exchange are packages/contracts' imports.ts.
 */
export * from "./limits";
export * from "./layout";
export * from "./open";
export * from "./summary";
export * from "./lines";
// The importer's stand-in for the API's tests (section 12.1).
export * from "./fixtures";
