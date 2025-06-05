import React, { useState, useEffect, useCallback } from 'react';
import './App.css'; // Make sure your App.css has all the styles including button states

function App() {
  const [messageTemplate, setMessageTemplate] = useState('Hi {name}, this is a test message!');
  const [submitStatus, setSubmitStatus] = useState(''); // For send operation status
  const [isLoading, setIsLoading] = useState(false); // For send button loading state
  const [isSendingComplete, setIsSendingComplete] = useState(false); // For send button completion tick
  const [result, setResult] = useState(null); // For send operation result

  const [qrDataURL, setQrDataURL] = useState(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState('Checking status...');
  const [showReadyAnimation, setShowReadyAnimation] = useState(false);

  const fetchQrStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/getQrStatus'); // Proxied by netlify.toml
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to parse error from QR status" }));
        console.error('Error fetching QR status:', response.status, errorData.error);
        setWhatsAppStatus(`Error: ${errorData.error || response.statusText}`);
        setQrDataURL(null);
        setShowReadyAnimation(false);
        return;
      }
      const data = await response.json();

      if (data.status === 'READY' && whatsAppStatus !== 'READY') {
        setShowReadyAnimation(true);
        setTimeout(() => setShowReadyAnimation(false), 2000); 
      } else if (data.status !== 'READY') {
        setShowReadyAnimation(false);
      }

      setWhatsAppStatus(data.status || 'Unknown');
      setQrDataURL(data.qrDataURL);
    } catch (error) {
      console.error('Network error fetching QR status:', error);
      setWhatsAppStatus('Network error.');
      setQrDataURL(null);
      setShowReadyAnimation(false);
    }
  }, [whatsAppStatus]); // Dependency: re-run if whatsAppStatus changes to correctly trigger animation

  useEffect(() => {
    fetchQrStatus(); // Fetch initially
    const intervalId = setInterval(fetchQrStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(intervalId); // Cleanup interval
  }, [fetchQrStatus]);


  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setIsSendingComplete(false); // Reset completion state for new submission
    setSubmitStatus('Sending messages... Please wait.');
    setResult(null);

    try {
      const response = await fetch('/api/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageTemplate }),
      });
      const data = await response.json();

      if (response.ok) {
        setSubmitStatus('Message sending process completed.');
        setResult(data);
        setIsSendingComplete(true); // Trigger completion animation on button
        setTimeout(() => {
          setIsSendingComplete(false); // Revert button after a delay
        }, 3000); // Revert button state after 3 seconds
      } else {
        setSubmitStatus(`Error: ${data.error || 'Failed to send messages.'} ${data.details ? `(${data.details})` : ''}`);
        setResult(null);
        // No setIsSendingComplete(true) on error
      }
    } catch (error) {
      console.error('Network or frontend error:', error);
      setSubmitStatus(`Frontend error: ${error.message}`);
      setResult(null);
    } finally {
      setIsLoading(false); // Stop loading animation
                           // isSendingComplete will control the tick visibility
    }
  };

  // Determine button content based on loading and completion states
  let buttonContent;
  if (isLoading) {
    buttonContent = <div className="button-loader"></div>;
  } else if (isSendingComplete) {
    buttonContent = (
      <div className="button-checkmark"> {/* Added div wrapper for consistent styling if needed */}
        <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
          <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
          <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
        </svg>
      </div>
    );
  } else {
    buttonContent = 'Send Messages to All Contacts';
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>ASR Bulk Messenger</h1>
        <div className="whatsapp-status-container">
          <h2>
            WhatsApp Status: <span className={`status-${String(whatsAppStatus).toLowerCase().replace(/[^a-z0-9_]/g, '')}`}>{whatsAppStatus}</span> {/* Sanitize class name */}
            {whatsAppStatus === 'READY' && showReadyAnimation && (
              <div className="tick-animation-container">
                <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                  <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                  <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
              </div>
            )}
          </h2>
          {whatsAppStatus === 'QR_PENDING' && qrDataURL && (
            <div className="qr-code-area">
              <p>Scan this QR code with your WhatsApp (Linked Devices):</p>
              <img src={qrDataURL} alt="WhatsApp QR Code" style={{ border: '1px solid #ccc', padding: '10px', backgroundColor: 'white' }}/>
            </div>
          )}
          {/* Display different messages based on WhatsApp status */}
          {whatsAppStatus === 'READY' && !showReadyAnimation && <p className="status-text-ready">WhatsApp is connected and ready!</p>}
          {whatsAppStatus === 'AUTH_FAILURE' && <p className="status-text-failure">WhatsApp authentication failed. Please try re-linking.</p>}
          {whatsAppStatus === 'DISCONNECTED' && <p className="status-text-disconnected">WhatsApp disconnected. Refresh or re-scan if needed.</p>}
          {whatsAppStatus === 'ERROR_INITIALIZING' && <p className="status-text-error">Error initializing WhatsApp client.</p>}
          {(whatsAppStatus === 'INITIALIZING' || whatsAppStatus === 'Checking status...' || String(whatsAppStatus).startsWith('Error:')) && 
            !qrDataURL && <p className="status-text-pending">{whatsAppStatus}</p>}
        </div>
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
              disabled={isLoading || isSendingComplete || whatsAppStatus !== 'READY'}
            />
          </div>
          <button 
            type="submit" 
            className={`submit-button ${isLoading ? 'loading' : ''} ${isSendingComplete ? 'completed' : ''}`}
            disabled={isLoading || isSendingComplete || whatsAppStatus !== 'READY'}
          >
            {buttonContent}
          </button>
        </form>

        {submitStatus && (
          <div className={`status-message ${result && result.messagesSuccessfullySent > 0 ? 'success' : (result || isLoading || isSendingComplete ? '' : 'error')}`}>
            <p>{submitStatus}</p>
            {result && (
              <div className="result-details">
                <p><strong>Total Contacts in Sheet:</strong> {result.totalContactsInSheet !== undefined ? result.totalContactsInSheet : 'N/A'}</p>
                <p><strong>Messages Successfully Sent:</strong> {result.messagesSuccessfullySent !== undefined ? result.messagesSuccessfullySent : 'N/A'}</p>
                {result.errors && result.errors.length > 0 && (
                  <div>
                    <p><strong>Errors Encountered ({result.errors.length}):</strong></p>
                    <ul>
                      {result.errors.slice(0, 5).map((err, index) => (
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