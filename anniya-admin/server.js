require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const sharp      = require('sharp');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const cookieParser = require('cookie-parser');
const fetch      = require('node-fetch');
const fs         = require('fs');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;
const SITE = path.resolve(__dirname, process.env.SITE_PATH || '../anniya-site-v2');

// ── Credentials ───────────────────────────────────────────────────────────────
const USERS = {
  anniya: {
    hash: bcrypt.hashSync(process.env.ANNIYA_PASSWORD || 'anniya2024', 10),
    role: 'content'
  },
  akshu: {
    hash: bcrypt.hashSync(process.env.AKSHU_PASSWORD  || 'akshu_admin_2024', 10),
    role: 'admin'
  }
};

const JWT_SECRET     = process.env.JWT_SECRET     || 'magicspell';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_OWNER   = process.env.GITHUB_OWNER   || 'akcaesar';
const GITHUB_REPO    = process.env.GITHUB_REPO    || 'Anniwebsite';
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH  || 'main';
const NETLIFY_TOKEN  = process.env.NETLIFY_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

// ── Login rate limiting ───────────────────────────────────────────────────────
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  return entry;
}

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'admin.log');
const logs = [];

function log(level, user, action, detail = '', error = null) {
  const entry = {
    ts:     new Date().toISOString(),
    level,  // info | warn | error
    user:   user || 'system',
    action,
    detail,
    error:  error ? (error.message || String(error)) : null
  };
  logs.unshift(entry);
  if (logs.length > 500) logs.pop();

  const line = `[${entry.ts}] [${level.toUpperCase()}] [${entry.user}] ${action}${detail ? ' — ' + detail : ''}${entry.error ? ' ✗ ' + entry.error : ''}\n`;
  fs.appendFileSync(LOG_FILE, line);
  if (level === 'error') console.error(line.trim());
  else console.log(line.trim());
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/admin', express.static(path.join(__dirname, 'public')));
app.use('/site-images', express.static(path.join(SITE, 'images')));
app.use('/preview-assets', express.static(path.join(SITE, 'assets')));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Preview with path rewriting
app.get('/preview/:page?', (req, res) => {
  const page = req.params.page || 'index.html';
  const fp   = path.join(SITE, 'pages', page);
  if (!fs.existsSync(fp)) return res.status(404).send('Page not found');
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/src="\.\.\/images\//g,       'src="/site-images/');
  html = html.replace(/href="\.\.\/assets\/css\//g, 'href="/preview-assets/css/');
  html = html.replace(/src="\.\.\/assets\/js\//g,   'src="/preview-assets/js/');
  res.send(html);
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.token || '', JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Nicht eingeloggt' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  next();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────
function sp(...parts) { return path.join(SITE, ...parts); }

function readJSON(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(sp(rel), 'utf8')); }
  catch { return fallback; }
}

function writeJSON(rel, data) {
  fs.writeFileSync(sp(rel), JSON.stringify(data, null, 2), 'utf8');
}

function readContent() {
  return readJSON('content.json') || {
    hero:    { subtitle_de: '', subtitle_en: '' },
    about:   { text_de: '', text_en: '' },
    contact: { text_de: '', text_en: '' },
    colors:  { primary: '#7C5CBF', background: '#1A1228', accent: '#A98FD8' },
    categories: ['mental-health', 'women', 'fanart', 'sketches', 'other']
  };
}

function readArtworks() { return readJSON('artworks.json', []); }

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── GitHub + Netlify deploy ───────────────────────────────────────────────────
async function retryFetch(url, options, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;
      const err = await r.text();
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs * Math.pow(2, i)));
        continue;
      }
      throw new Error(`HTTP ${r.status}: ${err.slice(0, 200)}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, delayMs * Math.pow(2, i)));
    }
  }
}

async function pushToGitHub(commitMessage, user) {
  if (!GITHUB_TOKEN) throw new Error('GitHub Token nicht konfiguriert');

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github.v3+json'
  };

  // Files to sync to GitHub
  const filesToSync = [
    { localPath: sp('pages', 'index.html'),      repoPath: 'anniya-site-v2/pages/index.html' },
    { localPath: sp('assets', 'css', 'main.css'), repoPath: 'anniya-site-v2/assets/css/main.css' },
    { localPath: sp('content.json'),              repoPath: 'anniya-site-v2/content.json' },
    { localPath: sp('artworks.json'),             repoPath: 'anniya-site-v2/artworks.json' },
  ];

  // Also sync any new images
  const imageBase = sp('images', 'artwork');
  if (fs.existsSync(imageBase)) {
    const categories = fs.readdirSync(imageBase);
    for (const cat of categories) {
      const catDir = path.join(imageBase, cat);
      if (!fs.statSync(catDir).isDirectory()) continue;
      const files = fs.readdirSync(catDir);
      for (const f of files) {
        filesToSync.push({
          localPath: path.join(catDir, f),
          repoPath:  `anniya-site-v2/images/artwork/${cat}/${f}`
        });
      }
    }
  }

  // Also sync profile/hero images
  for (const img of ['profile/Anniya_Profilbild.jpeg', 'profile/Anniya_Real_Photo.jpeg', 'hero/Website_Anniya.jpeg']) {
    const lp = sp('images', ...img.split('/'));
    if (fs.existsSync(lp)) filesToSync.push({ localPath: lp, repoPath: `anniya-site-v2/images/${img}` });
  }

  log('info', user, 'github_push_start', `${filesToSync.length} Dateien, Branch: ${GITHUB_BRANCH}`);

  for (const { localPath, repoPath } of filesToSync) {
    if (!fs.existsSync(localPath)) continue;

    const content = fs.readFileSync(localPath).toString('base64');

    // Get current SHA if file exists
    let sha;
    try {
      const r = await retryFetch(`${apiBase}/contents/${repoPath}?ref=${GITHUB_BRANCH}`, { headers });
      const data = await r.json();
      sha = data.sha;
    } catch { /* file doesn't exist yet, that's fine */ }

    const body = { message: commitMessage, content, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;

    await retryFetch(`${apiBase}/contents/${repoPath}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
  }

  log('info', user, 'github_push_done', commitMessage);
}

async function triggerNetlifyDeploy(user) {
  if (!NETLIFY_TOKEN || !NETLIFY_SITE_ID) throw new Error('Netlify nicht konfiguriert');

  const r = await retryFetch(
    `https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}/deploys`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clear_cache: false })
    }
  );

  const data = await r.json();
  log('info', user, 'netlify_deploy_triggered', `Deploy ID: ${data.id}`);
  return data.id;
}

async function saveAndDeploy(commitMessage, user) {
  try {
    await pushToGitHub(commitMessage, user);
    const deployId = await triggerNetlifyDeploy(user);
    return { ok: true, deployId };
  } catch (err) {
    log('error', user, 'deploy_failed', commitMessage, err);
    throw err;
  }
}

// ── HTML sync ─────────────────────────────────────────────────────────────────
function applyContentToFiles(content) {
  // Colors → CSS
  try {
    const cssPath = sp('assets', 'css', 'main.css');
    let css = fs.readFileSync(cssPath, 'utf8');
    if (content.colors) {
      css = css.replace(/--lav-deep:\s*#[0-9a-fA-F]{6}/, `--lav-deep:  ${content.colors.primary}`);
      css = css.replace(/--ink:\s*#[0-9a-fA-F]{6}/,      `--ink:       ${content.colors.background}`);
      css = css.replace(/--lav-mid:\s*#[0-9a-fA-F]{6}/,  `--lav-mid:   ${content.colors.accent}`);
    }
    fs.writeFileSync(cssPath, css, 'utf8');
  } catch (e) { log('error', 'system', 'css_update_failed', '', e); }

  // Texts → HTML
  try {
    const htmlPath = sp('pages', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (content.hero?.subtitle_de !== undefined)
      html = html.replace(/(<p class="hero-sub">\s*<span data-de>)[^<]*/, `$1${escHtml(content.hero.subtitle_de)}`);
    if (content.hero?.subtitle_en !== undefined)
      html = html.replace(/(<p class="hero-sub">[\s\S]*?<span data-de>[^<]*<\/span>\s*<span data-en>)[^<]*/, `$1${escHtml(content.hero.subtitle_en)}`);
    if (content.about?.text_de !== undefined)
      html = html.replace(/(<p class="about-body">\s*<span data-de>)[^<]*/, `$1${escHtml(content.about.text_de)}`);
    if (content.about?.text_en !== undefined)
      html = html.replace(/(<p class="about-body">[\s\S]*?<span data-de>[^<]*<\/span>\s*<span data-en>)[^<]*/, `$1${escHtml(content.about.text_en)}`);
    if (content.contact?.text_de !== undefined)
      html = html.replace(/(<p class="c-sub">\s*<span data-de>)[^<]*/, `$1${escHtml(content.contact.text_de)}`);
    if (content.contact?.text_en !== undefined)
      html = html.replace(/(<p class="c-sub">[\s\S]*?<span data-de>[^<]*<\/span>\s*<span data-en>)[^<]*/, `$1${escHtml(content.contact.text_en)}`);
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (e) { log('error', 'system', 'html_text_update_failed', '', e); }
}

function rebuildGalleryHTML(artworks) {
  try {
    const htmlPath = sp('pages', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const items = artworks.map(a => {
      const label = a.category.charAt(0).toUpperCase() + a.category.slice(1).replace(/-/g,' ');
      return `    <div class="m-item reveal" data-cat="${escAttr(a.category)}" data-title-de="${escAttr(a.title_de)}" data-title-en="${escAttr(a.title_en)}" data-series-de="${escAttr(label)}" data-series-en="${escAttr(label)}"><img src="../${a.file}" alt="${escAttr(a.title_en)}" loading="lazy"/><div class="m-overlay"><div class="m-text"><h3>${escHtml(a.title_de)}</h3><span>${escHtml(label)}</span></div></div></div>`;
    }).join('\n');
    html = html.replace(
      /(<div class="masonry" id="gallery">)[\s\S]*?(\n  <\/div>\n<\/section>\n\n<!-- LIGHTBOX -->)/,
      `$1\n${items}\n  $2`
    );
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (e) { log('error', 'system', 'gallery_rebuild_failed', '', e); }
}

function rebuildFilterButtons(categories) {
  try {
    const htmlPath = sp('pages', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const btns = [
      `    <button class="fBtn active" data-filter="all"><span data-de>✦ Alle</span><span data-en>✦ All</span></button>`,
      ...categories.map(cat => {
        const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g,' ');
        return `    <button class="fBtn" data-filter="${escAttr(cat)}">${escHtml(label)}</button>`;
      })
    ].join('\n');
    html = html.replace(
      /(<div class="filters reveal">)[\s\S]*?(<\/div>\s*\n\s*<div class="cat-desc reveal")/,
      `$1\n${btns}\n  $2`
    );
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (e) { log('error', 'system', 'filter_rebuild_failed', '', e); }
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip    = req.ip;
  const entry = checkRateLimit(ip);
  if (entry.count >= 5) {
    const minutesLeft = Math.ceil((entry.resetAt - Date.now()) / 60000);
    log('warn', req.body.username, 'login_rate_limited', ip);
    return res.status(429).json({ error: `Zu viele Versuche. Bitte warte ${minutesLeft} Minute(n).` });
  }

  const { username, password } = req.body;
  const userDef = USERS[username];

  if (!userDef || !bcrypt.compareSync(password || '', userDef.hash)) {
    entry.count++;
    loginAttempts.set(ip, entry);
    log('warn', username, 'login_failed', `Versuch ${entry.count}/5`);
    return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
  }

  const token = jwt.sign({ username, role: userDef.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7*24*60*60*1000, sameSite: 'strict' });
  loginAttempts.delete(ip);
  log('info', username, 'login_success', `Rolle: ${userDef.role}`);
  res.json({ ok: true, role: userDef.role, username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  log('info', req.user.username, 'logout');
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/check-auth', requireAuth, (req, res) => {
  res.json({ ok: true, role: req.user.role, username: req.user.username });
});

// ── Logs (admin only) ─────────────────────────────────────────────────────────
app.get('/api/logs', requireAuth, requireAdmin, (req, res) => {
  res.json(logs.slice(0, 200));
});

// ── Deploy status ─────────────────────────────────────────────────────────────
app.get('/api/deploy/status', requireAuth, async (req, res) => {
  if (!NETLIFY_TOKEN || !NETLIFY_SITE_ID) return res.json({ status: 'not_configured' });
  try {
    const r = await fetch(
      `https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}/deploys?per_page=1`,
      { headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` } }
    );
    const deploys = await r.json();
    const latest  = deploys[0];
    res.json({
      status:    latest?.state || 'unknown',
      createdAt: latest?.created_at,
      deployId:  latest?.id,
      url:       latest?.deploy_ssl_url || latest?.url
    });
  } catch (e) {
    res.json({ status: 'error', error: e.message });
  }
});

// ── Content routes ────────────────────────────────────────────────────────────
app.get('/api/content', requireAuth, (req, res) => res.json(readContent()));

app.post('/api/content', requireAuth, async (req, res) => {
  try {
    const cur = readContent();
    const updated = {
      hero:       { ...cur.hero,    ...(req.body.hero    || {}) },
      about:      { ...cur.about,   ...(req.body.about   || {}) },
      contact:    { ...cur.contact, ...(req.body.contact || {}) },
      colors:     { ...cur.colors,  ...(req.body.colors  || {}) },
      categories: req.body.categories || cur.categories,
    };
    writeJSON('content.json', updated);
    applyContentToFiles(updated);

    const section = Object.keys(req.body)[0] || 'content';
    log('info', req.user.username, 'content_saved', section);

    const { deployId } = await saveAndDeploy(`update: ${section} geändert von ${req.user.username}`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, 'content_save_failed', '', e);
    res.status(500).json({ error: 'Speichern fehlgeschlagen. Bitte versuche es erneut. 🌸' });
  }
});

// ── Artworks ──────────────────────────────────────────────────────────────────
app.get('/api/artworks', requireAuth, (req, res) => res.json(readArtworks()));

app.post('/api/artworks/reorder', requireAuth, async (req, res) => {
  try {
    const { artworks } = req.body;
    if (!Array.isArray(artworks)) return res.status(400).json({ error: 'Ungültige Daten' });
    writeJSON('artworks.json', artworks);
    rebuildGalleryHTML(artworks);
    log('info', req.user.username, 'artworks_reordered');
    const { deployId } = await saveAndDeploy(`update: Galerie neu sortiert von ${req.user.username}`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, 'reorder_failed', '', e);
    res.status(500).json({ error: 'Reihenfolge konnte nicht gespeichert werden. 🌸' });
  }
});

app.delete('/api/artworks/:id', requireAuth, async (req, res) => {
  try {
    const artworks = readArtworks();
    const idx = artworks.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Kunstwerk nicht gefunden' });
    const [removed] = artworks.splice(idx, 1);
    const imgPath = sp(removed.file);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    writeJSON('artworks.json', artworks);
    rebuildGalleryHTML(artworks);
    log('info', req.user.username, 'artwork_deleted', removed.title_de);
    const { deployId } = await saveAndDeploy(`delete: "${removed.title_de}" entfernt von ${req.user.username}`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, 'delete_failed', '', e);
    res.status(500).json({ error: 'Löschen fehlgeschlagen. Bitte versuche es erneut. 🌸' });
  }
});

app.post('/api/artworks/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { title_de, title_en, category } = req.body;
    if (!req.file)  return res.status(400).json({ error: 'Kein Bild ausgewählt' });
    if (!title_de)  return res.status(400).json({ error: 'Bitte deutschen Titel eingeben' });
    if (!title_en)  return res.status(400).json({ error: 'Bitte englischen Titel eingeben' });
    if (!category)  return res.status(400).json({ error: 'Bitte Kategorie wählen' });

    const quality  = Math.min(100, Math.max(10, parseInt(req.body.quality) || 85));
    const uid      = Date.now().toString();
    const filename = uid + '_' + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destDir  = sp('images', 'artwork', category);
    const destPath = path.join(destDir, filename);

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const meta = await sharp(req.file.buffer).metadata();
    const w = Math.min(meta.width  || 2400, 2400);
    const h = Math.min(meta.height || 2400, 2400);
    const fs_ = Math.max(20, Math.round(Math.min(w, h) * 0.032));
    const pad = Math.round(Math.min(w, h) * 0.03);
    const wm  = Buffer.from(
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <text x="${w-pad+1}" y="${h-pad+1}" text-anchor="end" font-family="Arial" font-size="${fs_}" fill="black" fill-opacity="0.3">© Anniya</text>
        <text x="${w-pad}"   y="${h-pad}"   text-anchor="end" font-family="Arial" font-size="${fs_}" fill="white" fill-opacity="0.55">© Anniya</text>
      </svg>`
    );

    await sharp(req.file.buffer)
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .composite([{ input: wm, blend: 'over' }])
      .jpeg({ quality })
      .toFile(destPath);

    const artworks = readArtworks();
    const artwork  = { id: uid, title_de, title_en, category, file: `images/artwork/${category}/${filename}`, year: new Date().getFullYear() };
    artworks.push(artwork);
    writeJSON('artworks.json', artworks);
    rebuildGalleryHTML(artworks);

    log('info', req.user.username, 'artwork_uploaded', `"${title_de}" → ${category}`);
    const { deployId } = await saveAndDeploy(`add: "${title_de}" hochgeladen von ${req.user.username}`, req.user.username);
    res.json({ ok: true, artwork, deployId });
  } catch (e) {
    log('error', req.user?.username, 'upload_failed', '', e);
    res.status(500).json({ error: 'Upload fehlgeschlagen. Bitte versuche es erneut. 🌸' });
  }
});

// ── Special images ────────────────────────────────────────────────────────────
app.post('/api/images/:type', requireAuth, upload.single('image'), async (req, res) => {
  const type = req.params.type;
  if (!['hero', 'profile'].includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Bild ausgewählt' });
    const q   = Math.min(100, Math.max(10, parseInt(req.body.quality) || 90));
    const dest = type === 'hero'
      ? sp('images', 'hero',    'Website_Anniya.jpeg')
      : sp('images', 'profile', 'Anniya_Profilbild.jpeg');
    const size = type === 'hero' ? [2400, 2400] : [1200, 1200];
    await sharp(req.file.buffer).resize(size[0], size[1], { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: q }).toFile(dest);
    log('info', req.user.username, `${type}_image_updated`);
    const { deployId } = await saveAndDeploy(`update: ${type === 'hero' ? 'Hero' : 'Profil'}-Bild aktualisiert`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, `${type}_upload_failed`, '', e);
    res.status(500).json({ error: 'Bild-Upload fehlgeschlagen. 🌸' });
  }
});

// ── Categories ────────────────────────────────────────────────────────────────
app.get('/api/categories', requireAuth, (req, res) => res.json(readContent().categories || []));

app.post('/api/categories', requireAuth, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) return res.status(400).json({ error: 'Ungültige Daten' });
    const content = readContent();
    content.categories = categories;
    writeJSON('content.json', content);
    categories.forEach(cat => {
      const dir = sp('images', 'artwork', cat);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    rebuildFilterButtons(categories);
    log('info', req.user.username, 'categories_saved', categories.join(', '));
    const { deployId } = await saveAndDeploy(`update: Kategorien geändert von ${req.user.username}`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, 'categories_save_failed', '', e);
    res.status(500).json({ error: 'Kategorien konnten nicht gespeichert werden. 🌸' });
  }
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/api/pages', requireAuth, (req, res) => {
  try { res.json(fs.readdirSync(sp('pages')).filter(f => f.endsWith('.html'))); }
  catch { res.json([]); }
});

app.post('/api/pages/create', requireAuth, async (req, res) => {
  try {
    const { name, title } = req.body;
    if (!name || !title) return res.status(400).json({ error: 'Name und Titel erforderlich' });
    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    const fp   = sp('pages', `${slug}.html`);
    if (fs.existsSync(fp)) return res.status(400).json({ error: 'Seite existiert bereits' });
    fs.writeFileSync(fp, `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escHtml(title)} – Anniya</title>
  <link rel="stylesheet" href="../assets/css/main.css"/>
</head>
<body>
  <nav><a href="index.html" class="logo">Anniya</a></nav>
  <main style="padding:120px 5vw;min-height:80vh;">
    <h1>${escHtml(title)}</h1>
    <p>Seite im Aufbau – kommt bald! ✨</p>
  </main>
  <script src="../assets/js/main.js"></script>
</body>
</html>`);
    log('info', req.user.username, 'page_created', slug);
    const { deployId } = await saveAndDeploy(`add: Seite "${title}" erstellt`, req.user.username);
    res.json({ ok: true, slug, deployId });
  } catch (e) {
    log('error', req.user?.username, 'page_create_failed', '', e);
    res.status(500).json({ error: 'Seite konnte nicht erstellt werden. 🌸' });
  }
});

app.delete('/api/pages/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    if (name === 'index.html') return res.status(400).json({ error: 'Hauptseite kann nicht gelöscht werden' });
    const fp = sp('pages', name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Seite nicht gefunden' });
    fs.unlinkSync(fp);
    log('info', req.user.username, 'page_deleted', name);
    const { deployId } = await saveAndDeploy(`delete: Seite "${name}" gelöscht`, req.user.username);
    res.json({ ok: true, deployId });
  } catch (e) {
    log('error', req.user?.username, 'page_delete_failed', '', e);
    res.status(500).json({ error: 'Seite konnte nicht gelöscht werden. 🌸' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log('info', 'system', 'server_start', `http://localhost:${PORT}/admin`);
  console.log(`\n✦ Anniya Admin läuft auf http://localhost:${PORT}/admin\n`);
  console.log(`  Users: anniya (content), akshu (admin)`);
  console.log(`  Site: ${SITE}\n`);
});
