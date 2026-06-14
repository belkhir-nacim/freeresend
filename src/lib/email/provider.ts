// Lightweight provider selector with NO heavy imports, so modules that only need
// to know the active provider (e.g. the domain lifecycle) don't transitively pull
// in nodemailer or the AWS SDK.

export type EmailProvider = "ses" | "smtp";

// Which provider this deployment sends through. Global per deployment; defaults
// to "ses" so existing setups are unaffected.
export function getEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "smtp" ? "smtp" : "ses";
}
