/**
 * EVERY FIELD A diag() CALL CAN WRITE, AND WHETHER IT IS TEXT.
 *
 * R3 (lane B review): the 30-day redaction (src/diag/diagPrivacy.ts) works
 * from a list of private field names, and the first list missed the N-best
 * `readings` on every voice result, FieldTest's `text` and two device-label
 * fields, while redacting counts and session types that are not private. A
 * hand-written fixture cannot catch that; this walks the real call sites.
 *
 * TYPED, NOT GREPPED. It builds the app's TypeScript program (tsconfig.app.json)
 * and, for every call of `diag` (resolved to src/diag/diagnosticLog.ts) and
 * every `log('event', {...})` in src/audio/voiceControl.ts (its `deps.log`
 * reaches diag through useVoiceControl), reads the detail argument:
 *
 *   - an object literal: each property, spreads followed, `a ? {..} : {..}`
 *     followed into both branches;
 *   - anything else: the properties of its TYPE, when the type names them.
 *
 * A field is TEXT unless its type is only number, boolean, null or
 * undefined: strings, string arrays, objects and unknown all count, because
 * any of them can carry words or a device name into the log.
 *
 * A detail whose type cannot name its fields (an index signature, `unknown`)
 * is reported as OPAQUE; diagFields.test.ts keeps a reasoned list of those.
 *
 * Run it for the census:  node scripts/diagFields.ts
 */

import { relative, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface DiagField {
  /** 'src/audio/voiceControl.ts:869' */
  site: string;
  /** The event names this call can write ('*' when the name is computed). */
  events: string[];
  key: string;
  text: boolean;
}

export interface OpaqueSite {
  site: string;
  events: string[];
  /** The expression whose fields the type cannot name. */
  expr: string;
}

/** Calls that only forward another call site's detail, walked at that site instead. */
const FORWARDERS = new Set(['src/ui/useVoiceControl.ts']);

function program(): ts.Program {
  const configPath = join(ROOT, 'tsconfig.app.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error('tsconfig.app.json did not parse');
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
}

function isTextType(checker: ts.TypeChecker, t: ts.Type, depth = 0): boolean {
  if (depth > 4) return true;
  if (t.isUnion()) return t.types.some((u) => isTextType(checker, u, depth + 1));
  const f = t.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  if (f & ts.TypeFlags.StringLike) return true;
  if (f & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never)) {
    return false;
  }
  if (checker.isArrayType(t) || checker.isTupleType(t)) {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    return args.some((a) => isTextType(checker, a, depth + 1));
  }
  // An object: text if any of its fields is (an input list of device labels).
  if (f & ts.TypeFlags.Object) {
    if (checker.getIndexInfosOfType(t).length > 0) return true;
    const props = checker.getPropertiesOfType(t);
    if (props.length === 0) return false;
    return props.some((p) => {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
      return isTextType(checker, pt, depth + 1);
    });
  }
  return true;
}

function eventsOf(e: ts.Expression | undefined): string[] {
  if (!e) return ['*'];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e)) return eventsOf(e.expression);
  if (ts.isConditionalExpression(e)) return [...eventsOf(e.whenTrue), ...eventsOf(e.whenFalse)];
  return ['*'];
}

export function census(): { fields: DiagField[]; opaque: OpaqueSite[] } {
  const prog = program();
  const checker = prog.getTypeChecker();
  const fields: DiagField[] = [];
  const opaque: OpaqueSite[] = [];
  const diagFile = join(ROOT, 'src', 'diag', 'diagnosticLog.ts').split(sep).join('/');

  const resolvesToDiag = (id: ts.Identifier): boolean => {
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return false;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return (sym.declarations ?? []).some((d) => d.getSourceFile().fileName.split(sep).join('/') === diagFile);
  };

  for (const sf of prog.getSourceFiles()) {
    const rel = relative(ROOT, sf.fileName).split(sep).join('/');
    if (!rel.startsWith('src/') || /\.test\.tsx?$/.test(rel)) continue;
    if (FORWARDERS.has(rel)) continue;
    const site = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

    const walk = (expr: ts.Expression, events: string[], at: ts.Node): void => {
      if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
        walk(expr.expression, events, at);
        return;
      }
      if (ts.isConditionalExpression(expr)) {
        walk(expr.whenTrue, events, at);
        walk(expr.whenFalse, events, at);
        return;
      }
      if (ts.isObjectLiteralExpression(expr)) {
        for (const p of expr.properties) {
          if (ts.isSpreadAssignment(p)) {
            walk(p.expression, events, p);
            continue;
          }
          if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
          const name = p.name;
          const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText(sf);
          let t: ts.Type;
          if (ts.isShorthandPropertyAssignment(p)) {
            const vs = checker.getShorthandAssignmentValueSymbol(p);
            t = vs ? checker.getTypeOfSymbolAtLocation(vs, p) : checker.getTypeAtLocation(p.name);
          } else {
            t = checker.getTypeAtLocation(p.initializer);
          }
          fields.push({ site: site(p), events, key, text: isTextType(checker, t) });
        }
        return;
      }
      // Not a literal: the type names the fields, or the site is opaque.
      const t = checker.getTypeAtLocation(expr);
      const parts = t.isUnion() ? t.types : [t];
      for (const part of parts) {
        if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
        if (part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || checker.getIndexInfosOfType(part).length > 0) {
          opaque.push({ site: site(at), events, expr: expr.getText(sf).slice(0, 80) });
          continue;
        }
        for (const p of checker.getPropertiesOfType(part)) {
          const decl = p.valueDeclaration ?? p.declarations?.[0];
          const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
          fields.push({ site: site(at), events, key: p.getName(), text: isTextType(checker, pt) });
        }
      }
    };

    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const callee = n.expression;
        if (callee.text === 'diag' && n.arguments.length >= 3 && resolvesToDiag(callee)) {
          walk(n.arguments[2]!, eventsOf(n.arguments[1]), n.arguments[2]!);
        } else if (callee.text === 'log' && rel === 'src/audio/voiceControl.ts' && n.arguments.length >= 2) {
          walk(n.arguments[1]!, eventsOf(n.arguments[0]), n.arguments[1]!);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { fields, opaque };
}

// `node scripts/diagFields.ts`: print the census.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { fields, opaque } = census();
  const byKey = new Map<string, Set<string>>();
  for (const f of fields.filter((x) => x.text)) {
    const s = byKey.get(f.key) ?? new Set<string>();
    for (const e of f.events) s.add(e);
    byKey.set(f.key, s);
  }
  for (const [k, evs] of [...byKey].sort()) console.log(`${k}\t${[...evs].join(',')}`);
  console.log(`--- opaque ${opaque.length}`);
  for (const o of opaque) console.log(`${o.site}\t${o.events.join(',')}\t${o.expr}`);

}
