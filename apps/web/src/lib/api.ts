export type Role = 'admin' | 'teacher' | 'student';
export interface User {
  id: string;
  login: string;
  displayName: string;
  role: Role;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { path: string; message: string }[],
    public details?: unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Ha ocurrido un error', data.fields, data.details);
  }
  return data as T;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return handle<T>(res);
}

export async function upload<T = unknown>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'PUT', credentials: 'same-origin', body: fd });
  return handle<T>(res);
}
