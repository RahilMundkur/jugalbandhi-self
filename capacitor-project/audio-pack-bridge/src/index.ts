import { registerPlugin } from '@capacitor/core';
import type { AudioPackPlugin } from './definitions';

const AudioPack = registerPlugin<AudioPackPlugin>('AudioPack', {
  // Web fallback (used when the app runs in a normal browser, not in a
  // native shell). The fallback reports 'available' so the existing
  // fetch('audio/{lang}/...') path takes over.
  web: () => import('./web').then(m => new m.AudioPackWeb())
});

export * from './definitions';
export { AudioPack };
