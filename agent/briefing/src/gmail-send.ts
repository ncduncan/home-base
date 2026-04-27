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
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]

  const body = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
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
    throw new Error(`Gmail send failed: ${resp.status}`)
  }
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
