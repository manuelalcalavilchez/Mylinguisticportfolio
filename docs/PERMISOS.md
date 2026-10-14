# Roles, permisos, estados y modelo de datos

## Reglas generales
- Toda autorización se comprueba en el backend (`apps/api/src/lib/access.ts`). El frontend solo oculta opciones.
- Recurso ajeno ⇒ **404** (no se revela que existe). Rol insuficiente para la ruta ⇒ **403**. Sin sesión ⇒ **401**.
- El profesor solo accede a alumnos con pertenencia **activa** en **sus** grupos. Si retira a un alumno, deja de ver su portfolio.
- El administrador gestiona cuentas y puede retirar publicaciones, pero **no lee** grupos ni portfolios (minimización).

## Matriz de permisos
| Acción | Anónimo | Alumno | Profesor | Admin |
|---|---|---|---|---|
| Ver portfolio publicado (`/p/:slug`) | ✔ | ✔ | ✔ | ✔ |
| Registrarse | con código de grupo / de profesor | — | — | — |
| Crear grupos, códigos, proyectos, actividades, rúbrica | — | — | sus grupos | — |
| Ver miembros, retirar/reincorporar, enlace de recuperación de alumno | — | — | sus grupos | — |
| Registrar/retirar autorización de publicación | — | — | su alumnado | — |
| Editar portfolio y evidencias, subir archivos, entregar | — | el suyo | — | — |
| Ver portfolio privado y archivos | — | el suyo | su alumnado activo | — |
| Comentar, revisar evidencias, evaluar con rúbrica | — | — | su alumnado activo | — |
| Solicitar / cancelar publicación | — | el suyo | — | — |
| Aprobar, pedir cambios, publicar | — | — | su alumnado activo | — |
| Retirar publicación | — | la suya | su alumnado | ✔ |
| Ver progreso del grupo | — | el suyo | sus grupos | — |
| Gestionar cuentas, borrar usuarios | — | — | — | ✔ |
| Exportar sus propios datos | — | ✔ | ✔ | ✔ |

## Estados

### Portfolio y publicación
```
private_draft ──request──▶ publication_requested ──approve──▶ approved ──publish──▶ published
      ▲                         │          │                     │                     │
      └────────cancel───────────┘   request_changes ◀────────────┘                  revoke
                                            ▼                                          ▼
                                    changes_requested ──request──▶ …                revoked ──request──▶ …
```
- Edición permitida en `private_draft`, `changes_requested`, `published` y `revoked`. Bloqueada en revisión (`publication_requested`, `approved`).
- `approve` exige: autorización `public_publication` registrada, solo evidencias aceptadas y comprobación de privacidad sin incidencias.
- `publish` exige además `PUBLICATION_ENABLED=true`. Crea un snapshot congelado y sustituye a la publicación anterior.
- `revoke` marca `revoked_at`: la URL y sus archivos devuelven 404. El portfolio privado se conserva.
- Retirar la autorización retira automáticamente todas las publicaciones del alumno.

### Evidencia
`draft → submitted → accepted` o `submitted → returned → submitted…`. El alumno solo modifica en `draft` y `returned`.

## Modelo de datos (PostgreSQL)

| Tabla | Finalidad | Notas |
|---|---|---|
| `users` | Cuentas | `login` = email (profesor/admin) o usuario (alumno); único sin distinguir mayúsculas. Contraseña con scrypt |
| `sessions` | Sesiones | Solo el SHA-256 del token; caducidad |
| `password_resets` | Enlaces de recuperación | Hash, un uso, 60 min |
| `groups` | Grupos del profesor | Código de invitación como hash, caducidad, usos, estado |
| `memberships` | Pertenencia | PK (grupo, usuario); estado `active`/`removed` |
| `projects` | Proyecto por grupo | Versión de plantilla, estado, rúbrica (jsonb) |
| `activities` | Actividades guiadas | Sección, destreza, fecha de entrega |
| `portfolios` | Un portfolio por alumno y proyecto | Contenido jsonb validado por plantilla, `version` para concurrencia, estado, selección de publicación |
| `evidences` | Evidencias del dossier | Destreza, enlace, clave de archivo privada, MIME detectado, reflexión, estado |
| `reviews` | Feedback docente | Tipo: comentario, revisión de evidencia, evaluación con rúbrica o publicación |
| `publications` | Versiones publicadas | Slug aleatorio, snapshot congelado, quién aprobó, `revoked_at`, una activa por portfolio |
| `consents` | Autorizaciones | Finalidad, referencia al documento, quién la registró, retirada |
| `audit_events` | Auditoría | Actor, acción y recurso; metadatos mínimos sin secretos |
| `schema_migrations` | Control de migraciones | |

Todas las relaciones tienen claves foráneas e índices. Borrar un usuario elimina en cascada sus portfolios, evidencias
y publicaciones; los archivos se borran del disco en la misma operación. Un profesor con grupos o revisiones no se puede
borrar, solo desactivar.
