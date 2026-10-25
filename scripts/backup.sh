#!/usr/bin/env bash
# ============================================================
# MediClick — Backup diario de PostgreSQL
# Ejecutar desde el VPS con: /opt/mediclick/scripts/backup.sh
# O via cron (ver setup-backup-cron.sh)
# ============================================================
set -euo pipefail

BACKUP_DIR="/opt/mediclick/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"
RETENTION_DAYS=30
CONTAINER="mediclick-db"
DB_USER="mediclick"
DB_NAME="mediclick"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/mediclick_${TIMESTAMP}.sql.gz"

# ── Funciones ───────────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cleanup_old_backups() {
  local deleted=0
  while IFS= read -r file; do
    rm -f "$file"
    ((deleted++))
  done < <(find "$BACKUP_DIR" -name "mediclick_*.sql.gz" -type f -mtime +${RETENTION_DAYS} 2>/dev/null)
  if [ "$deleted" -gt 0 ]; then
    log "INFO  Limpieza: $deleted backup(s) con más de ${RETENTION_DAYS} días eliminados"
  fi
}

# ── Pre-checks ──────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

if ! docker inspect "$CONTAINER" &>/dev/null; then
  log "ERROR El contenedor '$CONTAINER' no existe o no está corriendo"
  exit 1
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  log "ERROR El contenedor '$CONTAINER' no está corriendo"
  exit 1
fi

# ── Backup ──────────────────────────────────────────────────
log "INFO  Iniciando backup → ${BACKUP_FILE}"

if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "OK    Backup completado: ${BACKUP_FILE} (${SIZE})"
else
  log "ERROR Falló el pg_dump"
  rm -f "$BACKUP_FILE"
  exit 2
fi

# Verificar que el archivo no esté vacío
if [ ! -s "$BACKUP_FILE" ]; then
  log "ERROR El backup está vacío, eliminando"
  rm -f "$BACKUP_FILE"
  exit 3
fi

# ── Limpieza ────────────────────────────────────────────────
cleanup_old_backups

# ── Resumen ─────────────────────────────────────────────────
TOTAL=$(find "$BACKUP_DIR" -name "mediclick_*.sql.gz" -type f | wc -l)
DISK=$(du -sh "$BACKUP_DIR" | cut -f1)
log "INFO  Total backups: ${TOTAL} | Espacio usado: ${DISK}"
