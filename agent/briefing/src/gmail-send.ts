/**
 * Send a multi-part HTML email via the Gmail API using the same OAuth token
 * the calendar sync uses (gmail.send scope).
 */

export type SendEmailParams = {
  /** Bearer access token with gmail.send scope */
  accessToken: string
  /** Comma-separated TO list */
  to: string[]
  /** Subject line */
  subject: string
  /** Rendered HTML body */
  html: string
  /** Plain-text fallback body */
  text: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { accessToken, to, subject, html, text } = params

  const boundary = `=====bound_${Date.now()}_${Math.random().toString(36).slice(2)}=====`
  const headers = [
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]

  // Body parts are base64-encoded so non-ASCII content (em dashes, smart
  // quotes, etc. from event titles or todos) survives intact. 7bit would be
  // invalid for any byte > 127 and Gmail rejects with 400.
  const body = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrap(text),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrap(html),
    '',
    `--${boundary}--`,
  ].join('\r\n')

  // Gmail API expects base64url-encoded RFC 2822 message in `raw` field.
  const raw = Buffer.from(body, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const resp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  )

  if (!resp.ok) {
    // Body is Gmail's error response (no user content), safe to log.
    const detail = await resp.text().catch(() => '')
    throw new Error(`Gmail send failed: ${resp.status} ${detail.slice(0, 500)}`)
  }
}

/**
 * RFC 2047 encoded-word for Subject / other unstructured headers. ASCII
 * passes through; anything else gets `=?UTF-8?B?<base64>?=` so the header
 * line stays 7-bit-clean and Gmail's parser accepts it.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  const b64 = Buffer.from(value, 'utf-8').toString('base64')
  return `=?UTF-8?B?${b64}?=`
}

/** Base64-encode and wrap to 76-char lines per RFC 2045. */
function base64Wrap(value: string): string {
  const b64 = Buffer.from(value, 'utf-8').toString('base64')
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64
}

/** Strip HTML tags for the plain-text fallback. Keeps the briefing readable in clients that only render text. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
