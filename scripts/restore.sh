#!/usr/bin/env sh
# Restauración desde un backup generado por backup.sh.  OPERACIÓN DESTRUCTIVA: reemplaza datos actuales.
# Uso:  ./scripts/restore.sh backups/mlp-AAAAMMDD-HHMMSS.tar.gz[.gpg]
set -eu
FILE="${1:?Indica el archivo de backup}"
printf 'Se SOBRESCRIBIRÁN la base de datos y los archivos actuales con %s. Escribe RESTAURAR para continuar: ' "$FILE"
read -r ANSWER
[ "$ANSWER" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
case "$FILE" in
  *.gpg) gpg --batch --pinentry-mode loopback --passphrase "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}" -d "$FILE" | tar -C "$TMP" -xzf - ;;
  *) tar -C "$TMP" -xzf "$FILE" ;;
esac
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"

get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
PGUSER="$(get POSTGRES_USER)"; PGDB="$(get POSTGRES_DB)"

docker compose stop app
docker compose exec -T db pg_restore -U "$PGUSER" -d "$PGDB" --clean --if-exists --no-owner < "$SRC/db.dump"
docker compose run --rm --no-deps -T --entrypoint sh app -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < "$SRC/uploads.tar.gz"
docker compose start app
echo "Restauración completada. Comprueba: curl -s http://127.0.0.1:\${HOST_PORT:-3000}/api/health"
