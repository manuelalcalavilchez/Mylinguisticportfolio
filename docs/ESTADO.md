# Estado del proyecto

Fecha: 2026-10-14 · Versión 0.1.0

## Fase 0 — Inspección (completada)

- Directorio de trabajo vacío: no había proyecto previo; se inicializó un repositorio Git nuevo. No se sobrescribió nada.
- Herramientas disponibles: Node 22, npm 10, Docker 29, PostgreSQL 16, Git.
- Decisión principal: adaptar la arquitectura de la especificación a un **piloto pequeño** (ver README):
  2 contenedores, almacenamiento local en volumen en vez de S3, sesiones en Postgres en vez de Redis,
  recuperación de acceso por enlace del admin en vez de email.
- Dependencias de desarrollo fijadas a TypeScript 6.0 porque typescript-eslint aún no admite TypeScript 7.

## Fase 1 — Base (completada)

| Elemento | Estado |
|---|---|
| Monorepo (npm workspaces), lint, typecheck, build | Implementado y probado |
| Migraciones SQL versionadas (001 auth, 002 dominio completo) | Implementado y probado (idempotentes) |
| Registro de profesor con código, login, logout, `/me` | Implementado y probado |
| Cambio de contraseña (cierra otras sesiones) | Implementado y probado |
| Recuperación por enlace de un solo uso | Implementado y probado (uso único, caducidad) |
| Bloqueo por intentos fallidos + rate limit | Implementado y probado (bloqueo) |
| Roles admin/teacher/student y control en backend | Implementado y probado |
| Gestión de usuarios por admin (crear, activar/desactivar) | Implementado y probado |
| CSRF (Origin + JSON), cabeceras de seguridad, noindex | Implementado y probado |
| Auditoría de eventos sensibles | Implementado y probado |
| CLI para crear el primer admin | Implementado y probado (y bug corregido durante la validación) |
| Frontend: login, registro, recuperación, panel por rol, gestión de usuarios | Implementado; compila y se sirve desde el contenedor. **Sin tests automáticos de navegador todavía** |
| Docker (imagen única + Postgres con límites de memoria) | Probado: arranca, migra, health check `healthy` |
| Backup y restauración | Probado de extremo a extremo |

### Comandos ejecutados y resultados

```
npm run lint        -> 0 errores, 0 avisos
npm run typecheck   -> OK (api y web)
npm test            -> 27/27 pruebas superadas (Vitest + Supertest contra Postgres real)
npm run build       -> OK (web: 269 KB JS / 85 KB gzip)
docker compose up   -> app healthy; migraciones 001 y 002 aplicadas
E2E con curl        -> SPA servida; login sin Origin = 403; login y alta de profesor OK; CSP y X-Robots-Tag presentes
backup.sh / restore.sh -> datos y archivos borrados se recuperan; health ok tras restaurar
```

Nota: la imagen Docker se construyó en un entorno con proxy, usando una variante temporal del Dockerfile que solo
añadía el certificado del proxy en la etapa de build. El Dockerfile del repositorio no contiene esa modificación.

## Pendiente

- **Fase 2 — Grupos**: crear grupo, código/invitación con caducidad, límite de usos y revocación; alta de alumnos; retirar acceso. Pruebas de aislamiento profesor A / profesor B.
- **Fase 3 — Portfolio**: plantilla versionada con Home, Passport, Biography y Dossier; guardado de borradores; vista previa.
- **Fase 4 — Evidencias**: subida de archivos (validación de tipo real, tamaño, nombres aleatorios), descarga autorizada, reflexiones, revisión y rúbrica.
- **Fase 5 — Publicación**: máquina de estados, snapshot congelado, URL pública, retirada, consentimientos.
- **Fase 6 — Producción**: HTTPS en el servidor real, cron de backups fuera del servidor, piloto.
- Tests de navegador/móvil (Playwright) cuando exista el flujo de alumno.

## Limitaciones conocidas

- Rate limiting en memoria: correcto con una sola instancia; si se escala a varias, hay que moverlo a Postgres o Redis.
- No hay envío de emails: la recuperación depende del admin.
- La tabla `consents` existe, pero no sustituye la revisión legal del centro.
