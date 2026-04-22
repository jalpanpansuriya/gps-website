export type SmsSendResult = {
  ok: boolean;
  providerMessageId?: string;
  rawResponse?: unknown;
  error?: string;
};

export interface SmsProvider {
  sendSms(phone: string, message: string): Promise<SmsSendResult>;
}

export function normalizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(3);
  return digits;
}
