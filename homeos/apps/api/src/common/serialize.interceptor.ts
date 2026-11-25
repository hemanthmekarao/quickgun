import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

function isDecimal(v: any): boolean {
  return typeof v === 'object' && v !== null && typeof v.toNumber === 'function' && typeof v.toFixed === 'function' && Array.isArray(v.d);
}

/** Convert Prisma Decimal values to plain numbers anywhere in a response body. */
export function toPlain(value: any, depth = 0): any {
  if (value === null || value === undefined || depth > 12) return value;
  if (typeof value !== 'object') return typeof value === 'bigint' ? Number(value) : value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (isDecimal(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map((v) => toPlain(v, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) out[k] = toPlain(v, depth + 1);
  return out;
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((body) => toPlain(body)));
  }
}
