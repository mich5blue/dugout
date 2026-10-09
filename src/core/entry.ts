import { InningGridCore } from './api';

/*
  The bundle's only side effect: publish the API where the Swift bridge looks
  for it. Kept out of api.ts so tests can import the functions without
  touching globals.
*/
(globalThis as unknown as { InningGridCore: typeof InningGridCore }).InningGridCore =
  InningGridCore;
