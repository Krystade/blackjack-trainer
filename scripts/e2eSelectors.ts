/**
 * EVERY CLASS AND TEST ID AN E2E SELECTOR NAMES CAN BE RENDERED BY src/.
 *
 * A selector that matches nothing is a passing test whenever it is asserted
 * absent (`toHaveCount(0)`, `toBeHidden()`, `not.toHaveClass`), and a silent
 * fallback whenever it is one alternative of a list. Four of them shipped:
 * `.flashcard, .table-felt` (field-test, neither class ever existed),
 * `getByTestId('index-test-pending')` (deleted by the same commit that
 * asserted it absent), `.drill-feedback` (surrender-indices, voice-answers)
 * and `.flashcards-screen` (gutters). Each was found by hand; this finds the
 * next one.
 *
 * STATIC, NOT RENDERED. It parses src/ and e2e/ with the TypeScript parser
 * (so comments and prose never count) and asks whether some string in a
 * CLASS POSITION or a TEST-ID POSITION in src could produce the name:
 *
 *   class position:  a `className` / `class` / `*ClassName` JSX attribute or
 *                    object property, `el.className = ...`, `classList.*()`,
 *                    and any variable, function, property or parameter
 *                    named `cls`, `*class`, `*classes` or `*className`
 *                    (ZonePad's `quadClass`, CollapsibleSection's default
 *                    `className = 'settings-section'`).
 *   test-id position: a `data-testid` or `*testId` attribute, property,
 *                    variable or parameter.
 *
 * Every string literal anywhere inside one of those counts, split on
 * whitespace. A template contributes a pattern for each piece that touches
 * a `${}`: `zone-pad-quad-${zone}` produces `zone-pad-quad-*`, and
 * CollapsibleSection's `${className}-body` produces `*-body`.
 *
 * What it reads in e2e/: the first argument of `locator`, `querySelector(All)`,
 * `closest`, `matches`, `waitForSelector`, `$`/`$$`/`$eval`/`$$eval`,
 * `getByTestId` and `toHaveClass` (a string, or a regex that is a bare name).
 * Class tokens come from the CSS; test ids from `[data-testid=...]` and
 * `[data-testid~=...]`. A selector held in a variable, or built by a helper
 * from its argument, is not followed. A name built in e2e from a `${}` is
 * checked by its static prefix.
 *
 * Run it to see the census:  node scripts/e2eSelectors.ts
 * e2eSelectors.test.ts fails on a name nothing can render and on an
 * ALLOWED entry that is no longer needed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export type Kind = 'class' | 'testid';

export interface Allowed {
  kind: Kind;
  name: string;
  reason: string;
}

/**
 * Names src produces in a way the extraction cannot see. Each needs a reason,
 * and the test fails on an entry that has stopped being needed.
 */
export const ALLOWED: readonly Allowed[] = [
  // CollapsibleSection renders `${className}-title` and `${className}-body`,
  // and `className` defaults to 'settings-section'. A `*-title` family would
  // accept every name ending that way, so the two are listed by name.
  { kind: 'class', name: 'settings-section-title', reason: "CollapsibleSection's `${className}-title`, default className 'settings-section'" },
  { kind: 'class', name: 'settings-section-body', reason: "CollapsibleSection's `${className}-body`, default className 'settings-section'" },
];

export interface Use {
  kind: Kind;
  /** The name, or its static prefix when `dynamic`. */
  name: string;
  /** Built in the spec from a `${}`; only the prefix is known. */
  dynamic: boolean;
  file: string;
  line: number;
}

export interface Produced {
  literals: Set<string>;
  patterns: RegExp[];
  /** Static text before the first `${}` of each pattern. */
  prefixes: string[];
}

export interface Vocabulary {
  class: Produced;
  testid: Produced;
}

// A substitution, in a template's flattened text: a private-use character,
// which no class or test id contains.
const HOLE = '\uE000';
const NAME = /^-?[_a-zA-Z][\w-]*$/;

function walk(dir: string, keep: (f: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
  });
}

export function srcFiles(root = ROOT): string[] {
  return walk(join(root, 'src'), (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

export function e2eFiles(root = ROOT): string[] {
  return walk(join(root, 'e2e'), (f) => f.endsWith('.ts'));
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
}

/** A string literal or template as text, each `${}` replaced by HOLE. */
function flatten(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => HOLE + s.literal.text).join('');
  }
  return null;
}

// Past this many spellings a template is read with HOLEs instead.
const MAX_SPELLINGS = 64;

/**
 * Every text an expression can be, HOLE standing in for what is not known
 * statically. `zone-pad${visible ? '' : ' zone-pad-hidden'}` is the two
 * texts `zone-pad` and `zone-pad zone-pad-hidden` -- not a `zone-pad*`
 * family, which would accept any name that starts the same way.
 */
function spellings(node: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(node)) return spellings(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...spellings(node.whenTrue), ...spellings(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    // `${on && ' x'}` renders the left side when it is falsy; a class string
    // never relies on that, so it reads as nothing.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return ['', ...spellings(node.right)];
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...spellings(node.left), ...spellings(node.right)];
    }
    if (op === ts.SyntaxKind.PlusToken) return product(spellings(node.left), spellings(node.right));
  }
  if (ts.isTemplateExpression(node)) {
    let out = [node.head.text];
    for (const span of node.templateSpans) {
      out = product(product(out, spellings(span.expression)), [span.literal.text]);
    }
    return out;
  }
  return [HOLE];
}

function product(a: string[], b: string[]): string[] {
  if (a.length * b.length > MAX_SPELLINGS) return [HOLE];
  return a.flatMap((x) => b.map((y) => x + y));
}

function nameOf(node: ts.Node): string | null {
  const n = (node as { name?: ts.Node }).name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isJsxNamespacedName(n)) return `${n.namespace.text}:${n.name.text}`;
  return null;
}

const CLASS_NAME = /^(cls|class|classes|classname)$|(class|classes|classname)$/i;
const TESTID_NAME = /^data-testid$|testid$/i;

/** Which position a declaration-like node puts its value in, if any. */
function positionOf(node: ts.Node): Kind | null {
  if (
    !ts.isJsxAttribute(node) &&
    !ts.isPropertyAssignment(node) &&
    !ts.isVariableDeclaration(node) &&
    !ts.isParameter(node) &&
    !ts.isBindingElement(node) &&
    !ts.isPropertyDeclaration(node) &&
    !ts.isFunctionDeclaration(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return null;
  }
  // `{ className }` destructured from props names a prop, not a value.
  if (ts.isBindingElement(node) && !node.initializer) return null;
  const name = nameOf(node);
  if (!name) return null;
  if (TESTID_NAME.test(name)) return 'testid';
  if (CLASS_NAME.test(name)) return 'class';
  return null;
}

function emptyProduced(): Produced {
  return { literals: new Set(), patterns: [], prefixes: [] };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function addText(into: Produced, text: string): void {
  for (const piece of text.split(/\s+/)) {
    if (!piece) continue;
    if (!piece.includes(HOLE)) {
      if (NAME.test(piece)) into.literals.add(piece);
      continue;
    }
    // A family is a fixed prefix and then anything: `drive-check-run-${id}`.
    // One that STARTS with a substitution (`${className}-body`) would accept
    // every name with that ending, so those go in ALLOWED by name instead.
    const prefix = piece.slice(0, piece.indexOf(HOLE));
    if (!/^[_a-zA-Z][\w-]{2,}$/.test(prefix) || !/^[\w\-\uE000]+$/.test(piece)) continue;
    into.patterns.push(new RegExp(`^${piece.split(HOLE).map(esc).join('[\\w-]*')}$`));
    into.prefixes.push(prefix);
  }
}

/** Every name src can put in a class or a test id. */
export function vocabulary(files: { file: string; text: string }[]): Vocabulary {
  const out: Vocabulary = { class: emptyProduced(), testid: emptyProduced() };
  const collect = (node: ts.Node, kind: Kind): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      for (const text of spellings(node)) addText(out[kind], text);
    }
    ts.forEachChild(node, (c) => collect(c, kind));
  };
  for (const { file, text } of files) {
    const visit = (node: ts.Node): void => {
      const pos = positionOf(node);
      if (pos) {
        const value =
          (node as { initializer?: ts.Node }).initializer ?? (node as { body?: ts.Node }).body;
        if (value) collect(value, pos);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        CLASS_NAME.test(node.left.name.text)
      ) {
        collect(node.right, 'class');
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'classList'
      ) {
        for (const a of node.arguments) collect(a, 'class');
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'setAttribute' &&
        node.arguments.length === 2
      ) {
        const attr = flatten(node.arguments[0]!);
        if (attr === 'class') collect(node.arguments[1]!, 'class');
        if (attr === 'data-testid') collect(node.arguments[1]!, 'testid');
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file, text));
  }
  return out;
}

const SELECTOR_CALLS = new Set([
  'locator',
  'querySelector',
  'querySelectorAll',
  'closest',
  'matches',
  'waitForSelector',
  '$',
  '$$',
  '$eval',
  '$$eval',
]);

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Names in one selector string (HOLE where the spec interpolates). */
export function selectorNames(selector: string): { kind: Kind; name: string; dynamic: boolean }[] {
  const out: { kind: Kind; name: string; dynamic: boolean }[] = [];
  if (/^\s*(xpath=|text=|\/\/|id=)/.test(selector)) return out;
  const push = (kind: Kind, raw: string) => {
    const hole = raw.indexOf(HOLE);
    const name = hole === -1 ? raw : raw.slice(0, hole);
    if (hole === -1 ? NAME.test(name) : name.length >= 3) out.push({ kind, name, dynamic: hole !== -1 });
  };
  // Attribute selectors first, then cut out so their values are not read as CSS.
  let css = selector.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const a = /^\s*data-testid\s*(~?)=\s*(["']?)(.*?)\2\s*(?:[is])?\s*$/.exec(inner);
    if (a) for (const t of a[3]!.split(/\s+/)) if (t) push('testid', t);
    return '[]';
  });
  // Quoted text (`:has-text("Hit.")`, `>> text="..."`) is not CSS either.
  css = css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  for (const m of css.matchAll(/(?<![\w-])\.(-?[_a-zA-Z][\w-]*\uE000?)|(?<=[\w)\]])\.(-?[_a-zA-Z][\w-]*\uE000?)/g)) {
    push('class', (m[1] ?? m[2])!);
  }
  return out;
}

/** Every class and test id the e2e suite names. */
export function uses(files: { file: string; text: string }[]): Use[] {
  const out: Use[] = [];
  for (const { file, text } of files) {
    const sf = parse(file, text);
    const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const fn = calleeName(node);
        const arg = node.arguments[0]!;
        const s = flatten(arg);
        if (fn && SELECTOR_CALLS.has(fn) && s !== null) {
          for (const n of selectorNames(s)) out.push({ ...n, file, line: at(arg) });
        } else if (fn === 'getByTestId' && s !== null) {
          const hole = s.indexOf(HOLE);
          const name = hole === -1 ? s : s.slice(0, hole);
          if (name) out.push({ kind: 'testid', name, dynamic: hole !== -1, file, line: at(arg) });
        } else if (fn === 'toHaveClass') {
          const names =
            s !== null
              ? s.split(/\s+/).filter((t) => t && !t.includes(HOLE))
              : ts.isRegularExpressionLiteral(arg)
                ? [/^\/(.*)\/[a-z]*$/.exec(arg.text)![1]!].filter((t) => NAME.test(t))
                : [];
          for (const name of names) out.push({ kind: 'class', name, dynamic: false, file, line: at(arg) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

export function producible(use: Pick<Use, 'kind' | 'name' | 'dynamic'>, vocab: Vocabulary): boolean {
  const p = vocab[use.kind];
  if (!use.dynamic) return p.literals.has(use.name) || p.patterns.some((r) => r.test(use.name));
  // Only the prefix is known: some name src makes must be able to start with it.
  for (const l of p.literals) if (l.startsWith(use.name)) return true;
  return p.prefixes.some((pre) => pre.startsWith(use.name) || use.name.startsWith(pre));
}

const read = (root: string, files: string[]) =>
  files.map((f) => ({ file: relative(root, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

export function realVocabulary(root = ROOT): Vocabulary {
  return vocabulary(read(root, srcFiles(root)));
}

export function realUses(root = ROOT): Use[] {
  return uses(read(root, e2eFiles(root)));
}

export function isAllowed(use: Pick<Use, 'kind' | 'name'>): Allowed | undefined {
  return ALLOWED.find((a) => a.kind === use.kind && a.name === use.name);
}

/** Uses that nothing in src can render, and that ALLOWED does not explain. */
export function deadUses(all: Use[], vocab: Vocabulary): Use[] {
  return all.filter((u) => !producible(u, vocab) && !isAllowed(u));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const vocab = realVocabulary();
  const all = realUses();
  const dead = deadUses(all, vocab);
  const names = (k: Kind) => new Set(all.filter((u) => u.kind === k).map((u) => u.name)).size;
  console.log(
    `e2e names ${names('class')} classes, ${names('testid')} test ids; ` +
      `src makes ${vocab.class.literals.size}+${vocab.class.patterns.length} classes, ` +
      `${vocab.testid.literals.size}+${vocab.testid.patterns.length} test ids (literals+patterns)`,
  );
  for (const u of dead) console.log(`DEAD ${u.kind} ${u.name}${u.dynamic ? '${...}' : ''}  ${u.file}:${u.line}`);
}
