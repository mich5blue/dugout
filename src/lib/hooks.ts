'use client';

import { useDugout } from '@/app/providers';
import { getSystemFormation } from '@/domain/formations';
import type { Formation } from '@/domain/types';
import { useMemo } from 'react';

/** The team's default formation, whether it is a system preset or custom. */
export function useTeamFormation(): Formation | null {
  const { team, db } = useDugout();
  return useMemo(() => {
    if (!team) return null;
    return (
      db.formations.find((formation) => formation.id === team.defaultFormationId) ??
      getSystemFormation(team.defaultFormationId) ??
      null
    );
  }, [db.formations, team]);
}

/** Resolves a formation id against custom formations then system presets. */
export function useFormationById(formationId: string | null): Formation | null {
  const { db } = useDugout();
  return useMemo(() => {
    if (!formationId) return null;
    return (
      db.formations.find((formation) => formation.id === formationId) ??
      getSystemFormation(formationId) ??
      null
    );
  }, [db.formations, formationId]);
}
