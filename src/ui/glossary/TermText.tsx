import { Fragment, type ReactNode } from 'react';
import { Term } from './Term';
import { splitTerms } from './splitTerms';

/** T2-2B: `text` with each glossary word's first appearance tappable (splitTerms.ts). */
export function TermText({ text }: { text: string }): ReactNode {
  return (
    <>
      {splitTerms(text).map((p, i) =>
        typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <Term key={i} id={p[1]}>{p[0]}</Term>,
      )}
    </>
  );
}
