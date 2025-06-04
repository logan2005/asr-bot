// netlify/functions/sendMessage.js
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    console.log("--- Netlify Function: sendMessage.js ---");
    console.log("Attempting to read RENDER_BACKEND_URL from process.env");

    let rawBackendUrlFromEnv = process.env.RENDER_BACKEND_URL;
    let apiKeyFromEnv = process.env.RENDER_API_KEY;

    console.log("Raw RENDER_BACKEND_URL from env:", rawBackendUrlFromEnv);
    console.log("Raw RENDER_API_KEY from env:", apiKeyFromEnv);

    if (!rawBackendUrlFromEnv || !apiKeyFromEnv) {
        console.error('CRITICAL: Missing RENDER_BACKEND_URL or RENDER_API_KEY from environment variables.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Backend URL or API Key not found in env.' }),
        };
    }

    // --- BEGIN PROTOCOL FIX ---
    let correctedBackendUrl = rawBackendUrlFromEnv;
    if (!correctedBackendUrl.startsWith('http://') && !correctedBackendUrl.startsWith('https://')) {
        console.warn(`RENDER_BACKEND_URL ("${rawBackendUrlFromEnv}") is missing protocol. Prepending "http://". Assumed for local development.`);
        correctedBackendUrl = 'http://' + correctedBackendUrl;
    }
    // --- END PROTOCOL FIX ---

    const RENDER_BACKEND_FULL_URL_WITH_PATH = `${correctedBackendUrl}/send-messages`;

    try {
        const { messageTemplate } = JSON.parse(event.body);
        if (!messageTemplate) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing messageTemplate in request body' }) };
        }

        console.log(`Forwarding request to Render backend with corrected URL: ${RENDER_BACKEND_FULL_URL_WITH_PATH}`);
        const response = await fetch(RENDER_BACKEND_FULL_URL_WITH_PATH, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKeyFromEnv,
            },
            body: JSON.stringify({ messageTemplate }),
        });

        const responseData = await response.json();
        console.log("Response status from Render backend:", response.status);
        console.log("Response data from Render backend:", responseData);

        return {
            statusCode: response.status,
            body: JSON.stringify(responseData),
            headers: { 'Content-Type': 'application/json' }
        };

    } catch (error) {
        console.error('Error in Netlify function during fetch or JSON processing:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error in Netlify function.', details: error.message, type: error.name }),
            headers: { 'Content-Type': 'application/json' }
        };
    }
};