import { z } from "zod";

// The page runs under require-trusted-types-for 'script' with trusted-types 'none' (3a design, section 3). Unless zod is
// jitless, the first object schema it builds probes whether it may compile code from a string, which the policy reports
// even though zod catches the failure (console-lab.md, probe zod). The contracts build their schemas as soon as they are imported, so
// this module is the entry's first import and imports nothing but zod.
z.config({ jitless: true });
