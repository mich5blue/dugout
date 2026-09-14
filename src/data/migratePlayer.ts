import { toLastInitial } from '@/domain/factories';
import type { Player } from '@/domain/types';

/**
 * Brings a stored player forward to the current shape.
 *
 * InningGrid used to store a full surname. It no longer does — see the note on
 * `Player.lastInitial` — so a player saved before that change carries a
 * `lastName` this app has no field for.
 *
 * Reducing it here, at the single point every read passes through, means no
 * surface can render one and nothing downstream has to remember to truncate.
 * The surname is dropped rather than kept alongside the initial: a privacy
 * change that leaves the data in place is not one.
 *
 * The stored document still holds the old field until that player is next
 * saved, which `migrateStoredPlayers` in the provider handles on load.
 */
type LegacyPlayer = Player & { lastName?: string };

export function migratePlayer(raw: Player): Player {
  const legacy = raw as LegacyPlayer;
  if (legacy.lastName === undefined) return raw;

  const { lastName, ...rest } = legacy;
  return {
    ...rest,
    lastInitial: rest.lastInitial ?? toLastInitial(lastName),
  };
}

/** True when this player still carries the legacy surname at rest. */
export function needsMigration(raw: Player): boolean {
  return (raw as LegacyPlayer).lastName !== undefined;
}
