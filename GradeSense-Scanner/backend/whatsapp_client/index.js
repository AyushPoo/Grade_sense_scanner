import express from 'express';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pkg from '@whiskeysockets/baileys';
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason 
} = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.WHATSAPP_PORT || 8001;
const SESSION_DIR = path.join(__dirname, 'session');

// State
let sock = null;
let currentQr = null;
let connectionStatus = 'disconnected'; // 'connecting', 'connected', 'disconnected'
let pairingCode = null;

const logger = pino({ level: 'info' });

async function initWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      // Save QR code as base64 data URL
      try {
        currentQr = await QRCode.toDataURL(qr);
      } catch (err) {
        console.error('Failed to convert QR to DataURL:', err);
      }
      connectionStatus = 'disconnected';
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      connectionStatus = 'disconnected';
      currentQr = null;
      pairingCode = null;
      
      if (shouldReconnect) {
        // Re-initialize socket
        setTimeout(initWhatsApp, 3000);
      } else {
        // Logged out - clean up directory and start clean
        console.log('Logged out of WhatsApp. Cleaning up session files.');
        try {
          fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        } catch (err) {
          console.error('Failed to clean session folder:', err);
        }
        setTimeout(initWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection is open and active.');
      connectionStatus = 'connected';
      currentQr = null;
      pairingCode = null;
    } else if (connection === 'connecting') {
      connectionStatus = 'connecting';
    }
  });
}

// Routes
app.get('/status', (req, res) => {
  res.json({ status: connectionStatus });
});

app.get('/qr', (req, res) => {
  if (connectionStatus === 'connected') {
    return res.json({ status: 'connected' });
  }
  if (!currentQr) {
    return res.json({ status: 'connecting', message: 'QR code not ready yet.' });
  }
  res.json({ status: 'disconnected', qr: currentQr });
});

app.get('/pair-code', async (req, res) => {
  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'phone query parameter required' });
  }
  if (connectionStatus === 'connected') {
    return res.json({ status: 'connected' });
  }
  
  // Format phone: strip plus signs and make sure it has country code
  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone) {
    return res.status(400).json({ error: 'invalid phone number format' });
  }

  try {
    // Request pairing code from WhatsApp servers
    pairingCode = await sock.requestPairingCode(cleanPhone);
    res.json({ status: 'disconnected', code: pairingCode });
  } catch (err) {
    console.error('Failed to request pairing code:', err);
    res.status(500).json({ error: 'Failed to request pairing code from WhatsApp' });
  }
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message fields required' });
  }
  if (connectionStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp client is not connected' });
  }

  // Format to WhatsApp JID format: e.g. 919876543210@s.whatsapp.net
  let cleanPhone = phone.replace(/\D/g, '');
  const jid = `${cleanPhone}@s.whatsapp.net`;

  try {
    const result = await sock.sendMessage(jid, { text: message });
    res.json({ success: true, result });
  } catch (err) {
    console.error(`Failed to send message to ${phone}:`, err);
    res.status(500).json({ error: `Failed to send message: ${err.message}` });
  }
});

app.post('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
    // Clean up session folder
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    res.json({ success: true, message: 'Successfully logged out and cleared session.' });
  } catch (err) {
    console.error('Error during logout:', err);
    res.status(500).json({ error: `Logout failed: ${err.message}` });
  }
});

// Start express server and Whatsapp client
app.listen(PORT, '127.0.0.1', () => {
  console.log(`WhatsApp controller listening on http://127.0.0.1:${PORT}`);
  initWhatsApp();
});
