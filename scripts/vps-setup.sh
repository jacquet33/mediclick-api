#!/bin/bash
# ════════════════════════════════════════════════════════════
# MediClick - Setup COMPLETO del VPS
# Copiar TODO este bloque y pegar en la terminal del VPS
# ════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   MediClick - Preparando VPS...      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. INSTALAR DOCKER ─────────────────────────────────────
echo "[1/8] Verificando Docker..."
if ! command -v docker &>/dev/null; then
    echo "  → Instalando Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "  ✓ Docker instalado"
else
    echo "  ✓ Docker ya está: $(docker --version)"
fi

# ─── 2. VERIFICAR DOCKER COMPOSE ────────────────────────────
echo "[2/8] Verificando Docker Compose..."
if ! docker compose version &>/dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi
echo "  ✓ $(docker compose version)"

# ─── 3. CREAR DIRECTORIO ────────────────────────────────────
echo "[3/8] Creando /opt/mediclick..."
mkdir -p /opt/mediclick
cd /opt/mediclick

# ─── 4. GENERAR .env CON SECRETS SEGUROS ─────────────────────
echo "[4/8] Generando .env..."
if [ ! -f .env ]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)
    REDIS_PASS=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)
    JWT_S=$(openssl rand -hex 32)
    JWT_R=$(openssl rand -hex 32)
    ENC_K=$(openssl rand -hex 16)

    cat > .env << ENVEOF
# MediClick - Producción
# Generado: $(date -u +"%Y-%m-%d %H:%M UTC")
# NO editar los secrets a menos que sepas qué hacés

DB_USER=mediclick
DB_PASSWORD=${DB_PASS}
REDIS_PASSWORD=${REDIS_PASS}
JWT_SECRET=${JWT_S}
JWT_REFRESH_SECRET=${JWT_R}
ENCRYPTION_KEY=${ENC_K}
ACME_EMAIL=admin@mediclick.com
ENVEOF
    chmod 600 .env
    echo "  ✓ .env generado con secrets seguros"
else
    echo "  ✓ .env ya existe, no se toca"
fi

# ─── 5. CREAR docker-compose.yml ────────────────────────────
echo "[5/8] Creando docker-compose.yml..."
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
    ports:
      - "3000:3000"
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
    ports:
      - "80:80"
      - "443:443"
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
DCEOF
echo "  ✓ docker-compose.yml creado"

# ─── 6. DESCARGAR SCHEMA SQL ────────────────────────────────
echo "[6/8] Descargando schema PostgreSQL..."
curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/src/database/migrations/init.sql -o init.sql
LINES=$(wc -l < init.sql)
echo "  ✓ init.sql descargado (${LINES} líneas)"

# ─── 7. LOGIN DOCKER HUB + PULL ─────────────────────────────
echo "[7/8] Login a Docker Hub..."
echo "dckr_pat_m8AmdIu6cMzuGzg5Lebjq-YObF4" | docker login -u ajacquet33 --password-stdin
echo "  ✓ Docker Hub login OK"

echo "  → Descargando imágenes (esto tarda 1-2 min)..."
docker compose pull
echo "  ✓ Imágenes descargadas"

# ─── 8. LEVANTAR TODO ───────────────────────────────────────
echo "[8/8] Levantando servicios..."
docker compose up -d postgres redis
echo "  → Esperando que PostgreSQL arranque..."
sleep 15

# Verificar que PostgreSQL está sano
if docker compose exec -T postgres pg_isready -U mediclick > /dev/null 2>&1; then
    echo "  ✓ PostgreSQL listo"
else
    echo "  ⚠ PostgreSQL tardando, esperando 15s más..."
    sleep 15
fi

# Levantar API
docker compose up -d api
echo "  → Esperando que la API arranque..."
sleep 10

# Levantar Traefik
docker compose up -d traefik
sleep 3

# ─── VERIFICACIÓN FINAL ─────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Verificación final                 ║"
echo "╚══════════════════════════════════════╝"
echo ""

echo "==> Contenedores:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "==> Health check de la API:"
if curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
    echo "  ✓ API respondiendo en http://localhost:3000"
else
    echo "  ⚠ API no responde aún. Verificando logs..."
    docker compose logs --tail=30 api
fi

echo ""
echo "==> PostgreSQL:"
if docker compose exec -T postgres psql -U mediclick -d mediclick -c "SELECT COUNT(*) AS tablas FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null; then
    echo "  ✓ Base de datos inicializada"
else
    echo "  ⚠ Verificar logs: docker compose logs postgres"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   ✓ MediClick desplegado!            ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  Directorio:  /opt/mediclick"
echo "  API:         http://$(hostname -I | awk '{print $1}'):3000/api/v1/health"
echo "  API externa: http://31.97.103.63:3000/api/v1/health"
echo ""
echo "  Comandos útiles:"
echo "    docker compose ps          → ver estado"
echo "    docker compose logs -f api → ver logs en vivo"
echo "    docker compose restart api → reiniciar API"
echo "    docker compose down        → parar todo"
echo "    cat /opt/mediclick/.env    → ver secrets"
echo ""
echo "  CI/CD: cada push a main en GitHub"
echo "  se deploya automáticamente acá."
echo ""
echo "  ⚠ SEGURIDAD: Cambiá estos passwords expuestos:"
echo "    - VPS root password"
echo "    - GitHub token (ghp_...)"
echo "    - Docker Hub token (dckr_pat_...)"
echo ""
