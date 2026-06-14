import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "FreeResend",
    version: "1.0.0",
    emailProvider: process.env.EMAIL_PROVIDER === "smtp" ? "smtp" : "ses",
  });
}
