# Contract: asset manifest

`deploy/assets/MANIFEST.sha256` is UTF-8 text. This file is not in the repo. A test may write it in a temporary directory.

A real deploy (`deploy.sh` with no arguments) checks the asset directory in this order:

1. If `deploy/assets/UNREPRODUCED` exists, the result is `assets-unreproduced`. The process exits 2. The manifest is not consulted.
2. If `MANIFEST.sha256` is absent, the result is `assets-manifest-missing`. The process exits 2.
3. Otherwise every rule below must hold. A failure is `assets-manifest-mismatch` and exit 2.
4. When every rule holds, the asset check passes. Exit from the guard is 0. This contract does not start Wrangler.

## Line rules

- The file may end with one newline. That newline is not a line.
- Every remaining line is 64 lowercase hex digits, then two spaces, then one relative path. No other text.
- The path uses `/`. It has no leading slash, no backslash, no space, and no empty, `.`, or `..` segment.
- The path is not `MANIFEST.sha256` and not `UNREPRODUCED`.
- A path appears once.
- There is at least one line.

## Directory rules

- The hash is the sha256 of that file's raw bytes.
- Every listed file exists and has that hash.
- Every file under `deploy/assets/` other than `MANIFEST.sha256` is listed. Subdirectories are part of the relative path.
- A symlink, or anything that is not a regular file or a directory, is a mismatch.

## What this repo contains

`deploy/assets/UNREPRODUCED` only. `--dry-run` does not apply this contract.
