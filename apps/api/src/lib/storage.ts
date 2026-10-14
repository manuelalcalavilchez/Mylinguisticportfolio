import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Request } from 'express';
import busboy from 'busboy';
import { HttpError } from './errors.js';

/**
 * Almacenamiento privado en disco (volumen Docker), fuera de cualquier ruta estática.
 * - Nombres aleatorios sin extensión: el nombre original nunca llega al sistema de archivos.
 * - El tipo se detecta por los primeros bytes (magic numbers), no por lo que diga el navegador.
 * - Lista blanca: PDF, imágenes, audio y vídeo. Documentos ofimáticos (zip) no: se piden en PDF.
 */
export const ALLOWED_TYPES = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/ogg': 'OGG',
  'video/webm': 'WebM',
  'video/mp4': 'MP4/M4A',
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

export function sniffMime(b: Buffer): AllowedMime | null {
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

export class Storage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!/^[a-f0-9]{48}$/.test(key)) throw new Error('storage key inválida');
    return path.join(this.root, key.slice(0, 2), key.slice(2, 4), key);
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.pathFor(key)).then(() => true, () => false);
  }

  open(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (key) await rm(this.pathFor(key), { force: true });
  }

  /** Recibe un único archivo multipart (campo "file") con límite de tamaño y lo valida. */
  async receive(req: Request, maxBytes: number): Promise<{ key: string; mime: AllowedMime; size: number }> {
    const tmpDir = path.join(this.root, '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, randomBytes(16).toString('hex'));

    const size = await new Promise<number>((resolve, reject) => {
      let bb: busboy.Busboy;
      try {
        bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 0, parts: 2 } });
      } catch {
        return reject(new HttpError(400, 'invalid_upload', 'Se esperaba un formulario multipart'));
      }
      let got = false;
      let written = 0;
      let failed: Error | null = null;
      let pending: Promise<void> | null = null;
      bb.on('file', (name, file) => {
        if (name !== 'file' || got) {
          file.resume();
          return;
        }
        got = true;
        const out = createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
        file.on('data', (chunk: Buffer) => (written += chunk.length));
        file.on('limit', () => {
          failed = new HttpError(413, 'file_too_large', `El archivo supera ${Math.round(maxBytes / 1048576)} MB`);
        });
        pending = new Promise((res, rej) => {
          out.on('finish', () => res());
          out.on('error', rej);
        });
        file.pipe(out);
      });
      bb.on('error', () => reject(new HttpError(400, 'invalid_upload', 'Subida no válida')));
      bb.on('close', () => {
        if (!got) return reject(new HttpError(400, 'no_file', 'No se ha recibido ningún archivo'));
        Promise.resolve(pending)
          .then(() => (failed ? reject(failed) : resolve(written)))
          .catch(reject);
      });
      req.pipe(bb);
    }).catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    });

    if (size === 0) {
      await rm(tmp, { force: true });
      throw new HttpError(400, 'empty_file', 'El archivo está vacío');
    }
    const fh = await open(tmp, 'r');
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    await fh.close();
    const mime = sniffMime(head);
    if (!mime) {
      await rm(tmp, { force: true });
      throw new HttpError(415, 'unsupported_file_type', `Tipo no permitido. Formatos: ${Object.values(ALLOWED_TYPES).join(', ')}`);
    }
    const key = randomBytes(24).toString('hex');
    const finalPath = this.pathFor(key);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tmp, finalPath);
    return { key, mime, size };
  }
}
