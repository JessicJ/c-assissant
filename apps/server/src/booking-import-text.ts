export function normalizeImportedBookingText(value: string): string {
  return cleanImportedBookingText(extractReadableBookingText(value));
}

function cleanImportedBookingText(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|br|li|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReadableBookingText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parsed = parseMimeBlock(normalized);
  if (!parsed.headers.size) return normalized;
  const contentType = headerValue(parsed.headers, "content-type");
  const boundary = mimeBoundary(contentType);
  if (boundary) {
    const readable = splitMimeParts(parsed.body, boundary)
      .map(parseMimeBlock)
      .filter((part) => !/attachment/i.test(headerValue(part.headers, "content-disposition")))
      .map((part) => ({ part, text: extractReadableMimePart(part) }))
      .filter((item) => item.text.trim())
      .sort((left, right) => mimePartScore(right.part) - mimePartScore(left.part));
    return readable.map((item) => item.text).join("\n\n") || parsed.body;
  }
  return decodeMimeBody(parsed.body, parsed.headers);
}

function extractReadableMimePart(part: { headers: Map<string, string>; body: string }): string {
  const contentType = headerValue(part.headers, "content-type");
  const boundary = mimeBoundary(contentType);
  if (boundary) return extractReadableBookingText([`Content-Type: ${contentType}`, "", part.body].join("\n"));
  if (!/text\/(?:plain|html)/i.test(contentType || "text/plain")) return "";
  return decodeMimeBody(part.body, part.headers);
}

function mimePartScore(part: { headers: Map<string, string> }): number {
  const contentType = headerValue(part.headers, "content-type");
  if (/text\/plain/i.test(contentType)) return 3;
  if (/text\/html/i.test(contentType)) return 2;
  return 1;
}

function parseMimeBlock(value: string): { headers: Map<string, string>; body: string } {
  const separator = value.indexOf("\n\n");
  if (separator < 0) return { headers: new Map(), body: value };
  const rawHeaders = value.slice(0, separator);
  if (!/^[\w-]+:/m.test(rawHeaders)) return { headers: new Map(), body: value };
  return { headers: parseMimeHeaders(rawHeaders), body: value.slice(separator + 2) };
}

function parseMimeHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";
  for (const line of value.split("\n")) {
    if (/^\s/.test(line) && current) {
      const previous = headers.get(current) ?? "";
      headers.set(current, `${previous} ${line.trim()}`.trim());
      continue;
    }
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    current = match[1]!.toLocaleLowerCase();
    headers.set(current, decodeMimeHeader(match[2] ?? ""));
  }
  return headers;
}

function headerValue(headers: Map<string, string>, name: string): string {
  return headers.get(name.toLocaleLowerCase()) ?? "";
}

function mimeBoundary(contentType: string): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2];
}

function splitMimeParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body.split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== "--" && !part.startsWith("--"));
}

function decodeMimeBody(body: string, headers: Map<string, string>): string {
  const encoding = headerValue(headers, "content-transfer-encoding").toLocaleLowerCase();
  if (encoding === "base64") {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  const input = value.replace(/=\n/g, "");
  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index + 1, index + 3);
    if (input[index] === "=" && /^[0-9a-f]{2}$/i.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(input[index]!, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeMimeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_match, _charset: string, encoding: string, text: string) => {
    if (encoding.toLocaleLowerCase() === "b") {
      try { return Buffer.from(text, "base64").toString("utf8"); } catch { return text; }
    }
    return decodeQuotedPrintable(text.replace(/_/g, " "));
  });
}
