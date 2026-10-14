import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

/** Registra un evento sensible. metadata debe ir minimizada: nunca contraseñas, tokens ni contenido privado. */
export async function audit(
  db: Queryable,
  actorId: string | null,
  action: string,
  resource?: { type: string; id: string },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, resource?.type ?? null, resource?.id ?? null, metadata],
  );
}
