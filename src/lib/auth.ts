import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

/**
 * Sign-in.
 *
 * Two ways in, for two different people. The head coach signs in with Google
 * in one tap. An assistant coach is invited at whatever address the head coach
 * has for them, which may not be a Google account at all — so an email link
 * has to work too, or half the invitations would be undeliverable in practice.
 *
 * No passwords either way: this app holds children's names, and a password
 * store is a liability it does not need to carry.
 */

export interface Account {
  uid: string;
  email: string;
  name: string;
}

export function toAccount(user: User): Account {
  return {
    uid: user.uid,
    email: user.email ?? '',
    // Prefer the name the provider gave, but never derive one from the address:
    // a local-part is not a person's name and guessing it wrong is worse than
    // showing nothing.
    name: user.displayName ?? '',
  };
}

export function watchAccount(listener: (account: Account | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    listener(null);
    return () => {};
  }
  return onAuthStateChanged(firebaseAuth(), (user) => {
    listener(user ? toAccount(user) : null);
  });
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(firebaseAuth(), provider);
  } catch (error) {
    /*
      Popups are blocked outright inside the in-app browsers that team group
      chats open links in, which is exactly where a coach will tap this. Falling
      back to a redirect keeps that path working.
    */
    const code = (error as { code?: string }).code ?? '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(firebaseAuth(), provider);
      return;
    }
    throw error;
  }
}

/** Where the email link comes back to, and the address it was sent to. */
const PENDING_EMAIL_KEY = 'dugout.pendingEmail';

export async function sendEmailLink(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  await sendSignInLinkToEmail(firebaseAuth(), address, {
    url: `${window.location.origin}/`,
    handleCodeInApp: true,
  });
  // The link may be opened in a different browser than the one that asked for
  // it, in which case this is missing and we have to ask for the address again.
  window.localStorage.setItem(PENDING_EMAIL_KEY, address);
}

export function hasPendingEmailLink(): boolean {
  return isFirebaseConfigured() && isSignInWithEmailLink(firebaseAuth(), window.location.href);
}

export function pendingEmail(): string {
  return window.localStorage.getItem(PENDING_EMAIL_KEY) ?? '';
}

/**
 * Finishes an email-link sign-in. Returns false when the address is unknown,
 * so the caller can ask for it rather than failing silently.
 */
export async function completeEmailLink(email = pendingEmail()): Promise<boolean> {
  if (!email) return false;
  await signInWithEmailLink(firebaseAuth(), email, window.location.href);
  window.localStorage.removeItem(PENDING_EMAIL_KEY);
  // Strip the one-time credential out of the address bar so it is not shared,
  // bookmarked or left in history.
  window.history.replaceState({}, '', window.location.pathname);
  return true;
}

export async function signOutNow(): Promise<void> {
  await signOut(firebaseAuth());
}
