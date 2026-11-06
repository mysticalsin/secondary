import { initialsOf } from "../../lib/people";
import { roleFill } from "./roles";

/** Initials on the colour of the person's role. Decorative: the name and the role are written beside it. */
export function Avatar({ name, role, size = 32 }: { name: string; role: string; size?: number }) {
  return (
    <span
      className="av8"
      aria-hidden
      style={{ background: roleFill(role), width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsOf(name)}
    </span>
  );
}
