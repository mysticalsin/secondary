// Dev mock for the v8 Review desk endpoints (docs/API-CONTRACT.md "v8 Review desk"). Synthetic data only.
import { NOT_HANDLED } from "./uxv2";

export function handleV8Review(
  _method: "GET" | "POST" | "PUT" | "DELETE",
  _p: string,
  _params: URLSearchParams,
  _body: Record<string, unknown>,
  _role: string,
): unknown {
  return NOT_HANDLED;
}
