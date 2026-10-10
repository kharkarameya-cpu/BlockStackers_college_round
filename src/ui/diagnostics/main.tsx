import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiagnosticsApp } from './DiagnosticsApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DiagnosticsApp />
  </React.StrictMode>
);
