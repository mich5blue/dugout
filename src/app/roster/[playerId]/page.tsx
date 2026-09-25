import { redirect } from 'next/navigation';

/** Moved to /team/[playerId]. See the note in ../page.tsx. */
export default async function PlayerRedirect({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  redirect(`/team/${playerId}`);
}
