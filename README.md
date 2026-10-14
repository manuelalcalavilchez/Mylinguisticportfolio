# My Linguistic Portfolio

Plataforma educativa para portfolios lingüísticos digitales. Primer caso de uso: Inglés, 4.º ESO.
Preparada para un **piloto en un servidor pequeño**, con pocos profesores y alumnos.

- **Profesorado**: crea grupos e invita al alumnado con un código. Sigue el progreso, comenta, revisa evidencias, evalúa con rúbrica y aprueba publicaciones.
- **Alumnado**: completa un portfolio guiado con 4 secciones (Home, My Language Passport, My Language Biography y My Dossier), sube evidencias con reflexión y solicita publicar una versión.
- **Visitantes**: solo ven versiones publicadas y aprobadas.
- **Privacidad por defecto**: todo es privado. Publicar exige autorización registrada, revisión docente y comprobación automática de datos personales. Además, la publicación está desactivada en el servidor hasta que se active expresamente.

**Estado: MVP completo (fases 0-6).** Ver [docs/ESTADO.md](docs/ESTADO.md) para el detalle de lo implementado y probado.

| Documento | Contenido |
|---|---|
| [docs/EASYPANEL.md](docs/EASYPANEL.md) | **Despliegue paso a paso en EasyPanel (192.168.1.134)** |
| [docs/ESTADO.md](docs/ESTADO.md) | Qué está implementado y probado, resultados reales y limitaciones |
| [docs/PERMISOS.md](docs/PERMISOS.md) | Roles, matriz de permisos, estados de publicación y modelo de datos |
| [docs/PRODUCCION.md](docs/PRODUCCION.md) | Checklist de producción, backups y revisión legal |

## Arquitectura (ajustada a servidor pequeño)

| Pieza | Decisión |
|---|---|
| Contenedores | 2: `app` (API + frontend compilado) y `db` (Postgres 16) |
| Frontend | React 19 + TypeScript + Vite, servido por Express |
| API | Node 22 + TypeScript + Express 5, validación con zod en todas las entradas |
| BD | PostgreSQL con migraciones SQL versionadas, sin ORM, ajustada para unos 256 MB |
| Sesiones | Cookie HttpOnly + SameSite=Strict; token guardado como SHA-256; revocables |
| Archivos | Volumen privado `/data/uploads`; tipo detectado por contenido; descargas autorizadas o con enlace firmado de 5 min |
| Recuperación de acceso | Enlace de un solo uso generado por el profesor (alumnado) o el admin. No necesita email |

Consumo medido en reposo: app unos 30 MB y Postgres unos 43 MB. **Servidor mínimo: 1 vCPU, 1 GB RAM.**

```
apps/api      API (src/routes, src/lib, migrations/, test/)
apps/web      SPA React (src/pages, src/components)
e2e/          pruebas de navegador (Playwright, escritorio y móvil)
scripts/      backup.sh, restore.sh, backup-easypanel.sh
docs/         documentación
```

## Desarrollo local

Requisitos: Node 20 o superior, Docker (o Postgres 16 local).

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # Postgres en 127.0.0.1:5432 (+ BD mlp_test)
cp .env.example .env
# Para desarrollo, en .env:
#   NODE_ENV=development  APP_ORIGIN=http://localhost:5173  TRUST_PROXY=0  STORAGE_DIR=./data/uploads
#   DATABASE_URL=postgres://mlp:mlp_dev_password@localhost:5432/mlp
#   SESSION_SECRET=<openssl rand -hex 32>   TEACHER_SIGNUP_CODE=piloto   PUBLICATION_ENABLED=true
npm run migrate
ADMIN_EMAIL=tu@email ADMIN_PASSWORD='contraseña-de-12+' npm run create-admin -w apps/api
SEED_PASSWORD='demo-password-123' npm run seed      # datos ficticios (opcional)
npm run dev:api     # API en :3000
npm run dev:web     # Web en http://localhost:5173 (proxy /api -> :3000)
```

### Comprobaciones

```bash
npm run check        # lint + typecheck + tests de API + build
npm run test:e2e     # navegador (escritorio y móvil). Requiere build y la BD vacía mlp_e2e_test
E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # contra una instancia desplegada de PRUEBAS
```

Para preparar la BD de e2e: `createdb -O mlp mlp_e2e_test` y después `npx playwright install chromium`.
Los tests de API usan `TEST_DATABASE_URL` (por defecto `…/mlp_test`). Tanto la API como e2e **se niegan a ejecutarse**
contra una BD cuyo nombre no termine en `_test`, porque la vacían.

## Despliegue

- **EasyPanel**: [docs/EASYPANEL.md](docs/EASYPANEL.md).
- **VPS con Docker Compose**:
  ```bash
  cp .env.example .env && nano .env
  docker compose up -d --build
  docker compose exec -e ADMIN_EMAIL=… -e ADMIN_PASSWORD='…' app node dist/create-admin-cli.js
  ```
  La app escucha en `127.0.0.1:${HOST_PORT}`. Pon delante un proxy con HTTPS (Caddy: `reverse_proxy 127.0.0.1:3000`) y usa `TRUST_PROXY=1`.

Las migraciones se aplican solas al arrancar, con bloqueo para evitar ejecuciones simultáneas. Solo avanzan; ninguna borra datos.

## Copias de seguridad

```bash
./scripts/backup.sh                              # Compose: BD + archivos en backups/, conserva 14 días
BACKUP_PASSPHRASE='…' ./scripts/backup.sh        # cifrado con gpg
./scripts/restore.sh backups/mlp-FECHA.tar.gz    # pide escribir RESTAURAR
PROJECT=portfolio PGUSER=postgres PGDB=portfolio ./scripts/backup-easypanel.sh   # EasyPanel
```

Copia los backups fuera del servidor.

## Variables de entorno

Todas están documentadas en [.env.example](.env.example). Las clave son:
- `APP_ORIGIN`: URL exacta que usa el navegador.
- `SESSION_SECRET`.
- `DATABASE_URL`.
- `TEACHER_SIGNUP_CODE`: vacío significa registro de profesores cerrado.
- `PUBLICATION_ENABLED`: `false` por defecto.
- `TRUST_PROXY`.
