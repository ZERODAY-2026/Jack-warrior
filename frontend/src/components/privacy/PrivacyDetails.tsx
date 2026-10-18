import { RefreshCw } from 'lucide-react';
import type { BackendStatus } from '../../hooks/useBackendHealth';
import { formatBytes } from '../../utils/validateFile';
import { describeBackend } from './BackendPill';

const MODEL_STATE_TEXT = {
  ready: 'Ready',
  loading: 'Loading',
  not_installed: 'Not installed',
  error: 'Failed to load',
} as const;

/** Explains the privacy design and shows what the backend reports about itself. */
export function PrivacyDetails({ status, onRefresh }: { status: BackendStatus; onRefresh: () => void }) {
  const { label } = describeBackend(status);
  const health = status.kind === 'online' ? status.health : null;
  return (
    <div className="privacy-details">
      <section aria-labelledby="privacy-design">
        <h3 id="privacy-design">How your document is handled</h3>
        <ul className="check-list">
          <li>This page sends your file only to the Clausewise backend running on your own computer.</li>
          <li>The backend is built to extract text, search and run the Gemma model locally, without any remote AI, OCR, translation or embedding service.</li>
          <li>This page loads no analytics, fonts or scripts from the internet, and in production builds its security policy blocks requests to any other site.</li>
          <li>Document text, findings and questions are kept only in this tab's memory, never in browser storage, and are cleared when you remove the document.</li>
          <li>Downloading the model and dependencies needs the internet once, during setup. Analysing documents does not.</li>
        </ul>
      </section>

      <section aria-labelledby="backend-status">
        <div className="section-head">
          <h3 id="backend-status">Backend status</h3>
          <button type="button" className="button button--ghost button--small" onClick={onRefresh}>
            <RefreshCw size={14} aria-hidden="true" /> Check again
          </button>
        </div>
        <p className="muted">{label}</p>
        {status.kind === 'offline' && <p>{status.message}</p>}
        {health && (
          <dl className="facts">
            <div><dt>Model</dt><dd>{health.model.name ?? 'Not reported'}</dd></div>
            <div><dt>Model state</dt><dd>{MODEL_STATE_TEXT[health.model.state]}</dd></div>
            {health.model.detail && <div><dt>Detail</dt><dd>{health.model.detail}</dd></div>}
            <div><dt>Runtime</dt><dd>{health.model.runtime ?? 'Not reported'}</dd></div>
            <div><dt>Quantization</dt><dd>{health.model.quantization ?? 'Not reported'}</dd></div>
            {health.model.parameter_size && <div><dt>Model size</dt><dd>{health.model.parameter_size}</dd></div>}
            <div><dt>Listening on</dt><dd>{health.privacy.bind_host}</dd></div>
            <div><dt>Telemetry</dt><dd>{health.privacy.telemetry_enabled ? 'On' : 'Off'}</dd></div>
            {health.privacy.egress_guard_active !== null && (
              <div><dt>Outbound network guard</dt><dd>{health.privacy.egress_guard_active ? 'Active' : 'Not active'}</dd></div>
            )}
            {health.privacy.blocked_outbound_attempts !== null && (
              <div><dt>Blocked outbound attempts</dt><dd>{health.privacy.blocked_outbound_attempts}</dd></div>
            )}
            {health.privacy.storage && (
              <div><dt>Document storage</dt><dd>{health.privacy.storage === 'memory_only' ? 'In memory only' : health.privacy.storage}</dd></div>
            )}
            <div><dt>Needs internet to analyse</dt><dd>{health.privacy.outbound_network_required ? 'Yes' : 'No'}</dd></div>
            <div><dt>Accepted files</dt><dd>{health.limits.accepted_extensions.join(', ')} up to {formatBytes(health.limits.max_file_bytes)}{health.limits.max_pages !== null && `, ${health.limits.max_pages} pages`}</dd></div>
            <div><dt>Scanned PDFs (OCR)</dt><dd>{health.limits.ocr_supported ? 'Supported' : 'Not supported'}</dd></div>
          </dl>
        )}
      </section>

      <p className="fine-print">
        These values are what the backend reports about its own configuration. They are not proof that nothing
        leaves your device. The project's offline test (run with networking disabled, plus connection monitoring) is
        the evidence; see <code>docs/privacy.md</code> in the repository.
      </p>
    </div>
  );
}
