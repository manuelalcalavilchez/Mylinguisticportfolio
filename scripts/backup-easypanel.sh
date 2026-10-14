#!/usr/bin/env sh
# Copia de seguridad cuando la app corre en EasyPanel (contenedores Swarm, sin docker compose).
# Ejecutar en el servidor de EasyPanel (por SSH) como root o usuario del grupo docker:
#   PROJECT=portfolio PGUSER=postgres PGDB=portfolio ./scripts/backup-easypanel.sh
# Variables:
#   PROJECT   nombre del proyecto en EasyPanel (los contenedores se llaman <PROJECT>_<servicio>.…)
#   DB_SVC    nombre del servicio Postgres (por defecto: db)
#   APP_SVC   nombre del servicio de la app (por defecto: app)
#   PGUSER / PGDB  usuario y base de datos (los ves en el servicio Postgres de EasyPanel)
#   OUT       carpeta destino (por defecto: /root/backups/mlp)
#   BACKUP_PASSPHRASE  si se define, el archivo se cifra con gpg
#   KEEP_DAYS días de retención (por defecto 14)
set -eu
: "${PROJECT:?Define PROJECT}" "${PGUSER:?Define PGUSER}" "${PGDB:?Define PGDB}"
DB_SVC="${DB_SVC:-db}"; APP_SVC="${APP_SVC:-app}"; OUT="${OUT:-/root/backups/mlp}"; KEEP_DAYS="${KEEP_DAYS:-14}"
cid() { docker ps -q --filter "name=^${PROJECT}_$1\." | head -1; }
DB_C="$(cid "$DB_SVC")"; APP_C="$(cid "$APP_SVC")"
[ -n "$DB_C" ] || { echo "No encuentro el contenedor ${PROJECT}_${DB_SVC}"; exit 1; }
[ -n "$APP_C" ] || { echo "No encuentro el contenedor ${PROJECT}_${APP_SVC}"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"; DIR="$OUT/$STAMP"
mkdir -p "$DIR"; chmod 700 "$OUT"
docker exec "$DB_C" pg_dump -U "$PGUSER" -d "$PGDB" --format=custom --no-owner > "$DIR/db.dump"
docker exec "$APP_C" tar -C /data -czf - uploads > "$DIR/uploads.tar.gz"
tar -C "$OUT" -czf "$OUT/mlp-$STAMP.tar.gz" "$STAMP" && rm -rf "$DIR"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 \
      -o "$OUT/mlp-$STAMP.tar.gz.gpg" "$OUT/mlp-$STAMP.tar.gz"
  rm -f "$OUT/mlp-$STAMP.tar.gz"
fi
find "$OUT" -maxdepth 1 -name 'mlp-*.tar.gz*' -mtime +"$KEEP_DAYS" -delete
echo "Backup listo en $OUT (mlp-$STAMP)"
# Restaurar (manual, destructivo): parar la app en EasyPanel y luego
#   docker exec -i <db> pg_restore -U <user> -d <db> --clean --if-exists --no-owner < db.dump
#   docker exec -i <app> sh -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < uploads.tar.gz
