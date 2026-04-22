# SMS Dispatcher (FAST2SMS)

This edge function reads `QUEUED` records from `public.sms_logs`, sends SMS using FAST2SMS, then marks each row as `SENT` or `FAILED`.

## Why this design

- Attendance flow stays unchanged.
- API key remains server-side.
- Provider is isolated behind a small interface so it can be swapped later.

## Required Supabase secrets

Set these before deploy/invoke:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FAST2SMS_API_KEY`

Optional:

- `SMS_DISPATCH_SECRET` (Bearer token for function endpoint protection)
- `FAST2SMS_ENDPOINT` (default: `https://www.fast2sms.com/dev/bulkV2`)
- `FAST2SMS_ROUTE` (default: `q`)
- `FAST2SMS_LANGUAGE` (default: `english`)
- `FAST2SMS_SENDER_ID`

## Local/CLI setup

```bash
supabase functions deploy sms-dispatcher
supabase secrets set FAST2SMS_API_KEY=your_fast2sms_key
supabase secrets set SMS_DISPATCH_SECRET=your_dispatch_secret
```

If not already configured:

```bash
supabase secrets set SUPABASE_URL=your_project_url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Invoke manually

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/sms-dispatcher" \
  -H "Authorization: Bearer <SMS_DISPATCH_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}'
```

`limit` defaults to 20 and is capped to 100.

## Current status updates

The function only updates `sms_logs.status` (`SENT`/`FAILED`) to stay compatible with your current schema.
