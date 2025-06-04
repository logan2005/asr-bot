require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Configure CORS for your Netlify frontend URL for better security
// const allowedOrigins = ['YOUR_NETLIFY_APP_URL_HERE', 'http://localhost:3000', 'http://localhost:8888']; // Add localhost for React dev and Netlify dev
// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin) return callback(null, true); // Allow requests with no origin (like curl/Postman)
//     if (allowedOrigins.indexOf(origin) === -1) {
//       const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
//       return callback(new Error(msg), false);
//     }
//     return callback(null, true);
//   }
// }));
app.use(cors()); // For simplicity in this example, allow all. Restrict in production.


const PORT = process.env.PORT || 3001; // Changed default to 3001 to avoid common React dev port
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
}

// --- WhatsApp Client Setup ---
const SESSION_FILE_PATH_BASE = process.env.WA_SESSION_DIR || './wa_sessions';
console.log(`WhatsApp session data will be stored in directory: ${SESSION_FILE_PATH_BASE}`);
const SESSION_DATA_PATH_FOR_CLIENT = path.join(SESSION_FILE_PATH_BASE, 'my_bot_session');
HTMLFormControlsCollection.log(`Specific sessoin data path for LocalAuth: $(SESSION_DATA_PATH_FOR_CLIENT)`);
//if (!fs.existsSync(SESSION_FILE_PATH_BASE)) {
//    console.log(`Creating session directory: ${SESSION_FILE_PATH_BASE}`);
  //  fs.mkdirSync(SESSION_FILE_PATH_BASE, { recursive: true });
//}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DATA_PATH_FOR_CLIENT }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            // '--single-process', // Can cause issues on some systems
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

client.initialize().catch(err => console.error("Error initializing WhatsApp client:", err));

// --- API Key Middleware ---
const apiKeyAuth = (req, res, next) => {
    const receivedApiKey = req.headers['x-api-key'];
    if (receivedApiKey && receivedApiKey === API_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Missing or invalid API Key' });
    }
};

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send('WhatsApp Bot Backend is running. Use the POST /send-messages endpoint with an API Key and messageTemplate.');
});

app.post('/send-messages', apiKeyAuth, async (req, res) => {
    const { messageTemplate } = req.body; // Get messageTemplate from request body

    if (!messageTemplate) {
        return res.status(400).json({ error: 'Missing messageTemplate in request body.' });
    }

    if (!client.info) {
        return res.status(503).json({ error: 'WhatsApp client not ready. Scan QR code if needed.' });
    }
    if (!sheets) {
        return res.status(500).json({ error: 'Google Sheets API not initialized. Check server logs.' });
    }

    try {
        console.log('Fetching contacts from Google Sheet ID:');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:B', // Columns: name, phone
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) { // <=1 to account for header row
            return res.status(404).json({ message: 'No contact data found in sheet or only header row present.' });
        }

        const dataRows = rows.slice(1); // Skip header
        let messagesSent = 0;
        let errorsEncountered = []; // Renamed for clarity

        console.log(`Found ${dataRows.length} contacts. Processing...`);

                for (const row of dataRows) {
            const name = row[0];
            let phone = row[1]; // Phone number from the sheet
            const originalPhoneForError = phone; // Keep original for error logging

            if (!name || !phone) {
                console.warn('Skipping row due to missing name or phone:', row);
                errorsEncountered.push({ contact: {name, phone: originalPhoneForError}, error: 'Missing name or phone' });
                continue;
            }

            // 1. Convert to string and clean: Allow only digits and '+' initially
            phone = String(phone).replace(/[^0-9+]/g, '');

            // 2. If it starts with '+', remove it for easier processing of '91'
            if (phone.startsWith('+')) {
                phone = phone.substring(1); // e.g., +91987... becomes 91987...
            }
            // Now phone contains only digits, e.g., "917010663166" or "7010663166"

            // 3. Prepend '91' if it's a 10-digit number and doesn't already start with '91'
            if (phone.length === 10 && !phone.startsWith('91')) {
                phone = '91' + phone; // e.g., 7010663166 becomes 917010663166
            }
            // Now phone should be like "91xxxxxxxxxx" or "xxxxxxxxxx" if it wasn't a 10-digit Indian number

            // 4. Append @c.us - THIS IS THE CRUCIAL MISSING STEP
            if (!phone.endsWith('@c.us')) {
                phone = `${phone}@c.us`;
            }
            // Now phone is like "917010663166@c.us"

            const personalizedMessage = messageTemplate.replace(/{name}/g, name);

            try {
                console.log(`Sending...`);
                await client.sendMessage(phone, personalizedMessage); // `phone` now includes @c.us
                messagesSent++;
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 500));
            } catch (err) {
                console.error(`Failed to send message to ${phone} (original sheet value: ${originalPhoneForError}, contact name: ${name}):`, err.message);
                errorsEncountered.push({ contact: {name, phone: originalPhoneForError}, error: err.message });
            }
        }

        res.json({
            message: 'Message sending process completed.',
            totalContactsInSheet: dataRows.length,
            messagesSuccessfullySent: messagesSent,
            errors: errorsEncountered
        });

    } catch (err) {
        console.error('Error processing /send-messages:', err);
        if (err.response && err.response.data && err.response.data.error) {
            console.error("Google API Error:", err.response.data.error);
            res.status(500).json({ error: 'Failed to fetch data from Google Sheets.', details: err.response.data.error.message });
        } else {
            res.status(500).json({ error: 'An internal error occurred on the backend.', details: err.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    //if (!API_KEY) console.warn("Warning: API_KEY is not set. The /send-messages endpoint is unprotected!");
    //if (!SHEET_ID) console.warn("Warning: SHEET_ID is not set. Google Sheets integration will fail!");
    //if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn("Warning: GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set. Google Sheets integration will fail!");
});