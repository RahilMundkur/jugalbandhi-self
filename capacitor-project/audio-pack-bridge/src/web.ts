import { WebPlugin } from '@capacitor/core';
import type {
  AudioPackPlugin,
  GetFileUriResult,
  GetStatusResult,
  PackLang
} from './definitions';

/**
 * Web fallback. In a browser there's no Play Asset Delivery and no ODR —
 * the audio either lives at audio/{lang}/... on the same origin, or it
 * doesn't. We probe for it and report 'available' / 'missing' so the JS
 * code can do the right thing.
 */
export class AudioPackWeb extends WebPlugin implements AudioPackPlugin {
  async getStatus(opts: { lang: PackLang }): Promise<GetStatusResult> {
    const probeUrl = `audio/${opts.lang}/${opts.lang}_ch01_p000_male.mp3`;
    try {
      let res = await fetch(probeUrl, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(probeUrl, {
          method: 'GET', cache: 'no-store',
          headers: { Range: 'bytes=0-0' }
        });
      }
      return { status: res && res.ok ? 'available' : 'missing' };
    } catch {
      return { status: 'missing' };
    }
  }

  async getFileUri(opts: {
    lang: PackLang;
    chapter: string;
    paragraph: string;
    speaker: 'male' | 'female';
  }): Promise<GetFileUriResult> {
    const fname = `${opts.lang}_ch${opts.chapter}_p${opts.paragraph}_${opts.speaker}.mp3`;
    return { url: `audio/${opts.lang}/${fname}` };
  }

  async requestPack(_opts: { lang: PackLang }): Promise<void> {
    // No-op in the browser. The fetch path drives downloading.
  }
}
