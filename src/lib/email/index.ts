import * as ses from "@/lib/ses";
import { sendEmailViaSmtp } from "./smtp-provider";
import { getEmailProvider } from "./provider";
import type { SendEmailOptions, SmtpTransportConfig } from "./types";

export type {
  EmailAttachment,
  SendEmailOptions,
  SmtpTransportConfig,
} from "./types";
export { verifySmtpConnection } from "./smtp-provider";
export { getEmailProvider } from "./provider";
export type { EmailProvider } from "./provider";

// Unified sender. In SMTP mode the caller must supply the per-domain relay
// settings (looked up from the domain's smtp_config).
export async function sendEmail(
  options: SendEmailOptions,
  smtp?: SmtpTransportConfig
): Promise<string> {
  if (getEmailProvider() === "smtp") {
    if (!smtp) {
      throw new Error(
        "EMAIL_PROVIDER=smtp but no SMTP relay is configured for this domain"
      );
    }
    return sendEmailViaSmtp(options, smtp);
  }
  return ses.sendEmail(options);
}
