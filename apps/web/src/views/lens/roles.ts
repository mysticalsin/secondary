// Role colours for avatars. Each role keeps one fill from the v5 palette (white text on it was checked
// at 7:1 or better there). The role is always written next to the avatar, never carried by colour alone.
import { cat } from "../../insights/palette";

export const ROLE_ORDER = ["owner", "steward", "editor", "contributor", "reader"] as const;
export type RoleId = (typeof ROLE_ORDER)[number];

export const roleFill = (role: string): string => {
  const i = ROLE_ORDER.indexOf(role as RoleId);
  return i < 0 ? "#4a4a55" : cat(i).fill;
};
