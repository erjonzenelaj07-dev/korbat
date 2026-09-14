import { MemoryKv } from "../../src/auth/kv";
import { kvContract } from "./kv-contract";

kvContract("memory", () => new MemoryKv());
