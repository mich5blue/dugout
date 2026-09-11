// The Anthropic SDK's zodOutputFormat helper targets the Zod v4 API, which
// zod 3.25 ships under this subpath.
import { z } from 'zod/v4';

/**
 * Roster import from a photo or screenshot.
 *
 * The extraction contract and all normalization live here, separate from the
 * API call, so the parsing rules are testable without spending a request.
 *
 * The model is asked for what is legible and nothing more. It never invents a
 * player, never guesses a jersey number, and never infers whether someone can
 * pitch or catch from a position abbreviation — a coach's eligibility settings
 * are theirs to make, and a wrong guess there silently breaks lineups.
 */

export const IMPORTED_PLAYER_SCHEMA = z.object({
  firstName: z.string(),
  lastName: z.string(),
  jerseyNumber: z.string(),
  /** Model's own confidence that this row was read correctly. */
  confident: z.boolean(),
});

export const ROSTER_EXTRACTION_SCHEMA = z.object({
  /** What the image appears to be, in a few words. */
  source: z.string(),
  players: z.array(IMPORTED_PLAYER_SCHEMA),
  /** Anything the coach should check, written for a coach not a developer. */
  warning: z.string(),
});

export type RosterExtraction = z.infer<typeof ROSTER_EXTRACTION_SCHEMA>;
export type ImportedPlayer = z.infer<typeof IMPORTED_PLAYER_SCHEMA>;

export const EXTRACTION_PROMPT = `You are reading a youth baseball or softball roster so a coach does not have to type it in.

The image may be a screenshot from a scorekeeping app such as GameChanger, a typed team list, a printed roster, or a handwritten lineup card or scrap of paper.

Extract every player you can read. For each one:
- firstName and lastName as written. If only one name is given, put it in firstName and leave lastName empty.
- jerseyNumber only if a number is clearly shown next to that player. Otherwise leave it empty. Never guess a number.
- confident: false if the handwriting is unclear, the row is cut off, or you are unsure you read the name correctly. Otherwise true.

Rules:
- Never invent a player who is not visible in the image.
- Do not infer positions, pitching or catching ability, or skill from anything in the image. The coach sets those.
- Ignore coaches, staff, opponents, scores, innings and column headers. Players only.
- Keep the order they appear in the image.
- If the image is not a roster at all, return an empty players array and say so in warning.

Set source to a short description of what the image is, such as "GameChanger lineup screenshot" or "handwritten lineup card".
Set warning to a short note for the coach if anything needs checking, such as unclear handwriting or a cut-off row. Use an empty string if everything read cleanly.`;

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Anthropic's per-image ceiling is larger, but a phone photo over this is worth resizing. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isAcceptedImageType(value: string): value is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Approximate decoded size of a base64 payload, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Splits a `data:` URL into its media type and payload. */
export function parseDataUrl(
  dataUrl: string,
): { mediaType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

const NAME_CHARACTERS = /[^\p{L}\p{M}'’\-. ]/gu;

/** Title-cases a name while preserving the separators youth rosters actually use. */
export function normalizeName(raw: string): string {
  const cleaned = raw.replace(NAME_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((word) =>
      word
        .split(/([-'’])/)
        .map((part) =>
          /^[-'’]$/.test(part)
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join(''),
    )
    .join(' ');
}

/** Keeps only a plausible jersey number, or nothing. */
export function normalizeJersey(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  // Youth jerseys are one or two digits, occasionally three.
  if (digits.length > 3) return undefined;
  return String(Number(digits));
}

export interface NormalizedImport {
  source: string;
  warning: string;
  players: Array<{
    firstName: string;
    lastName: string;
    jerseyNumber?: string;
    confident: boolean;
  }>;
  /** Names that appeared more than once and were collapsed. */
  duplicatesRemoved: string[];
}

/**
 * Cleans up an extraction: trims and title-cases names, discards implausible
 * jersey numbers, drops rows with no readable name, and collapses duplicates.
 */
export function normalizeExtraction(extraction: RosterExtraction): NormalizedImport {
  const players: NormalizedImport['players'] = [];
  const seen = new Set<string>();
  const duplicatesRemoved: string[] = [];

  for (const raw of extraction.players) {
    const firstName = normalizeName(raw.firstName ?? '');
    const lastName = normalizeName(raw.lastName ?? '');
    if (!firstName && !lastName) continue;

    // A single-name row should read as a first name.
    const resolvedFirst = firstName || lastName;
    const resolvedLast = firstName ? lastName : '';

    const key = `${resolvedFirst}|${resolvedLast}`.toLowerCase();
    if (seen.has(key)) {
      duplicatesRemoved.push(`${resolvedFirst} ${resolvedLast}`.trim());
      continue;
    }
    seen.add(key);

    players.push({
      firstName: resolvedFirst,
      lastName: resolvedLast,
      jerseyNumber: normalizeJersey(raw.jerseyNumber ?? ''),
      confident: raw.confident !== false,
    });
  }

  return {
    source: extraction.source?.trim() || 'roster image',
    warning: extraction.warning?.trim() ?? '',
    players,
    duplicatesRemoved,
  };
}

/** Renders an import back into the Quick Add text format, one player per line. */
export function toQuickAddText(players: NormalizedImport['players']): string {
  return players
    .map((player) =>
      [player.firstName, player.lastName].filter(Boolean).join(' ') +
      (player.jerseyNumber ? ` #${player.jerseyNumber}` : ''),
    )
    .join('\n');
}

export interface RosterImportResponse {
  ok: boolean;
  result?: NormalizedImport;
  /** Coach-facing explanation when ok is false. */
  error?: string;
  /** True when the server has no API key configured. */
  unavailable?: boolean;
}
