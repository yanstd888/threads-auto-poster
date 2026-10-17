export function isSafeSourceUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !host.endsWith('.local')
      && host !== 'localhost'
      && !/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}
