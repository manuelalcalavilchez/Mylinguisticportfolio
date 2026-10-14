# Roles, permisos y estados

## Reglas generales

- Toda autorización se comprueba en el backend. El frontend solo oculta opciones por comodidad.
- Recurso ajeno ⇒ **404** (no se revela su existencia). Rol insuficiente en una ruta ⇒ **403**. Sin sesión ⇒ **401**.
- Todo portfolio nace privado.

## Matriz actual (fase 1)

| Ruta | Anónimo | Alumno | Profesor | Admin |
|---|---|---|---|---|
| `GET /api/health` | ✔ | ✔ | ✔ | ✔ |
| `POST /api/auth/login`, `/password-reset` | ✔ | ✔ | ✔ | ✔ |
| `POST /api/auth/register-teacher` (requiere código) | ✔ | — | — | — |
| `GET /api/auth/me`, `POST /logout`, `/change-password` | — | ✔ | ✔ | ✔ |
| `/api/admin/*` | — | — | — | ✔ |

## Matriz prevista (fases 2-5)

| Acción | Alumno | Profesor | Admin |
|---|---|---|---|
| Crear grupo / invitación | — | sus grupos | — |
| Ver miembros de un grupo | — | sus grupos | ✔ |
| Editar portfolio | el suyo | — | — |
| Ver portfolio | el suyo | alumnos de sus grupos | — (salvo soporte auditado) |
| Comentar / evaluar | — | alumnos de sus grupos | — |
| Solicitar publicación | el suyo | — | — |
| Aprobar / publicar / retirar | — | alumnos de sus grupos | retirar |
| Descargar evidencia | la suya | alumnos de sus grupos | — |

## Estados de publicación (fase 5)

```
private_draft → publication_requested → approved → published → revoked
                         ↓                               ↑
                 changes_requested → publication_requested
```

Solo el backend valida transiciones. Publicar crea un snapshot congelado en `publications.snapshot`;
retirar marca `revoked_at` y la URL deja de servir contenido. Indexación por buscadores desactivada por defecto.
