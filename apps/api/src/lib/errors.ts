export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Inicia sesión para continuar');
export const forbidden = () => new HttpError(403, 'forbidden', 'No tienes permiso para esta operación');
// Para recursos ajenos devolvemos 404 en lugar de 403: no revelamos que existen.
export const notFound = () => new HttpError(404, 'not_found', 'Recurso no encontrado');
