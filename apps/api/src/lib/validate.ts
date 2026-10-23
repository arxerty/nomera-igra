import type { ZodError, ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors';

export function formatZodError(err: ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

/** Разбор входных данных запроса zod-схемой; ошибка — 400 с понятным текстом. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw badRequest(formatZodError(result.error));
  return result.data;
}
