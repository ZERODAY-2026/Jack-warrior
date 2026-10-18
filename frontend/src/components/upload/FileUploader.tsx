import { useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { formatBytes } from '../../utils/validateFile';

interface Props {
  onFile: (file: File) => void;
  acceptedExtensions: string[];
  maxBytes: number;
  ocrSupported: boolean;
  disabled?: boolean;
  error: string | null;
}

export function FileUploader({ onFile, acceptedExtensions, maxBytes, ocrSupported, disabled, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const types = acceptedExtensions.map((e) => e.slice(1).toUpperCase()).join(' or ');

  const take = (files: FileList | null) => {
    if (disabled || !files || files.length === 0) return;
    const file = files[0];
    if (file) onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
  };

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span className="dropzone__icon" aria-hidden="true">
        <Upload size={22} />
      </span>
      <p className="dropzone__title">Drop a {types} file here</p>
      <p className="dropzone__hint">or</p>
      <button type="button" className="button button--primary" onClick={() => input.current?.click()} disabled={disabled}>
        Choose document
      </button>
      <input
        ref={input}
        id="document-input"
        type="file"
        className="visually-hidden"
        accept={acceptedExtensions.join(',')}
        aria-describedby="upload-rules"
        tabIndex={-1}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
        data-testid="file-input"
      />
      <p id="upload-rules" className="dropzone__rules">
        {types} up to {formatBytes(maxBytes)} · Text-based files only
        {!ocrSupported && ' (scanned PDFs without a text layer are not supported)'}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
