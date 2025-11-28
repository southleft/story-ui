/**
 * Production App Entry Point
 *
 * This is the main entry point for the Story UI production app.
 * It renders the main App component which provides the Lovable/Bolt-style
 * interface for generating and previewing UI components.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Mount the app
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure there is a <div id="root"></div> in your HTML.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
