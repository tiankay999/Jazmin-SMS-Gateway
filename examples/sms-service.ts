/**
 * sms-service.ts
 *
 * Provider-agnostic SMS service for Qrollix / QuestionsDey.
 *
 * Why an interface? So you can start on Jasmin today, swap to Arkesel or
 * Hubtel tomorrow, and the rest of your codebase doesn't care. The route
 * your messages take is a config concern, not a product concern.
 *
 * Node 18+ (uses built-in fetch). Drop this into your backend as
 * `src/sms/sms-service.ts` and import SmsService where you need to send.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SmsMessage {
  /** E.164 phone number, e.g. "+233244123456". */
  to: string;
  /** Message body. Keep to 160 GSM-7 chars per segment, or 70 UCS-2 chars. */
  content: string;
  /** Optional sender ID override. Defaults to the provider's configured one. */
  from?: string;
  /** Optional idempotency key — your own id so retries don't double-send. */
  clientRef?: string;
}

export type SmsResult =
  | { ok: true;  to: string; messageId: string;  provider: string }
  | { ok: false; to: string; error: string;      provider: string };

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

// ---------------------------------------------------------------------------
// Jasmin HTTP API adapter
// ---------------------------------------------------------------------------

export interface JasminConfig {
  baseUrl:  string;   // e.g. http://localhost:1401
  username: string;   // the HTTP-API user you created in configure-jasmin.sh
  password: string;
  senderId: string;   // your registered sender ID, e.g. "Qrollix"
  /** Optional webhook Jasmin will POST delivery reports to. */
  dlrUrl?:  string;
}

export class JasminSmsProvider implements SmsProvider {
  readonly name = "jasmin";

  constructor(private readonly cfg: JasminConfig) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    const params = new URLSearchParams({
      username: this.cfg.username,
      password: this.cfg.password,
      to:       message.to,
      from:     message.from ?? this.cfg.senderId,
      content:  message.content,
    });

    if (this.cfg.dlrUrl) {
      params.set("dlr",        "yes");
      params.set("dlr-url",    this.cfg.dlrUrl);
      params.set("dlr-level",  "2");
      params.set("dlr-method", "POST");
    }

    try {
      const resp = await fetch(`${this.cfg.baseUrl}/send?${params}`);
      const raw  = (await resp.text()).trim();
      const quoted = raw.match(/"([^"]+)"/)?.[1];

      if (raw.startsWith("Success") && quoted) {
        return { ok: true, to: message.to, messageId: quoted, provider: this.name };
      }
      return { ok: false, to: message.to, error: quoted ?? raw, provider: this.name };
    } catch (err) {
      return {
        ok: false,
        to: message.to,
        error: err instanceof Error ? err.message : String(err),
        provider: this.name,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Example second provider (Arkesel REST) — stub, implement when you need it.
// ---------------------------------------------------------------------------

export interface ArkeselConfig {
  apiKey:   string;
  senderId: string;
  baseUrl?: string;         // defaults to https://sms.arkesel.com/api/v2
}

export class ArkeselSmsProvider implements SmsProvider {
  readonly name = "arkesel";
  constructor(private readonly cfg: ArkeselConfig) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    const base = this.cfg.baseUrl ?? "https://sms.arkesel.com/api/v2";
    try {
      const resp = await fetch(`${base}/sms/send`, {
        method: "POST",
        headers: {
          "api-key":     this.cfg.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender:     message.from ?? this.cfg.senderId,
          message:    message.content,
          recipients: [message.to],
        }),
      });

      const body = (await resp.json().catch(() => ({}))) as {
        status?:  string;
        data?:    Array<{ id?: string }>;
        message?: string;
      };

      if (resp.ok && body.status === "success") {
        return {
          ok:        true,
          to:        message.to,
          messageId: body.data?.[0]?.id ?? "unknown",
          provider:  this.name,
        };
      }
      return {
        ok:       false,
        to:       message.to,
        error:    body.message ?? `HTTP ${resp.status}`,
        provider: this.name,
      };
    } catch (err) {
      return {
        ok:       false,
        to:       message.to,
        error:    err instanceof Error ? err.message : String(err),
        provider: this.name,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Broadcast helper — concurrency-limited fan-out with per-recipient results
// ---------------------------------------------------------------------------

export interface BroadcastOptions {
  /** How many sends to run at once. Keep this below your SMPP throughput cap. */
  concurrency?: number;
  /** Called after each send. Useful for progress bars / live updates. */
  onProgress?: (done: number, total: number, result: SmsResult) => void;
}

/**
 * Send one message to many recipients.
 *
 * Returns every result — don't throw on failure, return it. A broadcast
 * where 3 of 500 recipients fail still delivered 497, and the caller
 * decides what to do about the 3.
 */
export async function broadcast(
  provider:   SmsProvider,
  recipients: string[],
  content:    string,
  opts:       BroadcastOptions = {},
): Promise<SmsResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 10);
  const unique      = [...new Set(recipients)];     // dedupe: saves money
  const results: SmsResult[] = new Array(unique.length);
  let nextIndex = 0;
  let done      = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= unique.length) return;
      const to     = unique[i];
      const result = await provider.send({ to, content });
      results[i]   = result;
      done++;
      opts.onProgress?.(done, unique.length, result);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Example usage
// ---------------------------------------------------------------------------
//
//   import { JasminSmsProvider, broadcast } from "./sms-service";
//
//   const sms = new JasminSmsProvider({
//     baseUrl:  process.env.JASMIN_HTTP_URL!,
//     username: process.env.JASMIN_USER!,
//     password: process.env.JASMIN_PASSWORD!,
//     senderId: "Qrollix",
//     dlrUrl:   "https://api.qrollix.com/webhooks/sms-dlr",
//   });
//
//   // Single send
//   await sms.send({ to: "+233244123456", content: "Welcome to Qrollix." });
//
//   // Broadcast to a class list
//   const results = await broadcast(
//     sms,
//     classList.map(s => s.phone),
//     "CS101 lecture moved to JQB 3 at 10:00. — Qrollix",
//     {
//       concurrency: 20,
//       onProgress: (done, total) => console.log(`${done}/${total}`),
//     },
//   );
//
//   const failed = results.filter(r => !r.ok);
//   console.log(`Delivered ${results.length - failed.length}/${results.length}`);
