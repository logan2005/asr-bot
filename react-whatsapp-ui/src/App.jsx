import React, { useState } from 'react';
import './App.css';

function App() {
  const [messageTemplate, setMessageTemplate] = useState('Hi {name}, this is a test message!');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setStatus('Sending messages... Please wait.');
    setResult(null);

    try {
      // The request now goes to our Netlify function endpoint
      const response = await fetch('/api/sendMessage', { //  Proxied by netlify.toml
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messageTemplate }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('Message sending process initiated successfully.');
        setResult(data);
      } else {
        setStatus(`Error: ${data.error || 'Failed to send messages.'} ${data.details ? `(${data.details})` : ''}`);
        setResult(null);
      }
    } catch (error) {
      console.error('Network or frontend error:', error);
      setStatus(`Frontend error: ${error.message}`);
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>WhatsApp Bulk Messenger</h1>
        <p>Contacts are fetched from the linked Google Sheet.</p>
        <p>Use <strong>{"{name}"}</strong> in your message as a placeholder for the contact's name.</p>
      </header>
      <main>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="messageTemplate">Message Template:</label>
            <textarea
              id="messageTemplate"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              rows="5"
              placeholder="e.g., Hi {name}, your package has shipped!"
              required
              disabled={isLoading}
            />
          </div>
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send Messages to All Contacts'}
          </button>
        </form>

        {status && (
          <div className={`status-message ${result && result.messagesSuccessfullySent > 0 ? 'success' : (result || isLoading ? '' : 'error')}`}>
            <p>{status}</p>
            {result && (
              <div className="result-details">
                <p><strong>Total Contacts in Sheet:</strong> {result.totalContactsInSheet !== undefined ? result.totalContactsInSheet : 'N/A'}</p>
                <p><strong>Messages Successfully Sent:</strong> {result.messagesSuccessfullySent !== undefined ? result.messagesSuccessfullySent : 'N/A'}</p>
                {result.errors && result.errors.length > 0 && (
                  <div>
                    <p><strong>Errors Encountered ({result.errors.length}):</strong></p>
                    <ul>
                      {result.errors.slice(0, 5).map((err, index) => ( // Show first 5 errors
                        <li key={index}>
                          {err.contact ? `Contact: ${err.contact.name || 'N/A'} (${err.contact.phone || 'N/A'})` : ''} - Error: {err.error}
                        </li>
                      ))}
                      {result.errors.length > 5 && <li>...and {result.errors.length - 5} more errors.</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <footer>
        <p>Secure WhatsApp Bot with Live Google Sheets Integration</p>
      </footer>
    </div>
  );
}

export default App;