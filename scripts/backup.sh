#!/usr/bin/env sh
# Copia de seguridad: volcado de Postgres + archivos subidos, en ./backups/<fecha>/
# Uso (desde la raíz del proyecto, con docker compose en marcha):  ./scripts/backup.sh
# Programar a diario con cron, p. ej.:  15 3 * * * cd /ruta/proyecto && ./scripts/backup.sh >> backups/backup.log 2>&1
# Cifrado opcional: exporta BACKUP_PASSPHRASE y se generará un .tar.gz.gpg en lugar del .tar.gz.
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="backups/$STAMP"
mkdir -p "$DIR"
chmod 700 backups

# Variables de la BD desde .env sin ejecutar el archivo
get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
PGUSER="$(get POSTGRES_USER)"; PGDB="$(get POSTGRES_DB)"

docker compose exec -T db pg_dump -U "$PGUSER" -d "$PGDB" --format=custom --no-owner > "$DIR/db.dump"
docker compose exec -T app tar -C /data -czf - uploads > "$DIR/uploads.tar.gz"

tar -C backups -czf "backups/mlp-$STAMP.tar.gz" "$STAMP" && rm -rf "$DIR"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
      --symmetric --cipher-algo AES256 -o "backups/mlp-$STAMP.tar.gz.gpg" "backups/mlp-$STAMP.tar.gz"
  rm -f "backups/mlp-$STAMP.tar.gz"
fi
find backups -maxdepth 1 -name 'mlp-*.tar.gz*' -mtime +"$KEEP_DAYS" -delete
echo "Backup listo: $(ls -1 backups/mlp-"$STAMP".tar.gz* )"
