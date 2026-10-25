#!/usr/bin/env bash
# ============================================================
# MediClick — Restaurar backup de PostgreSQL
# Uso: /opt/mediclick/scripts/restore.sh <archivo.sql.gz>
# ============================================================
set -euo pipefail

BACKUP_DIR="/opt/mediclick/backups"
CONTAINER="mediclick-db"
DB_USER="mediclick"
DB_NAME="mediclick"

# ── Validar argumento ───────────────────────────────────────
if [ $# -lt 1 ]; then
  echo "Uso: $0 <archivo_backup.sql.gz>"
  echo ""
  echo "Backups disponibles:"
  ls -lh "$BACKUP_DIR"/mediclick_*.sql.gz 2>/dev/null || echo "  (ninguno encontrado)"
  exit 1
fi

BACKUP_FILE="$1"

# Si no es ruta absoluta, buscar en BACKUP_DIR
if [[ "$BACKUP_FILE" != /* ]]; then
  BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: No se encontró el archivo: $BACKUP_FILE"
  exit 1
fi

if [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: El archivo está vacío: $BACKUP_FILE"
  exit 1
fi

# ── Confirmar ───────────────────────────────────────────────
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RESTAURAR BACKUP DE MEDICLICK                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Archivo: $(basename "$BACKUP_FILE")"
echo "║  Tamaño:  $SIZE"
echo "║  DB:      $DB_NAME"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  ⚠️  ESTO REEMPLAZARÁ TODOS LOS DATOS ACTUALES      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
read -p "¿Estás seguro? Escribí 'SI' para continuar: " CONFIRM

if [ "$CONFIRM" != "SI" ]; then
  echo "Cancelado."
  exit 0
fi

# ── Backup previo de seguridad ──────────────────────────────
echo ""
echo "→ Creando backup de seguridad antes de restaurar..."
PRE_RESTORE="${BACKUP_DIR}/mediclick_pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$PRE_RESTORE"; then
  echo "  ✓ Backup de seguridad: $(basename "$PRE_RESTORE")"
else
  echo "  ⚠ No se pudo crear backup de seguridad (continuando de todos modos)"
fi

# ── Restaurar ───────────────────────────────────────────────
echo ""
echo "→ Restaurando desde $(basename "$BACKUP_FILE")..."

# Desconectar conexiones activas y recrear la DB
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
" >/dev/null 2>&1 || true

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null 2>&1
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null 2>&1

if gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" --quiet >/dev/null 2>&1; then
  echo "  ✓ Restauración completada exitosamente"
else
  echo "  ✗ Hubo errores durante la restauración (posiblemente no críticos)"
  echo "  Verificá la base de datos manualmente"
fi

# ── Verificar ───────────────────────────────────────────────
echo ""
echo "→ Verificando..."
TABLES=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
echo "  Tablas en la DB: $(echo "$TABLES" | tr -d ' ')"
echo ""
echo "Restauración finalizada. Reiniciá la API con:"
echo "  cd /opt/mediclick && docker compose restart api"
