#!/usr/bin/env bash
set -euo pipefail

if command -v awb >/dev/null 2>&1; then
  printf 'awb\n'
  exit 0
fi

if command -v opencli >/dev/null 2>&1 && opencli awb --help >/dev/null 2>&1; then
  printf 'opencli awb\n'
  exit 0
fi

printf 'No usable AWB CLI found. Install `@lingjingai/awb-cli` or install the AWB opencli plugin first.\n' >&2
exit 1
