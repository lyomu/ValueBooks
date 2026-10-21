import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EMAIL_JOB_NAMES, type EmailDeliveryJob, type EmailJobName } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';

/** Billing-specific transactional emails, following the same small-service-per-sender-domain
 * convention as `AuthMailerService` rather than a shared catch-all mailer. */
@Injectable()
export class BillingMailerService {
  private readonly webUrl: string;
  private readonly marketingUrl: string;

  constructor(
    config: ConfigService,
    private readonly emailQueue: EmailQueueService,
  ) {
    this.webUrl = (config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    this.marketingUrl = (config.get<string>('MARKETING_SITE_URL') || this.webUrl).replace(/\/$/, '');
  }

  /** Exact copy from billing spec Section 6.1, sent once, roughly 24 hours before trial expiry. */
  async sendTrialEndingTomorrow(input: {
    to: string;
    organizationName: string;
    trialEndsAt: Date;
    timeZone: string;
  }): Promise<void> {
    const url = `${this.marketingUrl}/pricing`;
    const expiry = formatInTimeZone(input.trialEndsAt, input.timeZone);
    await this.send(EMAIL_JOB_NAMES.trialEndingTomorrow, {
      to: input.to,
      subject: 'Your ValueBooks free trial ends tomorrow',
      text: [
        'Your 14-day ValueBooks free trial is almost over.',
        '',
        'You have one day remaining to explore your Professional trial features.',
        '',
        'Choose a subscription plan to continue creating invoices, tracking expenses, and managing your business without interruption.',
        '',
        'Your existing financial records will remain safely stored even if you decide not to subscribe immediately.',
        '',
        `View Plans: ${url}`,
        '',
        `Your trial ends ${expiry}.`,
        '',
        'Need help? Contact support@valuebooks.co.',
      ].join('\n'),
      html: this.template(
        'Your free trial ends tomorrow',
        `Your 14-day ValueBooks free trial is almost over. You have one day remaining to explore your Professional trial features.<br><br>` +
          `Choose a subscription plan to continue creating invoices, tracking expenses, and managing your business without interruption.<br><br>` +
          `Your existing financial records will remain safely stored even if you decide not to subscribe immediately.`,
        'View Plans',
        url,
        `Your trial ends ${expiry}. Need help? Contact support@valuebooks.co.`,
      ),
    });
  }

  async sendEvent(input: { to: string; subject: string; body: string; actionUrl?: string; actionLabel?: string; jobId: string }) {
    await this.emailQueue.enqueue(EMAIL_JOB_NAMES.billingNotice, {
      to: input.to, subject: input.subject, text: [input.body, input.actionUrl ? `${input.actionLabel ?? 'View billing'}: ${input.actionUrl}` : ''].filter(Boolean).join('\n\n'),
      html: this.template(input.subject, escapeHtml(input.body).replaceAll('\n', '<br>'),
        input.actionLabel ?? 'View billing', input.actionUrl ?? `${this.webUrl}/settings/billing`, 'ValueBooks billing notice'),
    }, input.jobId);
  }

  private async send(name: EmailJobName, message: EmailDeliveryJob): Promise<void> {
    await this.emailQueue.enqueue(name, message);
  }

  private template(title: string, copy: string, button: string, url: string, footnote: string): string {
    return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#061c3d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #dfe6ef;border-radius:14px"><tr><td style="padding:28px"><div style="font-weight:700;font-size:18px;margin-bottom:28px">ValueBooks</div><h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">${escapeHtml(title)}</h1><p style="color:#526681;line-height:1.6;margin:0 0 24px">${copy}</p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0879e8;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">${escapeHtml(button)}</a><p style="color:#718096;font-size:13px;line-height:1.5;margin:24px 0 0">${escapeHtml(footnote)}</p></td></tr></table></td></tr></table></body></html>`;
  }
}

function formatInTimeZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  );
}
