import type { Settings } from './types';

/**
 * B16: the sound settings that belong to a DEVICE, not to Jack: where sound
 * and the mic go (a desktop's 'phone' route forces the iPhone's speaker over
 * the car's Bluetooth), how it is played, which system voice (a desktop
 * voice id means nothing on iOS) and the chime level tuned to that speaker.
 *
 * A backup records the kind of device that made it. Restoring onto the same
 * kind -- the common case, a phone restoring its own backup after its storage
 * was cleared -- takes them from the file. Restoring a desktop's file onto a
 * phone keeps the phone's own. A file with no record (older versions) is
 * taken whole, as before.
 */
export const DEVICE_AUDIO_FIELDS = ['audioRoute', 'routeStrategy', 'voiceURI', 'chimeVolume'] as const;

export type DeviceClass = 'ios' | 'android' | 'desktop';

export function deviceClass(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent ?? ''): DeviceClass {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  // iPadOS asks for the desktop site and says "Macintosh"; touch gives it away.
  if (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** The device class a backup blob was made on, or null when it does not say. */
export function backupDevice(blob: Record<string, unknown>): DeviceClass | null {
  const meta = blob.meta as { device?: unknown } | undefined;
  const d = meta && typeof meta === 'object' ? meta.device : undefined;
  return d === 'ios' || d === 'android' || d === 'desktop' ? d : null;
}

/**
 * The settings to write on import: the file's, except that a file from a
 * different kind of device leaves this device's sound settings as they are.
 */
export function withDeviceAudio(fromFile: Settings, here: Settings, fileDevice: DeviceClass | null, thisDevice: DeviceClass): Settings {
  if (fileDevice === null || fileDevice === thisDevice) return fromFile;
  const audio = { ...fromFile.audio } as Record<string, unknown>;
  const mine = here.audio as unknown as Record<string, unknown>;
  for (const f of DEVICE_AUDIO_FIELDS) {
    if (mine[f] === undefined) delete audio[f];
    else audio[f] = mine[f];
  }
  return { ...fromFile, audio: audio as unknown as Settings['audio'] };
}

const DEVICE_NAME: Record<DeviceClass, string> = { ios: 'an iPhone or iPad', android: 'an Android phone', desktop: 'a computer' };

/** The confirm's line when a file's sound settings will not be applied here, or null. */
export function deviceAudioNote(fileDevice: DeviceClass | null, thisDevice: DeviceClass): string | null {
  if (fileDevice === null || fileDevice === thisDevice) return null;
  return `The file was made on ${DEVICE_NAME[fileDevice]}, so this device keeps its own speaker route, voice and chime level.`;
}
