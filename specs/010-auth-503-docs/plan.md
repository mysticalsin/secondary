# Plan 010: Keep the 503 classification

Copy the two files from `578de37a` with `git checkout`. Read them for secrets before the commit. Add the status note only because the bundle's `auth_unconfigured` guard is not the worker on `ad04f08`.

## Security & data

The files hold a synthetic issuer name, a synthetic audience, and a placeholder HMAC of repeated `x`. They hold no live token, no real email, and no vault content. The repro generates a throwaway RSA public key in memory and does not call the network when it is used as written.
