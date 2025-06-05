// BOT/react-whatsapp-ui/netlify/functions/getQrStatus.js

const fetch = require('node-fetch'); // Ensure node-fetch@2 is installed for CommonJS require

exports.handler = async function(event, context) {
    // Log invocation for easier debugging in Netlify function logs
    console.log(`Netlify Function 'getQrStatus' invoked. HTTP Method: ${event.httpMethod}`);

    if (event.httpMethod !== 'GET') {
        console.warn("Netlify Function 'getQrStatus': Method Not Allowed.");
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'GET' }
        };
    }

    // Attempt to get the backend URL and API key from environment variables
    // Adjust if you used REACT_APP_ prefixes for your environment variables
    let rawRenderBackendUrl = process.env.RENDER_BACKEND_URL;
    const renderApiKey = process.env.RENDER_API_KEY;

    // Log what was initially retrieved from environment variables
    console.log(`Netlify Function 'getQrStatus': Raw RENDER_BACKEND_URL from env: "${rawRenderBackendUrl}"`);
    console.log(`Netlify Function 'getQrStatus': RENDER_API_KEY from env is ${renderApiKey ? '"SET"' : '"NOT SET"'}`);


    if (!rawRenderBackendUrl || !renderApiKey) {
        const errorMsg = 'Netlify Function Error: Missing RENDER_BACKEND_URL or RENDER_API_KEY environment variables.';
        console.error(errorMsg);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing backend credentials for Netlify function.' })
        };
    }

    // --- WORKAROUND: Ensure the URL has a protocol ---
    let correctedRenderBackendUrl = String(rawRenderBackendUrl).trim(); // Trim whitespace just in case

    if (!correctedRenderBackendUrl.startsWith('http://') && !correctedRenderBackendUrl.startsWith('https://')) {
        // If testing locally against a local backend (e.g., localhost:3001), it's usually http.
        // If testing against a deployed Render service, it should already have https.
        // This primarily targets the local dev scenario where http:// might be stripped or missing.
        console.warn(`Netlify Function 'getQrStatus': RENDER_BACKEND_URL ("${rawRenderBackendUrl}") was missing protocol. Prepending "http://" for local dev assumption.`);
        correctedRenderBackendUrl = 'http://' + correctedRenderBackendUrl;
    }
    // --- END WORKAROUND ---

    const targetUrl = `${correctedRenderBackendUrl}/get-qr-status`;
    console.log(`Netlify Function 'getQrStatus': Attempting to fetch from corrected URL: ${targetUrl}`);

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'x-api-key': renderApiKey,
                'Accept': 'application/json' // Good practice to specify accept header
            },
            timeout: 8000 // Optional: set a timeout for the fetch call (e.g., 8 seconds)
        });

        console.log(`Netlify Function 'getQrStatus': Received status ${response.status} from backend for ${targetUrl}`);

        // Try to parse JSON regardless of status for more detailed error from backend
        let responseBody;
        const contentType = response.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
            try {
                responseBody = await response.json();
            } catch (jsonError) {
                console.error(`Netlify Function 'getQrStatus': Failed to parse JSON response from backend, though Content-Type was JSON. Status: ${response.status}. Error:`, jsonError);
                // Try to get text if JSON parsing failed
                const textResponseFallback = await response.text().catch(() => "Could not read text fallback.");
                responseBody = { error: 'Invalid JSON response from backend.', details: jsonError.message, rawText: textResponseFallback.substring(0, 200) };
                // Return the original status from backend, but with our parsing error message
                return {
                    statusCode: response.status, 
                    body: JSON.stringify(responseBody)
                };
            }
        } else {
            // If not JSON, get raw text
            responseBody = await response.text();
            console.warn(`Netlify Function 'getQrStatus': Backend response was not JSON (Content-Type: ${contentType}). Status: ${response.status}. Body: ${String(responseBody).substring(0, 200)}...`);
            // If the status was OK but not JSON, it's still an issue for the frontend expecting JSON.
            // If status was not OK, forward it with the text body.
            const errorPayload = { error: 'Unexpected response format from backend.', details: `Backend status: ${response.status}. Content-Type: ${contentType}.`, rawResponse: String(responseBody).substring(0,200) };
            return {
                statusCode: response.ok ? 502 : response.status, // If it was 200 but not JSON, treat as Bad Gateway
                body: JSON.stringify(response.ok ? errorPayload : responseBody) // If not ok, body might be useful text
            };
        }
        
        return {
            statusCode: response.status, // Forward the backend's status
            body: JSON.stringify(responseBody)   // Forward the backend's (parsed) JSON body
        };

    } catch (error) {
        console.error(`Netlify Function 'getQrStatus': Error during fetch to Render backend: Name: ${error.name}, Message: ${error.message}`);
        // Log more details for common fetch errors
        if (error.code) console.error(`Error code: ${error.code}`);
        if (error.errno) console.error(`Error errno: ${error.errno}`);
        if (error.syscall) console.error(`Error syscall: ${error.syscall}`);
        
        return {
            statusCode: 503, // Service Unavailable (couldn't reach backend) or 500 Internal Server Error
            body: JSON.stringify({ error: 'Failed to connect to backend service.', details: error.message, type: error.name })
        };
    }
};