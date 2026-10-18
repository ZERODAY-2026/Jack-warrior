import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
// Inter is bundled with the app and served from this origin; no font CDN is contacted.
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "user" turns movement off when the operating system asks for reduced motion. */}
    <MotionConfig reducedMotion="user">
      <ErrorBoundary label="application">
        <App />
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);
