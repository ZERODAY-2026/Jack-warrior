export interface FileRules {
  maxBytes: number;
  acceptedExtensions: string[];
}

/** Used until the backend reports its own limits through /api/health. */
export const DEFAULT_RULES: FileRules = {
  maxBytes: 10 * 1024 * 1024,
  acceptedExtensions: ['.pdf', '.txt'],
};

const MIME_BY_EXT: Record<string, string[]> = {
  '.pdf': ['application/pdf', 'application/x-pdf'],
  '.txt': ['text/plain'],
};

export type FileCheck = { ok: true } | { ok: false; message: string };

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/**
 * Quick checks before upload. The backend re-validates by file content, so these
 * only spare the user a round trip; they are not a security boundary.
 */
export function checkFile(file: File, rules: FileRules = DEFAULT_RULES): FileCheck {
  const ext = extensionOf(file.name);
  const accepted = rules.acceptedExtensions.map((e) => e.toLowerCase());
  if (!accepted.includes(ext)) {
    return {
      ok: false,
      message: `“${file.name}” is not supported. Choose a ${accepted.map((e) => e.slice(1).toUpperCase()).join(' or ')} file.`,
    };
  }
  const mimes = MIME_BY_EXT[ext];
  if (file.type && mimes && !mimes.includes(file.type)) {
    return { ok: false, message: `“${file.name}” does not look like a real ${ext.slice(1).toUpperCase()} file.` };
  }
  if (file.size === 0) {
    return { ok: false, message: `“${file.name}” is empty.` };
  }
  if (file.size > rules.maxBytes) {
    return {
      ok: false,
      message: `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(rules.maxBytes)}.`,
    };
  }
  return { ok: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
