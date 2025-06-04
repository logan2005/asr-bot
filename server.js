require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;

// --- Google Sheets Setup ---
let sheets;
try {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_BASE64 env var not set.");
    const decodedCredentials = Buffer.from(credentialsBase64, 'base64').toString('ascii');
    const credentials = JSON.parse(decodedCredentials);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
    console.error('Failed to initialize Google Sheets API:', error.message);
}

// --- WhatsApp Client Setup for Render Free Tier (Ephemeral Session) ---
// Sessions will NOT persist across deploys/restarts on Render free tier.
// LocalAuth will attempt to write to a local directory.
const sessionDataPath = './wa_ephemeral_session'; // Relative path, will be in the app's ephemeral storage
console.log(`WhatsApp session (ephemeral) will be attempted at: ${path.resolve(sessionDataPath)}`);

// Attempt to create this directory if it doesn't exist.
// This should work on the ephemeral filesystem.
if (!fs.existsSync(sessionDataPath)) {
    console.log(`Creating ephemeral session directory: ${sessionDataPath}`);
    try {
        fs.mkdirSync(sessionDataPath, { recursive: true });
        console.log(`Successfully created ephemeral session directory: ${sessionDataPath}`);
    } catch (mkdirErr) {
        // If this fails, LocalAuth will also likely fail.
        console.error(`Failed to create ephemeral session directory ${sessionDataPath}:`, mkdirErr);
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: sessionDataPath // Use the local ephemeral path
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
            '--disable-gpu',
            '--disable-software-rasterizer', // Might help in resource-constrained envs
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-popup-blocking',
            '--disable-hang-monitor',
            '--disable-client-side-phishing-detection',
            '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-pings'
        ],
        // executablePath: '/usr/bin/google-chrome-stable' // Only if you install Chrome separately, Render's Node env might have Chromium
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// ... (rest of your client event handlers, API middleware, routes, app.listen are the same) ...
// (Make sure they are included below this block)

client.on('qr', qr => { qrcode.generate(qr, { small: true }); console.log('Scan QR to connect. Session will be lost on restart/redeploy.'); });
client.on('ready', () => { console.log('WhatsApp client is ready! (Ephemeral session)'); });
client.on('authenticated', () => { console.log('WhatsApp client authenticated! (Ephemeral session)'); });
client.on('auth_failure', msg => { console.error('WhatsApp authentication failure:', msg); });
client.on('disconnected', (reason) => { console.log('WhatsApp client was logged out:', reason); });
client.initialize().catch(err => { console.error("Error initializing WhatsApp client (ephemeral session):", err); });

const apiKeyAuth = (req, res, next) => {
    const receivedApiKey = req.headers['x-api-key'];
    if (API_KEY && receivedApiKey && receivedApiKey === API_KEY) {
        next();
    } else {
        if (!API_KEY) console.warn("API_KEY is not set on the server. Endpoint is effectively unprotected.");
        res.status(401).json({ error: 'Unauthorized: Missing or invalid API Key' });
    }
};

app.get('/', (req, res) => {
    res.send('WhatsApp Bot Backend is running (Ephemeral Session). Use POST /send-messages with API Key and messageTemplate.');
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
    console.log(`Server running on port ${PORT} (Ephemeral WhatsApp Session)`);
    if (!API_KEY) console.warn("CRITICAL WARNING: API_KEY not set!");
    if (!SHEET_ID) console.warn("WARNING: SHEET_ID not set!");
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn("WARNING: GOOGLE_APPLICATION_CREDENTIALS_BASE64 not set!");
    // No longer need to warn about WA_SESSION_DIR in production if we accept ephemeral sessions
});