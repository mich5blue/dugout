'use client';

import { installNativeBehaviours } from '@/lib/native';
import { useEffect } from 'react';

/**
 * Mounts the native-app behaviours once, at the root. Renders nothing, and in a
 * browser does nothing at all — see lib/native.ts.
 */
export function NativeBridge() {
  useEffect(() => installNativeBehaviours(), []);
  return null;
}
