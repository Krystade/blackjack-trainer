import { useEffect, useState } from 'react';
import { loadCustomLists, subscribeCustomLists, type CustomListsDoc } from '../drills/customLists';

/**
 * Wave W: the saved Custom lists, re-read whenever they change in this tab
 * or another one. Read-only here: every change goes through
 * `updateCustomLists`, which re-reads the stored blob before writing.
 */
export function useCustomLists(): CustomListsDoc {
  const [doc, setDoc] = useState<CustomListsDoc>(() => loadCustomLists());
  useEffect(() => subscribeCustomLists(() => setDoc(loadCustomLists())), []);
  return doc;
}
