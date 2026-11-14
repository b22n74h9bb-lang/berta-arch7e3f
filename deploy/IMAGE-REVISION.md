# Release image identification

This is an opt-in build and inspection workflow, not a deployment command. It does not enable offline notes, change application authorization, migrate the database, or configure Caddy.

## Build a release candidate

Use a dedicated clean checkout of the reviewed full commit. Do not edit it during the build. Have the existing host-only environment file available; never copy secrets into Git or Slack.

```bash
bash scripts/build-release.sh .env
```

The script rejects tracked changes and non-ignored untracked files, supplies the full HEAD SHA through the revision Compose override, builds only the app, and verifies the final image label. Keep its final UTC/source/image-reference/image-ID receipt in the operational record. Do not redirect a receipt into the source checkout before building, as that creates an untracked file. Build output should be reviewed for sensitive content before sharing.

Ignored files are not covered by the clean-checkout check. Audit ignored build inputs and .dockerignore separately. The existing .env exclusions remain in effect; do not assume every possible credential filename is excluded. Dependency downloads and base images are not pinned by this change, so this does not promise reproducible builds.

The base Compose file is unchanged. The override sets the app image reference to berta-arch7e3f:<full SHA> and passes VCS_REF to the final Docker stage. Bare Docker builds remain compatible and default to revision unknown; unknown is not an accepted release revision.

## Verify a running container without changing it

Resolve APP_CONTAINER_ID using the actual production Compose project. Inspect selected fields only; never post full inspect output or environment values.

```bash
docker inspect --format 'container={{.Id}} image={{.Image}} started={{.State.StartedAt}}' APP_CONTAINER_ID
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Destination}}; {{end}}' APP_CONTAINER_ID
docker image inspect --format 'image={{.Id}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}' APP_IMAGE_ID
```

Replace APP_IMAGE_ID with the immutable image ID from the container, not a mutable tag. Match that ID and its revision to the retained build receipt and approved source SHA. Check whether mounts override application files. A tag, a host checkout SHA, or a label in isolation is not independent proof of provenance. These labels are operator-supplied metadata, not signed attestations. Do not infer metadata for older images.

## Deployment boundary

This script does not deploy, restart services, prune images, or alter MySQL. The sole VPS operator separately verifies exact-commit CI, current image/rollback availability, and authorization before using the built image. Preserve the existing Compose project identity, environment file, and any host overrides. Use the revision override and the same full VCS_REF when selecting the image; do not run a new unreviewed build during cutover. Afterward inspect the actual container image ID and test local health, certificate-validated HTTPS, login/logout, access denial, and task persistence. No immediate redeploy is required just to add a label.

## Validation before merge

- Run bash -n scripts/build-release.sh.
- Run the normal typecheck, unit tests, and production build.
- In a non-production Docker environment with dummy configuration, confirm dirty checkout rejection, successful full-SHA labeling, and matching receipt/image IDs.
- Confirm the build script starts no containers.
- Runtime acceptance remains the VPS operator's separate step.
