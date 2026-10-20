/**
 * The contract between the API and the image worker, which talk only through files on two
 * volumes. Each side writes its own volume and reads the other's. See section 2.2 of
 * docs/superpowers/specs/2026-09-18-images-2b-design.md.
 */
export * from "./limits";
export * from "./layout";
export * from "./result";
export * from "./sniff";
// 3d Task 6: the R1 classifier's identity, and the test adapters' fixtures (the scorer's marker).
export * from "./classifier";
export * from "./fixtures";
