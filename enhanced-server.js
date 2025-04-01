// Enhanced server with Supabase, OpenAI, and Twilio functionality
// This server is designed to be more resilient for Cloud Run deployment

// Import required modules
const http = require('http');
const https = require('https');
const url = require('url');
const { Buffer } = require('buffer');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

// Environment variables
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;

// Log environment variable status
console.log('Environment variables:');
console.log(`- PORT: ${PORT}`);
console.log(`- OPENAI_API_KEY: ${OPENAI_API_KEY ? 'Set' : 'Not set'}`);
console.log(`- TWILIO_ACCOUNT_SID: ${TWILIO_ACCOUNT_SID ? 'Set' : 'Not set'}`);
console.log(`- TWILIO_AUTH_TOKEN: ${TWILIO_AUTH_TOKEN ? 'Set' : 'Not set'}`);
console.log(`- TWILIO_PHONE_NUMBER: ${TWILIO_PHONE_NUMBER ? 'Set' : 'Not set'}`);
console.log(`- SUPABASE_URL: ${SUPABASE_URL ? 'Set' : 'Not set'}`);
console.log(`- SUPABASE_API_KEY: ${SUPABASE_API_KEY ? 'Set' : 'Not set'}`);

// Helper function to make HTTP requests
async function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: parsedData });
        } catch (error) {
          resolve({ statusCode: res.statusCode, data: responseData });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Supabase functions
async function getOrCreateConversation(phoneNumber, name = '') {
  if (!SUPABASE_URL || !SUPABASE_API_KEY) {
    console.warn('Supabase credentials not set, returning mock conversation');
    return { id: 'mock-id', phone_number: phoneNumber, name: name || null };
  }
  
  try {
    // First try to get existing conversation
    const getOptions = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: `/rest/v1/conversations?phone_number=eq.${encodeURIComponent(phoneNumber)}&order=created_at.desc&limit=1`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_API_KEY,
        'Authorization': `Bearer ${SUPABASE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const { statusCode, data } = await makeRequest(getOptions);
    
    if (statusCode === 200 && Array.isArray(data) && data.length > 0) {
      console.log('Found existing conversation:', data[0]);
      return data[0];
    }
    
    // If not found, create a new conversation
    const createOptions = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: '/rest/v1/conversations',
      method: 'POST',
      headers: {
        'apikey': SUPABASE_API_KEY,
        'Authorization': `Bearer ${SUPABASE_API_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    
    const createData = JSON.stringify({
      phone_number: phoneNumber,
      name: name || null
    });
    
    const createResult = await makeRequest(createOptions, createData);
    
    if (createResult.statusCode === 201 && Array.isArray(createResult.data) && createResult.data.length > 0) {
      console.log('Created new conversation:', createResult.data[0]);
      return createResult.data[0];
    }
    
    throw new Error(`Failed to create conversation: ${JSON.stringify(createResult)}`);
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return { id: 'error-id', phone_number: phoneNumber, name: name || null };
  }
}

async function storeMessage(conversationId, sender, content) {
  if (!SUPABASE_URL || !SUPABASE_API_KEY) {
    console.warn('Supabase credentials not set, skipping message storage');
    return { id: 'mock-message-id', conversation_id: conversationId, sender, content };
  }
  
  try {
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: '/rest/v1/messages',
      method: 'POST',
      headers: {
        'apikey': SUPABASE_API_KEY,
        'Authorization': `Bearer ${SUPABASE_API_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    
    const messageData = JSON.stringify({
      conversation_id: conversationId,
      sender,
      content
    });
    
    const { statusCode, data } = await makeRequest(options, messageData);
    
    if (statusCode === 201 && Array.isArray(data) && data.length > 0) {
      console.log('Stored message:', data[0]);
      
      // Update conversation's updated_at timestamp
      const updateOptions = {
        hostname: new URL(SUPABASE_URL).hostname,
        path: `/rest/v1/conversations?id=eq.${conversationId}`,
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_API_KEY,
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      };
      
      const updateData = JSON.stringify({
        updated_at: new Date().toISOString()
      });
      
      await makeRequest(updateOptions, updateData);
      
      return data[0];
    }
    
    throw new Error(`Failed to store message: ${JSON.stringify(data)}`);
  } catch (error) {
    console.error('Error in storeMessage:', error);
    return { id: 'error-message-id', conversation_id: conversationId, sender, content };
  }
}

// OpenAI API function
async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not set, returning mock response');
    return { content: 'This is a mock response because the OpenAI API key is not set.' };
  }
  
  try {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const data = JSON.stringify({
      model: "gpt-4o",
      messages
    });
    
    const { statusCode, data: responseData } = await makeRequest(options, data);
    
    if (statusCode === 200 && responseData.choices && responseData.choices.length > 0) {
      return responseData.choices[0].message;
    }
    
    throw new Error(`OpenAI API error: ${JSON.stringify(responseData)}`);
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    return { content: 'Sorry, there was an error generating a response.' };
  }
}

// Twilio API function
async function sendSMS(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn('Twilio credentials not set, skipping SMS sending');
    return { success: false, message: 'Twilio credentials not set' };
  }
  
  try {
    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };
    
    const formData = querystring.stringify({
      'To': to,
      'From': TWILIO_PHONE_NUMBER,
      'Body': body
    });
    
    const { statusCode, data } = await makeRequest(options, formData);
    
    if (statusCode === 201) {
      console.log('SMS sent successfully:', data);
      return { success: true, data };
    }
    
    throw new Error(`Failed to send SMS: ${JSON.stringify(data)}`);
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

// Handle /check-leads endpoint
async function handleCheckLeads(req, res) {
  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    console.log('Received /check-leads request body:', body);
    
    try {
      // Parse the request body
      const data = JSON.parse(body);
      
      // Validate the request format
      if (!data.leads || !Array.isArray(data.leads)) {
        throw new Error('Invalid request format: expected "leads" array');
      }
      
      const results = [];
      
      // Process each lead
      for (const lead of data.leads) {
        try {
          let phoneNumber = lead.phoneNumber;
          const name = lead.name || '';
          
          // Format phone number for Twilio (ensure it starts with +)
          if (phoneNumber && !phoneNumber.startsWith('+')) {
            phoneNumber = '+' + phoneNumber.replace(/\D/g, '');
          }
          
          // Skip invalid phone numbers
          if (!phoneNumber || phoneNumber.length < 10) {
            console.warn(`Skipping invalid phone number: ${phoneNumber}`);
            results.push({
              phoneNumber,
              name,
              success: false,
              message: 'Invalid phone number'
            });
            continue;
          }
          
          // Get or create conversation in Supabase
          const conversation = await getOrCreateConversation(phoneNumber, name);
          
          // Make ChatGPT API call for initial outreach
          const aiMessage = await callOpenAI([
            {
              role: "system",
              content: "You are an AI assistant for Barts Automotive. Your task is to initiate contact with potential leads. Keep the message professional, friendly, and focused on automotive services."
            },
            {
              role: "user",
              content: `Create an initial outreach message for ${name}. Mention Barts Automotive and ask about their automotive needs.`
            }
          ]);
          
          const aiResponse = aiMessage.content;
          
          // Store AI message in Supabase
          await storeMessage(conversation.id, 'assistant', aiResponse);
          
          // Send SMS using Twilio
          const smsResult = await sendSMS(phoneNumber, aiResponse);
          
          results.push({
            phoneNumber,
            name,
            message: aiResponse,
            success: smsResult.success
          });
        } catch (leadError) {
          console.error(`Error processing lead ${lead.name}:`, leadError);
          results.push({
            phoneNumber: lead.phoneNumber,
            name: lead.name,
            success: false,
            error: leadError.message
          });
        }
      }
      
      // Send the response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: "Outreach messages processed",
        results
      }));
    } catch (error) {
      console.error('Error in /check-leads:', error);
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      }));
    }
  });
}

// Handle /sms endpoint
async function handleSMS(req, res) {
  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    console.log('Received /sms request body:', body);
    
    try {
      // Parse the form data
      const formData = querystring.parse(body);
      const userMessage = formData.Body;
      const userPhone = formData.From;
      
      if (!userMessage || !userPhone) {
        throw new Error('Missing Body or From in SMS request');
      }
      
      // Get or create conversation in Supabase
      const conversation = await getOrCreateConversation(userPhone);
      
      // Store user message in Supabase
      await storeMessage(conversation.id, 'user', userMessage);
      
      // Make ChatGPT API call
      const aiMessage = await callOpenAI([
        {
          role: "system",
          content: "You are an AI receptionist for Barts Automotive. Your job is to politely engage with the client and obtain their name, availability, and service/work required. Keep responses concise as this is SMS."
        },
        {
          role: "user",
          content: userMessage
        }
      ]);
      
      const aiResponse = aiMessage.content;
      
      // Store AI message in Supabase
      await storeMessage(conversation.id, 'assistant', aiResponse);
      
      // Send SMS reply using Twilio
      await sendSMS(userPhone, aiResponse);
      
      // Send response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error('Error in /sms:', error);
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      }));
    }
  });
}

// Create the server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  console.log(`Received request: ${req.method} ${pathname}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS requests (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Basic routing
  if (pathname === '/' || pathname === '/index.html') {
    // Serve the home page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head>
          <title>Barts Automotive Assistant</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            h1 { color: #333; }
            .container { max-width: 800px; margin: 0 auto; }
            .success { color: green; font-weight: bold; }
            .info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            .endpoint { background: #e9f7fe; padding: 15px; border-radius: 5px; margin-bottom: 10px; }
            .endpoint h3 { margin-top: 0; }
            code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Barts Automotive Assistant</h1>
            <p class="success">✅ Server is running successfully!</p>
            
            <div class="info">
              <p><strong>Environment:</strong></p>
              <ul>
                <li>PORT: ${PORT}</li>
                <li>OpenAI API: ${OPENAI_API_KEY ? 'Configured' : 'Not configured'}</li>
                <li>Twilio: ${(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) ? 'Configured' : 'Not configured'}</li>
                <li>Supabase: ${(SUPABASE_URL && SUPABASE_API_KEY) ? 'Configured' : 'Not configured'}</li>
                <li>Server started at: ${new Date().toISOString()}</li>
              </ul>
            </div>
            
            <h2>Available Endpoints:</h2>
            
            <div class="endpoint">
              <h3>1. /check-leads</h3>
              <p>Send leads data to initiate outreach via SMS.</p>
              <p><strong>Method:</strong> POST</p>
              <p><strong>Content-Type:</strong> application/json</p>
              <p><strong>Request Format:</strong></p>
              <pre><code>{
  "leads": [
    {
      "phoneNumber": "+15551234567",
      "name": "John Doe"
    }
  ]
}</code></pre>
            </div>
            
            <div class="endpoint">
              <h3>2. /sms</h3>
              <p>Webhook for handling incoming SMS messages from Twilio.</p>
              <p><strong>Method:</strong> POST</p>
              <p><strong>Content-Type:</strong> application/x-www-form-urlencoded</p>
              <p><strong>Parameters:</strong> Body (message content), From (sender phone number)</p>
            </div>
          </div>
        </body>
      </html>
    `);
  } else if (pathname === '/check-leads' && req.method === 'POST') {
    // Handle check-leads endpoint
    handleCheckLeads(req, res);
  } else if (pathname === '/sms' && req.method === 'POST') {
    // Handle SMS webhook
    handleSMS(req, res);
  } else {
    // Handle 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Not Found',
      message: `The requested URL ${pathname} was not found on this server.`
    }));
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Environment variables: PORT=${PORT}`);
  console.log('Server is ready to handle requests');
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Keep the process running
});

console.log('Enhanced server script loaded');
