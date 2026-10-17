import { defineInstructions } from "eve/instructions";
import { readFileSync } from "node:fs";
// Eve compiles static instructions from the shared prompt directory at build time.
export default defineInstructions({
  content: readFileSync("../prompts/eve/system.md", "utf8"),
});
