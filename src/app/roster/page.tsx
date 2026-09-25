import { redirect } from 'next/navigation';

/**
 * The roster list moved to /team when navigation collapsed to five
 * destinations. Kept as a redirect rather than deleted: this path is in
 * bookmarks, in the guide, and in links coaches have sent each other.
 */
export default function RosterRedirect() {
  redirect('/team');
}
