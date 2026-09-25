import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * SMTP transport. By default it points at Mailpit, which catches every message
 * (http://localhost:8025) so nothing reaches a real inbox. With SMTP_USER and
 * SMTP_PASS set it logs in to a real provider over TLS and delivers for real.
 */
const realProvider = !!env.SMTP_USER;
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  ...(realProvider
    ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, requireTLS: !env.SMTP_SECURE }
    : // Mailpit speaks plain SMTP.
      { ignoreTLS: true }),
});

export async function sendEmail(message: EmailMessage): Promise<void> {
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}
