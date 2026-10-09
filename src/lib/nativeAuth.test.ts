import { describe, expect, it } from 'vitest';
import { callbackWith, safeCallback, safeState } from '@/lib/nativeAuth';

/**
 * The bridge hands a Google ID token to whatever `redirect` names, so the one
 * property that must hold is that it can only ever name the app.
 */
describe('the native sign-in bridge', () => {
  it('refuses to hand a credential to a website', () => {
    expect(safeCallback('https://evil.example/steal')).toBeNull();
    expect(safeCallback('http://localhost/anything')).toBeNull();
    expect(safeCallback('javascript:alert(1)')).toBeNull();
    expect(safeCallback('not a url')).toBeNull();
  });

  it('accepts the app scheme, and defaults to it', () => {
    expect(safeCallback('inninggrid://auth')?.toString()).toBe('inninggrid://auth');
    expect(safeCallback(null)?.toString()).toBe('inninggrid://auth');
  });

  it('only accepts a state token shaped like one the app generates', () => {
    expect(safeState('0123456789abcdef-ABCDEF')).toBe('0123456789abcdef-ABCDEF');
    expect(safeState('short')).toBeNull();
    expect(safeState('has spaces in it and is long enough')).toBeNull();
    expect(safeState('<script>alert(1)</script>-padding-padding')).toBeNull();
    expect(safeState(null)).toBeNull();
  });

  it('builds the callback without mangling the token', () => {
    const url = callbackWith(new URL('inninggrid://auth'), { state: 'abc', idToken: 'a.b+c/d=' });
    expect(new URL(url).searchParams.get('idToken')).toBe('a.b+c/d=');
  });
});
