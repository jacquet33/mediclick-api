#!/bin/bash
set -e
echo "═══════════════════════════════════════"
echo " MediClick - Setup VPS"
echo "═══════════════════════════════════════"

# 1. Docker
if ! command -v docker &>/dev/null; then
  echo "==> Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi
echo "✓ Docker: $(docker --version)"

# 2. Docker Compose
if ! docker compose version &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi
echo "✓ Compose: $(docker compose version)"

# 3. Directorio
mkdir -p /opt/mediclick && cd /opt/mediclick
echo "✓ Directorio: /opt/mediclick"

# 4. Generar .env con secrets seguros
if [ ! -f .env ]; then
  cat > .env << ENVEOF
DB_USER=mediclick
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
ACME_EMAIL=admin@mediclick.com
ENVEOF
  chmod 600 .env
  echo "✓ .env generado con secrets seguros"
else
  echo "✓ .env ya existe"
fi

# 5. docker-compose.yml de producción
cat > docker-compose.yml << 'COMPEOF'
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: mediclick-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: mediclick
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [mediclick-net]

  redis:
    image: redis:7-alpine
    container_name: mediclick-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes: [redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [mediclick-net]

  api:
    image: ajacquet33/mediclick-api:latest
    container_name: mediclick-api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/mediclick
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks: [mediclick-net]

  traefik:
    image: traefik:v3.1
    container_name: mediclick-proxy
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--certificatesresolvers.le.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.le.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
    ports: ["80:80", "443:443"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks: [mediclick-net]

volumes:
  pgdata:
  redisdata:
  letsencrypt:

networks:
  mediclick-net:
    driver: bridge
COMPEOF
echo "✓ docker-compose.yml creado"

# 6. Descargar schema SQL
echo "==> Descargando schema SQL..."
curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/src/database/migrations/init.sql -o init.sql
echo "✓ init.sql descargado"

# 7. Login Docker Hub
echo ""
echo "==> Login a Docker Hub (ingresá tu token)..."
docker login -u ajacquet33

# 8. Levantar todo
echo "==> Levantando servicios..."
docker compose pull api
docker compose up -d

echo ""
echo "==> Esperando 15 segundos..."
sleep 15

echo ""
echo "═══════════════════════════════════════"
docker compose ps
echo "═══════════════════════════════════════"
echo ""
echo "✓ MediClick deployado en /opt/mediclick"
echo "  API: curl http://localhost:3000/api/v1/health"
echo "  Logs: docker compose logs -f api"
echo ""
