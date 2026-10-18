import { AlertTriangle, BadgeCheck, CircleHelp, FileQuestion, HelpCircle, Quote, ShieldAlert } from 'lucide-react';
import type { AnswerType, Classification, EvidenceStatus } from '../../types/api';
import {
  ANSWER_LABEL,
  CLASSIFICATION_HELP,
  CLASSIFICATION_LABEL,
  EVIDENCE_LABEL,
} from '../../utils/labels';

// Every badge carries an icon and a text label, so meaning never depends on colour alone.

const CLASS_ICON = {
  explicit: Quote,
  interpretation: HelpCircle,
  concern: AlertTriangle,
  not_established: FileQuestion,
} as const;

export function ClassificationBadge({ value }: { value: Classification }) {
  const Icon = CLASS_ICON[value];
  return (
    <span className={`badge badge--${value}`} title={CLASSIFICATION_HELP[value]}>
      <Icon aria-hidden="true" size={14} />
      {CLASSIFICATION_LABEL[value]}
    </span>
  );
}

export function EvidenceBadge({ value }: { value: EvidenceStatus }) {
  const Icon = value === 'verified' ? BadgeCheck : value === 'unverified' ? CircleHelp : FileQuestion;
  return (
    <span className={`evidence-status evidence-status--${value}`}>
      <Icon aria-hidden="true" size={14} />
      {EVIDENCE_LABEL[value]}
    </span>
  );
}

const ANSWER_ICON: Record<AnswerType, typeof Quote> = {
  answered: Quote,
  not_in_document: FileQuestion,
  ambiguous: CircleHelp,
  needs_professional: ShieldAlert,
  out_of_scope: AlertTriangle,
};

export function AnswerTypeBadge({ value }: { value: AnswerType }) {
  const Icon = ANSWER_ICON[value];
  return (
    <span className={`badge badge--answer-${value}`}>
      <Icon aria-hidden="true" size={14} />
      {ANSWER_LABEL[value]}
    </span>
  );
}
