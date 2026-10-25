#!/usr/bin/env bash
# ============================================================
# MediClick — Configurar backup automático diario
# Ejecutar UNA VEZ en el VPS: bash /opt/mediclick/scripts/setup-backup-cron.sh
# ============================================================
set -euo pipefail

SCRIPTS_DIR="/opt/mediclick/scripts"
BACKUP_DIR="/opt/mediclick/backups"
BACKUP_SCRIPT="${SCRIPTS_DIR}/backup.sh"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  CONFIGURAR BACKUP AUTOMÁTICO DE MEDICLICK          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Crear directorios ───────────────────────────────────────
echo "→ Creando directorios..."
mkdir -p "$BACKUP_DIR"
mkdir -p "$SCRIPTS_DIR"
echo "  ✓ ${BACKUP_DIR}"
echo "  ✓ ${SCRIPTS_DIR}"

# ── Copiar scripts ──────────────────────────────────────────
SCRIPT_SOURCE="$(cd "$(dirname "$0")" && pwd)"

if [ "$SCRIPT_SOURCE" != "$SCRIPTS_DIR" ]; then
  echo ""
  echo "→ Copiando scripts a ${SCRIPTS_DIR}..."
  cp "$SCRIPT_SOURCE/backup.sh" "$SCRIPTS_DIR/backup.sh"
  cp "$SCRIPT_SOURCE/restore.sh" "$SCRIPTS_DIR/restore.sh"
  echo "  ✓ Scripts copiados"
fi

chmod +x "$SCRIPTS_DIR/backup.sh"
chmod +x "$SCRIPTS_DIR/restore.sh"
echo "  ✓ Permisos ejecutables configurados"

# ── Configurar cron ─────────────────────────────────────────
# 3:00 AM Argentina (UTC-3) = 06:00 UTC
CRON_ENTRY="0 6 * * * ${BACKUP_SCRIPT} >> ${BACKUP_DIR}/backup.log 2>&1"

echo ""
echo "→ Configurando cron..."

# Verificar si ya existe
if crontab -l 2>/dev/null | grep -qF "$BACKUP_SCRIPT"; then
  echo "  ⚠ Ya existe una entrada cron para backup.sh"
  echo "  Entrada actual:"
  crontab -l 2>/dev/null | grep "$BACKUP_SCRIPT" | sed 's/^/    /'
else
  # Agregar sin borrar las existentes
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
  echo "  ✓ Cron instalado: todos los días a las 03:00 AM (Argentina)"
fi

# ── Ejecutar primer backup ──────────────────────────────────
echo ""
read -p "¿Ejecutar un backup ahora para verificar? (s/n): " RUN_NOW

if [ "$RUN_NOW" = "s" ] || [ "$RUN_NOW" = "S" ]; then
  echo ""
  bash "$BACKUP_SCRIPT"
fi

# ── Resumen ─────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ CONFIGURACIÓN COMPLETA                          ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Backup diario: 03:00 AM (Argentina)               ║"
echo "║  Retención:     30 días                            ║"
echo "║  Directorio:    /opt/mediclick/backups/            ║"
echo "║  Log:           /opt/mediclick/backups/backup.log  ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Comandos útiles:                                  ║"
echo "║  • Ver cron:    crontab -l                         ║"
echo "║  • Backup ya:   /opt/mediclick/scripts/backup.sh   ║"
echo "║  • Restaurar:   /opt/mediclick/scripts/restore.sh  ║"
echo "║  • Ver log:     tail -20 backups/backup.log        ║"
echo "╚══════════════════════════════════════════════════════╝"
