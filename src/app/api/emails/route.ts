import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/api-keys";
import { sendEmail, getEmailProvider } from "@/lib/email";
import type { SmtpTransportConfig } from "@/lib/email";
import { getDomainById } from "@/lib/domains";
import { query } from "@/lib/database";
import { decryptSecret } from "@/lib/crypto";

// Sending goes through the AWS SES SDK; force the Node runtime (not Edge).
export const runtime = "nodejs";
export const maxDuration = 30;

const attachmentSchema = z.object({
  filename: z.string(),
  content: z.string(), // Base64 encoded
  contentType: z.string().optional(),
});

const sendEmailSchema = z
  .object({
    from: z.string().email("Invalid from email"),
    to: z
      .array(z.string().email("Invalid to email"))
      .min(1, "At least one recipient is required"),
    cc: z.array(z.string().email("Invalid cc email")).optional(),
    bcc: z.array(z.string().email("Invalid bcc email")).optional(),
    subject: z.string().min(1, "Subject is required"),
    html: z.string().optional(),
    text: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    reply_to: z.array(z.string().email("Invalid reply_to email")).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .refine((data) => data.html || data.text, {
    message: "Either html or text content is required",
  });

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

export async function POST(request: NextRequest) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return cors(new NextResponse(null, { status: 200 }));
  }

  try {
    // Check authorization (API key required)
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return cors(NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      ));
    }

    const apiKeyValue = authHeader.substring(7);
    const apiKey = await verifyApiKey(apiKeyValue);
    if (!apiKey) {
      return cors(NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      ));
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = sendEmailSchema.parse(body);
    
    const {
      from,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      attachments,
      reply_to,
      tags,
    } = validatedData;

    // Verify the from domain is authorized for this API key
    const domain = await getDomainById(apiKey.domain_id);
    if (!domain) {
      return cors(NextResponse.json({ error: "Domain not found" }, { status: 404 }));
    }

    if (domain.status !== "verified") {
      return cors(NextResponse.json(
        { error: "Domain not verified" },
        { status: 400 }
      ));
    }

    // Validate from email domain
    const fromDomain = from.split("@")[1];
    if (fromDomain !== domain.domain) {
      return cors(NextResponse.json(
        { error: `From email must be from domain: ${domain.domain}` },
        { status: 400 }
      ));
    }

    // Check API key permissions
    if (!apiKey.permissions.includes("send")) {
      return cors(NextResponse.json(
        { error: "API key does not have send permission" },
        { status: 403 }
      ));
    }

    // In SMTP mode, load this domain's relay settings (decrypting the password).
    let smtpConfig: SmtpTransportConfig | undefined;
    if (getEmailProvider() === "smtp") {
      if (!domain.smtp_config) {
        return cors(NextResponse.json(
          { error: `No SMTP relay configured for domain ${domain.domain}` },
          { status: 400 }
        ));
      }
      smtpConfig = {
        ...domain.smtp_config,
        password: decryptSecret(domain.smtp_config.password),
      };
    }

    // Convert arrays and prepare data for the email provider
    const toArray = Array.isArray(to) ? to : [to];
    const ccArray = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;
    const bccArray = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;
    const replyToArray = reply_to ? (Array.isArray(reply_to) ? reply_to : [reply_to]) : undefined;
    
    // Convert attachments to match EmailAttachment interface
    const sesAttachments = attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType || 'application/octet-stream'
    }));

    // Send email via the configured provider (SES, or per-domain SMTP relay)
    const messageId = await sendEmail({
      from,
      to: toArray,
      cc: ccArray,
      bcc: bccArray,
      subject: subject || '',
      html,
      text,
      attachments: sesAttachments,
      replyTo: replyToArray,
      tags,
    }, smtpConfig);

    // Log email in database
    let emailLog = null;
    try {
      const result = await query(
        `INSERT INTO email_logs (
          api_key_id, domain_id, message_id, from_email, to_emails, cc_emails, bcc_emails,
          subject, html_content, text_content, attachments, status, ses_message_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          apiKey.id,
          domain.id,
          messageId,
          from,
          JSON.stringify(to),
          JSON.stringify(cc || []),
          JSON.stringify(bcc || []),
          subject,
          html,
          text,
          JSON.stringify(attachments || []),
          "sent",
          // ses_message_id is only meaningful in SES mode (used by the SNS webhook).
          getEmailProvider() === "ses" ? messageId : null,
        ]
      );
      emailLog = result.rows[0];
    } catch (logError) {
      console.error("Failed to log email:", logError);
    }

    return cors(NextResponse.json({
      id: emailLog?.id || messageId,
      from,
      to,
      created_at: new Date().toISOString(),
    }));
  } catch (error: unknown) {
    // Handle validation errors
    const errorObj = error as { errors?: unknown; message?: string };
    if (errorObj.errors || errorObj.message?.includes('validation') || errorObj.message?.includes('parse')) {
      return cors(NextResponse.json(
        {
          error: "Invalid request data",
          details: errorObj.errors || errorObj.message,
        },
        { status: 400 }
      ));
    }

    console.error("API Error:", error);
    return cors(NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    ));
  }
}