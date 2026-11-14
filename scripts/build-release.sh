#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
if [[ -n $(git status --porcelain --untracked-files=all) ]]; then
  echo 'Refusing release build: tracked changes or untracked files exist.' >&2
  exit 1
fi
export VCS_REF
VCS_REF=$(git rev-parse --verify HEAD)
if [[ ! $VCS_REF =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a full 40-character Git SHA.' >&2
  exit 1
fi
env_file=${1:-.env}
if [[ ! -f $env_file ]]; then
  echo 'Host environment file not found; do not commit secrets.' >&2
  exit 1
fi
compose=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.revision.yml --env-file "$env_file")

# Build only. Never starts containers or touches database volumes.
"${compose[@]}" build app
if [[ $(git rev-parse HEAD) != "$VCS_REF" || -n $(git status --porcelain --untracked-files=all) ]]; then
  echo 'Checkout changed during build; reject this image for release.' >&2
  exit 1
fi
image="berta-arch7e3f:$VCS_REF"
image_id=$(docker image inspect --format '{{.Id}}' "$image")
revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")
if [[ $revision != "$VCS_REF" ]]; then
  echo 'Image revision mismatch; reject this image for release.' >&2
  exit 1
fi
printf 'built_at_utc=%s\nsource_revision=%s\nimage_ref=%s\nimage_id=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$VCS_REF" "$image" "$image_id"
