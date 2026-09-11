'use client';

import { useDugout } from '@/app/providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  Notice,
  PlayerChip,
} from '@/components/ui';
import {
  MAX_ASSISTANT_COACHES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  assistantCount,
  canInviteAssistant,
  type TeamMembership,
} from '@/domain/access';
import { createId } from '@/domain/factories';
import Link from 'next/link';
import { useState } from 'react';

/**
 * Coaches (spec section 73, scoped to what a head coach actually needs).
 *
 * A head coach may add two assistant coaches. Assistants can set where players
 * can and cannot play and mark core players; everything else is read-only for
 * them.
 *
 * Invitations are recorded locally for now. Until accounts exist there is
 * nothing to send an invitation to, so this page is honest about that rather
 * than pretending an email went out.
 */
export default function CoachesPage() {
  const { ready, team, memberships, role, can, saveMembership, removeMembership, setPreviewRole } =
    useDugout();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!ready) return null;

  if (!team) {
    return (
      <EmptyState
        title="No team yet"
        action={
          <Link href="/setup">
            <Button variant="primary">Create your team</Button>
          </Link>
        }
      />
    );
  }

  const assistants = memberships.filter((member) => member.role === 'ASSISTANT');
  const remaining = MAX_ASSISTANT_COACHES - assistantCount(memberships);
  const manages = can('members:manage');

  const invite = async () => {
    const verdict = canInviteAssistant(role, memberships, email);
    if (!verdict.ok) {
      setError(verdict.message);
      return;
    }

    const membership: TeamMembership = {
      id: createId('mem'),
      teamId: team.id,
      userId: null,
      email: email.trim().toLowerCase(),
      name: name.trim() || email.trim().split('@')[0],
      role: 'ASSISTANT',
      status: 'INVITED',
      createdAt: new Date().toISOString(),
    };

    await saveMembership(membership);
    setEmail('');
    setName('');
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-4xl text-ink sm:text-5xl">Coaches</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You can add {MAX_ASSISTANT_COACHES} assistant coaches.{' '}
          {remaining > 0
            ? `${remaining} ${remaining === 1 ? 'spot' : 'spots'} left.`
            : 'Both spots are filled.'}
        </p>
      </div>

      <Notice tone="caution" title="Accounts are not switched on yet">
        Assistants are recorded here and the app already enforces what each role
        can change, but nobody can sign in until accounts are connected. Until
        then these are notes to yourself, not invitations that were sent.
      </Notice>

      <Card>
        <CardHeader title="This team" />
        <ul className="divide-y divide-border">
          <li className="flex flex-wrap items-center gap-3 px-5 py-3">
            <PlayerChip name="You" className="w-40 shrink-0" />
            <span className="min-w-0 flex-1 text-sm text-ink-muted">
              {ROLE_DESCRIPTION.HEAD_COACH}
            </span>
            <Badge tone="brand">{ROLE_LABEL.HEAD_COACH}</Badge>
          </li>

          {assistants.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <PlayerChip name={member.name} className="w-40 shrink-0" />
              <span className="min-w-0 flex-1 text-sm text-ink-muted">{member.email}</span>
              <Badge tone={member.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {member.status === 'ACTIVE' ? 'Active' : 'Invited'}
              </Badge>
              {manages ? (
                <Button size="sm" variant="ghost" onClick={() => removeMembership(member.id)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {assistants.length === 0 ? (
          <p className="border-t border-border px-5 py-4 text-sm text-ink-subtle">
            No assistant coaches yet.
          </p>
        ) : null}
      </Card>

      {manages ? (
        <Card>
          <CardHeader
            title="Add an assistant coach"
            description={ROLE_DESCRIPTION.ASSISTANT}
          />
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="coach-name">Name</Label>
                <Input
                  id="coach-name"
                  className="mt-1.5"
                  placeholder="Jamie Rivera"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="coach-email">Email</Label>
                <Input
                  id="coach-email"
                  className="mt-1.5"
                  type="email"
                  placeholder="jamie@example.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>

            {error ? <Notice tone="critical">{error}</Notice> : null}

            <Button
              variant="primary"
              disabled={remaining <= 0 || email.trim().length === 0}
              onClick={invite}
            >
              {remaining <= 0 ? 'Both spots filled' : 'Add assistant coach'}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Preview the assistant view"
          description="See exactly what an assistant coach can and cannot change. This is a preview, not a login."
        />
        <div className="flex flex-wrap items-center gap-3 px-5 py-5">
          <Button
            variant={role === 'HEAD_COACH' ? 'primary' : 'secondary'}
            onClick={() => setPreviewRole('HEAD_COACH')}
          >
            Head coach
          </Button>
          <Button
            variant={role === 'ASSISTANT' ? 'primary' : 'secondary'}
            onClick={() => setPreviewRole('ASSISTANT')}
          >
            Assistant coach
          </Button>
          <span className="text-sm text-ink-muted">
            Currently viewing as <strong className="text-ink">{ROLE_LABEL[role]}</strong>
          </span>
        </div>
      </Card>
    </div>
  );
}
