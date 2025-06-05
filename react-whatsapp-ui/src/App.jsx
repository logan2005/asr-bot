import React, { useState, useEffect, useCallback } from 'react';
import netlifyIdentity from 'netlify-identity-widget';
import './App.css'; // Ensure your App.css has all the styles

function App() {
  // --- Authentication State ---
  const [user, setUser] = useState(netlifyIdentity.currentUser());
  const [authLoading, setAuthLoading] = useState(true); // For initial auth check

  // --- WhatsApp Bot States ---
  const [messageTemplate, setMessageTemplate] = useState('Hi {name}, this is a test message from ASR!');
  const [submitStatus, setSubmitStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false); // For send button
  const [isSendingComplete, setIsSendingComplete] = useState(false);
  const [result, setResult] = useState(null);

  // --- QR Code and WhatsApp Connection States ---
  const [qrDataURL, setQrDataURL] = useState(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState('INITIALIZING'); // More explicit initial state
  const [showReadyAnimation, setShowReadyAnimation] = useState(false);

  // --- Initialize Netlify Identity and Event Handlers ---
  useEffect(() => {
    netlifyIdentity.init({
      // APIUrl: "YOUR_NETLIFY_SITE_URL/.netlify/identity", // Auto-detected
      // logo: false, // You can set a custom logo in Netlify Identity settings
    });

    const handleAuthChange = (loggedInUser) => {
      setUser(loggedInUser);
      setAuthLoading(false); // Auth state resolved
      if (loggedInUser) netlifyIdentity.close(); // Close modal on login
    };

    // Check initial state and set up listeners
    handleAuthChange(netlifyIdentity.currentUser()); 

    netlifyIdentity.on('init', (initUser) => handleAuthChange(initUser));
    netlifyIdentity.on('login', (loginUser) => handleAuthChange(loginUser));
    netlifyIdentity.on('logout', () => handleAuthChange(null));
    netlifyIdentity.on('error', (err) => {
      console.error('Netlify Identity Error:', err);
      setAuthLoading(false); // Resolve auth loading even on error
    });


    return () => {
      // Cleanup: It's good practice but netlify-identity-widget is a bit global.
      // Re-initializing is usually fine. You could try to use netlifyIdentity.off if issues arise.
    };
  }, []);

  // --- Fetch QR Status (only if logged in) ---
  const fetchQrStatus = useCallback(async () => {
    if (!user) { // Don't poll if not logged in
      setWhatsAppStatus('Logged out'); // Or some other appropriate status
      setQrDataURL(null);
      return;
    }
    try {
      const response = await fetch('/api/getQrStatus');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to parse QR status error" }));
        console.error('Error fetching QR status:', response.status, errorData);
        setWhatsAppStatus(`Error: ${errorData.error || response.statusText}`);
        setQrDataURL(null);
        setShowReadyAnimation(false);
        return;
      }
      const data = await response.json();
      if (data.status === 'READY' && whatsAppStatus !== 'READY') {
        setShowReadyAnimation(true);
        setTimeout(() => setShowReadyAnimation(false), 2500); // Animation duration + a bit
      } else if (data.status !== 'READY') {
        setShowReadyAnimation(false);
      }
      setWhatsAppStatus(data.status || 'Unknown');
      setQrDataURL(data.qrDataURL);
    } catch (error) {
      console.error('Network error fetching QR status:', error);
      setWhatsAppStatus('Network error fetching status.');
      setQrDataURL(null);
      setShowReadyAnimation(false);
    }
  }, [user, whatsAppStatus]); // Add user

  useEffect(() => {
    if (user) { // Only start polling if user is logged in
      const initialFetchDelay = setTimeout(fetchQrStatus, 1000); // Slight delay for initial fetch
      const intervalId = setInterval(fetchQrStatus, 5000);
      return () => {
        clearTimeout(initialFetchDelay);
        clearInterval(intervalId);
      };
    } else {
      // Clear WhatsApp status if user logs out
      setWhatsAppStatus('Logged out');
      setQrDataURL(null);
      setShowReadyAnimation(false);
    }
  }, [user, fetchQrStatus]);


  // --- Handle Message Sending ---
  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setIsSendingComplete(false);
    setSubmitStatus('Sending messages, please wait...');
    setResult(null);

    try {
      const response = await fetch('/api/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageTemplate }),
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitStatus(`Process completed: ${data.messagesSuccessfullySent || 0} sent.`);
        setResult(data);
        setIsSendingComplete(true);
        setTimeout(() => setIsSendingComplete(false), 3500);
      } else {
        setSubmitStatus(`Error: ${data.error || 'Failed to process messages.'} ${data.details ? `(${data.details})` : ''}`);
        setResult(data); // Still set result to show partial errors if any
      }
    } catch (error) {
      console.error('Frontend error during send:', error);
      setSubmitStatus(`Frontend error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Elements ---
  const openLoginModal = () => netlifyIdentity.open();
  const handleLogoutAction = () => netlifyIdentity.logout();

  let buttonContent;
  if (isLoading) {
    buttonContent = <div className="button-loader"></div>;
  } else if (isSendingComplete) {
    buttonContent = (
      <div className="button-checkmark">
        <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
          <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
          <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
        </svg>
      </div>
    );
  } else {
    buttonContent = 'Send Messages';
  }

  // --- Render Logic ---
  if (authLoading) {
    return (
      <div className="App loading-screen">
        <div className="app-loader"></div> {/* Simple loader for auth check */}
        <p>Loading Application...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="App login-screen animated fadeIn"> {/* Added animation class */}
        <header className="App-header login-header">
          <img src="/logo.jpg" alt="ASR Bot Logo" className="app-logo" />
          <h1>ASR Messenger</h1>
          <p>Securely send WhatsApp messages via Google Sheets.</p>
        </header>
        <main className="login-main">
          <button onClick={openLoginModal} className="submit-button login-button">
            Login / Sign Up
          </button>
          <p className="login-note">Note: Sign up is by invitation only.</p>
        </main>
        <footer className="login-footer"><p>© {new Date().getFullYear()} Logan Tech Solutions</p><p>Powered by Logadheenan</p></footer>
      </div>
    );
  }

  // User is logged in - Render the main application
  return (
    <div className="App main-app animated fadeIn"> {/* Added animation class */}
      <header className="App-header">
        <div className="header-top-bar">
          <img src="/logo.jpg" alt="ASR Bot Logo" className="app-logo-small" />
          <h1>ASR Messenger</h1>
          <div className="user-info">
            <span>{user.user_metadata?.full_name || user.email}</span>
            <button onClick={handleLogoutAction} className="logout-button">Logout</button>
          </div>
        </div>

        <div className="whatsapp-status-container">
          <h2>
            WhatsApp Status: <span className={`status-text status-${String(whatsAppStatus).toLowerCase().replace(/[^a-z0-9_]/g, '')}`}>{whatsAppStatus}</span>
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
              <p>Scan QR with WhatsApp (Linked Devices):</p>
              <img src={qrDataURL} alt="WhatsApp QR Code" />
            </div>
          )}
          {whatsAppStatus === 'READY' && !showReadyAnimation && <p className="status-text-ready">Connected & Ready!</p>}
          {whatsAppStatus === 'AUTH_FAILURE' && <p className="status-text-failure">Authentication Failed. Re-scan needed.</p>}
          {whatsAppStatus === 'DISCONNECTED' && <p className="status-text-disconnected">Disconnected. May need re-scan.</p>}
          {whatsAppStatus === 'ERROR_INITIALIZING' && <p className="status-text-error">Error Initializing Client.</p>}
          {(whatsAppStatus === 'INITIALIZING' || whatsAppStatus === 'Checking status...' || String(whatsAppStatus).startsWith('Error:')) && 
            !qrDataURL && <p className="status-text-pending">{whatsAppStatus}</p>}
        </div>
      </header>

      <main>
        <p className="app-description">
          Enter your message template below. Use <strong>{"{name}"}</strong> for personalization. Contacts are fetched from the linked Google Sheet.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="messageTemplate">Message Template:</label>
            <textarea
              id="messageTemplate"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              rows="6"
              placeholder="e.g., Hi {name}, your special offer is waiting!"
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
          <div className={`status-message ${result && result.messagesSuccessfullySent > 0 && (!result.errors || result.errors.length === 0) ? 'success' : (result && result.errors && result.errors.length > 0 ? 'warning' : (submitStatus.toLowerCase().includes('error') ? 'error' : 'info'))}`}>
            <p>{submitStatus}</p>
            {result && (
              <div className="result-details">
                {/* ... result details as before ... */}
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="app-footer"><p>© {new Date().getFullYear()} Logan Tech Solutions. Secure WhatsApp Automation.</p> <p>Powered by Logadheenan</p></footer>
    </div>
  );
}

export default App;