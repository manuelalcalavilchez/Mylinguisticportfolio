# Checklist de puesta en marcha del piloto

## Servidor
- [ ] VPS con ≥ 1 vCPU, 1 GB RAM, 10 GB disco; actualizaciones de seguridad automáticas.
- [ ] Firewall: solo 22 (SSH con clave), 80 y 443 abiertos. Postgres y el puerto 3000 nunca expuestos.
- [ ] Swap de 1 GB (evita caídas por memoria en el build).

## Configuración
- [ ] `.env` creado desde `.env.example`, con permisos `600`.
- [ ] `SESSION_SECRET` generado con `openssl rand -hex 32`; contraseña de Postgres larga y aleatoria.
- [ ] `APP_ORIGIN` = URL HTTPS exacta; `TRUST_PROXY=1` con proxy delante.
- [ ] `TEACHER_SIGNUP_CODE` vacío salvo durante el alta de profesores.
- [ ] HTTPS activo y redirección desde HTTP.
- [ ] Volumen persistente para `/data/uploads`.

## Operación
- [ ] Admin creado con contraseña ≥ 12 caracteres.
- [ ] `/api/health` devuelve `{"status":"ok"}`.
- [ ] Cron diario de `scripts/backup.sh` (idealmente con `BACKUP_PASSPHRASE`).
- [ ] Backups copiados fuera del servidor.
- [ ] Restauración probada en el servidor real al menos una vez.
- [ ] Logs revisados: no contienen contraseñas, tokens ni contenido de alumnos.

## Legal y centro (antes de usar con alumnado real)
- [ ] Revisión RGPD/LOPDGDD con el centro: base legal, encargado del tratamiento, información a familias.
- [ ] Criterio para datos de menores y derechos de imagen.
- [ ] Política de retención y borrado definida.
- [ ] Publicación pública **desactivada** hasta completar la fase 5 y esta revisión.
