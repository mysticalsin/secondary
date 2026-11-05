#!/usr/bin/env bash
# Kept for muscle memory: the dev deploy is scripts/deploy.sh dev.
exec "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" dev
