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
// Hanya index.html yang disajikan ke publik. Sebelumnya seluruh folder ikut terbuka,
// sehingga server.js, package.json, bahkan .env (kalau ada) bisa diunduh lewat URL.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- Pembatas laju sederhana per IP (anti-spam, tanpa library tambahan) ----------
const hits = new Map();
function rateLimit(name, max, windowMs){
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'x').toString().split(',')[0].trim();
    const key = name + ':' + ip;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) { if (!v.length || now - v[v.length - 1] > 120000) hits.delete(k); } }, 60000).unref();

// Kepribadian asisten untuk Chat AI
const PERSONAS = {
  asisten:   'Kamu adalah asisten AI ramah di dalam aplikasi game bernama Souly Arena. Jawab singkat, jelas, dan gunakan Bahasa Indonesia kecuali diminta lain.',
  guru:      'Kamu adalah guru privat yang sabar di aplikasi Souly Arena. Jelaskan konsep langkah demi langkah dengan contoh sederhana, lalu beri satu pertanyaan latihan singkat di akhir. Gunakan Bahasa Indonesia kecuali diminta lain.',
  kreatif:   'Kamu adalah partner kreatif di aplikasi Souly Arena: penulis cerita, pembuat puisi, ide konten, dan nama-nama unik. Jawab dengan imajinatif dan menyenangkan, ringkas, Bahasa Indonesia kecuali diminta lain.',
  coder:     'Kamu adalah mentor programmer di aplikasi Souly Arena. Beri jawaban teknis yang tepat dengan contoh kode singkat bila perlu, jelaskan alasannya secara ringkas. Bahasa Indonesia kecuali diminta lain.',
  santai:    'Kamu adalah teman ngobrol santai di aplikasi Souly Arena. Gaya bicara akrab, hangat, sedikit humor, kalimat pendek. Bahasa Indonesia gaul yang sopan kecuali diminta lain.'
};

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

app.post('/api/chat', rateLimit('chat', 30, 60000), async (req, res) => {
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
      content: PERSONAS[req.body?.persona] || PERSONAS.asisten
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

// Topik acak biar soal makin bervariasi antar permintaan & antar pengguna
const QUIZ_TOPICS = [
  'sejarah dunia', 'sejarah Indonesia', 'geografi dunia', 'geografi Indonesia',
  'sains & fisika', 'biologi', 'kimia', 'matematika', 'astronomi & luar angkasa',
  'teknologi & internet', 'bahasa Indonesia', 'bahasa Inggris', 'olahraga',
  'seni & budaya', 'musik', 'film & animasi', 'kesehatan', 'ekonomi',
  'hewan & alam', 'kuliner', 'pengetahuan umum', 'game & teknologi',
];

app.post('/api/quiz', rateLimit('quiz', 30, 60000), async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server belum diatur: GROQ_API_KEY belum di-set di environment variable.' });
  }

  const difficulty = Math.min(4, Math.max(1, Number(req.body?.difficulty) || 1));
  const avoid = Array.isArray(req.body?.avoid) ? req.body.avoid.slice(-25).map(s => String(s).slice(0, 160)) : [];
  const topic = QUIZ_TOPICS[Math.floor(Math.random() * QUIZ_TOPICS.length)];
  const diffLabel = ['', 'mudah', 'sedang', 'sulit', 'ahli/sangat sulit'][difficulty];
  const nonce = Math.random().toString(36).slice(2, 10);

  const sys = 'Kamu adalah generator soal quiz pilihan ganda untuk aplikasi game. ' +
    'Selalu balas HANYA dengan satu objek JSON valid, tanpa teks lain, tanpa markdown, dengan bentuk persis: ' +
    '{"question":"...","options":["...","...","...","..."],"answerIndex":0}. ' +
    'Field "options" wajib berisi TEPAT 4 pilihan berbeda, dan "answerIndex" adalah index (0-3) jawaban yang benar. ' +
    'Soal & pilihan wajib berbahasa Indonesia, singkat, dan jelas.';

  const userPrompt = 'Buatkan SATU soal quiz baru dan orisinal dengan topik "' + topic + '", ' +
    'tingkat kesulitan "' + diffLabel + '". ' +
    'Soal ini HARUS berbeda dari soal-soal berikut yang sudah pernah muncul (jangan ulangi atau membuat variasi mirip persis darinya): ' +
    (avoid.length ? JSON.stringify(avoid) : '(belum ada riwayat)') + '. ' +
    'Kode acak sesi: ' + nonce + ' — gunakan ini sebagai dorongan untuk memilih sudut pertanyaan yang baru dan tidak umum.';

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 400,
        temperature: 1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt }
        ]
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
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch (_) {} }
    }

    if (!parsed || typeof parsed.question !== 'string' || !Array.isArray(parsed.options) ||
        parsed.options.length !== 4 || !Number.isInteger(parsed.answerIndex) ||
        parsed.answerIndex < 0 || parsed.answerIndex > 3) {
      return res.status(502).json({ error: 'AI memberi format soal yang tidak valid.' });
    }

    res.json({
      question: String(parsed.question).slice(0, 300),
      options: parsed.options.map(o => String(o).slice(0, 120)),
      answerIndex: parsed.answerIndex,
      topic
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gagal membuat soal quiz.' });
  }
});


// =====================================================================
//  STUDIO FOTO AI
//  - /api/enhance : mengubah ide singkat (bahasa apa pun) jadi prompt gambar yang detail
//  - /api/image   : membuat gambar. Server meneruskan ke penyedia gambar gratis
//                   (Pollinations) sehingga browser tidak perlu tahu URL/kuncinya.
//  Opsional: set POLLINATIONS_KEY di environment untuk limit lebih longgar & tanpa watermark.
// =====================================================================
const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY || '';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'flux';
const IMAGE_MIN_GAP_MS = Number(process.env.IMAGE_MIN_GAP_MS || (POLLINATIONS_KEY ? 500 : 4000));

const STYLE_SUFFIX = {
  none:      '',
  realistic: ', ultra realistic photograph, natural lighting, sharp focus, 85mm lens, highly detailed',
  anime:     ', anime illustration, vibrant colors, clean line art, studio quality, detailed background',
  '3d':      ', cute 3D render, soft studio lighting, smooth materials, high detail, octane render',
  cyberpunk: ', cyberpunk city, neon lights, rain reflections, cinematic, futuristic, high contrast',
  watercolor:', delicate watercolor painting, soft washes, paper texture, pastel palette',
  pixel:     ', pixel art, 16-bit retro game style, limited palette, crisp pixels',
  fantasy:   ', epic fantasy concept art, dramatic lighting, magical atmosphere, intricate details',
  sketch:    ', pencil sketch, hand drawn, cross hatching, monochrome, paper texture',
  cinematic: ', cinematic film still, dramatic lighting, shallow depth of field, anamorphic, color graded'
};
const RATIO_SIZE = { '1:1': [1024, 1024], '9:16': [768, 1344], '16:9': [1344, 768], '3:4': [896, 1152] };

async function groqText(system, user, maxTokens, temperature) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
    body: JSON.stringify({
      model: GROQ_MODEL, max_tokens: maxTokens || 300, temperature: temperature ?? 0.8,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!r.ok) {
    let detail = 'HTTP ' + r.status;
    try { const e = await r.json(); if (e?.error?.message) detail = e.error.message; } catch (_) {}
    throw new Error(detail);
  }
  const d = await r.json();
  return (d?.choices?.[0]?.message?.content || '').trim();
}

app.post('/api/enhance', rateLimit('enhance', 12, 60000), async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'Server belum diatur: GROQ_API_KEY belum di-set.' });
  const idea = String(req.body?.prompt || '').trim().slice(0, 300);
  if (idea.length < 2) return res.status(400).json({ error: 'Tulis ide gambarnya dulu.' });
  try {
    const out = await groqText(
      'Kamu adalah prompt engineer untuk generator gambar AI. Ubah ide pengguna (bahasa apa pun) menjadi SATU prompt bahasa Inggris yang deskriptif, maksimal 60 kata: subjek utama, latar, suasana, pencahayaan, komposisi. Jangan menyebut gaya seni khusus (gaya ditambahkan terpisah). Jangan menambah teks/tulisan di gambar. Balas HANYA prompt-nya, tanpa tanda kutip atau penjelasan.',
      idea, 200, 0.8
    );
    const prompt = out.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 500);
    if (!prompt) return res.status(502).json({ error: 'AI tidak memberi hasil.' });
    res.json({ prompt });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Gagal menyempurnakan prompt.' });
  }
});

// Antrean sederhana: satu permintaan gambar berjalan pada satu waktu (menjaga limit penyedia gratis)
const imageQueue = [];
let imageBusy = false;
let lastImageAt = 0;
const MAX_QUEUE = 6;

function pumpImageQueue() {
  if (imageBusy || !imageQueue.length) return;
  imageBusy = true;
  const job = imageQueue.shift();
  const wait = Math.max(0, lastImageAt + IMAGE_MIN_GAP_MS - Date.now());
  setTimeout(async () => {
    try { job.resolve(await fetchImage(job.params)); }
    catch (e) { job.reject(e); }
    finally { lastImageAt = Date.now(); imageBusy = false; pumpImageQueue(); }
  }, wait);
}
function enqueueImage(params) {
  return new Promise((resolve, reject) => {
    if (imageQueue.length >= MAX_QUEUE) return reject(Object.assign(new Error('Antrean pembuat gambar sedang penuh. Coba lagi sebentar.'), { status: 503 }));
    imageQueue.push({ params, resolve, reject });
    pumpImageQueue();
  });
}

async function fetchImage({ prompt, width, height, seed }, attempt = 0) {
  const q = new URLSearchParams({
    width: String(width), height: String(height), seed: String(seed),
    model: IMAGE_MODEL, nologo: 'true'
  });
  let url;
  if (POLLINATIONS_KEY) {
    q.set('key', POLLINATIONS_KEY);
    url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt) + '?' + q.toString();
  } else {
    url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?' + q.toString();
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 429 && attempt < 1) {
      await new Promise(ok => setTimeout(ok, 8000));
      return fetchImage({ prompt, width, height, seed }, attempt + 1);
    }
    if (!r.ok) {
      const msg = r.status === 429 ? 'Pembuat gambar sedang ramai. Coba lagi sebentar lagi.'
                : r.status === 401 || r.status === 403 ? 'Kunci penyedia gambar ditolak. Periksa POLLINATIONS_KEY.'
                : 'Penyedia gambar mengembalikan HTTP ' + r.status;
      throw Object.assign(new Error(msg), { status: 502 });
    }
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw Object.assign(new Error('Penyedia gambar tidak mengirim gambar.'), { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, type };
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('Pembuatan gambar terlalu lama. Coba lagi.'), { status: 504 });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/image', rateLimit('image', 6, 60000), async (req, res) => {
  const base = String(req.body?.prompt || '').trim().slice(0, 500);
  if (base.length < 2) return res.status(400).json({ error: 'Tulis deskripsi gambarnya dulu.' });
  const style = Object.prototype.hasOwnProperty.call(STYLE_SUFFIX, req.body?.style) ? req.body.style : 'none';
  const [width, height] = RATIO_SIZE[req.body?.ratio] || RATIO_SIZE['1:1'];
  const seed = Number.isInteger(req.body?.seed) ? Math.abs(req.body.seed) % 2000000000 : Math.floor(Math.random() * 2000000000);
  const prompt = (base + STYLE_SUFFIX[style]).slice(0, 800);
  try {
    const { buf, type } = await enqueueImage({ prompt, width, height, seed });
    res.set({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Image-Seed': String(seed) });
    res.send(buf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Gagal membuat gambar.' });
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
