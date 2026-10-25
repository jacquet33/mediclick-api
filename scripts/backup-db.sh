#!/bin/bash
# MediClick — Backup automático de base de datos
# Ley 26.529: retención mínima 10 años de historias clínicas
#
# Uso:
#   ./scripts/backup-db.sh
#
# Configurar en cron del VPS:
#   crontab -e
#   0 3 * * * /opt/mediclick/scripts/backup-db.sh >> /opt/mediclick/logs/backup.log 2>&1

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────
BACKUP_DIR="/opt/mediclick/backups"
CONTAINER_NAME="mediclick-db"
DB_NAME="mediclick"
DB_USER="mediclick"
RETENTION_DAYS=90       # Mantener backups locales por 90 días
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/mediclick_${DATE}.sql.gz"
LOG_PREFIX="[BACKUP $(date '+%Y-%m-%d %H:%M:%S')]"

# ─── Setup ────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
mkdir -p "/opt/mediclick/logs"

echo "${LOG_PREFIX} Iniciando backup de base de datos..."

# ─── Dump + compress ──────────────────────────────────────────
if docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${BACKUP_FILE}"; then
    SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
    echo "${LOG_PREFIX} Backup completado: ${BACKUP_FILE} (${SIZE})"
else
    echo "${LOG_PREFIX} ERROR: Backup falló!"
    exit 1
fi

# ─── Verificar integridad ─────────────────────────────────────
if gzip -t "${BACKUP_FILE}" 2>/dev/null; then
    echo "${LOG_PREFIX} Verificación de integridad: OK"
else
    echo "${LOG_PREFIX} ERROR: Archivo de backup corrupto!"
    exit 1
fi

# ─── Limpiar backups viejos ───────────────────────────────────
DELETED=$(find "${BACKUP_DIR}" -name "mediclick_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
    echo "${LOG_PREFIX} Eliminados ${DELETED} backups con más de ${RETENTION_DAYS} días"
fi

# ─── Resumen ──────────────────────────────────────────────────
TOTAL=$(find "${BACKUP_DIR}" -name "mediclick_*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
echo "${LOG_PREFIX} Total backups almacenados: ${TOTAL} (${TOTAL_SIZE})"
echo "${LOG_PREFIX} Backup finalizado exitosamente."
