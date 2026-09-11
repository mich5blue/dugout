'use client';

import { useDugout } from '@/app/providers';
import { Button, Notice, Spinner } from '@/components/ui';
import { getStore } from '@/data/localStore';
import { useEffect, useState } from 'react';

/**
 * Moves a team that was created before sign-in into the account.
 *
 * Dugout stored everything in the browser before it had a backend, and a coach
 * who already has a roster and a season of games there should not have to type
 * it again. The move is explicit rather than automatic: it writes to their
 * account, and silently uploading someone's data is not a decision to make on
 * their behalf.
 */
export function MoveLocalData() {
  const { backend, account, teams, store } = useDugout();
  const [local, setLocal] = useState<{ teams: number; players: number } | null>(null);
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');

  useEffect(() => {
    if (backend !== 'firebase' || !account) return;
    const snapshot = getStore().snapshot();
    if (snapshot.teams.length === 0) return;
    setLocal({ teams: snapshot.teams.length, players: snapshot.players.length });
  }, [account, backend]);

  // Nothing to move, or the account already has teams of its own — in which
  // case merging two sources without being asked would be the wrong call.
  if (!local || teams.length > 0 || state === 'done') return null;

  const move = async () => {
    setState('working');
    const snapshot = getStore().snapshot();
    store.replaceAll(snapshot);
    setState('done');
  };

  return (
    <Notice
      tone="brand"
      title="You have a team saved in this browser"
      action={
        <Button size="sm" variant="primary" disabled={state === 'working'} onClick={move}>
          {state === 'working' ? (
            <>
              <Spinner /> Moving…
            </>
          ) : (
            'Move it to my account'
          )}
        </Button>
      }
    >
      {local.teams === 1 ? 'One team' : `${local.teams} teams`} and {local.players}{' '}
      {local.players === 1 ? 'player' : 'players'} are stored on this device only. Move
      them to your account and you can reach them from any phone — and share them with
      an assistant coach.
    </Notice>
  );
}
