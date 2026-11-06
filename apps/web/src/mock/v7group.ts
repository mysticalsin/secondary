// Dev mock for the privacy approver group: GET and PUT /v1/rules/groups (platform admin only, 404 for others).
import { ApiError } from "../api";
import { NOT_HANDLED } from "./uxv2";

let members: string[] = [];

export function resetGroupMock(): void {
  members = [];
}

export function handleV7Group(
  method: string,
  p: string,
  body: Record<string, unknown>,
  role: string,
): unknown {
  if (p !== "/v1/rules/groups") return NOT_HANDLED;
  if (role !== "platform_admin") throw new ApiError(404, "Not found.", { error: "not_found" });
  if (method === "GET")
    return {
      privacy: members.map((id) => ({
        id,
        email: id.startsWith("u_") ? `${id.slice(2)}@example.invalid` : null,
      })),
    };
  if (method === "PUT") {
    const ids = body.privacy;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
      throw new ApiError(400, "Send a list of ids.", { error: "invalid_privacy" });
    members = [...new Set(ids as string[])];
    return { ok: true };
  }
  return NOT_HANDLED;
}
