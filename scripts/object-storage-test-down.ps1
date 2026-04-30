$ErrorActionPreference = "Stop"

wsl sh -lc "mkdir -p /tmp/openkb-docker-config && printf '{}' > /tmp/openkb-docker-config/config.json && PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config docker compose -f deploy/docker-compose/minio.test.yml down -v"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to stop openkb-minio-test."
}
