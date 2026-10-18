import type { DocumentTypeOption } from '../../types/api';

interface Props {
  id: string;
  types: DocumentTypeOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Label for the "auto" option, e.g. naming what was detected. */
  autoLabel?: string;
  label?: string;
}

/** Document-type picker. "auto" lets the backend detect the type. */
export function DocumentTypeSelect({ id, types, value, onChange, disabled, autoLabel = 'Auto-detect (recommended)', label = 'Document type' }: Props) {
  return (
    <div className="type-select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="auto">{autoLabel}</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  );
}
