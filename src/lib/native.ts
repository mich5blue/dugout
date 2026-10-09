import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * The thin layer that makes the web app behave like the native one.
 *
 * Every function here is a no-op in a browser. The iOS and Android apps load
 * this same web app from the server (see capacitor.config.ts), and Capacitor's
 * bridge is injected into it there — so one code path serves the website, the
 * installed home-screen app and the store apps, and a feature never has to be
 * built twice.
 */

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}

/**
 * A tap you can feel, for the actions a coach makes without looking.
 *
 * Game Day is used with the phone held low and the eyes on the field, so
 * "did that register?" is answered by the hand. Light for the common taps,
 * medium for the ones that change the lineup.
 */
export async function tap(weight: 'light' | 'medium' = 'light'): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await Haptics.impact({ style: weight === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    /* No haptic engine (older iPads, most tablets). Nothing to do. */
  }
}

/** Status bar text that stays readable on whatever is behind it. */
export async function setStatusBar(ground: 'dark' | 'light'): Promise<void> {
  if (!isNativeApp()) return;
  try {
    /* Capacitor names styles by the bar's *background*: DARK means light
       text, which is what a dark ground needs. */
    await StatusBar.setStyle({ style: ground === 'dark' ? Style.Dark : Style.Light });
  } catch {
    /* Unsupported on this platform version; the default is legible enough. */
  }
}

/**
 * Wire the platform behaviours that have no web equivalent. Returns a cleanup.
 *
 * Android's hardware back button exits the app by default, from any screen —
 * so a coach backing out of a lineup would land on the home screen instead of
 * the schedule. It walks history instead, and only leaves from the root.
 */
export function installNativeBehaviours(): () => void {
  if (!isNativeApp()) return () => {};

  document.documentElement.dataset.native = nativePlatform();

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const syncBar = () => void setStatusBar(prefersLight.matches ? 'light' : 'dark');
  syncBar();
  prefersLight.addEventListener('change', syncBar);

  const backHandle = App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  });

  return () => {
    prefersLight.removeEventListener('change', syncBar);
    void backHandle.then((handle) => handle.remove());
  };
}
