import { createHmac, timingSafeEqual } from 'node:crypto';

/** Enlaces temporales firmados (HMAC-SHA256) para descargar archivos privados sin cookie. */
export class UrlSigner {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update('file-links-v1').digest();
  }

  private mac(resource: string, exp: number): string {
    return createHmac('sha256', this.key).update(`${resource}|${exp}`).digest('base64url');
  }

  sign(resource: string, ttlSeconds: number, now = Date.now()) {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    return { exp, sig: this.mac(resource, exp) };
  }

  verify(resource: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
    const a = Buffer.from(this.mac(resource, exp));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
