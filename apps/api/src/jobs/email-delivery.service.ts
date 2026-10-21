import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailDeliveryJob } from './email-job.js';

@Injectable()
export class EmailDeliveryService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const configuredHost = config.get<string>('SMTP_HOST') ?? '127.0.0.1';
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASSWORD');
    // Mailpit (local/CI) accepts unauthenticated SMTP; a real mailbox (DirectAdmin's
    // mail.valuebooks.co) requires AUTH + STARTTLS on port 587 -- only demand TLS when we're
    // actually authenticating, so Mailpit (which doesn't speak STARTTLS) keeps working.
    const authenticated = Boolean(user && pass);
    this.transporter = nodemailer.createTransport({
      // On Windows, `localhost` may resolve to an IPv6 listener that Docker Desktop's published
      // SMTP port does not serve. Keep named production hosts unchanged and make local delivery
      // deterministic.
      host: configuredHost === 'localhost' ? '127.0.0.1' : configuredHost,
      port: Number(config.get('SMTP_PORT') ?? 51025),
      secure: false,
      ...(authenticated ? { requireTLS: true, auth: { user, pass } } : {}),
      // Real-world SMTP (DirectAdmin's mail.valuebooks.co over the public internet, not Mailpit
      // on loopback) needs more than the 1.5s/3s budget tuned for local delivery.
      connectionTimeout: authenticated ? 5_000 : 1_500,
      greetingTimeout: authenticated ? 5_000 : 1_500,
      socketTimeout: authenticated ? 10_000 : 3_000,
    });
    this.from = config.get('EMAIL_FROM') ?? 'ValueBooks <no-reply@valuebooks.local>';
  }

  async deliver(message: EmailDeliveryJob): Promise<void> {
    // Delivery errors must escape so BullMQ can apply the configured retry/backoff policy.
    await this.transporter.sendMail({ ...message, from: this.from });
  }
}
