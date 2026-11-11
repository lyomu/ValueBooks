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

/**
 * Errors that are not HttpExceptions but still describe a client problem. Mapping them here keeps
 * the user-facing message specific instead of the generic 500 text: body-parser rejections carry
 * an HTTP `status` (413 for an oversized JSON body, 400 for malformed JSON), and Prisma reports
 * unique and foreign-key violations with stable codes.
 */
function describeKnownFailure(exception: unknown): { status: number; message: string } | null {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      return { status: HttpStatus.CONFLICT, message: 'A record with these details already exists.' };
    }
    if (exception.code === 'P2003') {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'This record refers to something that no longer exists. Reload and try again.',
      };
    }
    return null;
  }
  if (exception instanceof Error) {
    const candidate = exception as Error & { status?: unknown; statusCode?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 413) {
        return {
          status,
          message:
            'This request is too large. Choose a smaller image or shorten the entry and try again.',
        };
      }
      if (status === 400) {
        return { status, message: 'The request could not be read. Reload the page and try again.' };
      }
      return { status, message: exception.message || 'Request could not be completed.' };
    }
  }
  return null;
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
    const known = exception instanceof HttpException ? null : describeKnownFailure(exception);
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : staleVersion
          ? HttpStatus.CONFLICT
          : (known?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const correlationId = correlationIdOf(request);
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
      : known
        ? known.message
        : status >= 500
          ? correlationId
            ? `Something went wrong on our side and the change was not saved. Try again, and if it keeps happening quote reference ${correlationId.slice(0, 8)} to support.`
            : 'Something went wrong on our side and the change was not saved. Please try again.'
          : validationMessages
            ? validationMessages.length === 1
              ? validationMessages[0]
              : 'Some fields need your attention.'
          : typeof messages === 'string'
            ? messages
            : typeof payload === 'string'
              ? payload
              : 'Request could not be completed.';

    if (status >= 500) {
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

    const billingLimit = payload && typeof payload === 'object' &&
      (payload as { code?: unknown }).code === 'PLAN_LIMIT_REACHED'
      ? payload as { code: string; feature: string; currentUsage: number; limit: number; upgradeRequired: boolean }
      : null;
    const readOnly = payload && typeof payload === 'object' &&
      (payload as { code?: unknown }).code === 'SUBSCRIPTION_READ_ONLY';
    response.status(status).json({
      error: {
        code: billingLimit?.code ?? (readOnly ? 'SUBSCRIPTION_READ_ONLY' : errorCode(status, Boolean(validationMessages))),
        message: billingLimit ? `You have reached the ${billingLimit.feature} limit for your plan.` : message,
        ...(billingLimit ? { feature: billingLimit.feature, currentUsage: billingLimit.currentUsage,
          limit: billingLimit.limit, upgradeRequired: true } : {}),
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
