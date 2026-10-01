import { readInteractiveInput } from './interactive-input.ts';

export function parseStandardToken(input: string): string {
  const token = input.trim();
  if (!/^(?:xoxe\.)?xox[bp]-[^\s]+$/.test(token)) throw new Error('Expected one standard Slack token on stdin');
  return token;
}

export function parseBrowserTokens(input: string): { xoxd: string; xoxc: string } {
  let data: unknown;
  try { data = JSON.parse(input); } catch { throw new Error('Expected a JSON object with xoxd and xoxc on stdin'); }
  if (!data || typeof data !== 'object') throw new Error('Expected browser credentials on stdin');
  const { xoxd, xoxc } = data as Record<string, unknown>;
  if (typeof xoxd !== 'string' || typeof xoxc !== 'string' || !/^xoxd-\S+$/.test(xoxd) || !/^xoxc-\S+$/.test(xoxc)) {
    throw new Error('Expected valid xoxd and xoxc fields on stdin');
  }
  return { xoxd, xoxc };
}

export async function readCredentialStdin(): Promise<string> {
  return readInteractiveInput({ secret: true });
}
