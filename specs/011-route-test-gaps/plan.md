# Plan 011: Route test gaps

Add the cases to the existing real-route integration test. It already builds `createApp`, a synthetic Access JWT, and a sqlite `TenantPolicy`.

## Security & data

The JWT key, the HMAC secrets, and the email stay synthetic. The restore body is the temporary tenant's own snapshot. No network.
