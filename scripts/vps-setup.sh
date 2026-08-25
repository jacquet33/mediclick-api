#!/bin/bash
# ════════════════════════════════════════════════════════════
# MediClick - Setup VPS (usa Traefik existente)
# ════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   MediClick - Preparando VPS...      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. VERIFICAR DOCKER ────────────────────────────────────
echo "[1/7] Verificando Docker..."
if ! command -v docker &>/dev/null; then
    echo "  → Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker && systemctl start docker
fi
echo "  ✓ $(docker --version)"
echo "  ✓ $(docker compose version)"

# ─── 2. CREAR DIRECTORIO ────────────────────────────────────
echo "[2/7] Creando /opt/mediclick..."
mkdir -p /opt/mediclick
cd /opt/mediclick

# ─── 3. GENERAR .env ────────────────────────────────────────
echo "[3/7] Generando .env..."
if [ ! -f .env ]; then
    cat > .env << ENVEOF
DB_USER=mediclick
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
ACME_EMAIL=admin@mediclick.com
ENVEOF
    chmod 600 .env
    echo "  ✓ .env generado"
else
    echo "  ✓ .env ya existe"
fi

# ─── 4. DOCKER-COMPOSE (sin Traefik, usa el existente) ──────
echo "[4/7] Creando docker-compose.yml..."
cat > docker-compose.yml << 'DCEOF'
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
      test: ["CMD-SHELL", "pg_isready -U mediclick"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - mediclick-internal

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
    networks:
      - mediclick-internal

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
    labels:
      - "traefik.enable=true"
      # HTTP → ruta por dominio (cambiar api.mediclick.com por tu dominio)
      - "traefik.http.routers.mediclick-api.rule=Host(`api.mediclick.com`)"
      - "traefik.http.routers.mediclick-api.entrypoints=websecure"
      - "traefik.http.routers.mediclick-api.tls.certresolver=le"
      # O si no tenés dominio, ruta por path prefix:
      # - "traefik.http.routers.mediclick-api.rule=PathPrefix(`/mediclick`)"
      - "traefik.http.services.mediclick-api.loadbalancer.server.port=3000"
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks:
      - mediclick-internal
      - traefik-public

volumes:
  pgdata:
  redisdata:

networks:
  mediclick-internal:
    driver: bridge
  traefik-public:
    external: true
DCEOF
echo "  ✓ docker-compose.yml creado (sin Traefik propio, usa traefik-public)"

# ─── 5. DESCARGAR SCHEMA SQL ────────────────────────────────
echo "[5/7] Descargando schema PostgreSQL..."
curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/src/database/migrations/init.sql -o init.sql
echo "  ✓ init.sql ($(wc -l < init.sql) líneas)"

# ─── 6. LOGIN DOCKER HUB + PULL ─────────────────────────────
echo "[6/7] Docker Hub login + pull..."
echo "dckr_pat_m8AmdIu6cMzuGzg5Lebjq-YObF4" | docker login -u ajacquet33 --password-stdin 2>/dev/null
echo "  ✓ Login OK"
docker compose pull
echo "  ✓ Imágenes descargadas"

# ─── 7. LEVANTAR SERVICIOS ──────────────────────────────────
echo "[7/7] Levantando servicios..."

echo "  → PostgreSQL + Redis..."
docker compose up -d postgres redis
echo "  → Esperando PostgreSQL (15s)..."
sleep 15

if docker compose exec -T postgres pg_isready -U mediclick > /dev/null 2>&1; then
    echo "  ✓ PostgreSQL sano"
else
    echo "  → Esperando 15s más..."
    sleep 15
fi

echo "  → API..."
docker compose up -d api
echo "  → Esperando API (10s)..."
sleep 10

# ─── VERIFICACIÓN ───────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Verificación                       ║"
echo "╚══════════════════════════════════════╝"
echo ""

docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

if curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
    echo "✓ API OK → http://localhost:3000/api/v1/health"
else
    echo "⚠ API no responde, logs:"
    docker compose logs --tail=20 api
fi

echo ""
TABLES=$(docker compose exec -T postgres psql -U mediclick -d mediclick -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')
if [ -n "$TABLES" ] && [ "$TABLES" -gt 0 ]; then
    echo "✓ PostgreSQL OK → ${TABLES} tablas creadas"
else
    echo "⚠ Verificar PostgreSQL: docker compose logs postgres"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   ✓ MediClick listo!                 ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo " La API se conectó a tu Traefik existente"
echo " vía la red traefik-public."
echo ""
echo " Test directo (sin dominio):"
echo "   curl http://localhost:3000/api/v1/health"
echo ""
echo " Con Traefik (cuando configures dominio):"
echo "   https://api.mediclick.com/api/v1/health"
echo ""
echo " Para cambiar el dominio, editá en docker-compose.yml"
echo " la label: traefik.http.routers.mediclick-api.rule"
echo ""
echo " Comandos:"
echo "   cd /opt/mediclick"
echo "   docker compose ps"
echo "   docker compose logs -f api"
echo "   docker compose restart api"
echo ""
