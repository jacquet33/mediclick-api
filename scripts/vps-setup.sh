#!/bin/bash
# ============================================================
# MediClick - Setup inicial del VPS
# Ejecutar UNA sola vez en el VPS:
#   curl -sSL <raw_url> | bash
#   o copiar y pegar en el terminal del VPS
# ============================================================

set -e

echo "========================================="
echo " MediClick - Setup del VPS"
echo "========================================="

# 1. Instalar Docker si no está
if ! command -v docker &> /dev/null; then
    echo "==> Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "✓ Docker instalado"
else
    echo "✓ Docker ya instalado: $(docker --version)"
fi

# 2. Instalar Docker Compose plugin si no está
if ! docker compose version &> /dev/null; then
    echo "==> Instalando Docker Compose plugin..."
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
    echo "✓ Docker Compose instalado"
else
    echo "✓ Docker Compose ya instalado: $(docker compose version)"
fi

# 3. Crear directorio del proyecto
echo "==> Creando /opt/mediclick..."
mkdir -p /opt/mediclick
cd /opt/mediclick

# 4. Crear .env de producción
if [ ! -f .env ]; then
    echo "==> Generando .env con secrets seguros..."
    
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 16)
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    
    cat > .env << ENVEOF
# ═══ MediClick - Producción ═══
# Generado automáticamente el $(date)

# PostgreSQL
DB_USER=mediclick
DB_PASSWORD=${DB_PASSWORD}

# Redis
REDIS_PASSWORD=${REDIS_PASSWORD}

# JWT (generados con openssl rand -hex 32)
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# Cifrado
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# SSL - Cambiar por tu email real
ACME_EMAIL=admin@mediclick.com
ENVEOF

    chmod 600 .env
    echo "✓ .env generado con secrets seguros"
    echo "  IMPORTANTE: Editá ACME_EMAIL con tu email real"
else
    echo "✓ .env ya existe, no se sobreescribe"
fi

# 5. Descargar docker-compose.yml de producción
echo "==> Descargando docker-compose.yml..."
curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/docker-compose.prod.yml \
    -o docker-compose.yml

# 6. Descargar schema SQL
echo "==> Descargando schema SQL..."
curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/src/database/migrations/init.sql \
    -o init.sql

# 7. Login a Docker Hub
echo "==> Login a Docker Hub..."
echo "  Ejecutá manualmente: docker login -u ajacquet33"

# 8. Levantar servicios base (DB + Redis primero)
echo "==> Levantando PostgreSQL y Redis..."
docker compose up -d postgres redis

echo "==> Esperando que PostgreSQL esté listo..."
sleep 10

# 9. Levantar API
echo "==> Levantando API..."
docker compose up -d api

echo ""
echo "========================================="
echo " ✓ Setup completo!"
echo "========================================="
echo ""
echo " Directorio: /opt/mediclick"
echo " Servicios:  docker compose ps"
echo " Logs:       docker compose logs -f api"
echo " Health:     curl http://localhost:3000/api/v1/health"
echo ""
echo " PENDIENTE:"
echo "  1. Editá .env → ACME_EMAIL con tu email"
echo "  2. docker login -u ajacquet33 (para pull de imágenes)"
echo "  3. Si tenés dominio, levantá Traefik:"
echo "     docker compose up -d traefik"
echo ""
