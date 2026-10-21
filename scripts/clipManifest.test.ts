import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Wave L review S2: the clip generator and the shipped manifests.
 *
 * The generator used to OVERWRITE each manifest with today's vocabulary, which
 * dropped every line recorded by hand (31 per voice: the Drive checks lines and
 * "Watching."). Two halves keep that from happening again:
 *
 * - every key of every shipped manifest is in build_vocabulary(), so a line
 *   recorded without being derived (scripts/spokenPhrases.ts) fails here;
 * - a run merges instead of overwriting, so even an underived line survives a
 *   regeneration until it is derived.
 *
 * Runs the real Python, since the vocabulary is built there.
 */

const PY = process.platform === 'win32' ? 'python' : 'python3';
const GENERATOR = fileURLToPath(new URL('./generate-audio-clips.py', import.meta.url));
const CLIPS = fileURLToPath(new URL('../public/clips/', import.meta.url));

function python(args: string[], input?: string): string {
  return execFileSync(PY, args, { encoding: 'utf8', input, maxBuffer: 1 << 26 });
}

const voices = readdirSync(CLIPS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('clip manifests against the generator', () => {
  const vocab = new Set(JSON.parse(python([GENERATOR, '--list-json'])) as string[]);

  it('finds the three shipped voices', () => {
    expect(voices.sort()).toEqual(['af_bella', 'bf_emma', 'bm_george']);
  });

  for (const voice of voices) {
    it(`every shipped clip in ${voice} is in build_vocabulary()`, () => {
      const manifest = JSON.parse(readFileSync(`${CLIPS}${voice}/manifest.json`, 'utf8')) as {
        clips: Record<string, string>;
      };
      expect(Object.keys(manifest.clips).filter((k) => !vocab.has(k))).toEqual([]);
    });
  }
});

describe('a generator run merges', () => {
  // The module name has hyphens, so it is loaded by path.
  const run = (body: string) =>
    python(
      ['-c', `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('g', sys.argv[1])\ng=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(g)\n${body}`, GENERATOR],
    );

  it('keeps a previous entry whose file exists, drops one whose file is gone, and lets the fresh entry win', () => {
    const out = run(
      [
        "fresh={'Hit.':'hit.mp3','Stand.':'stand.mp3'}",
        "prev={'Hit.':'old-hit.mp3','Say hit.':'say-hit.mp3','Gone.':'gone.mp3','Clash.':'stand.mp3'}",
        "merged,kept=g.merge_manifest(fresh,prev,lambda f: f!='gone.mp3')",
        'print(json.dumps({"merged":merged,"kept":kept}))',
      ].join('\n'),
    );
    expect(JSON.parse(out)).toEqual({
      merged: { 'Hit.': 'hit.mp3', 'Stand.': 'stand.mp3', 'Say hit.': 'say-hit.mp3' },
      kept: ['Say hit.'],
    });
  });

  it('keeps the voices a run did not touch in index.json, and the default', () => {
    const out = run(
      [
        "prev={'voices':[{'id':'af_bella','label':'Bella'},{'id':'bm_george','label':'George'}],'default':'af_bella'}",
        "print(json.dumps(g.merge_index(prev,['bf_emma'],{})))",
      ].join('\n'),
    );
    const index = JSON.parse(out) as { voices: { id: string }[]; default: string };
    expect(index.voices.map((v) => v.id)).toEqual(['af_bella', 'bm_george', 'bf_emma']);
    expect(index.default).toBe('af_bella');
  });
});
