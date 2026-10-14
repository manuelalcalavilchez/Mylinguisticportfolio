# Despliegue en EasyPanel (servidor 192.168.1.134)

Guía para desplegar el piloto en el EasyPanel de la red local. Tiempo estimado: 15 minutos.

> **Importante: red local y HTTP.** `192.168.1.134` es una IP privada: solo se podrá entrar desde la misma red
> (o por VPN/Tailscale). Además, sin HTTPS las contraseñas viajan sin cifrar dentro de esa red.
> Sirve para probar con unos pocos profesores en el centro. Para que el alumnado entre desde casa hace falta
> un dominio con HTTPS: ver “Paso a dominio con HTTPS” al final.

EasyPanel usa el puerto **3000** del servidor para su propio panel, así que la app se publica en otro puerto
(en esta guía, **8090**). Dentro del contenedor la app sigue escuchando en el 3000.

## 1. Proyecto

En `http://192.168.1.134:3000` → **Create project** → nombre `portfolio`.

## 2. Base de datos

En el proyecto → **+ Service → Postgres**.
- Service name: `db`
- Image: `postgres:16` (o la que proponga EasyPanel, 16 o superior)
- Crear. En la pestaña del servicio copia la **Internal Connection URL**
  (algo como `postgres://postgres:CONTRASEÑA@portfolio_db:5432/portfolio`).

## 3. Aplicación

**+ Service → App** → Service name: `app`.

### Source
- **GitHub**: owner `manuelalcalavilchez`, repository `Mylinguisticportfolio`, branch `main`, build path `/`.
  Si el repositorio es privado, configura antes un token de GitHub en *Settings → GitHub* de EasyPanel.

### Build
- Tipo: **Dockerfile**, archivo `Dockerfile`.

### Environment
Pega esto y sustituye los valores entre `< >`:

```
NODE_ENV=production
PORT=3000
APP_ORIGIN=http://192.168.1.134:8090
DATABASE_URL=<Internal Connection URL del paso 2>
SESSION_SECRET=<64 caracteres hex: openssl rand -hex 32>
SESSION_TTL_HOURS=12
TEACHER_SIGNUP_CODE=<código para que se registren los profesores; vacío = registro cerrado>
STORAGE_DIR=/data/uploads
MAX_UPLOAD_MB=10
DB_POOL_MAX=5
TRUST_PROXY=0
PUBLICATION_ENABLED=false
ALLOW_PUBLIC_INDEXING=false
```

- `APP_ORIGIN` debe coincidir **exactamente** con la dirección que se escribe en el navegador
  (protocolo, IP y puerto). Si no coincide, todas las acciones darán “Origen no permitido”.
- Para generar `SESSION_SECRET` sin terminal puedes usar la consola de EasyPanel: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PUBLICATION_ENABLED=false`: se puede trabajar, revisar y aprobar, pero no publicar en abierto hasta que el
  centro complete la revisión legal. Cámbialo a `true` cuando proceda y redepliega.

### Mounts
- **Add Volume** → name `uploads`, mount path `/data/uploads`.
  Sin este volumen los archivos del alumnado se perderían en cada despliegue.
  Usa un *volume* (no un *bind mount* a una carpeta del host): el contenedor corre como usuario sin privilegios.

### Ports
- **Add Port** → Published `8090`, Target `3000`, protocolo TCP.
  (No añadas dominio en *Domains* para este modo por IP).

### Recursos (opcional)
- Memory limit 256–384 MB es suficiente para el piloto.

Pulsa **Deploy**. El primer build tarda unos minutos.

## 4. Comprobar

En *Logs* de `app` deben aparecer:

```
migración aplicada: 001_auth.sql
migración aplicada: 002_domain.sql
migración aplicada: 003_pilot.sql
Publicación pública DESACTIVADA (PUBLICATION_ENABLED=false)
API escuchando en :3000 (production)
```

Abre `http://192.168.1.134:8090/api/health` → `{"status":"ok"}`.

## 5. Crear el administrador

Pestaña **Console** del servicio `app` (shell `sh`):

```sh
ADMIN_EMAIL=tu@email.es ADMIN_NAME="Manuel" ADMIN_PASSWORD='una-contraseña-de-12-o-más' node dist/create-admin-cli.js
```

Entra en `http://192.168.1.134:8090` con ese email.

### Datos de demostración (opcional, solo para enseñar la app)

```sh
SEED_FORCE=true SEED_PASSWORD='demo-password-123' node dist/seed-cli.js
```

Crea `demo.teacher@example.invalid`, `demo.alba` y `demo.leo`. Bórralos desde el panel de administración antes del piloto real.

## 6. Uso en el piloto

1. El admin crea las cuentas de profesor (o comparte `TEACHER_SIGNUP_CODE` y la URL `/registro-profesor`).
2. Cada profesor crea su grupo y pulsa **Generar código**.
3. El alumnado entra en `http://192.168.1.134:8090/unirse` con ese código. No necesita email.
4. Si un alumno olvida la contraseña, su profesor genera un enlace de recuperación desde la ficha del grupo.

## 7. Actualizar

Cada `git push` a `main` → en EasyPanel pulsa **Deploy** (o activa *Auto Deploy*). Las migraciones se aplican solas
al arrancar y nunca borran datos.

## 8. Copias de seguridad

Opción A, desde EasyPanel: servicio `db` → *Backups* (necesita un destino S3 configurado). Esto no incluye los archivos subidos.

Opción B, recomendada (BD + archivos), por SSH en el servidor:

```sh
git clone https://github.com/manuelalcalavilchez/Mylinguisticportfolio.git /opt/mlp-scripts
PROJECT=portfolio PGUSER=postgres PGDB=portfolio /opt/mlp-scripts/scripts/backup-easypanel.sh
```

Programa un cron diario (`crontab -e`):

```
15 3 * * * PROJECT=portfolio PGUSER=postgres PGDB=portfolio /opt/mlp-scripts/scripts/backup-easypanel.sh >> /root/backups/mlp.log 2>&1
```

Copia `/root/backups/mlp` a otro equipo o disco. El final del script explica cómo restaurar.
Haz al menos **una restauración de prueba** antes del piloto.

## Paso a dominio con HTTPS

Cuando tengas un dominio que apunte al servidor (p. ej. `portfolio.tecnologiaalcala.com` con Cloudflare Tunnel o
apertura de puertos 80/443):
1. En `app` → *Domains* → añade el dominio, puerto 3000, HTTPS activado. Puedes quitar el puerto 8090.
2. Cambia `APP_ORIGIN=https://portfolio.tudominio` y `TRUST_PROXY=1` (o `2` si además hay Cloudflare delante).
3. Redepliega. Con `https://` la cookie de sesión pasa a ser `Secure` automáticamente.

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| “Origen no permitido” al entrar | `APP_ORIGIN` no coincide con la URL del navegador | Ajustar y redeplegar |
| El contenedor se reinicia y el log dice `STORAGE_DIR … no tiene permiso` | Montaje *bind* propiedad de root | Usar *volume*, o `chown -R 1000:1000` en la carpeta |
| `Configuración inválida: SESSION_SECRET` | Falta o es corto | Generar 64 caracteres hex |
| `ECONNREFUSED` a la BD | `DATABASE_URL` no es la URL interna | Copiar la *Internal Connection URL* |
| “Demasiados intentos” | Rate limit (20 intentos / 15 min por IP) | Esperar 15 min |
