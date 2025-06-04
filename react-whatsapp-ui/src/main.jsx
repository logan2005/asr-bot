import React from 'react';
import ReactDOM from 'react-dom/client'; // For React 18
// For React < 18: import ReactDOM from 'react-dom';
import './index.css'; // if you have global styles here
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// For React < 18:
// ReactDOM.render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>,
//   document.getElementById('root')
// );