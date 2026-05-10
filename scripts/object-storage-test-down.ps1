$ErrorActionPreference = "Stop"

$minioPort = if ($env:OPENKB_MINIO_TEST_PORT) { $env:OPENKB_MINIO_TEST_PORT } else { "59000" }
$minioConsolePort = if ($env:OPENKB_MINIO_TEST_CONSOLE_PORT) { $env:OPENKB_MINIO_TEST_CONSOLE_PORT } else { "59001" }

wsl sh -lc "mkdir -p /tmp/openkb-docker-config && printf '{}' > /tmp/openkb-docker-config/config.json && PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config OPENKB_MINIO_TEST_PORT=$minioPort OPENKB_MINIO_TEST_CONSOLE_PORT=$minioConsolePort docker compose -f deploy/docker-compose/minio.test.yml down -v"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to stop openkb-minio-test."
}
