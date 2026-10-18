import { ChevronRight, Lock } from 'lucide-react';

/** Breadcrumb header above the workspace. Purely presentational. */
export function Topbar({ trail }: { trail: string[] }) {
  return (
    <header className="topbar">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          {trail.map((t, i) => (
            <li key={`${t}-${i}`} aria-current={i === trail.length - 1 ? 'page' : undefined}>
              {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </nav>
      <p className="topbar__chip">
        <Lock size={13} aria-hidden="true" /> On-device · No analytics
      </p>
    </header>
  );
}
