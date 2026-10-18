import { useRef, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { FileSearch, ListChecks, MessageSquareText, Scale, ShieldCheck } from 'lucide-react';
import type { BackendStatus } from '../../hooks/useBackendHealth';
import { BackendPill } from '../privacy/BackendPill';

export type Tab = 'overview' | 'findings' | 'ask';

export const TABS: { id: Tab; label: string; icon: typeof FileSearch }[] = [
  { id: 'overview', label: 'Overview', icon: FileSearch },
  { id: 'findings', label: 'Findings', icon: ListChecks },
  { id: 'ask', label: 'Ask a question', icon: MessageSquareText },
];

interface ReviewNav {
  tab: Tab;
  onTab: (t: Tab) => void;
  findingCount: number;
  questionCount: number;
}

interface Props {
  status: BackendStatus;
  onOpenPrivacy: () => void;
  review: ReviewNav | null;
}

/**
 * Dark application sidebar. On wide screens it is a fixed column; below 900px the same
 * elements reflow into a compact top bar with the review tabs in a scrollable row.
 */
export function Sidebar({ status, onOpenPrivacy, review }: Props) {
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, findings: null, ask: null });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!review) return;
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(i + dir + TABS.length) % TABS.length]!.id;
    review.onTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside className="sidebar" aria-label="Application">
      <div className="sidebar__brand">
        <span className="brand-mark" aria-hidden="true">
          <Scale size={17} />
        </span>
        <div>
          <p className="brand-name">Clausewise</p>
          <p className="brand-tagline">Private legal review</p>
        </div>
      </div>

      <div className="sidebar__status">
        <BackendPill status={status} onClick={onOpenPrivacy} />
      </div>

      {review && (
        <nav className="sidebar__section sidebar__review" aria-label="Review sections">
          <p className="sidebar__label">Review</p>
          <div role="tablist" aria-orientation="vertical" aria-label="Review sections" className="sidebar__tabs">
            {TABS.map((t, i) => {
              const Icon = t.icon;
              const active = review.tab === t.id;
              const count = t.id === 'findings' ? review.findingCount : t.id === 'ask' ? review.questionCount : 0;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  id={`tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  className="nav-item"
                  onClick={() => review.onTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="nav-item__bg"
                      transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                      aria-hidden="true"
                    />
                  )}
                  <Icon size={16} aria-hidden="true" />
                  <span className="nav-item__label">{t.label}</span>
                  {(t.id === 'findings' || count > 0) && <span className="nav-item__count">{count}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <div className="sidebar__section sidebar__trust">
        <p className="sidebar__label">Trust</p>
        <button type="button" className="nav-item" onClick={onOpenPrivacy} aria-haspopup="dialog">
          <ShieldCheck size={16} aria-hidden="true" />
          <span className="nav-item__label">Privacy and local processing</span>
        </button>
      </div>

      <p className="sidebar__note">
        <Scale size={13} aria-hidden="true" /> Informational assistance only. Not legal advice.
      </p>
    </aside>
  );
}
