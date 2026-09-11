import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { NextResponse } from 'next/server';
import {
  EXTRACTION_PROMPT,
  MAX_IMAGE_BYTES,
  ROSTER_EXTRACTION_SCHEMA,
  base64ByteLength,
  isAcceptedImageType,
  normalizeExtraction,
  parseDataUrl,
  type RosterImportResponse,
} from '@/lib/rosterImport';

/**
 * Reads a roster out of a photo or screenshot.
 *
 * This is the only server-side endpoint in Dugout and the only point at which
 * anything leaves the device. The image is forwarded to the Claude API to be
 * read and is not written to disk, cached, or logged, and neither are the names
 * that come back — the response goes straight to the browser, where the coach
 * reviews and edits it before anything is saved. Given this handles pictures of
 * children's names, nothing here should ever start logging request bodies.
 */

export const runtime = 'nodejs';
/** Roster photos can be a few megabytes; the default body limit is smaller. */
export const maxDuration = 60;

const MODEL = 'claude-opus-5';

function fail(error: string, status: number, extra: Partial<RosterImportResponse> = {}) {
  return NextResponse.json<RosterImportResponse>({ ok: false, error, ...extra }, { status });
}

/**
 * Rejects requests that did not come from this site's own pages.
 *
 * On a public deployment this endpoint spends the owner's API credits, so a
 * drive-by POST should not be free. This is a speed bump, not authentication —
 * an `origin` header is trivially forged. Real protection is an account, a rate
 * limit, or Netlify's password protection on the site; see the README.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  // Same-origin fetches from a browser omit `origin` on some navigations but
  // always send it for POST, so a missing header here means a non-browser call.
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return fail('This endpoint only accepts requests from the Dugout app.', 403);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(
      'Photo import is not configured on this server. Set ANTHROPIC_API_KEY to enable it — you can still paste or type your roster.',
      503,
      { unavailable: true },
    );
  }

  let image: unknown;
  try {
    ({ image } = (await request.json()) as { image?: unknown });
  } catch {
    return fail('That request could not be read. Please try the upload again.', 400);
  }

  if (typeof image !== 'string' || image.length === 0) {
    return fail('No image was received. Please choose a photo or screenshot.', 400);
  }

  const parsed = parseDataUrl(image);
  if (!parsed) {
    return fail('That file does not look like an image. Try a PNG or JPEG.', 400);
  }
  if (!isAcceptedImageType(parsed.mediaType)) {
    return fail(
      `${parsed.mediaType} is not supported. Use a PNG, JPEG, WebP or GIF image.`,
      400,
    );
  }
  if (base64ByteLength(parsed.base64) > MAX_IMAGE_BYTES) {
    return fail(
      'That image is larger than 5 MB. A screenshot or a smaller photo will work.',
      413,
    );
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Reading cramped handwriting is exactly the case worth thinking about.
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: parsed.mediaType,
                data: parsed.base64,
              },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ROSTER_EXTRACTION_SCHEMA) },
    });

    if (response.stop_reason === 'refusal') {
      return fail(
        'That image could not be read. Try a clearer photo, or paste the names instead.',
        422,
      );
    }

    const extraction = response.parsed_output;
    if (!extraction) {
      return fail(
        'No roster could be read from that image. Try a clearer photo, or paste the names instead.',
        422,
      );
    }

    const result = normalizeExtraction(extraction);

    if (result.players.length === 0) {
      return fail(
        result.warning ||
          "No players could be read from that image. Make sure the names are in frame, or paste them instead.",
        422,
      );
    }

    return NextResponse.json<RosterImportResponse>({ ok: true, result });
  } catch (error) {
    // Deliberately no request body or extracted names in any log line.
    if (error instanceof Anthropic.AuthenticationError) {
      return fail('Photo import is misconfigured on this server: the API key was rejected.', 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return fail('Photo import is busy right now. Try again in a moment.', 429);
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`roster-import: Claude API error ${error.status}`);
      return fail('Reading that image failed. Try again, or paste the names instead.', 502);
    }
    console.error('roster-import: unexpected failure');
    return fail('Reading that image failed. Try again, or paste the names instead.', 500);
  }
}
