require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Required for local fallback directory creation
const path = require('path'); // Not strictly needed for this version but good practice if manipulating paths
const cors = require('cors');

const app = express();
app.use(express.json());

// For production, restrict CORS to your Netlify domain.
// Example:
// const allowedOrigins = ['https://your-netlify-app-name.netlify.app'];
// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   }
// }));
app.use(cors()); // Current: Allow all origins

const PORT = process.env.PORT || 3001;
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;

// --- Google Sheets Setup ---
let sheets;
try {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
        throw new Error("GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is not set.");
    }
    const decodedCredentials = Buffer.from(credentialsBase64, 'base64').toString('ascii');
    const credentials = JSON.parse(decodedCredentials);

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
    console.error('Failed to initialize Google Sheets API:', error.message);
    // Consider if the app should exit or continue with degraded functionality
}

// --- WhatsApp Client Setup ---
// This will be /var/data/wa_sessions on Render, or ./wa_sessions_local_fallback locally if WA_SESSION_DIR is not set.
const effectiveDataPath = process.env.WA_SESSION_DIR || './wa_sessions_local_fallback';

console.log(`WhatsApp client will use dataPath for LocalAuth: ${effectiveDataPath}`);

// For local development: if WA_SESSION_DIR is not set (i.e., not on Render)
// and the fallback directory doesn't exist, create it.
if (!process.env.WA_SESSION_DIR && !fs.existsSync(effectiveDataPath)) {
    console.log(`Local fallback: Creating session directory: ${effectiveDataPath}`);
    try {
        fs.mkdirSync(effectiveDataPath, { recursive: true });
        console.log(`Successfully created local fallback directory: ${effectiveDataPath}`);
    } catch (mkdirErr) {
        console.error(`Failed to create local fallback directory ${effectiveDataPath}:`, mkdirErr);
        // This could be critical for local testing if it fails.
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: effectiveDataPath,
        clientId: 'main_session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp to connect.');
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
});

client.on('authenticated', () => {
    console.log('WhatsApp client authenticated!');
});

client.on('auth_failure', msg => {
    console.error('WhatsApp authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp client was logged out:', reason);
});

// Initialize client and catch potential errors during initialization
client.initialize().catch(err => {
    console.error("Error initializing WhatsApp client:", err);
    // Depending on the error, you might want to exit the process or attempt a retry strategy
});


// --- API Key Middleware ---
const apiKeyAuth = (req, res, next) => {
    const receivedApiKey = req.headers['x-api-key'];
    if (API_KEY && receivedApiKey && receivedApiKey === API_KEY) {
        next();
    } else {
        if (!API_KEY) console.warn("API_KEY is not set on the server. Endpoint is effectively unprotected.");
        res.status(401).json({ error: 'Unauthorized: Missing or invalid API Key' });
    }
};

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send('WhatsApp Bot Backend is running. Use the POST /send-messages endpoint with an API Key and messageTemplate.');
});

app.post('/send-messages', apiKeyAuth, async (req, res) => {
    const { messageTemplate } = req.body;

    if (!messageTemplate) {
        return res.status(400).json({ error: 'Missing messageTemplate in request body.' });
    }
    if (messageTemplate.length > 2000) { // Basic input validation
        return res.status(400).json({ error: 'Message template is too long (max 2000 chars).' });
    }

    if (!client.info) { // Check if client is ready (connected to WhatsApp)
        return res.status(503).json({ error: 'WhatsApp client not ready. Please scan QR code if needed or wait for connection.' });
    }
    if (!sheets) {
        return res.status(500).json({ error: 'Google Sheets API not initialized. Check server logs.' });
    }

    try {
        console.log('Fetching contacts from Google Sheet...'); // Removed SHEET_ID from log for brevity/security
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:B', // Columns: name, phone
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(404).json({ message: 'No contact data found in sheet or only header row present.' });
        }

        const dataRows = rows.slice(1);
        let messagesSent = 0;
        let errorsEncountered = [];

        console.log(`Found ${dataRows.length} contacts. Processing...`);

        for (const row of dataRows) {
            const name = row[0];
            let phone = row[1];
            const originalPhoneForError = String(phone);

            if (!name || !phone) {
                console.warn('Skipping row due to missing data (name or phone):', { name, phone: originalPhoneForError });
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: 'Missing name or phone' });
                continue;
            }

            phone = String(phone).replace(/[^0-9+]/g, '');
            if (phone.startsWith('+')) {
                phone = phone.substring(1);
            }
            if (phone.length === 10 && !phone.startsWith('91')) {
                phone = '91' + phone;
            }
            if (!phone.endsWith('@c.us')) {
                phone = `${phone}@c.us`;
            }

            const personalizedMessage = messageTemplate.replace(/{name}/g, name);

            try {
                console.log(`Attempting to send message to contact: ${name} (Phone: ${phone})`);
                await client.sendMessage(phone, personalizedMessage);
                messagesSent++;
                // Consider making delay configurable or slightly longer for larger lists
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 1000)); // 1-2.5 seconds delay
            } catch (err) {
                console.error(`Failed to send message to ${phone} (Original: ${originalPhoneForError}, Name: ${name}):`, err.message);
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: err.message });
            }
        }

        res.json({
            status: 'Completed',
            totalContactsInSheet: dataRows.length,
            messagesSuccessfullySent: messagesSent,
            errors: errorsEncountered
        });

    } catch (err) {
        console.error('Error processing /send-messages request:', err);
        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) { // Google API specific error
            console.error("Google API Error details:", err.response.data.error);
            res.status(500).json({ error: 'Failed to fetch data from Google Sheets.', details: err.response.data.error.message });
        } else {
            res.status(500).json({ error: 'An internal server error occurred.', details: err.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (!API_KEY) console.warn("CRITICAL WARNING: API_KEY is not set. The /send-messages endpoint is UNPROTECTED!");
    if (!SHEET_ID) console.warn("WARNING: SHEET_ID is not set. Google Sheets integration will fail!");
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn("WARNING: GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set. Google Sheets integration will fail!");
    if (!process.env.WA_SESSION_DIR && process.env.NODE_ENV === 'production') {
        console.warn("WARNING: WA_SESSION_DIR is not set in a production-like environment. WhatsApp sessions may not persist reliably.");
    }
});