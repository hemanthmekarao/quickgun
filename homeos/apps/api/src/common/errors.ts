import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ValidationIssue } from '@homeos/shared';

export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string, issues?: ValidationIssue[]) {
    super({ statusCode: status, code, message, ...(issues ? { issues } : {}) }, status);
  }
}

export const badRequest = (message: string, issues?: ValidationIssue[], code = 'BAD_REQUEST') =>
  new ApiException(HttpStatus.BAD_REQUEST, code, message, issues);
export const validationFailed = (issues: ValidationIssue[]) =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'VALIDATION',
    `Validation failed: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`,
    issues,
  );
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHENTICATED') =>
  new ApiException(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN') =>
  new ApiException(HttpStatus.FORBIDDEN, code, message);
export const notFound = (what = 'Record') => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new ApiException(HttpStatus.CONFLICT, code, message);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: any, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, any>;
        res.status(status).json({
          statusCode: status,
          code: b.code ?? (typeof b.error === 'string' ? b.error.toUpperCase().replace(/\s+/g, '_') : 'ERROR'),
          message: Array.isArray(b.message) ? b.message.join('; ') : (b.message ?? exception.message),
          ...(b.issues ? { issues: b.issues } : {}),
        });
      } else {
        res.status(status).json({ statusCode: status, code: 'ERROR', message: String(body) });
      }
      return;
    }

    // Prisma known request errors (identified by code so we do not depend on error classes).
    const code: string | undefined = typeof exception?.code === 'string' ? exception.code : undefined;
    if (code === 'P2002') {
      res.status(409).json({ statusCode: 409, code: 'DUPLICATE', message: 'A record with these details already exists' });
      return;
    }
    if (code === 'P2003') {
      res.status(409).json({
        statusCode: 409,
        code: 'IN_USE',
        message: 'This record is referenced by other records and cannot be changed in this way',
      });
      return;
    }
    if (code === 'P2025') {
      res.status(404).json({ statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' });
      return;
    }
    if (exception?.type === 'entity.too.large' || exception?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ statusCode: 413, code: 'TOO_LARGE', message: 'The upload is too large' });
      return;
    }
    if (exception?.type === 'entity.parse.failed') {
      res.status(400).json({ statusCode: 400, code: 'BAD_JSON', message: 'Request body is not valid JSON' });
      return;
    }

    this.logger.error(exception?.stack ?? String(exception));
    res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Something went wrong. The error has been logged.' });
  }
}
