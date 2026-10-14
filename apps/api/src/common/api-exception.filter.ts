import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { ERROR_REPORTER, type ErrorReporter } from './logging/error-reporter.js';
import { redactUrl } from './logging/redact.js';

/**
 * P2025 ("record to update/delete not found") is what an optimistic-concurrency `where: {
 * id, version }` update throws when the version is stale, across every versioned model
 * (Invoice, Bill, Expense, CreditNote, Quote, PurchaseOrder, PaymentReceived, PaymentMade,
 * Journal, VendorCredit, SalesOrder) -- none of those services catches it themselves, so
 * it otherwise falls through to a generic 500. Mapped centrally here rather than in each
 * service so every versioned type gets the same 409 without a repeated catch block.
 */
function isStaleVersionConflict(exception: unknown): boolean {
  return exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(ApiExceptionFilter.name) private readonly logger: PinoLogger,
    @Inject(ERROR_REPORTER) private readonly errorReporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const staleVersion = !(exception instanceof HttpException) && isStaleVersionConflict(exception);
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : staleVersion
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    const messages =
      typeof payload === 'object' && payload && 'message' in payload
        ? (payload as { message?: unknown }).message
        : exception instanceof Error
          ? exception.message
          : null;
    const validationMessages = Array.isArray(messages)
      ? messages.filter((message): message is string => typeof message === 'string')
      : undefined;
    const message = staleVersion
      ? 'This record was changed by someone else. Reload and try again.'
      : status >= 500
        ? 'Something went wrong. Please try again.'
        : validationMessages
          ? 'Some fields need your attention.'
          : typeof messages === 'string'
            ? messages
            : typeof payload === 'string'
              ? payload
              : 'Request could not be completed.';

    if (status >= 500) {
      const correlationId = correlationIdOf(request);
      const detail = {
        correlationId,
        method: request.method,
        url: redactUrl(request.originalUrl),
        statusCode: status,
      };

      this.logger.error(
        { ...detail, err: exception instanceof Error ? exception : new Error(String(exception)) },
        'Unhandled request failure',
      );
      this.errorReporter.captureException(exception, detail);
    }

    response.status(status).json({
      error: {
        code: errorCode(status, Boolean(validationMessages)),
        message,
        ...(validationMessages ? { fieldErrors: validationMessages } : {}),
      },
    });
  }
}

function correlationIdOf(request: Request): string | undefined {
  const id = (request as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function errorCode(status: number, validation: boolean): string {
  if (validation) return 'VALIDATION_ERROR';
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'AUTHENTICATION_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    429: 'RATE_LIMITED',
  };
  return codes[status] ?? 'INTERNAL_ERROR';
}
