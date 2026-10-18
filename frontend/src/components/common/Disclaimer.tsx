import { Scale } from 'lucide-react';

export function Disclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="disclaimer disclaimer--compact">
        <Scale aria-hidden="true" size={14} />
        Informational assistance only · Not legal advice
      </p>
    );
  }
  return (
    <aside className="disclaimer" aria-label="Important limitation">
      <Scale aria-hidden="true" size={18} />
      <p>
        <strong>Clausewise is not a lawyer.</strong> It helps you read and question a document, and it can be
        wrong. It cannot decide whether a document is valid or enforceable. For decisions that matter, consult a
        qualified legal professional in your jurisdiction.
      </p>
    </aside>
  );
}
