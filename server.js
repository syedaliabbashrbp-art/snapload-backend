require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { exec } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── PLATFORM DETECT ────────────────────────────────────────────────────────
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('tiktok') || u.includes('vm.tiktok') || u.includes('vt.tiktok')) return 'TikTok';
  if (u.includes('youtube') || u.includes('youtu.be'))  return 'YouTube';
  if (u.includes('instagram'))                           return 'Instagram';
  if (u.includes('twitter')  || u.includes('x.com'))    return 'Twitter/X';
  if (u.includes('facebook') || u.includes('fb.watch')) return 'Facebook';
  if (u.includes('reddit')   || u.includes('redd.it'))  return 'Reddit';
  if (u.includes('vimeo'))                               return 'Vimeo';
  if (u.includes('dailymotion'))                         return 'Dailymotion';
  if (u.includes('twitch'))                              return 'Twitch';
  if (u.includes('soundcloud'))                          return 'SoundCloud';
  if (u.includes('pinterest'))                           return 'Pinterest';
  if (u.includes('snapchat'))                            return 'Snapchat';
  if (u.includes('linkedin'))                            return 'LinkedIn';
  return 'Other';
}

// ─── RUN YT-DLP ──────────────────────────────────────────────────────────────
function ytdlp(args) {
  return new Promise((resolve, reject) => {
    exec(
      `yt-dlp ${args}`,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      }
    );
  });
}

// ─── FORMAT MAP ───────────────────────────────────────────────────────────────
const FORMAT_MAP = {
  'max':  'bestvideo+bestaudio/best',
  '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
  '720':  'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
  '480':  'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
  '360':  'bestvideo[height<=360]+bestaudio/best[height<=360]/best',
  '144':  'bestvideo[height<=144]+bestaudio/best[height<=144]/best',
};

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    app:      'SnapLoad Backend',
    version:  '2.0.0',
    engine:   'yt-dlp',
    status:   'running',
    supports: 'YouTube, TikTok, Instagram, Facebook, Twitter/X, Reddit, Vimeo, Dailymotion, SoundCloud, WhatsApp Status + 1000 more',
  });
});

// ─── GET VIDEO INFO ───────────────────────────────────────────────────────────
// Returns title, thumbnail, duration, uploader — used for preview before download
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });

  try {
    const raw  = await ytdlp(`--dump-json --no-playlist --no-warnings "${url}"`);
    const info = JSON.parse(raw);
    return res.json({
      success:   true,
      title:     info.title      || 'Untitled',
      thumbnail: info.thumbnail  || '',
      duration:  info.duration   || 0,
      uploader:  info.uploader   || '',
      platform:  detectPlatform(url),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET ALL AVAILABLE FORMATS ────────────────────────────────────────────────
// Returns list of all formats user can choose from
app.get('/api/formats', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });

  try {
    const raw = await ytdlp(`--list-formats --no-warnings "${url}" 2>&1 || true`);
    // Parse available heights
    const heights  = new Set();
    const lines    = raw.split('\n');
    lines.forEach(line => {
      const match = line.match(/(\d{3,4})p/);
      if (match) heights.add(parseInt(match[1]));
    });

    const qualities = [];
    [2160, 1440, 1080, 720, 480, 360, 240, 144].forEach(h => {
      if (heights.has(h) || heights.size === 0) {
        qualities.push({ label: `${h}p ${h >= 1080 ? 'FHD' : h >= 720 ? 'HD' : 'SD'}`, value: String(h) });
      }
    });

    if (qualities.length === 0) {
      qualities.push(
        { label: '720p HD',  value: '720' },
        { label: '480p SD',  value: '480' },
        { label: '360p',     value: '360' },
      );
    }

    return res.json({ success: true, platform: detectPlatform(url), qualities });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── MAIN DOWNLOAD ────────────────────────────────────────────────────────────
app.post('/api/download', async (req, res) => {
  const { url, quality = '720', audioOnly = false, audioFormat = 'mp3' } = req.body;

  // Validate URL
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });
  try { new URL(url); } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  const platform = detectPlatform(url);
  const links    = [];

  try {
    if (audioOnly) {
      // ── AUDIO ONLY ────────────────────────────────────────────────────────
      const fmt = audioFormat === 'mp3' ? 'bestaudio[ext=mp3]/bestaudio/best' : 'bestaudio/best';
      const out = await ytdlp(`--get-url --no-playlist --no-warnings -f "${fmt}" "${url}"`);
      const audioUrl = out.split('\n').find(l => l.startsWith('http'));
      if (!audioUrl) throw new Error('No audio URL found');

      links.push({
        type:     'audio',
        quality:  `Best Audio (${audioFormat.toUpperCase()})`,
        url:      audioUrl,
        filename: `audio.${audioFormat}`,
      });

    } else {
      // ── VIDEO ─────────────────────────────────────────────────────────────
      const fmt = FORMAT_MAP[quality] || FORMAT_MAP['720'];
      const out = await ytdlp(`--get-url --no-playlist --no-warnings -f "${fmt}" "${url}"`);
      const urls = out.split('\n').filter(l => l.startsWith('http'));
      if (!urls.length) throw new Error('No video URL found');

      links.push({
        type:     'video',
        quality:  quality === 'max' ? 'Best Quality' : `${quality}p`,
        url:      urls[0],
        filename: `video_${quality}p.mp4`,
      });

      // Always offer audio option alongside video
      try {
        const aOut = await ytdlp(`--get-url --no-playlist --no-warnings -f "bestaudio/best" "${url}"`);
        const aUrl = aOut.split('\n').find(l => l.startsWith('http'));
        if (aUrl) {
          links.push({
            type:     'audio',
            quality:  'Audio Only (MP3)',
            url:      aUrl,
            filename: 'audio.mp3',
          });
        }
      } catch (_) { /* audio is optional */ }
    }

    console.log(`[OK] ${platform} | quality:${quality} | audio:${audioOnly}`);
    return res.json({ success: true, platform, links, count: links.length });

  } catch (err) {
    console.error(`[ERR] ${platform} | ${err.message}`);
    return res.status(500).json({
      success: false,
      error:   'Download failed. Video may be private or unavailable.',
      details: err.message,
    });
  }
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  SnapLoad Backend v2.0  —  port ${PORT}`);
  console.log(`🎯  Engine: yt-dlp  |  1000+ sites supported\n`);
});
