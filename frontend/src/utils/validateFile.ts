export interface FileRules {
  maxBytes: number;
  acceptedExtensions: string[];
}

/** Used until the backend reports its own limits through /api/health. */
export const DEFAULT_RULES: FileRules = {
  maxBytes: 10 * 1024 * 1024,
  acceptedExtensions: ['.pdf', '.docx', '.txt'],
};

const MIME_BY_EXT: Record<string, string[]> = {
  '.pdf': ['application/pdf', 'application/x-pdf'],
  '.txt': ['text/plain'],
  // Browsers report .docx inconsistently, so generic zip/binary types are allowed too.
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ],
};

const TYPE_NAME: Record<string, string> = { '.pdf': 'PDF', '.docx': 'Word (.docx)', '.txt': 'TXT' };

/** "PDF, Word (.docx) or TXT" */
export function describeTypes(extensions: string[]): string {
  const names = extensions.map((e) => TYPE_NAME[e.toLowerCase()] ?? e.slice(1).toUpperCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? '');
}

export function describeFile(name: string): string {
  const ext = extensionOf(name);
  return ext === '.pdf' ? 'PDF' : ext === '.docx' ? 'Word document' : 'Plain text';
}

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
      message: `“${file.name}” is not supported. Choose a ${describeTypes(accepted)} file.${ext === '.doc' ? ' Older .doc files need to be saved as .docx first.' : ''}`,
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

/** Checks pasted text against the same size limit as a file. */
export function checkText(text: string, rules: FileRules = DEFAULT_RULES): FileCheck {
  if (!text.trim()) return { ok: false, message: 'Paste some text from the document first.' };
  const bytes = new Blob([text]).size;
  if (bytes > rules.maxBytes) {
    return { ok: false, message: `The pasted text is ${formatBytes(bytes)}. The limit is ${formatBytes(rules.maxBytes)}.` };
  }
  return { ok: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
