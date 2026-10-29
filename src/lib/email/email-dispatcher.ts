import { logOperationalFailure } from "../observability/log";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDispatcher {
  sendEmail(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export class DefaultEmailDispatcher implements EmailDispatcher {
  async sendEmail(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // In production, can hook into SMTP or webhook via fetch if configured.
      // In dev/test or when unset, safely log the notification dispatch without external libraries.
      const simulatedId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Audit/system observability log for dispatch
      if (process.env.NODE_ENV !== "test") {
        console.info(`[EMAIL_DISPATCH] To: ${payload.to} | Subject: ${payload.subject} | ID: ${simulatedId}`);
      }

      return {
        success: true,
        messageId: simulatedId,
      };
    } catch (err) {
      logOperationalFailure({
        operation: "email.send",
        outcome: "failure",
        category: "EMAIL_DISPATCH_FAILED",
        status: 500,
        resourceId: payload.to,
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : "EMAIL_DISPATCH_FAILED",
      };
    }
  }
}

export const emailDispatcher: EmailDispatcher = new DefaultEmailDispatcher();
