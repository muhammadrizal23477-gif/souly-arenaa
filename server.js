// Server kecil untuk Souly Arena.
// Tugasnya cuma dua:
// 1. Menyajikan file index.html (dan aset statis lain) ke pengunjung.
// 2. Menerima pesan chat dari browser di /api/chat, lalu meneruskannya ke
//    Groq (API AI gratis) memakai API key yang disimpan aman di server
//    (environment variable), BUKAN di browser pengguna.
//
// Karena key-nya ada di server, pengguna app tidak perlu (dan tidak bisa)
// melihat atau memasukkan API key apa pun. Semua orang otomatis bisa pakai
// Chat AI begitu situsnya dibuka.

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server belum diatur: GROQ_API_KEY belum di-set di environment variable.' });
  }

  const clientMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Batasi panjang riwayat yang dikirim biar hemat & aman
  const trimmed = clientMessages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000)
  }));

  const messages = [
    {
      role: 'system',
      content: 'Kamu adalah asisten AI ramah di dalam aplikasi game bernama Souly Arena. Jawab singkat, jelas, dan gunakan Bahasa Indonesia kecuali diminta lain.'
    },
    ...trimmed
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 600,
        messages
      })
    });

    if (!groqRes.ok) {
      let detail = 'HTTP ' + groqRes.status;
      try {
        const errData = await groqRes.json();
        if (errData?.error?.message) detail = errData.error.message;
      } catch (_) {}
      return res.status(502).json({ error: detail });
    }

    const data = await groqRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || '(tidak ada respons)';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal menghubungi AI.' });
  }
});

// Semua route lain kembalikan index.html (biar aman kalau ada refresh di path lain)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Souly Arena berjalan di port ' + PORT);
});
