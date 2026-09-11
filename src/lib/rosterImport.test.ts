import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  isAcceptedImageType,
  normalizeExtraction,
  normalizeJersey,
  normalizeName,
  parseDataUrl,
  toQuickAddText,
  type RosterExtraction,
} from './rosterImport';

/**
 * The extraction contract is testable without spending an API request, which
 * matters because these rules are what stand between a misread photo and a
 * corrupted roster.
 */

function extraction(players: RosterExtraction['players']): RosterExtraction {
  return { source: 'handwritten lineup card', players, warning: '' };
}

describe('normalizeName', () => {
  it('title-cases names read in any case', () => {
    expect(normalizeName('BRODY')).toBe('Brody');
    expect(normalizeName('brody')).toBe('Brody');
    expect(normalizeName('  bRoDy  ')).toBe('Brody');
  });

  it('keeps the separators youth rosters actually contain', () => {
    expect(normalizeName("o'brien")).toBe("O'Brien");
    expect(normalizeName('smith-jones')).toBe('Smith-Jones');
    expect(normalizeName('mary jo')).toBe('Mary Jo');
    expect(normalizeName('D.J.')).toBe('D.j.');
  });

  it('strips characters OCR invents without mangling the name', () => {
    expect(normalizeName('Brody |')).toBe('Brody');
    expect(normalizeName('Race*')).toBe('Race');
    expect(normalizeName('Wes7on')).toBe('Wes On');
  });

  it('returns empty for an unreadable row', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('###')).toBe('');
  });
});

describe('normalizeJersey', () => {
  it('keeps plausible numbers and drops the leading zero', () => {
    expect(normalizeJersey('8')).toBe('8');
    expect(normalizeJersey('08')).toBe('8');
    expect(normalizeJersey('#12')).toBe('12');
    expect(normalizeJersey('99')).toBe('99');
  });

  it('rejects anything that is not a jersey number', () => {
    expect(normalizeJersey('')).toBeUndefined();
    expect(normalizeJersey('none')).toBeUndefined();
    // A four-digit read is a misread, not a jersey.
    expect(normalizeJersey('2026')).toBeUndefined();
  });
});

describe('parseDataUrl', () => {
  it('splits a data URL into media type and payload', () => {
    expect(parseDataUrl('data:image/png;base64,AAAA')).toEqual({
      mediaType: 'image/png',
      base64: 'AAAA',
    });
  });

  it('rejects anything that is not a base64 data URL', () => {
    expect(parseDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseDataUrl('data:image/png,AAAA')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
  });
});

describe('base64ByteLength', () => {
  it('measures the decoded size without decoding', () => {
    const payload = Buffer.from('hello world, this is a roster').toString('base64');
    expect(base64ByteLength(payload)).toBe(29);
  });
});

describe('isAcceptedImageType', () => {
  it('accepts the formats a phone or screenshot produces', () => {
    expect(isAcceptedImageType('image/png')).toBe(true);
    expect(isAcceptedImageType('image/jpeg')).toBe(true);
    expect(isAcceptedImageType('image/heic')).toBe(false);
    expect(isAcceptedImageType('application/pdf')).toBe(false);
  });
});

describe('normalizeExtraction', () => {
  it('cleans up a typical handwritten read', () => {
    const result = normalizeExtraction(
      extraction([
        { firstName: 'brody', lastName: 'BOREK', jerseyNumber: '#8', confident: true },
        { firstName: 'race', lastName: 'smith', jerseyNumber: '12', confident: false },
      ]),
    );

    expect(result.players).toEqual([
      { firstName: 'Brody', lastName: 'Borek', jerseyNumber: '8', confident: true },
      { firstName: 'Race', lastName: 'Smith', jerseyNumber: '12', confident: false },
    ]);
  });

  it('treats a single name as a first name', () => {
    const result = normalizeExtraction(
      extraction([{ firstName: '', lastName: 'Solomon', jerseyNumber: '', confident: true }]),
    );
    expect(result.players[0]).toMatchObject({ firstName: 'Solomon', lastName: '' });
  });

  it('drops rows with no readable name', () => {
    const result = normalizeExtraction(
      extraction([
        { firstName: '', lastName: '', jerseyNumber: '7', confident: true },
        { firstName: 'Walter', lastName: '', jerseyNumber: '', confident: true },
      ]),
    );
    expect(result.players).toHaveLength(1);
    expect(result.players[0].firstName).toBe('Walter');
  });

  it('collapses a player read twice and says who', () => {
    const result = normalizeExtraction(
      extraction([
        { firstName: 'Brody', lastName: 'Borek', jerseyNumber: '8', confident: true },
        { firstName: 'brody', lastName: 'borek', jerseyNumber: '8', confident: true },
      ]),
    );
    expect(result.players).toHaveLength(1);
    expect(result.duplicatesRemoved).toEqual(['Brody Borek']);
  });

  it('never fabricates a jersey number', () => {
    const result = normalizeExtraction(
      extraction([
        { firstName: 'Mehki', lastName: 'Barnes', jerseyNumber: 'unknown', confident: true },
      ]),
    );
    expect(result.players[0].jerseyNumber).toBeUndefined();
  });

  it('defaults a missing confidence flag to confident', () => {
    const result = normalizeExtraction(
      extraction([
        // A model response that omitted the field entirely.
        { firstName: 'Vasil', lastName: 'Petrov', jerseyNumber: '9' } as never,
      ]),
    );
    expect(result.players[0].confident).toBe(true);
  });

  it('handles an image that was not a roster', () => {
    const result = normalizeExtraction({
      source: 'photo of a scoreboard',
      players: [],
      warning: 'This looks like a scoreboard rather than a roster.',
    });
    expect(result.players).toHaveLength(0);
    expect(result.warning).toContain('scoreboard');
  });
});

describe('toQuickAddText', () => {
  it('round-trips into the paste format', () => {
    expect(
      toQuickAddText([
        { firstName: 'Brody', lastName: 'Borek', jerseyNumber: '8', confident: true },
        { firstName: 'Solomon', lastName: '', confident: true },
      ]),
    ).toBe('Brody Borek #8\nSolomon');
  });
});
