import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 128 * 1024;

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max: number) {
  const normalized = text(value, max);
  return normalized || null;
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseOccurredAt(value: unknown) {
  const raw = text(value, 80);
  const brazilian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brazilian) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = brazilian;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}-03:00`;
    if (!Number.isNaN(Date.parse(iso))) return new Date(iso).toISOString();
  }
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : new Date().toISOString();
}

function parseResponseTime(payload: Record<string, unknown>) {
  const milliseconds = payload.response_time_ms ?? payload.tempo_resposta_ms;
  const seconds = payload.response_time ?? payload.tempo_resposta;
  const value = milliseconds == null
    ? Number(String(seconds ?? "").replace(",", ".")) * 1000
    : Number(String(milliseconds).replace(",", "."));
  return Number.isFinite(value) ? Math.min(600000, Math.max(0, Math.round(value))) : null;
}

Deno.serve(async request => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return response(413, { error: "payload_too_large" });

  const sourceKey = text(request.headers.get("x-doti-source-key"), 80);
  const webhookSecret = text(request.headers.get("x-doti-webhook-secret"), 200);
  if (!sourceKey || !webhookSecret) return response(401, { error: "missing_credentials" });

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return response(413, { error: "payload_too_large" });
    }
    payload = JSON.parse(raw);
  } catch (_) {
    return response(400, { error: "invalid_json" });
  }

  const question = text(payload.question ?? payload.pergunta, 20000);
  const answer = text(payload.answer ?? payload.resposta, 50000);
  const externalEventId = text(payload.event_id ?? payload.external_event_id, 200);
  if (!question || !answer || !externalEventId) {
    return response(422, { error: "missing_fields", required: ["event_id", "question", "answer"] });
  }

  const occurredAt = parseOccurredAt(payload.occurred_at ?? payload.data_hora);
  const responseTimeMs = parseResponseTime(payload);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return response(500, { error: "server_not_configured" });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: integration, error: integrationError } = await admin
    .from("chatbot_integrations")
    .select("id, agency_id, secret_hash, is_active")
    .eq("source_key", sourceKey)
    .maybeSingle();
  const receivedHash = await sha256(webhookSecret);
  if (integrationError || !integration || !integration.is_active || !safeEqual(receivedHash, integration.secret_hash)) {
    return response(401, { error: "invalid_credentials" });
  }

  const row = {
    agency_id: integration.agency_id,
    integration_id: integration.id,
    external_event_id: externalEventId,
    occurred_at: occurredAt,
    question,
    answer,
    channel: text(payload.channel ?? payload.canal, 40) || "web",
    external_user_id: nullableText(payload.user_id ?? payload.id_usuario, 200),
    source_url: nullableText(payload.url ?? payload.endereco_url, 2048),
    response_time_ms: responseTimeMs,
    raw_payload: payload
  };
  const { data, error } = await admin
    .from("chatbot_interactions")
    .upsert(row, { onConflict: "integration_id,external_event_id", ignoreDuplicates: true })
    .select("id, created_at")
    .maybeSingle();
  if (error) {
    console.error("chatbot_ingest_failed", { code: error.code, message: error.message });
    return response(500, { error: "database_error" });
  }

  return response(data ? 201 : 200, {
    ok: true,
    duplicate: !data,
    interaction_id: data?.id || null
  });
});
