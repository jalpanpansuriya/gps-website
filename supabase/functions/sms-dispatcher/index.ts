import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Fast2SmsProvider } from "../_shared/fast2smsProvider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DISPATCH_SECRET = Deno.env.get("SMS_DISPATCH_SECRET") || "";

const FAST2SMS_API_KEY = Deno.env.get("FAST2SMS_API_KEY") || "";
const FAST2SMS_ENDPOINT = Deno.env.get("FAST2SMS_ENDPOINT") || "https://www.fast2sms.com/dev/bulkV2";
const FAST2SMS_ROUTE = Deno.env.get("FAST2SMS_ROUTE") || "q";
const FAST2SMS_LANGUAGE = Deno.env.get("FAST2SMS_LANGUAGE") || "english";
const FAST2SMS_SENDER_ID = Deno.env.get("FAST2SMS_SENDER_ID") || "";

type SmsQueueRow = {
  id: string;
  phone: string;
  message_body: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function isAuthorized(req: Request): boolean {
  if (!DISPATCH_SECRET) return true;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === DISPATCH_SECRET;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Missing Supabase service role configuration." }, 500);
  }

  if (!FAST2SMS_API_KEY) {
    return json({ error: "Missing FAST2SMS_API_KEY." }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const provider = new Fast2SmsProvider({
    apiKey: FAST2SMS_API_KEY,
    endpoint: FAST2SMS_ENDPOINT,
    route: FAST2SMS_ROUTE,
    language: FAST2SMS_LANGUAGE,
    senderId: FAST2SMS_SENDER_ID || undefined
  });

  const requestBody = await req.json().catch(() => ({}));
  const limitValue = Number(requestBody?.limit ?? 20);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, Math.floor(limitValue))) : 20;

  const queueResult = await supabase
    .from("sms_logs")
    .select("id, phone, message_body")
    .eq("status", "QUEUED")
    .limit(limit);

  if (queueResult.error) {
    return json({ error: "Failed to load SMS queue.", details: queueResult.error.message }, 500);
  }

  const queued = (queueResult.data || []) as SmsQueueRow[];
  if (queued.length === 0) {
    return json({ processed: 0, sent: 0, failed: 0, message: "No queued SMS." });
  }

  let sent = 0;
  let failed = 0;
  const results: Array<{ id: string; status: "SENT" | "FAILED"; reason?: string }> = [];

  for (const row of queued) {
    const sendResult = await provider.sendSms(row.phone, row.message_body);
    const nextStatus = sendResult.ok ? "SENT" : "FAILED";

    const updateResult = await supabase
      .from("sms_logs")
      .update({ status: nextStatus })
      .eq("id", row.id);

    if (updateResult.error) {
      failed += 1;
      results.push({
        id: row.id,
        status: "FAILED",
        reason: `Send status=${nextStatus} but update failed: ${updateResult.error.message}`
      });
      continue;
    }

    if (sendResult.ok) {
      sent += 1;
      results.push({ id: row.id, status: "SENT" });
    } else {
      failed += 1;
      results.push({
        id: row.id,
        status: "FAILED",
        reason: sendResult.error || "Provider rejected SMS"
      });
    }
  }

  return json({
    processed: queued.length,
    sent,
    failed,
    provider: "FAST2SMS",
    results
  });
});
