import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { usesNewInterface } from './interface.ts';

// Each interface brings its own stylesheet, so only the chosen one is loaded.
const { App } = await (usesNewInterface() ? import('./next/App.tsx') : import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
