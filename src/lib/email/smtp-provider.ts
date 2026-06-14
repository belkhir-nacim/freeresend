import nodemailer from "nodemailer";
import type { SendEmailOptions, SmtpTransportConfig } from "./types";

function createTransport(smtp: SmtpTransportConfig) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure, // true for 465 (implicit TLS), false for 587/25 (STARTTLS)
    auth: {
      user: smtp.username,
      pass: smtp.password,
    },
    tls: {
      // Set SMTP_TLS_REJECT_UNAUTHORIZED=false to allow self-signed / internal certs.
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    },
  });
}

// Verify connectivity + authentication without sending. Throws on failure.
export async function verifySmtpConnection(
  smtp: SmtpTransportConfig
): Promise<void> {
  const transporter = createTransport(smtp);
  await transporter.verify();
}

export async function sendEmailViaSmtp(
  options: SendEmailOptions,
  smtp: SmtpTransportConfig
): Promise<string> {
  const transporter = createTransport(smtp);

  // Preserve Resend/SES "tags" as custom headers (SMTP has no native tags).
  const headers: Record<string, string> = {};
  if (options.tags) {
    for (const [key, value] of Object.entries(options.tags)) {
      headers[`X-FreeResend-Tag-${key}`] = value;
    }
  }

  const info = await transporter.sendMail({
    from: options.from,
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    replyTo: options.replyTo,
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers,
    // nodemailer builds the MIME message; decode base64 content to a Buffer.
    attachments: options.attachments?.map((att) => ({
      filename: att.filename,
      content: Buffer.from(att.content, "base64"),
      contentType: att.contentType,
    })),
  });

  // nodemailer throws on connection/auth errors; also guard the all-rejected case.
  if (info.rejected?.length && !info.accepted?.length) {
    throw new Error(
      `SMTP server rejected all recipients: ${info.rejected.join(", ")}`
    );
  }

  return info.messageId;
}
