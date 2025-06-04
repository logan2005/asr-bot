require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Required for local fallback directory creation
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Consider restricting this in production

const PORT = process.env.PORT || 3001;
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;

// --- Google Sheets Setup ---
let sheets;
try {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is not set.");
    const decodedCredentials = Buffer.from(credentialsBase64, 'base64').toString('ascii');
    const credentials = JSON.parse(decodedCredentials);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
    console.error('Failed to initialize Google Sheets API:', error.message);
}

// --- WhatsApp Client Setup (Option A) ---
const effectiveDataPath = process.env.WA_SESSION_DIR || './wa_sessions_local_fallback';
console.log(`LocalAuth will use dataPath: ${effectiveDataPath} and clientId: 'main_session'`);

// For local development fallback directory creation
if (!process.env.WA_SESSION_DIR && !fs.existsSync(effectiveDataPath)) {
    console.log(`Local fallback: Creating base session directory: ${effectiveDataPath}`);
    try {
        fs.mkdirSync(effectiveDataPath, { recursive: true });
        console.log(`Successfully created local fallback base directory: ${effectiveDataPath}`);
    } catch (mkdirErr) {
        console.error(`Failed to create local fallback base directory ${effectiveDataPath}:`, mkdirErr);
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: effectiveDataPath,
        clientId: 'main_session' // LocalAuth will attempt to create a 'main_session' folder inside dataPath
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

client.on('qr', qr => { qrcode.generate(qr, { small: true }); console.log('Scan QR to connect.'); });
client.on('ready', () => { console.log('WhatsApp client is ready!'); });
client.on('authenticated', () => { console.log('WhatsApp client authenticated!'); });
client.on('auth_failure', msg => { console.error('WhatsApp authentication failure:', msg); });
client.on('disconnected', (reason) => { console.log('WhatsApp client was logged out:', reason); });
client.initialize().catch(err => { console.error("Error initializing WhatsApp client:", err); });

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
    res.send('WhatsApp Bot Backend is running. Use POST /send-messages with API Key and messageTemplate.');
});

app.post('/send-messages', apiKeyAuth, async (req, res) => {
    const { messageTemplate } = req.body;

    if (!messageTemplate) return res.status(400).json({ error: 'Missing messageTemplate in request body.' });
    if (messageTemplate.length > 2000) return res.status(400).json({ error: 'Message template is too long (max 2000 chars).' });
    if (!client.info) return res.status(503).json({ error: 'WhatsApp client not ready.' });
    if (!sheets) return res.status(500).json({ error: 'Google Sheets API not initialized.' });

    try {
        console.log('Fetching contacts from Google Sheet...');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:B',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return res.status(404).json({ message: 'No contact data found in sheet.' });

        const dataRows = rows.slice(1);
        let messagesSent = 0;
        let errorsEncountered = [];
        console.log(`Found ${dataRows.length} contacts. Processing...`);

        for (const row of dataRows) {
            const name = row[0];
            let phone = row[1];
            const originalPhoneForError = String(phone);

            if (!name || !phone) {
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: 'Missing name or phone' });
                continue;
            }

            phone = String(phone).replace(/[^0-9+]/g, '');
            if (phone.startsWith('+')) phone = phone.substring(1);
            if (phone.length === 10 && !phone.startsWith('91')) phone = '91' + phone;
            if (!phone.endsWith('@c.us')) phone = `${phone}@c.us`;

            const personalizedMessage = messageTemplate.replace(/{name}/g, name);

            try {
                console.log(`Attempting to send to: ${name} (${phone})`);
                await client.sendMessage(phone, personalizedMessage);
                messagesSent++;
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 1000));
            } catch (err) {
                console.error(`Failed to send to ${phone} (Name: ${name}):`, err.message);
                errorsEncountered.push({ contact: { name, phone: originalPhoneForError }, error: err.message });
            }
        }
        res.json({ status: 'Completed', totalContactsInSheet: dataRows.length, messagesSuccessfullySent: messagesSent, errors: errorsEncountered });
    } catch (err) {
        console.error('Error in /send-messages:', err);
        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
            res.status(500).json({ error: 'Google Sheets API error.', details: err.response.data.error.message });
        } else {
            res.status(500).json({ error: 'Internal server error.', details: err.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (!API_KEY) console.warn("CRITICAL WARNING: API_KEY not set!");
    if (!SHEET_ID) console.warn("WARNING: SHEET_ID not set!");
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn("WARNING: GOOGLE_APPLICATION_CREDENTIALS_BASE64 not set!");
    if (!process.env.WA_SESSION_DIR && process.env.NODE_ENV === 'production') console.warn("WARNING: WA_SESSION_DIR not set in production!");
});