// Shared email contract. This module intentionally imports nothing so it can be
// depended on by both the SES and SMTP providers (and their callers) without
// creating circular imports.

export interface EmailAttachment {
  filename: string;
  content: string; // Base64 encoded
  contentType: string;
}

export interface SendEmailOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string[];
  tags?: Record<string, string>;
}

// Per-domain SMTP relay settings used by the nodemailer provider.
export interface SmtpTransportConfig {
  host: string;
  port: number;
  secure: boolean; // true => implicit TLS (465), false => STARTTLS (587/25)
  username: string;
  password: string;
}
