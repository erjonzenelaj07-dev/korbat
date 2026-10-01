// Types for dev-server.mjs, which the tests import; the script itself runs in Node without a compiler.
import type { Server } from "node:http";

export declare function createDevServer(options: { dist: string; api: string }): Server;
export declare function parsePort(args: string[]): number;
