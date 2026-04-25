import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const IS_DEV = process.env.NODE_ENV !== 'production';

// === MIDDLEWARE ===
app.use(cors({ 
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://127.0.0.1:3000'] 
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === AI CLIENT ===
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// === MODEL NORMALIZER ===
function normalizeModelName(rawName) {
  if (!rawName) return 'models/gemini-1.5-flash';
  let normalized = rawName.toLowerCase().replace(/\s+/g, '-').replace(/^models\//, '');
  
  const VALID_MODELS = [
    'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 
    'gemini-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-exp',
    'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ];
  
  if (!VALID_MODELS.includes(normalized)) {
    console.warn(`⚠️ Unknown model "${rawName}", falling back to gemini-2.5-flash-lite`);
    normalized = 'gemini-2.5-flash-lite';
  }
  return `models/${normalized}`;
}

const RAW_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_MODEL = normalizeModelName(RAW_MODEL);
const DISPLAY_MODEL = GEMINI_MODEL.replace('models/', '');

// === ROLE NORMALIZER (FIX UNTUK ERROR 'assistant') ===
function normalizeRole(role) {
  const map = {
    'user': 'user',
    'assistant': 'model',  // ← FIX: Gemini API pakai 'model', bukan 'assistant'
    'model': 'model',
  };
  return map[role?.toLowerCase()] || 'user';
}

// === SYSTEM PROMPT ===
const BANKING_SYSTEM_INSTRUCTION = `
Anda adalah "Cloud", asisten virtual resmi [Nama Bank].
TUGAS: Berikan info produk bank, bantu navigasi fitur, jelaskan syarat & ketentuan.
GUARDRAILS: Jangan minta data sensitif (PIN, OTP, password). Jangan eksekusi transaksi.
Gunakan bahasa formal dan jelas. Akhiri dengan "Apakah ada yang bisa saya bantu lagi?".
`.trim();

// === AUTH (DEV BYPASS) ===
const authenticateBankingUser = (req, res, next) => {
  if (IS_DEV) { req.userContext = { userId: 'dev-user' }; return next(); }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  req.userContext = { userId: 'masked' };
  next();
};

// === MOCK FALLBACK ===
function getMockResponse(userText) {
  const text = (userText || '').toLowerCase();
  const responses = {
    'saldo': 'Untuk cek saldo: 1) Mobile Banking → Menu Rekening 2) ATM → Cek Saldo 3) Internet Banking → Informasi Rekening.\n\nApakah ada yang bisa saya bantu lagi?',
    'transfer': 'Cara transfer: Transfer → Pilih tujuan → Masukkan jumlah → Konfirmasi. Pastikan nomor rekening benar.\n\nApakah ada yang bisa saya bantu lagi?',
    'tabungan': 'Produk tabungan: Silver (Rp100rb, 0.5%/th), Gold (Rp500rb, 1.5%/th), Platinum (Rp1jt, 2.5%/th).\n*Ini bukan saran finansial.*\n\nApakah ada yang bisa saya bantu lagi?',
    'default': 'Halo! Saya Cloud, asisten virtual bank. ☁️\nSaya bisa bantu: cek saldo, transfer, info produk, bayar tagihan.\n\nApakah ada yang bisa saya bantu lagi?'
  };
  for (const [key, val] of Object.entries(responses)) {
    if (text.includes(key)) return val;
  }
  return responses.default;
}

// === CHAT ENDPOINT ===
app.post('/api/chat', authenticateBankingUser, async (req, res) => {
  try {
    const { conversation } = req.body;
    
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return res.status(400).json({ error: 'Conversation must be a non-empty array' });
    }

    // ✅ FIX: Normalisasi role + text
    const contents = conversation.map(({ role, text }) => ({
      role: normalizeRole(role),  // ← 'assistant' → 'model'
      parts: [{ text: (text || '').trim() }],
    }));

    const config = {
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      systemInstruction: BANKING_SYSTEM_INSTRUCTION,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };

    console.log(`🤖 Calling: ${GEMINI_MODEL} | Messages: ${contents.length}`);
    
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config,
    });

    res.json({ result: response.text, model: DISPLAY_MODEL });

  } catch (error) {
    if (IS_DEV) console.error('❌ API Error:', error);
    
    // Handle role error (debug hint)
    if (error.code === 400 && error.message?.includes('Role')) {
      return res.status(400).json({
        error: 'Format percakapan tidak valid',
        ...(IS_DEV && { 
          debug: error.message,
          hint: "Role harus: 'user' atau 'model' (bukan 'assistant')",
        }),
      });
    }
    
    // Handle quota → fallback mock
    if (error.code === 429 || error.status === 'RESOURCE_EXHAUSTED') {
      console.log('⚠️ Quota exhausted → mock fallback');
      return res.json({
        result: getMockResponse(req.body.conversation?.[0]?.text),
        model: 'mock-fallback',
      });
    }
    
    if (error.code === 404) {
      return res.status(404).json({ error: `Model "${DISPLAY_MODEL}" tidak tersedia` });
    }

    res.status(error.code === 400 ? 400 : 500).json({ 
      error: error.code === 400 ? 'Permintaan tidak valid' : 'Terjadi gangguan sistem',
      ...(IS_DEV && { debug: error.message }),
    });
  }
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: DISPLAY_MODEL, env: process.env.NODE_ENV });
});

// === START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`☁️  Cloud Banking AI: http://localhost:${PORT}`);
  console.log(`📦 Model: ${DISPLAY_MODEL} | Env: ${IS_DEV ? 'DEV' : 'PROD'}`);
});