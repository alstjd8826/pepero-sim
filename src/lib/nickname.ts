import { BANNED_WORDS } from './bannedWords';

export const NICKNAME_MAX = 20;

export type NicknameResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'banned' };

export function validateNickname(s: string): NicknameResult {
  const value = s.trim();
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if ([...value].length > NICKNAME_MAX) return { ok: false, reason: 'too-long' };
  const norm = value.toLowerCase().replace(/\s+/g, '');
  if (BANNED_WORDS.some((w) => norm.includes(w))) return { ok: false, reason: 'banned' };
  return { ok: true, value };
}
