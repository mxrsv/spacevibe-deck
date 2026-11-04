#!/bin/sh
# Format, typecheck, lint and test just the files you touched — the pre-push
# checks plus `tsc`, run on demand. No arguments: every modified or untracked
# file in the working tree. Prettier rewrites the files it formats.
set -eu

if [ "$#" -gt 0 ]; then
  files="$*"
else
  files=$(git status --porcelain | cut -c4-)
fi

existing=""
sources=""
tests=""
mobile=""
for file in $files; do
  [ -f "$file" ] || continue
  # `mobile/` has its own toolchain and check; the root tsc, oxlint and vitest must not see it.
  case "$file" in
    mobile/*)
      mobile=1
      continue
      ;;
  esac
  existing="$existing $file"
  case "$file" in
    *.ts | *.tsx | *.js | *.mjs | *.cjs) sources="$sources $file" ;;
  esac
  case "$file" in
    *.test.ts | *.test.tsx) tests="$tests $file" ;;
    *.ts | *.tsx)
      for candidate in "${file%.*}.test.ts" "${file%.*}.test.tsx"; do
        [ -f "$candidate" ] && tests="$tests $candidate"
      done
      ;;
  esac
done

[ -z "$mobile" ] || npm --prefix mobile run check
[ -n "$existing" ] || { echo "check-changed: nothing to check"; exit 0; }

# shellcheck disable=SC2086 # one argument per path is the point
{
  npx prettier --write --ignore-unknown $existing
  npx tsc --noEmit
  [ -z "$sources" ] || npx oxlint --quiet $sources
  [ -z "$tests" ] || npx vitest run $tests
}
