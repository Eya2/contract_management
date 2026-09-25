import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * SMTP transport. In development this points at Mailpit, which catches every
 * message (http://localhost:8025) so nothing reaches a real inbox.
 */
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  // Mailpit has no TLS; a real provider would be configured with auth + TLS.
  ignoreTLS: env.NODE_ENV !== 'production',
});

export async function sendEmail(message: EmailMessage): Promise<void> {
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}
