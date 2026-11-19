// The gate between what wrote an answer (a model, or the deterministic planner) and the stream: every
// finished line must be one statement of a registered component whose props pass the contract checks
// (`lineOk`), and every brain id it names must be one the caller may open. Anything else is dropped and
// counted, never sent. The assembled program must also read as a view with a root, or there is no answer.

import {
  brainRefs,
  clean,
  lineOk,
  parseAgentProgram,
  toView,
  viewOfProgram,
} from "../../../packages/contracts/src/agent-ui/index.ts";

export interface Checked {
  lines: string[];
  dropped: number;
}

/** The brain ids one line names (its own props and its buttons' values). Empty for a bad line. */
export function brainsOfLine(line: string): string[] {
  const one = line.replace(/^[a-z][A-Za-z0-9_]*\s*=/, "root =");
  const v = toView(parseAgentProgram(one), { pendingOk: true });
  return v.root ? brainRefs(v.root) : [];
}

/** Text in, the lines that may be sent and the count of those that may not. */
export function checkLines(text: string, admitted: ReadonlySet<string>): Checked {
  const c = clean(text);
  const lines: string[] = [];
  let dropped = c.dropped;
  for (const line of c.lines) {
    if (!lineOk(line) || !brainsOfLine(line).every((b) => admitted.has(b))) {
      dropped++;
      continue;
    }
    lines.push(line);
  }
  return { lines, dropped };
}

/** Does this program read as a view with a root? (A program of loose cards is no answer.) */
export const hasRoot = (lines: readonly string[]): boolean =>
  viewOfProgram(lines.join("\n")).root !== null;
