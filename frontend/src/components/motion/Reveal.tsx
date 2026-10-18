import type { ReactNode } from 'react';
import { motion } from 'motion/react';

// Shared, restrained motion presets. Only opacity and transform are animated, and
// MotionConfig reducedMotion="user" (set in main.tsx) drops the movement for people who ask for less.
export const EASE = [0.22, 1, 0.36, 1] as const;

export const fadeRise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: EASE },
};

/** Fades and lifts its children in once on mount. `index` staggers siblings slightly, capped so long lists never wait. */
export function Reveal({
  children,
  index = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: 'div' | 'li' | 'section';
}) {
  const Component = as === 'li' ? motion.li : as === 'section' ? motion.section : motion.div;
  return (
    <Component
      className={className}
      initial={fadeRise.initial}
      animate={fadeRise.animate}
      transition={{ ...fadeRise.transition, delay: Math.min(index, 8) * 0.035 }}
    >
      {children}
    </Component>
  );
}
