import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './redesign.css';
import './workspace.css';
import './desk.css';
import './solvia-yellow.css';
import './staff-workspace.css';
import './clinic-workspace.css';
import './reception.css';
import './desktop-system.css';
import './desktop-forms.css';
import './monochrome.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

