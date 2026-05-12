/**
 * Audio-pack bridge — uniform JS API across Android (Play Asset Delivery)
 * and iOS (On-Demand Resources). Returns a "browser" status when running
 * outside a Capacitor native shell so the existing fetch fallback runs.
 */
export type PackLang = 'fr' | 'hi' | 'th';
export type PackStatus =
  | 'available'        // pack is on device, files reachable
  | 'downloading'      // platform is fetching the pack now
  | 'missing'          // pack is not on device and not downloading
  | 'failed'           // last download attempt failed
  | 'unknown';         // platform hasn't reported yet

export interface GetStatusResult {
  status: PackStatus;
  /** 0–1 download progress when status === 'downloading' */
  progress?: number;
  /** Bytes downloaded so far (informational) */
  bytesDownloaded?: number;
  /** Total bytes the platform reports for this pack */
  bytesTotal?: number;
  /** Free-form message from the platform layer (errors etc.) */
  message?: string;
}

export interface GetFileUriResult {
  /** A URL the WebView can fetch — file://, capacitor://, or content:// */
  url: string;
  /** Approximate byte size if the platform reports it */
  byteSize?: number;
}

export interface AudioPackPlugin {
  /** Status of a language pack. Cheap; safe to call repeatedly. */
  getStatus(opts: { lang: PackLang }): Promise<GetStatusResult>;

  /**
   * Resolve an audio file URL inside a pack to something the WebView can
   * fetch. On Android: returns a file:// URL inside the pack's assetPath.
   * On iOS: returns the bundle URL after ensuring the ODR tag is loaded.
   * Throws if the pack is not available — call getStatus first.
   */
  getFileUri(opts: {
    lang: PackLang;
    chapter: string;       // e.g. '01'
    paragraph: string;     // e.g. '000'
    speaker: 'male' | 'female';
  }): Promise<GetFileUriResult>;

  /**
   * Optional: explicitly request a pack download (iOS / on-demand Android).
   * No-op for fast-follow packs that the platform already manages.
   * Resolves when status transitions to 'available' or rejects on failure.
   */
  requestPack(opts: { lang: PackLang }): Promise<void>;
}
