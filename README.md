# My Linguistic Portfolio

Plataforma educativa para portfolios lingüísticos digitales (primer caso: Inglés, 4.º ESO).
Esta versión está preparada para un **piloto en un servidor pequeño** (pocos profesores y alumnos).

> Estado: **Fase 0 y Fase 1 completadas** (base, BD, migraciones, autenticación, roles, Docker, backups).
> Grupos, portfolio, evidencias y publicación (fases 2-5) aún **no** están implementados. Ver [docs/ESTADO.md](docs/ESTADO.md).

## Arquitectura (ajustada a servidor pequeño)

| Pieza | Decisión | Motivo |
|---|---|---|
| Contenedores | **2**: `app` (API + frontend compilado) y `db` (Postgres) | Menos RAM y menos piezas que mantener |
| Frontend | React + TypeScript + Vite, servido por Express | Sin nginx extra |
| API | Node 22 + TypeScript + Express 5, validación con zod | Según especificación |
| BD | PostgreSQL 16, migraciones SQL versionadas propias | Sin ORM; tuning para 256 MB |
| Sesiones | Cookie HttpOnly + SameSite=Strict, token hasheado en Postgres | Sin Redis; revocables al instante |
| Archivos | Volumen Docker local (`/data/uploads`), fuera de rutas públicas | S3 es innecesario para un piloto; se podrá cambiar |
| Hash de contraseñas | scrypt nativo de Node (N=2^15) | Sin dependencias nativas; RAM acotada |
| Recuperación de acceso | El admin genera un enlace de un solo uso (60 min) | Funciona sin configurar SMTP |
| Rate limiting | En memoria (express-rate-limit) | Válido con una única instancia |

Consumo medido en reposo: app ≈ 22 MB, Postgres ≈ 31 MB (límites: 256 MB cada uno). Imagen: 255 MB.
**Servidor mínimo recomendado:** 1 vCPU, 1 GB RAM, 10 GB disco.

```
apps/api      API Express (src/, migrations/, test/)
apps/web      SPA React
scripts/      backup.sh, restore.sh, dev-init.sql
docs/         estado, permisos, checklist de producción
```

## Desarrollo local

Requisitos: Node ≥ 20, Docker (o un Postgres 16 local).

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # Postgres en 127.0.0.1:5432 (+ BD mlp_test)
cp .env.example .env
# Edita .env para desarrollo:
#   NODE_ENV=development
#   APP_ORIGIN=http://localhost:5173
#   DATABASE_URL=postgres://mlp:mlp_dev_password@localhost:5432/mlp
#   SESSION_SECRET=$(openssl rand -hex 32)
#   TEACHER_SIGNUP_CODE=piloto       STORAGE_DIR=./data/uploads    TRUST_PROXY=0
npm run migrate
ADMIN_EMAIL=tu@email ADMIN_PASSWORD='contraseña-de-12+' npm run create-admin -w apps/api
npm run dev:api     # API en :3000
npm run dev:web     # Web en http://localhost:5173 (proxy /api -> :3000)
```

Comprobaciones (lo mismo que se ejecutó para validar esta entrega):

```bash
npm run lint && npm run typecheck && npm test && npm run build    # o: npm run check
```

Los tests usan `TEST_DATABASE_URL` (por defecto `postgres://mlp:mlp_dev_password@localhost:5432/mlp_test`) y
**se niegan a ejecutarse** si el nombre de la BD no termina en `_test`, porque borran el esquema.

## Despliegue en el servidor

### Opción A: Docker Compose + proxy HTTPS (VPS)

```bash
git clone <repo> && cd my-linguistic-portfolio
cp .env.example .env && nano .env      # valores reales: ver comentarios del archivo
docker compose up -d --build
docker compose exec -e ADMIN_EMAIL=tu@email -e ADMIN_PASSWORD='...' app node dist/create-admin-cli.js
curl -s http://127.0.0.1:3000/api/health   # {"status":"ok"}
```

La app solo escucha en `127.0.0.1:3000`. Delante pon un proxy con HTTPS, p. ej. Caddy:

```
portfolio.tudominio.es {
  reverse_proxy 127.0.0.1:3000
}
```

### Opción B: EasyPanel

1. Crea un servicio **Postgres** (versión 16) en el proyecto y anota la URL interna.
2. Crea un servicio **App** desde el repositorio Git, con build por **Dockerfile**.
3. Variables de entorno: las de `.env.example` (`DATABASE_URL` = URL interna del Postgres de EasyPanel, `TRUST_PROXY=1`, `APP_ORIGIN=https://tu-dominio`).
4. **Monta un volumen** en `/data/uploads` (si no, los archivos se pierden al redeplegar).
5. Dominio → puerto 3000. EasyPanel gestiona el HTTPS.
6. Crea el admin desde la consola del contenedor: `ADMIN_EMAIL=... ADMIN_PASSWORD=... node dist/create-admin-cli.js`.

Las migraciones se aplican solas al arrancar (con bloqueo para evitar ejecuciones simultáneas). Solo avanzan:
no hay migraciones destructivas automáticas.

## Cuentas en el piloto

- **Admin**: se crea por CLI. Gestiona usuarios y genera enlaces de recuperación.
- **Profesores**: los crea el admin desde el panel, o se registran en `/registro-profesor` si `TEACHER_SIGNUP_CODE` tiene valor. Déjalo **vacío** para cerrar el registro.
- **Alumnos**: entrarán con invitación o código de grupo (fase 2). El admin no puede crear alumnos directamente, a propósito.
- **Contraseña olvidada**: el admin pulsa “Enlace recuperación” y lo entrega por un canal privado. Al usarlo, se cierran todas las sesiones del usuario.

## Copias de seguridad

```bash
./scripts/backup.sh                              # backups/mlp-FECHA.tar.gz (BD + archivos), conserva 14 días
BACKUP_PASSPHRASE='...' ./scripts/backup.sh      # versión cifrada .gpg
./scripts/restore.sh backups/mlp-FECHA.tar.gz    # pide escribir RESTAURAR
```

Cron diario sugerido: `15 3 * * * cd /ruta/proyecto && ./scripts/backup.sh >> backups/backup.log 2>&1`.
**Copia los backups fuera del servidor** (otro equipo, almacenamiento externo). Un backup en el mismo disco no protege de su pérdida.

El ciclo backup → borrado de datos → restauración se ha probado en esta entrega (ver docs/ESTADO.md).

## Seguridad aplicada en la base

Autorización en backend por rol en cada ruta · cookies HttpOnly/SameSite=Strict/Secure (con HTTPS) · protección CSRF
por Origin + JSON obligatorio · CSP estricta y cabeceras con helmet · `noindex` por defecto · bloqueo tras 5 intentos
fallidos y rate limit · mensajes que no revelan si un email existe · tokens de sesión y recuperación guardados solo como
SHA-256 · auditoría de acciones sensibles sin secretos · BD no expuesta fuera de Docker · contenedor sin root.

Antes de activar la publicación pública (fase 5) hay que revisar RGPD/LOPDGDD, el tratamiento de datos de menores y
los derechos de imagen con el centro. Ver [docs/PRODUCCION.md](docs/PRODUCCION.md).
