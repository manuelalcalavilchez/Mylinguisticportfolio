# Checklist de puesta en marcha del piloto

## Servidor
- [ ] Al menos 1 vCPU, 1 GB RAM y 10 GB de disco; actualizaciones de seguridad automáticas.
- [ ] Postgres y el puerto interno de la app no expuestos a Internet.
- [ ] Swap de 1 GB (evita fallos de memoria durante el build).

## Configuración
- [ ] `SESSION_SECRET` aleatorio de 64 caracteres hex; contraseña de Postgres larga.
- [ ] `APP_ORIGIN` = URL exacta de acceso. `TRUST_PROXY` según haya o no proxy delante.
- [ ] `TEACHER_SIGNUP_CODE` vacío salvo durante el alta de profesores.
- [ ] Volumen persistente montado en `/data/uploads`.
- [ ] `PUBLICATION_ENABLED=false` hasta completar la revisión legal.
- [ ] HTTPS si se accede desde fuera de la red local.

## Operación
- [ ] Admin creado (contraseña de 12 o más caracteres). Datos de demostración borrados.
- [ ] `/api/health` devuelve `{"status":"ok"}`.
- [ ] Backup diario programado y copiado fuera del servidor.
- [ ] **Restauración probada** en el servidor real al menos una vez.
- [ ] Logs revisados: sin contraseñas, tokens ni contenido de alumnos (la app no los registra).

## Legal y centro (antes de usar con alumnado real)
- [ ] Revisión RGPD/LOPDGDD con el centro: base legal, información a las familias, encargo del tratamiento.
- [ ] Procedimiento de autorización de publicación y derechos de imagen (menores de 14 años: consentimiento de los tutores).
- [ ] Política de retención: qué se borra al final del curso (el admin puede borrar cuentas con sus archivos).
- [ ] Solo entonces: `PUBLICATION_ENABLED=true`.
- [ ] Recordar a profesores y alumnos que no suban fotos de otras personas ni datos personales.
