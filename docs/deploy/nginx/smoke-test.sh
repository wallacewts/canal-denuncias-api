#!/usr/bin/env bash
# Teste de fumaça da configuração de referência do proxy (TRV-12).
# Sobe, em containers, o nginx com canal-denuncias.conf na frente de um upstream que devolve os cabeçalhos recebidos,
# e confere: rota pública sem access log e sem cabeçalhos de origem; rota administrativa com log e IP; TLS, HSTS e
# limite de corpo. Uso: bash docs/deploy/nginx/smoke-test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="$HERE/canal-denuncias.conf"
NGINX_IMAGE="nginx:1.31-alpine"
NODE_IMAGE="node:26-alpine"
PORT="${SMOKE_PORT:-18443}"
NAME="canal-proxy-smoke-$$"
WORK="$(mktemp -d)"
failures=0

cleanup() {
  docker rm -f "$NAME-nginx" "$NAME-api" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { # check <descrição> <comando...>
  local description="$1"; shift
  if "$@"; then echo "  ok   $description"; else echo "  FALHA $description"; failures=$((failures + 1)); fi
}

[ -f "$CONF" ] || { echo "Configuração não encontrada: $CONF"; exit 1; }

# Certificado autoassinado só para o teste.
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=localhost" \
  -keyout "$WORK/tls.key" -out "$WORK/tls.crt" >/dev/null 2>&1

docker network create "$NAME" >/dev/null
# Upstream "api": devolve como JSON os cabeçalhos que chegaram.
docker run -d --name "$NAME-api" --network "$NAME" --network-alias api "$NODE_IMAGE" node -e "
  require('http').createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    req.resume();
    req.on('end', () => res.end(JSON.stringify(req.headers)));
  }).listen(3000)" >/dev/null
docker run -d --name "$NAME-nginx" --network "$NAME" -p "$PORT:443" \
  -v "$CONF:/etc/nginx/conf.d/default.conf:ro" -v "$WORK:/etc/nginx/certs:ro" "$NGINX_IMAGE" >/dev/null

for _ in $(seq 1 30); do curl -sk -o /dev/null "https://localhost:$PORT/health" && break; sleep 1; done
sleep 1

echo "Configuração:"
check "nginx -t aceita a configuração" docker exec "$NAME-nginx" nginx -t -q

echo "Rota pública (/api/public/):"
public=$(curl -sk -H 'X-Forwarded-For: 198.51.100.7' -H 'X-Real-IP: 198.51.100.7' -H 'Forwarded: for=198.51.100.7' \
  -A 'Agente-Do-Denunciante/1.0' "https://localhost:$PORT/api/public/v1/tracking")
check "não repassa X-Forwarded-For, X-Real-IP, Forwarded nem User-Agent à API" \
  bash -c "! grep -qiE '198\.51\.100\.7|x-forwarded-for|x-real-ip|\"forwarded\"|Agente-Do-Denunciante' <<<'$public'"
public_headers=$(curl -skI "https://localhost:$PORT/api/public/v1/tracking")
check "envia HSTS" grep -qi 'strict-transport-security: max-age=31536000' <<<"$public_headers"
check "não expõe a versão do nginx" bash -c "! grep -qiE '^server: nginx/' <<<'$public_headers'"

echo "Rota administrativa (/api/admin/):"
admin=$(curl -sk "https://localhost:$PORT/api/admin/v1/reports")
check "repassa o IP do cliente em X-Forwarded-For" grep -q 'x-forwarded-for' <<<"$admin"

echo "Logs:"
sleep 1
logs=$(docker logs "$NAME-nginx" 2>&1)
check "nenhuma linha de access log para /api/public/" bash -c "! grep -q '/api/public/' <<<'$logs'"
check "nenhum IP de denunciante nos logs" bash -c "! grep -q '198.51.100.7' <<<'$logs'"
check "access log da rota administrativa registrado" grep -q '/api/admin/v1/reports' <<<"$logs"

echo "TLS e corpo:"
check "aceita TLS 1.2" curl -sk --tlsv1.2 --tls-max 1.2 -o /dev/null "https://localhost:$PORT/health"
check "aceita TLS 1.3" curl -sk --tlsv1.3 -o /dev/null "https://localhost:$PORT/health"
head -c $((11 * 1024 * 1024)) /dev/zero > "$WORK/grande.bin"
status=$(curl -sk -o /dev/null -w '%{http_code}' --data-binary "@$WORK/grande.bin" "https://localhost:$PORT/api/public/v1/attachments")
check "corpo acima de 10 MB (MAX_ATTACHMENT_BYTES) recusado com 413" test "$status" = "413"
sleep 1
check "o 413 da rota pública não deixa IP no log" bash -c "! docker logs '$NAME-nginx' 2>&1 | grep -qE '172\.|client: '"

echo
if [ "$failures" -gt 0 ]; then echo "$failures verificação(ões) falharam."; exit 1; fi
echo "Todas as verificações passaram."
