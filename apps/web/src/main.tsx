import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { clearLegacyPersistenceKeys } from './state/legacyCleanup.js';
import './index.css';

clearLegacyPersistenceKeys();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
