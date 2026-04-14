// TCP Protocol Implementations — IMAP & SMTP
// Runs in the main Worker where connect() is available.
// Called by /api/net/ HTTP endpoints, NOT by Dynamic Workers directly.

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Line Reader ──

class LineReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = '';

  constructor(readable: ReadableStream<Uint8Array>) {
    this.reader = readable.getReader();
  }

  async readLine(): Promise<string> {
    while (true) {
      const idx = this.buf.indexOf('\r\n');
      if (idx >= 0) {
        const line = this.buf.substring(0, idx);
        this.buf = this.buf.substring(idx + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) return this.buf;
      this.buf += dec.decode(value, { stream: true });
    }
  }

  async readBytes(n: number): Promise<string> {
    while (this.buf.length < n) {
      const { value, done } = await this.reader.read();
      if (done) break;
      this.buf += dec.decode(value, { stream: true });
    }
    const data = this.buf.substring(0, n);
    this.buf = this.buf.substring(n);
    return data;
  }

  releaseLock() { try { this.reader.releaseLock(); } catch {} }
}

// ── Email Parser ──

export interface ParsedEmail {
  uid: number;
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string;
}

function parseEmail(raw: string): Omit<ParsedEmail, 'uid'> {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headerBlock = headerEnd > 0 ? raw.substring(0, headerEnd) : raw;
  const bodyBlock = headerEnd > 0 ? raw.substring(headerEnd + 4) : '';
  const unfolded = headerBlock.replace(/\r\n([ \t])/g, ' ');

  function getHeader(name: string): string {
    const re = new RegExp('^' + name + ':\\s*(.+)$', 'im');
    const m = unfolded.match(re);
    return m ? m[1].trim() : '';
  }

  function decodeWord(s: string): string {
    return s.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_: string, _c: string, encoding: string, text: string) => {
      if (encoding.toUpperCase() === 'B') {
        return dec.decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
      }
      return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    });
  }

  function extractAddr(s: string): string {
    const m = s.match(/<([^>]+)>/);
    return m ? m[1] : s.trim();
  }

  const from = extractAddr(getHeader('From'));
  const to = extractAddr(getHeader('To'));
  const subject = decodeWord(getHeader('Subject'));
  const messageId = getHeader('Message-ID').replace(/[<>]/g, '');
  const inReplyTo = getHeader('In-Reply-To').replace(/[<>]/g, '');

  let textBody = '';
  const contentType = getHeader('Content-Type');

  if (contentType.includes('multipart/')) {
    const bMatch = contentType.match(/boundary="?([^";\s]+)"?/);
    if (bMatch) {
      const boundary = bMatch[1];
      const parts = bodyBlock.split('--' + boundary);
      for (const part of parts) {
        if (part.trim() === '--' || part.trim() === '') continue;
        const phe = part.indexOf('\r\n\r\n');
        if (phe < 0) continue;
        const ph = part.substring(0, phe).toLowerCase();
        const pb = part.substring(phe + 4).trim();
        if (ph.includes('text/plain')) {
          textBody = pb;
          if (ph.includes('quoted-printable')) {
            textBody = textBody.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
          } else if (ph.includes('base64')) {
            textBody = dec.decode(Uint8Array.from(atob(pb.replace(/\s/g, '')), c => c.charCodeAt(0)));
          }
          break;
        }
      }
    }
  }

  if (!textBody) {
    textBody = bodyBlock;
    if (contentType.includes('quoted-printable') || getHeader('Content-Transfer-Encoding').includes('quoted-printable')) {
      textBody = textBody.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    } else if (getHeader('Content-Transfer-Encoding').includes('base64')) {
      textBody = dec.decode(Uint8Array.from(atob(textBody.replace(/\s/g, '')), c => c.charCodeAt(0)));
    }
    if (contentType.includes('text/html')) {
      textBody = textBody.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim();
    }
  }

  return { from, to, subject: subject || '(no subject)', body: textBody.trim(), messageId, inReplyTo };
}

// ── Security ──

function validateTarget(hostname: string, port: number) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('172.')) {
    throw new Error('Connections to internal/private networks are not allowed');
  }
  if (port === 25) throw new Error('Port 25 blocked. Use 465 or 587.');
}

// ── IMAP ──

export async function imapFetchUnseen(
  host: string, port: number, user: string, pass: string,
  lastUid: number, businessEmail: string, processedFlag: string, limit: number,
): Promise<{ emails: ParsedEmail[]; maxUid: number; hasMore: boolean }> {
  validateTarget(host, port);

  const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
  const lr = new LineReader(socket.readable);
  const writer = socket.writable.getWriter();
  let tagNum = 0;

  async function cmd(command: string): Promise<{ lines: string[]; ok: boolean }> {
    tagNum++;
    const tag = 'A' + String(tagNum).padStart(4, '0');
    await writer.write(enc.encode(tag + ' ' + command + '\r\n'));
    const lines: string[] = [];
    while (true) {
      // Read lines until tagged response. No literal handling — IMAP literals
      // are split into separate lines by readLine(), collected here as-is.
      // The FETCH response body spans multiple lines, reassembled later.
      const line = await lr.readLine();
      if (line.startsWith(tag + ' ')) {
        return { lines, ok: line.includes(tag + ' OK') };
      }
      lines.push(line);
    }
  }

  try {
    const greeting = await lr.readLine();
    if (!greeting.startsWith('* OK')) throw new Error('IMAP greeting failed: ' + greeting);

    const loginResult = await cmd('LOGIN "' + user.replace(/"/g, '\\"') + '" "' + pass.replace(/"/g, '\\"') + '"');
    if (!loginResult.ok) throw new Error('IMAP login failed');

    const selResult = await cmd('SELECT INBOX');
    if (!selResult.ok) throw new Error('SELECT INBOX failed');

    let searchCmd = 'UID SEARCH';
    if (lastUid > 0) searchCmd += ' UID ' + (lastUid + 1) + ':*';
    searchCmd += ' UNKEYWORD ' + processedFlag + ' UNSEEN';

    const searchResult = await cmd(searchCmd);
    const uidLine = searchResult.lines.find((l: string) => l.startsWith('* SEARCH'));
    const uids: number[] = [];
    if (uidLine) {
      for (const p of uidLine.replace('* SEARCH', '').trim().split(/\s+/)) {
        const n = parseInt(p);
        if (n > 0) uids.push(n);
      }
    }

    if (uids.length === 0) {
      await cmd('LOGOUT');
      return { emails: [], maxUid: lastUid, hasMore: false };
    }

    const toProcess = uids.slice(0, limit);
    const emails: ParsedEmail[] = [];

    for (const emailUid of toProcess) {
      try {
        const fetchResult = await cmd('UID FETCH ' + emailUid + ' (BODY.PEEK[] FLAGS)');
        const rawEmail = fetchResult.lines.join('\r\n');
        const bodyMatch = rawEmail.match(/BODY\[\]\s*\{(\d+)\}\r\n([\s\S]*)/);
        if (!bodyMatch) continue;

        const emailContent = bodyMatch[2].substring(0, parseInt(bodyMatch[1]));
        const parsed = parseEmail(emailContent);

        if (parsed.from.toLowerCase() === businessEmail.toLowerCase()) continue;

        emails.push({ uid: emailUid, ...parsed });

        await cmd('UID STORE ' + emailUid + ' +FLAGS (' + processedFlag + ')');
      } catch {
        // Skip individual email errors
      }
    }

    const maxUid = toProcess.length > 0 ? Math.max(...toProcess) : lastUid;
    await cmd('LOGOUT');

    return { emails, maxUid, hasMore: uids.length > limit };
  } finally {
    lr.releaseLock();
    try { writer.releaseLock(); } catch {}
    try { socket.close(); } catch {}
  }
}

// ── SMTP ──

export async function smtpSend(
  host: string, port: number, user: string, pass: string,
  from: string, fromName: string, to: string, subject: string, body: string, inReplyTo?: string,
): Promise<{ success: boolean; error?: string }> {
  validateTarget(host, port);

  const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
  const lr = new LineReader(socket.readable);
  const writer = socket.writable.getWriter();

  async function send(cmd: string): Promise<string> {
    await writer.write(enc.encode(cmd + '\r\n'));
    return await lr.readLine();
  }

  try {
    const greeting = await lr.readLine();
    if (!greeting.startsWith('220')) throw new Error('SMTP greeting failed: ' + greeting);

    let ehloResp = await send('EHLO ultralight.dev');
    while (!ehloResp.startsWith('250 ')) { ehloResp = await lr.readLine(); }

    const authResp = await send('AUTH LOGIN');
    if (!authResp.startsWith('334')) throw new Error('AUTH LOGIN failed');
    await send(btoa(user));
    const passResp = await send(btoa(pass));
    if (!passResp.startsWith('235')) throw new Error('SMTP auth failed');

    await send('MAIL FROM:<' + from + '>');
    await send('RCPT TO:<' + to + '>');

    const dataResp = await send('DATA');
    if (!dataResp.startsWith('354')) throw new Error('SMTP DATA rejected');

    const msgId = '<' + crypto.randomUUID() + '@ultralight.dev>';
    let headers = 'From: ' + fromName + ' <' + from + '>\r\n';
    headers += 'To: ' + to + '\r\n';
    headers += 'Subject: ' + subject + '\r\n';
    headers += 'Message-ID: ' + msgId + '\r\n';
    if (inReplyTo) headers += 'In-Reply-To: <' + inReplyTo + '>\r\n';
    headers += 'Content-Type: text/plain; charset=UTF-8\r\n';
    headers += 'Date: ' + new Date().toUTCString() + '\r\n';

    await writer.write(enc.encode(headers + '\r\n' + body + '\r\n.\r\n'));
    const sendResp = await lr.readLine();
    if (!sendResp.startsWith('250')) throw new Error('SMTP send failed: ' + sendResp);

    await send('QUIT');
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    lr.releaseLock();
    try { writer.releaseLock(); } catch {}
    try { socket.close(); } catch {}
  }
}
