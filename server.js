require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal'); // For console QR code as a backup
const qrcodeDataUrl = require('qrcode');         // For generating Data URL for frontend
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet'); // Basic security headers
const rateLimit = require('express-rate-limit'); // Basic rate limiting

const app = express();
app.set('trust proxy', 1); // Trust the first proxy (e.g., Render's reverse proxy)
// --- Security Middlewares ---
app.use(helmet()); // Set various HTTP headers for security
app.use(express.json({ limit: '5mb' })); // Parse JSON bodies, limit payload size

// --- CORS Configuration ---
// In production, replace '*' with your actual Netlify frontend URL
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const allowedOrigins = IS_PRODUCTION
    ? [process.env.FRONTEND_URL] // Expects FRONTEND_URL in Render env vars e.g., https://your-app.netlify.app
    : ['http://localhost:8888', 'http://localhost:5173', 'http://localhost:3000']; // For local dev

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS: Denied origin - ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'], // Only allow GET and POST
}));


// --- Rate Limiting ---
// Adjust limits as per your expected usage
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/get-qr-status', apiLimiter); // Apply to specific sensitive/frequent endpoints
app.use('/send-messages', apiLimiter);


// --- Environment Variables & Constants ---
const PORT = process.env.PORT || 3001;
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;
if (!API_KEY) console.error("CRITICAL ERROR: API_KEY is not set. Application will not be secure.");
if (!SHEET_ID) console.warn("WARNING: SHEET_ID is not set. Google Sheets integration will fail.");
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn("WARNING: GOOGLE_APPLICATION_CREDENTIALS_BASE64 not set. Sheets API will fail.");


// --- Global state for QR code and WhatsApp client status ---
let currentQRDataURL = null;
let whatsAppClientStatus = 'INITIALIZING';

// --- Google Sheets Setup ---
let sheets;
try {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_BASE64 env var not set.");
    const decodedCredentials = Buffer.from(credentialsBase64, 'base64').toString('ascii');
    const credentials = JSON.parse(decodedCredentials);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    sheets = google.sheets({ version: 'v4', auth });
    console.log("Google Sheets API initialized successfully.");
} catch (error) {
    console.error('FATAL: Failed to initialize Google Sheets API:', error.message);
    // Consider exiting if this is critical: process.exit(1);
}

// --- WhatsApp Client Setup (Ephemeral Session for Render Free Tier) ---
const sessionDataPath = './wa_ephemeral_session';
console.log(`WhatsApp session (ephemeral) will be attempted at: ${path.resolve(sessionDataPath)}`);

if (!fs.existsSync(sessionDataPath)) {
    console.log(`Attempting to create ephemeral session directory: ${sessionDataPath}`);
    try {
        fs.mkdirSync(sessionDataPath, { recursive: true });
        console.log(`Successfully created ephemeral session directory: ${sessionDataPath}`);
    } catch (mkdirErr) {
        console.error(`Failed to create ephemeral session directory ${sessionDataPath}:`, mkdirErr);
    }
}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDataPath }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu',
            '--disable-software-rasterizer', '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
            '--disable-popup-blocking', '--disable-hang-monitor', '--disable-client-side-phishing-detection',
            '--disable-features=IsolateOrigins,site-per-process,TranslateUI,AutofillServerCommunication',
            '--disable-sync', '--metrics-recording-only', '--no-pings', '--single-process'
        ],
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', async qr => {
    console.log('WhatsApp QR Code Received. Scan to connect. Session is ephemeral and will be lost on restart/redeploy.');
    qrcodeTerminal.generate(qr, { small: true });
    try {
        currentQRDataURL = await qrcodeDataUrl.toDataURL(qr);
        whatsAppClientStatus = 'QR_PENDING';
        console.log('QR Data URL generated for frontend.');
    } catch (err) {
        console.error('Error generating QR Data URL for frontend:', err);
        currentQRDataURL = null;
        whatsAppClientStatus = 'ERROR_GENERATING_QR';
    }
});

client.on('ready', () => {
    console.log('WhatsApp client is ready! (Ephemeral session)');
    currentQRDataURL = null;
    whatsAppClientStatus = 'READY';
});

client.on('authenticated', () => {
    console.log('WhatsApp client authenticated! (Ephemeral session)');
    currentQRDataURL = null;
    whatsAppClientStatus = 'READY';
});

client.on('auth_failure', msg => {
    console.error('WhatsApp authentication failure:', msg);
    currentQRDataURL = null;
    whatsAppClientStatus = 'AUTH_FAILURE';
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp client was logged out. Reason:', reason);
    currentQRDataURL = null;
    whatsAppClientStatus = 'DISCONNECTED';
});

console.log('Initializing WhatsApp client...');
client.initialize().catch(err => {
    console.error("FATAL: Error initializing WhatsApp client (ephemeral session):", err);
    whatsAppClientStatus = 'ERROR_INITIALIZING';
    currentQRDataURL = null;
    // Consider if the app should attempt to retry or exit if initialization is critical and fails.
});

// --- API Key Middleware ---
const apiKeyAuth = (req, res, next) => {
    const receivedApiKey = req.headers['x-api-key'];
    if (API_KEY && receivedApiKey && receivedApiKey === API_KEY) {
        next();
    } else {
        console.warn(`Unauthorized access attempt: Missing or invalid API Key. Origin: ${req.headers.origin}, IP: ${req.ip}`);
        res.status(401).json({ error: 'Unauthorized: Missing or invalid API Key' });
    }
};

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send('WhatsApp Bot Backend (Ephemeral Session).');
});

app.get('/get-qr-status', apiKeyAuth, (req, res) => {
    res.json({
        status: whatsAppClientStatus,
        qrDataURL: currentQRDataURL
    });
});

app.post('/send-messages', apiKeyAuth, async (req, res) => {
    const { messageTemplate } = req.body;

    if (!messageTemplate || typeof messageTemplate !== 'string' || messageTemplate.trim() === "") {
        return res.status(400).json({ error: 'Invalid or missing messageTemplate in request body.' });
    }
    if (messageTemplate.length > 2000) {
        return res.status(400).json({ error: 'Message template is too long (max 2000 chars).' });
    }
    
    if (whatsAppClientStatus !== 'READY') {
        return res.status(503).json({ error: `WhatsApp client not ready. Current status: ${whatsAppClientStatus}` });
    }
    if (!sheets) {
        return res.status(500).json({ error: 'Google Sheets API not available. Check server logs.' });
    }

    try {
        // console.log('Fetching contacts from Google Sheet...'); // Reduced verbosity
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:B', // Assumes Name in A, Phone in B
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(404).json({ message: 'No contact data found in sheet or sheet is empty/has only headers.' });
        }

        const dataRows = rows.slice(1);
        let messagesSent = 0;
        let errorsEncountered = [];
        console.log(`Processing ${dataRows.length} contacts for sending messages...`);

        for (const row of dataRows) {
            const name = row[0];
            let phone = row[1];
            const originalPhoneForError = String(phone);

            if (!name || !phone || String(name).trim() === "" || String(phone).trim() === "") {
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: 'Missing name or phone' });
                continue;
            }

            phone = String(phone).replace(/[^0-9+]/g, '');
            if (phone.startsWith('+')) phone = phone.substring(1);
            if (phone.length === 10 && !phone.startsWith('91')) phone = '91' + phone;
            if (!phone.endsWith('@c.us')) phone = `${phone}@c.us`;

            const personalizedMessage = messageTemplate.replace(/{name}/g, name);

            try {
                // console.log(`Sending to: ${name} (${phone})`); // Reduced verbosity
                await client.sendMessage(phone, personalizedMessage);
                messagesSent++;
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 1000));
            } catch (err) {
                console.error(`Failed to send message to ${phone} (Name: ${name}):`, err.message);
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: `Send failed: ${err.message}` });
            }
        }
        console.log(`Message sending process completed. Sent: ${messagesSent}, Errors: ${errorsEncountered.length}`);
        res.json({ status: 'Completed', totalContactsInSheet: dataRows.length, messagesSuccessfullySent: messagesSent, errors: errorsEncountered });
    } catch (err) {
        console.error('Critical error in /send-messages handler:', err);
        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
            res.status(500).json({ error: 'Google Sheets API interaction error.', details: err.response.data.error.message });
        } else if (err.name === 'TimeoutError') { // Example for specific error types
             res.status(504).json({ error: 'Request to an external service timed out.', details: err.message });
        }
        else {
            res.status(500).json({ error: 'Internal server error during message processing.', details: err.message });
        }
    }
});

// --- Global Error Handler (Basic) ---
// Catches errors from synchronous parts of middleware or routes if not handled by try/catch
app.use((err, req, res, next) => {
    console.error("Unhandled application error:", err.stack || err);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (Ephemeral WhatsApp Session)`);
    if (!process.env.FRONTEND_URL && IS_PRODUCTION) {
        console.warn("WARNING: FRONTEND_URL environment variable not set. CORS might block frontend in production.");
    }
});