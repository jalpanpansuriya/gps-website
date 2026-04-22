import { normalizeIndianPhone, SmsProvider, SmsSendResult } from "./smsProvider.ts";

type Fast2SmsConfig = {
  apiKey: string;
  endpoint: string;
  route: string;
  language: string;
  senderId?: string;
};

export class Fast2SmsProvider implements SmsProvider {
  private readonly config: Fast2SmsConfig;

  constructor(config: Fast2SmsConfig) {
    this.config = config;
  }

  async sendSms(phone: string, message: string): Promise<SmsSendResult> {
    const normalizedPhone = normalizeIndianPhone(phone);

    if (normalizedPhone.length !== 10) {
      return {
        ok: false,
        error: "Invalid Indian mobile number after normalization"
      };
    }

    const payload: Record<string, unknown> = {
      route: this.config.route,
      message,
      language: this.config.language,
      flash: 0,
      numbers: normalizedPhone
    };

    if (this.config.senderId) {
      payload.sender_id = this.config.senderId;
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.config.apiKey
        },
        body: JSON.stringify(payload)
      });

      const rawResponse = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          ok: false,
          error: `FAST2SMS HTTP ${response.status}`,
          rawResponse
        };
      }

      const requestId = rawResponse?.request_id ?? rawResponse?.requestId;
      return {
        ok: true,
        providerMessageId: typeof requestId === "string" ? requestId : undefined,
        rawResponse
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "FAST2SMS request failed"
      };
    }
  }
}
