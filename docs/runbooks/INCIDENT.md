# Runbook: incident response

Owner: platform admin on call. Applies to staging and prod. Dev and staging hold synthetic data only; treat prod as real.

## 1. Stop the bleeding (kill switches)

Four switches exist per tenant: `mcp`, `connector`, `ai`, `contribute`. Turning one off needs one person with the configure role and takes effect on the next request (MCP within about 5 seconds at the edge, immediately in the API).

```
curl -sS -X POST "$API/v1/admin/switches" -H "Content-Type: application/json" \
  -H "Cf-Access-Jwt-Assertion: $TOKEN" -d '{"switch":"mcp","enabled":false}'
```

| Symptom | Switch |
|---|---|
| An LLM host is leaking or misusing data, a stolen MCP token | `mcp` |
| A connector syncs the wrong content or ACLs look stale | `connector` |
| The AI processor misbehaves or its key leaked | `ai` |
| Bad or sensitive content is flowing into review | `contribute` |

Check state with `GET /v1/admin/switches`. Each change leaves an audit receipt (`switch_disable`, `switch_enable`).

Turning a switch back on in prod needs two different people: the first POST of `{"enabled":true}` returns 202 `pending`, a second person sends the same request within 24 hours. In dev and staging one person is enough. Turning it off again cancels a pending request.

## 2. Revoke access

- One person: remove them in Entra (SCIM deprovisioning ends the sessions and the next request is refused, because roles and the active flag are read on every request). See OFFBOARDING.md.
- One MCP host or token: revoke the grant in the OAuth provider store (KV `OAUTH_KV`, keys `grant:*` and `token:*`), or switch `mcp` off while you do it. Access tokens live 1 hour, refresh tokens 30 days, so revoke the grant, not only the token.
- Everyone: switch `mcp` off, then rotate `INTERNAL_HMAC_KEY` (KEY-ROTATION.md).

## 3. Rotate what leaked

Follow KEY-ROTATION.md for the secret in question. Rotate first, investigate second, when a key is confirmed exposed.

## 4. Investigate

1. `GET /v1/admin/audit` (Platform admin or Auditor) shows the last 7 days of receipts; `GET /v1/audit/receipts?principal=<id>&days=30` for one person.
2. Logs: one JSON line per request with `requestId`, `principal` (hash), `route`, `status`, `latencyMs`. No content or emails by design, so correlate by `requestId` and the principal hash (`principalHash` in `packages/contracts/src/log.ts`: first 16 hex of SHA-256 of the principal id). Workers Logs may leave the EU (see DPIA-INPUT.md); do not add content to logs.
3. Readiness: `GET /v1/ready` returns `{ready, checks:{do, r2}}`; 503 names the failing dependency.

## 5. Recover

Data damage or loss: RESTORE.md. After recovery, re-enable switches one at a time, watch the logs, record the incident.

## 6. After

Write the timeline from receipts and logs, list the data subjects affected, decide whether a personal data breach notification is due (72 hours to the supervisory authority from awareness; the DPO decides), and add a lesson to `~/.ai-memory/inbox/claude/<YYYY-MM>.md`.
