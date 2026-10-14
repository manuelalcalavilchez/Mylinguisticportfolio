# Estado del proyecto

Fecha: 2026-10-14 · Versión 1.0.0 (MVP del piloto)

Leyenda: **Probado** = cubierto por pruebas automáticas que se han ejecutado y pasan.
**Probado (e2e)** = además verificado en navegador real, en escritorio y móvil, contra el contenedor Docker de producción.

## Fase 0 — Inspección
Directorio vacío: el proyecto se creó de cero con Git. Herramientas disponibles: Node 22, Docker 29, PostgreSQL 16.
Adaptaciones al servidor pequeño: 2 contenedores, almacenamiento en volumen en vez de S3, sesiones en Postgres en vez
de Redis y recuperación de acceso sin email. TypeScript se fija en la versión 6.0 por compatibilidad con typescript-eslint.

## Fase 1 — Base
| Elemento | Estado |
|---|---|
| Registro de profesor con código, login, logout, cambio de contraseña | Probado (e2e) |
| Bloqueo tras 5 fallos; rate limit por IP+usuario (aulas con IP compartida) | Probado |
| Recuperación con enlace de un solo uso (admin y profesor) | Probado |
| CSRF (Origin + JSON), CSP, cabeceras, `noindex` | Probado |
| Auditoría de acciones sensibles sin secretos | Probado |

## Fase 2 — Grupos
| Elemento | Estado |
|---|---|
| Crear, editar y archivar grupos; proyecto con actividades por defecto | Probado |
| Código de invitación: caducidad, límite de usos (1 uso = invitación individual), revocación; solo se guarda su hash | Probado |
| Alta de alumnado con código, **sin email** | Probado (e2e) |
| Retirar y reincorporar alumnos; un retirado no vuelve por su cuenta | Probado |
| Aislamiento profesor A / profesor B; el admin no lee grupos ni portfolios | Probado (e2e parcial) |

## Fase 3 — Portfolio
| Elemento | Estado |
|---|---|
| Plantilla v1 versionada: Home, Passport (idiomas, autoevaluación MCER orientativa, certificados), Biography (historia, objetivos, checklist *can-do*), Dossier | Probado |
| Guardado automático con indicador; guardado parcial; validación de tipos y longitudes | Probado (e2e) |
| Control de concurrencia (dos pestañas): conflicto 409 en lugar de sobrescribir | Probado |
| Progreso individual y del grupo (orientativo) | Probado |
| Vista previa | Probado (e2e) |

## Fase 4 — Evidencias y evaluación
| Elemento | Estado |
|---|---|
| Evidencias con título, fecha, lengua, destreza, actividad, enlace y reflexión (4 preguntas) | Probado |
| Subida con tipo detectado por contenido (PDF, imagen, audio, vídeo); límite de tamaño; nombres aleatorios | Probado (e2e) |
| Descarga autorizada; enlaces firmados de 5 min; caducidad y manipulación rechazadas | Probado |
| Archivos servidos con `CSP: sandbox` y `nosniff` | Probado |
| Entrega, devolución con comentario, corrección y aceptación | Probado (e2e) |
| Comentarios por sección y rúbrica configurable con validación de puntuaciones | Probado |

## Fase 5 — Publicación
| Elemento | Estado |
|---|---|
| Estados `private_draft → publication_requested → approved → published → revoked` (+ `changes_requested`), validados en backend | Probado (no se pueden saltar) |
| El alumno elige secciones, evidencias aceptadas y nombre público | Probado (e2e) |
| Requisitos para aprobar: autorización registrada, solo evidencias aceptadas, sin emails, teléfonos ni usuario en el contenido | Probado |
| Snapshot congelado; editar el borrador no altera lo publicado | Probado |
| La URL pública no expone ids, usuario, grupo, centro ni claves de archivos | Probado |
| Retirada por alumno, profesor o admin; URL y archivos dejan de servirse; el portfolio privado se conserva | Probado (e2e) |
| Retirar la autorización retira las publicaciones | Probado |
| Interruptor `PUBLICATION_ENABLED` (por defecto `false`) | Probado |
| Indexación desactivada por defecto (`noindex`) | Probado |

## Fase 6 — Producción
| Elemento | Estado |
|---|---|
| Imagen Docker única, usuario sin root, health check, límites de memoria | Probado (arranca `healthy`, unos 30 MB) |
| Seed de datos ficticios (bloqueado en producción salvo `SEED_FORCE`) | Probado |
| Exportación de datos propios (JSON) y borrado definitivo de cuenta por el admin, archivos incluidos | Probado |
| Backup y restauración con archivos reales | Probado (Compose); el script de EasyPanel no se ha ejecutado contra EasyPanel |
| Guía EasyPanel para 192.168.1.134 | Escrita; **no desplegada desde aquí** (sin acceso a esa red) |

## Resultados de la última verificación

```
npm run lint        -> 0 errores, 0 avisos
npm run typecheck   -> OK (api y web)
npm test            -> 84/84 (Vitest + Supertest contra PostgreSQL real; 4 archivos)
npm run build       -> OK (web: 331 KB JS / 99 KB gzip)
npm run test:e2e    -> 4/4 (Chromium escritorio + Pixel 7), local y contra el contenedor Docker de producción
docker compose      -> app healthy; migraciones 001-003 aplicadas; create-admin y seed OK
backup/restore      -> usuarios 8→8 y archivos 2→2 recuperados tras borrarlos
```

Fallos reales detectados y corregidos durante la verificación:
- `create-admin` fallaba por tipos de parámetros en Postgres.
- En zod 4, los valores por defecto dentro de `.partial()` hacían que un PATCH sobrescribiera campos no enviados (evidencias, actividades y grupos).
- El detector de privacidad confundía cifras de los identificadores internos con teléfonos.
- El rate limit por IP habría bloqueado a una clase entera detrás de la misma IP.

Nota: la imagen se construyó en un entorno con proxy, usando una variante temporal del Dockerfile que solo añadía su
certificado en la etapa de build. El Dockerfile del repositorio no la incluye.

## Limitaciones conocidas
- Por IP local y HTTP (192.168.1.134), solo se accede desde la red local y sin cifrado. Para acceso externo hace falta un dominio con HTTPS (ver EASYPANEL.md).
- Rate limiting en memoria: válido con una instancia.
- Sin envío de emails: la recuperación depende del profesor o el admin.
- El detector de datos personales es una ayuda; la revisión del profesor sigue siendo necesaria (no detecta nombres propios ni caras en fotos).
- Plantilla v1 solo en inglés para 4.º ESO; otras plantillas e idiomas quedan para futuras versiones.
- La tabla `consents` registra una referencia a la autorización; no sustituye el procedimiento legal del centro.

## Fuera del MVP (siguientes pasos posibles)
Otras plantillas e idiomas · importación/exportación de portfolios completos con archivos · integración con LMS ·
asistente de IA con revisión docente · varios docentes por grupo y organizaciones · emails transaccionales.
