/**
 * send-sms.js — minimal Node.js example for Jasmin's HTTP API
 *
 * Jasmin exposes /send as a simple GET endpoint. You pass username/password
 * as query params, and get back a line like:
 *   Success "abc-123-message-id"
 * or an error like:
 *   Error "Mandatory argument <content> is not found."
 *
 * Node 18+ (built-in fetch). No dependencies.
 *
 * Usage:
 *   node examples/send-sms.js +233244123456 "Welcome to QuestionsDey!"
 */

import { URL, pathToFileURL } from 'node:url';

try {
  process.loadEnvFile();
} catch {}

const JASMIN_HTTP_URL = process.env.JASMIN_HTTP_URL ?? 'http://localhost:1401';
const JASMIN_USER     = process.env.JASMIN_USER     ?? 'qrollix';
const JASMIN_PASSWORD = process.env.JASMIN_PASSWORD ?? 'change-me';
const SENDER_ID       = process.env.SMPP_SOURCE_ADDR ?? 'Qrollix';

/**
 * Send a single SMS through Jasmin.
 *
 * @param {string} to       Recipient in E.164 format, e.g. +233244123456
 * @param {string} content  Message body (keep to 160 GSM-7 chars per segment)
 * @param {object} [opts]
 * @param {string} [opts.from]           Sender ID override
 * @param {boolean} [opts.dlr]           Request delivery report
 * @param {string}  [opts.dlrUrl]        Webhook for delivery reports
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string, raw: string}>}
 */
export async function sendSms(to, content, opts = {}) {
  const url = new URL(`${JASMIN_HTTP_URL}/send`);
  url.searchParams.set('username', JASMIN_USER);
  url.searchParams.set('password', JASMIN_PASSWORD);
  url.searchParams.set('to',       to);
  url.searchParams.set('from',     opts.from ?? SENDER_ID);
  url.searchParams.set('content',  content);

  if (opts.dlr) {
    url.searchParams.set('dlr',          'yes');
    url.searchParams.set('dlr-url',      opts.dlrUrl ?? '');
    url.searchParams.set('dlr-level',    '2');       // final delivery status
    url.searchParams.set('dlr-method',   'POST');
  }

  const resp = await fetch(url);
  const text = (await resp.text()).trim();

  // Jasmin responses: `Success "msg-id"`  or  `Error "message"`
  const ok = text.startsWith('Success');
  const quoted = text.match(/"([^"]+)"/)?.[1];

  return ok
    ? { ok: true,  messageId: quoted, raw: text }
    : { ok: false, error: quoted ?? text, raw: text };
}

// ---- CLI entrypoint -------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , to, ...rest] = process.argv;
  const message = rest.join(' ');
  if (!to || !message) {
    console.error('Usage: node send-sms.js <recipient-e164> <message...>');
    process.exit(1);
  }

  const result = await sendSms(to, message, { dlr: false });
  if (result.ok) {
    console.log(`✓  sent — message id: ${result.messageId}`);
  } else {
    console.error(`✗  failed — ${result.error}`);
    process.exit(2);
  }
}
