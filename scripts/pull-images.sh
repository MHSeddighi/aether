#!/usr/bin/env bash
# Fetch base images for the local stack.
#
# WHY THIS EXISTS
#   On networks where IPv6 egress is broken at the application layer, Docker Hub answers
#   registry-1.docker.io / auth.docker.io over IPv6 with HTTP 403, and the Docker CLI reports that
#   as `pull access denied ... RBAC: access denied`. Note that `"ipv6": false` in
#   /etc/docker/daemon.json does NOT help: that setting only controls *container* networking, while
#   the registry address family is chosen by the daemon's own resolver (RFC 6724 prefers IPv6 when
#   the host has a global IPv6 address).
#
#   This script sidesteps the problem without root access: it pulls the same images from registries
#   that only publish A records (so the daemon cannot choose the broken IPv6 path) and retags them
#   to the canonical names used by docker-compose.yml.
#
# PERMANENT FIX (needs root, pick one)
#   1. Point the daemon at an IPv4-only mirror:
#        sudo sh -c 'echo "{\"registry-mirrors\": [\"https://mirror.gcr.io\"]}" > /etc/docker/daemon.json'
#        sudo systemctl restart docker
#   2. Disable IPv6 on the host so the daemon only has IPv4 available:
#        sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1 && sudo sysctl -w net.ipv6.conf.default.disable_ipv6=1
#        sudo systemctl restart docker
#   3. Make IPv4 win address selection (gai.conf / systemd override for dockerd).
#
# Usage: scripts/pull-images.sh
set -euo pipefail

# registry|image|canonical tag
IMAGES=(
  "public.ecr.aws/docker/library|postgres:16-alpine|postgres:16-alpine"
  "dockerproxy.net|temporalio/auto-setup:1.27.2|temporalio/auto-setup:1.27.2"
  "public.ecr.aws/docker/library|python:3.12-slim|python:3.12-slim"
)

for entry in "${IMAGES[@]}"; do
  registry="${entry%%|*}"
  rest="${entry#*|}"
  image="${rest%%|*}"
  canonical="${rest#*|}"

  if docker image inspect "$canonical" >/dev/null 2>&1; then
    echo "skip   $canonical (already present)"
    continue
  fi

  echo "pull   $registry/$image -> $canonical"
  docker pull "$registry/$image"
  docker tag "$registry/$image" "$canonical"
done

echo
echo "images ready:"
docker images --format '  {{.Repository}}:{{.Tag}}' | grep -E "postgres|temporalio|python:3.12" | sort -u
