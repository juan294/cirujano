#!/usr/bin/env bash
set -euo pipefail

readonly cloud_init_commit=8bf3567532b07e2cc15aa4c76c36ebed65ccfaec
readonly image=cirujano-cloud-init-schema:26.1-${cloud_init_commit:0:12}
readonly docker_path=${CIRUJANO_DOCKER_PATH:-docker}
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/cirujano-schema.XXXXXX")
cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT INT TERM

rendered="$temporary_directory/cloud-config.yaml"
schema_output="$temporary_directory/schema-output.txt"

pnpm --filter @cirujano/runner run build >/dev/null
"$docker_path" build \
  --build-arg "CLOUD_INIT_COMMIT=$cloud_init_commit" \
  --tag "$image" \
  --file "$repository_root/packages/runner/test/cloud-init-26.1/Dockerfile" \
  "$repository_root/packages/runner/test/cloud-init-26.1" >/dev/null
node "$repository_root/scripts/render-runner-cloud-init.mjs" "$rendered"

mode=$(stat -c '%a' "$rendered" 2>/dev/null || stat -f '%Lp' "$rendered")
[[ "$mode" == 600 ]] || { echo 'rendered cloud-config mode is not 0600' >&2; exit 1; }

if ! "$docker_path" run --rm --volume "$temporary_directory:/work:ro" "$image" schema -c /work/cloud-config.yaml --annotate >"$schema_output" 2>&1; then
  echo 'cloud-init schema validation failed; captured annotated output withheld because user-data contains a private host key' >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])(ERROR|WARNING):|Schema validation failed|Invalid cloud-config' "$schema_output"; then
  echo 'cloud-init schema validation returned annotations; captured output withheld because user-data contains a private host key' >&2
  exit 1
fi

"$docker_path" run --rm "$image" --version
printf 'cloud-init source commit: %s\n' "$cloud_init_commit"
printf 'cloud-init schema: valid without annotations\n'
