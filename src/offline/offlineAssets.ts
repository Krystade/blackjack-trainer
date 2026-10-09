/**
 * WHICH URLS A FLIGHT NEEDS, worked out from what the running page already
 * loaded rather than from a list written by hand.
 *
 * A build emits hashed filenames (`assets/index-DeG47.js`), so no list checked
 * into the repo can name them. The page that is asking, though, has already
 * fetched exactly the right ones -- `performance.getEntriesByType('resource')`
 * names every file it took to get this far. Reading the answer off the live
 * page costs no build step and cannot drift from the build.
 */

/** The file `updateCheck` polls. It must never be cached -- see below. */
export const VERSION_FILE = 'version.json';

/**
 * Files that belong to the app whether or not the page has fetched them yet.
 *
 * The rest of the list is read off `performance.getEntriesByType('resource')`,
 * which names what has ALREADY loaded -- and these load late, or not from the
 * page at all. `icon-192.png` is the car's now-playing artwork, fetched by
 * mediaSession.ts the first time a drill speaks, which is after Save was
 * pressed in Settings; the offline drill test caught it 404ing with the
 * network out. The manifest and the other icons are the installed app's own
 * identity, requested by iOS rather than by the page.
 *
 * Fixed names in `public/`, so they are stated rather than discovered.
 */
const ALWAYS_SAVED = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
  'icon.svg',
  'icons.svg',
] as const;

export interface ShellInput {
  /** `location.href` of the running page. */
  documentUrl: string;
  /** Same-origin resource urls, e.g. from `performance.getEntriesByType`. */
  resources: readonly string[];
  /** `location.origin`, so another origin's files are left alone. */
  origin: string;
}

export function shellUrls(input: ShellInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  // The document first, and WITHOUT ITS QUERY STRING: a plain launch from the
  // home screen asks for `.../` and would miss a document stored as
  // `.../?e2e=1`, which is the same as having cached nothing at all.
  try {
    const doc = new URL(input.documentUrl);
    doc.search = '';
    doc.hash = '';
    add(doc.toString());
  } catch {
    /* A document url that will not parse is not one we can cache. */
  }

  for (const name of ALWAYS_SAVED) {
    try {
      add(new URL(name, input.documentUrl).toString());
    } catch {
      /* Only possible if the document url did not parse, handled above. */
    }
  }

  for (const raw of input.resources) {
    let url: URL;
    try {
      url = new URL(raw, input.documentUrl);
    } catch {
      continue;
    }
    // Another origin's response comes back opaque, so storing it buys nothing
    // and is not ours to hold.
    if (url.origin !== input.origin) continue;
    /*
     * NEVER THE VERSION FILE. `updateCheck` polls it to learn whether a newer
     * build has shipped; a cached copy freezes that answer at the day the
     * cache was warmed, and an installed phone can then never be told to
     * update again. This is the one url where a stale hit is worse than a
     * failed fetch.
     */
    if (url.pathname.endsWith(`/${VERSION_FILE}`) || url.pathname === `/${VERSION_FILE}`) continue;
    url.hash = '';
    add(url.toString());
  }

  return out;
}

/**
 * Every file the chosen clip voice needs: the voice list, the voice's own
 * manifest, and each recording once.
 */
export function clipUrlsFor(
  voiceId: string,
  manifest: Readonly<Record<string, string>>,
  clipsBase: string,
): string[] {
  const urls = [`${clipsBase}clips/index.json`, `${clipsBase}clips/${voiceId}/manifest.json`];
  const files = new Set<string>();
  for (const file of Object.values(manifest)) {
    // Keyed by phrase, and several phrases share a recording -- counting one
    // twice would make the progress total a lie.
    if (typeof file === 'string' && file) files.add(file);
  }
  for (const file of files) urls.push(`${clipsBase}clips/${voiceId}/${file}`);
  return urls;
}
