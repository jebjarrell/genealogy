// Content hashing for vault deduplication (handoff §2). SHA-256 over the file
// bytes via the Web Crypto API (available in browsers and in the jsdom/Node test
// environment). The hex digest is the document's content address: two uploads of
// the same bytes share one stored file.

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
