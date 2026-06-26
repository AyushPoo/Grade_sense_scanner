import express from 'express';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason 
} from '@whiskeysockets/baileys';
import { MongoClient } from 'mongodb';

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

// ==================== MONGO SESSION PERSISTENCE ====================
let mongoClient = null;
let mongoDb = null;

async function connectMongo() {
  if (mongoDb) return mongoDb;
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || 'gradesense_db';
  if (!mongoUrl) {
    console.log('MONGO_URL not set, skipping session persistence');
    return null;
  }
  try {
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    console.log(`Connected to MongoDB for WhatsApp session sync: ${dbName}`);
    return mongoDb;
  } catch (err) {
    console.error('Failed to connect to MongoDB for session sync:', err);
    return null;
  }
}

async function restoreSessionFromMongo() {
  const db = await connectMongo();
  if (!db) return;
  try {
    const sessionDoc = await db.collection('whatsapp_sessions').findOne({ _id: 'whatsapp_session' });
    if (sessionDoc && sessionDoc.files) {
      console.log(`Restoring WhatsApp session from MongoDB. Found ${sessionDoc.files.length} files.`);
      if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
      }
      for (const file of sessionDoc.files) {
        const filePath = path.join(SESSION_DIR, file.filename);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'));
      }
      console.log('WhatsApp session restored successfully.');
    } else {
      console.log('No WhatsApp session found in MongoDB.');
    }
  } catch (err) {
    console.error('Failed to restore WhatsApp session from MongoDB:', err);
  }
}

async function saveSessionToMongo() {
  const db = await connectMongo();
  if (!db) return;
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      return;
    }
    
    function getFilesRecursive(dir) {
      let results = [];
      if (!fs.existsSync(dir)) return results;
      const list = fs.readdirSync(dir);
      list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursive(filePath));
        } else {
          results.push(filePath);
        }
      });
      return results;
    }
    
    const filePaths = getFilesRecursive(SESSION_DIR);
    const files = filePaths.map(filePath => {
      const relativePath = path.relative(SESSION_DIR, filePath);
      const content = fs.readFileSync(filePath).toString('base64');
      return { filename: relativePath, content };
    });
    
    await db.collection('whatsapp_sessions').updateOne(
      { _id: 'whatsapp_session' },
      { $set: { files, updatedAt: new Date() } },
      { upsert: true }
    );
    console.log(`Saved WhatsApp session to MongoDB. Uploaded ${files.length} files.`);
  } catch (err) {
    console.error('Failed to save WhatsApp session to MongoDB:', err);
  }
}

let saveTimeout = null;
function debouncedSaveSession() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveSessionToMongo();
  }, 1500);
}

async function deleteSessionFromMongo() {
  const db = await connectMongo();
  if (!db) return;
  try {
    await db.collection('whatsapp_sessions').deleteOne({ _id: 'whatsapp_session' });
    console.log('Deleted WhatsApp session from MongoDB.');
  } catch (err) {
    console.error('Failed to delete WhatsApp session from MongoDB:', err);
  }
}
// ==================== MONGO SESSION PERSISTENCE END ====================

async function initWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger,
    browser: ['Mac OS', 'Chrome', '121.0.0']
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    debouncedSaveSession();
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
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
        setTimeout(initWhatsApp, 3000);
      } else {
        console.log('Logged out of WhatsApp. Cleaning up session files.');
        try {
          fs.rmSync(SESSION_DIR, { recursive: true, force: true });
          await deleteSessionFromMongo();
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
      // Sync initial state after successfully opening connection
      debouncedSaveSession();
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
  
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
    console.log(`Auto-prepended Indian country code 91 for pairing: ${cleanPhone}`);
  }
  if (!cleanPhone) {
    return res.status(400).json({ error: 'invalid phone number format' });
  }

  try {
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

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
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
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    await deleteSessionFromMongo();
    res.json({ success: true, message: 'Successfully logged out and cleared session.' });
  } catch (err) {
    console.error('Error during logout:', err);
    res.status(500).json({ error: `Logout failed: ${err.message}` });
  }
});

// Start express server and Whatsapp client
app.listen(PORT, '127.0.0.1', async () => {
  console.log(`WhatsApp controller listening on http://127.0.0.1:${PORT}`);
  await restoreSessionFromMongo();
  initWhatsApp();
});
