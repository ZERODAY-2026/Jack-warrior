import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { DocumentTypeOption } from '../types/api';

/**
 * Loads the document types the backend can analyse for (contract v0.4). Returns null
 * until they arrive, or when the backend is older and has no such list, in which case
 * the type picker is simply not shown.
 */
export function useDocumentTypes(online: boolean): DocumentTypeOption[] | null {
  const [types, setTypes] = useState<DocumentTypeOption[] | null>(null);
  const loaded = types !== null;
  useEffect(() => {
    if (!online || loaded) return;
    const c = new AbortController();
    api
      .documentTypes(c.signal)
      .then((t) => setTypes(t.length > 0 ? t : null))
      .catch(() => undefined);
    return () => c.abort();
  }, [online, loaded]);
  return types;
}
