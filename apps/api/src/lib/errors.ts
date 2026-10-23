import type { ApiErrorCode } from '@nomer/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, 'bad_request', message);
export const notFound = (message = 'Не найдено') => new AppError(404, 'not_found', message);
export const forbidden = (message = 'Нет доступа') => new AppError(403, 'forbidden', message);
export const conflict = (code: ApiErrorCode, message: string) => new AppError(409, code, message);
