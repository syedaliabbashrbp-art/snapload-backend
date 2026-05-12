require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY & MIDDLEWARE ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*', // Flutter app se allow karein
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// Rate limiting — abuse se bachao
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 min per IP
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ── PLATFORM DETECTION ───────────────────────────────────────────────────────
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com') || u.includes('vm.tiktok') || u.includes('vt.tiktok')) return 'tiktok';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('twitter.com') || u.includes('x.com') || u.includes('t.co')) return 'twitter';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('reddit.com') || u.includes('redd.it')) return 'reddit';
  return 'unknown';
}

// ── COBALT API CALL (Primary) ────────────────────────────────────────────────
// Server side call — no CORS issue!
async function callCobalt(videoUrl, options = {}) {
  const instances = [
    'https://api.cobalt.tools',
    'https://cobalt.pussthecat.org',
    'https://co.wuk.sh',
  ];

  for (const base of instances) {
    try {
      const res = await fetch(`${base}/api/json`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: videoUrl,
          vQuality: options.quality || '720',
          aFormat: options.audioFormat || 'mp3',
          isAudioOnly: options.audioOnly || false,
          isNoTTWatermark: true,
          isTTFullAudio: false,
          isAudioMuted: false,
          dubLang: false,
          disableMetadata: false,
        }),
        timeout: 15000,
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === 'error' || data.status === 'rate-limit') continue;
      return { success: true, data, source: base };
    } catch (e) {
      console.warn(`Cobalt instance ${base} failed:`, e.message);
      continue;
    }
  }
  throw new Error('All cobalt instances failed');
}

// ── FORMAT RESPONSE ──────────────────────────────────────────────────────────
function formatResponse(data, platform, audioOnly) {
  const links = [];

  if (['redirect', 'stream', 'tunnel'].includes(data.status)) {
    links.push({
      type: audioOnly ? 'audio' : 'video',
      quality: audioOnly ? 'MP3' : 'Video',
      url: data.url,
      filename: audioOnly ? 'audio.mp3' : `${platform}_video.mp4`,
    });
  } else if (data.status === 'picker') {
    (data.picker || []).forEach((item, i) => {
      links.push({
        type: item.type === 'photo' ? 'image' : 'video',
        quality: item.type === 'photo' ? 'Image' : `Video ${i + 1}`,
        url: item.url,
        filename: item.type === 'photo' ? `image_${i+1}.jpg` : `video_${i+1}.mp4`,
      });
    });
    if (data.audio) {
      links.push({ type: 'audio', quality: 'Audio', url: data.audio, filename: 'audio.mp3' });
    }
  }

  return links;
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    app: 'SnapLoad Backend',
    version: '1.0.0',
    status: 'running',
    endpoints: ['/api/download', '/api/info'],
  });
});

// Main download endpoint
app.post('/api/download', async (req, res) => {
  const { url, quality = '720', audioOnly = false, audioFormat = 'mp3' } = req.body;

  // Validate
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({
      success: false,
      error: 'Platform not supported',
      supported: ['tiktok', 'youtube', 'instagram', 'twitter', 'facebook', 'reddit'],
    });
  }

  console.log(`[Download] Platform: ${platform} | Quality: ${quality} | Audio: ${audioOnly}`);

  try {
    const result = await callCobalt(url, { quality, audioOnly, audioFormat });
    const links = formatResponse(result.data, platform, audioOnly);

    if (!links.length) {
      return res.status(500).json({ success: false, error: 'No downloadable links found' });
    }

    return res.json({
      success: true,
      platform,
      links,
      count: links.length,
    });

  } catch (err) {
    console.error('[Download Error]', err.message);
    return res.status(500).json({
      success: false,
      error: 'Download failed. The video may be private or unavailable.',
      details: err.message,
    });
  }
});

// Info endpoint — just get video metadata (no download)
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });

  const platform = detectPlatform(url);
  return res.json({
    success: true,
    platform,
    supported: platform !== 'unknown',
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ SnapLoad Backend running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/download`);
});
