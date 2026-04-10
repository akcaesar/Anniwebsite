/* ═══════════════════════════════════════
   Anniya Portfolio – Main JS
   Art is a Magic Spell
═══════════════════════════════════════ */

// ── Custom cursor ─────────────────────────────────────────────────────────────
const cur  = document.getElementById('cur');
const cur2 = document.getElementById('cur2');
if (cur && cur2) {
  document.addEventListener('mousemove', e => {
    cur.style.left  = e.clientX + 'px';
    cur.style.top   = e.clientY + 'px';
    setTimeout(() => {
      cur2.style.left = e.clientX + 'px';
      cur2.style.top  = e.clientY + 'px';
    }, 80);
  });
}

// ── Language switcher ─────────────────────────────────────────────────────────
function setLang(lang) {
  document.body.className = 'lang-' + lang;
  document.querySelectorAll('.lb').forEach(b => b.classList.remove('on'));
  const btn = document.querySelector(`.lb[onclick="setLang('${lang}')"]`);
  if (btn) btn.classList.add('on');
  localStorage.setItem('lang', lang);
}

// Restore saved language
const savedLang = localStorage.getItem('lang');
if (savedLang) setLang(savedLang);

// ── Scroll reveal ─────────────────────────────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('vis');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── Gallery filter ────────────────────────────────────────────────────────────
const catDescriptions = {
  'mental-health': 'Persönliche Auseinandersetzung mit Mental Health — zwischen Verarbeitung, Akzeptanz und der leisen Hoffnung.',
  'women':         'Was bedeutet es, eine Frau zu sein? Diese Serie erkundet Weiblichkeit in all ihren Facetten — lieblich, stark, sinnlich, magisch.',
  'fanart':        'Eine Hommage an die Welten, Charaktere und Geschichten, die mich als Künstlerin geformt haben.',
  'sketches':      'Rohe Ideen, festgehalten bevor sie verschwinden. Für mich genauso vollständig wie jedes andere Werk.',
  'other':         ''
};

document.querySelectorAll('.fBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter  = btn.dataset.filter;
    const items   = document.querySelectorAll('.m-item');
    const descEl  = document.getElementById('cat-desc-text');

    items.forEach(item => {
      const show = filter === 'all' || item.dataset.cat === filter;
      item.classList.toggle('hide', !show);
    });

    if (descEl) {
      descEl.textContent = filter === 'all' ? '' : (catDescriptions[filter] || '');
    }
  });
});

// ── Lightbox ──────────────────────────────────────────────────────────────────
const lb      = document.getElementById('lb');
const lbImg   = document.getElementById('lb-img');
const lbTitle = document.getElementById('lb-title');
const lbSeries= document.getElementById('lb-series');
const lbClose = document.getElementById('lb-close');
const lbPrev  = document.getElementById('lb-prev');
const lbNext  = document.getElementById('lb-next');

let currentItems = [];
let currentIndex = 0;

function openLightbox(index) {
  currentItems = Array.from(document.querySelectorAll('.m-item:not(.hide)'));
  currentIndex = index;
  showLightboxItem();
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function showLightboxItem() {
  const item = currentItems[currentIndex];
  if (!item) return;
  const img    = item.querySelector('img');
  const lang   = document.body.classList.contains('lang-en') ? 'en' : 'de';
  const title  = item.dataset[`titleDe`] || item.dataset['titleEn'] || '';
  const series = item.dataset[`seriesDe`] || item.dataset['seriesEn'] || '';
  lbImg.src        = img.src;
  lbImg.alt        = img.alt;
  lbTitle.textContent  = lang === 'en' ? (item.dataset['titleEn'] || title) : title;
  lbSeries.textContent = lang === 'en' ? (item.dataset['seriesEn'] || series) : series;
}

function closeLightbox() {
  lb.classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('.m-item').forEach((item, idx) => {
  item.addEventListener('click', () => {
    const visibleItems = Array.from(document.querySelectorAll('.m-item:not(.hide)'));
    const visibleIndex = visibleItems.indexOf(item);
    openLightbox(visibleIndex);
  });
});

if (lbClose) lbClose.addEventListener('click', closeLightbox);
if (lbPrev)  lbPrev.addEventListener('click', () => { currentIndex = (currentIndex - 1 + currentItems.length) % currentItems.length; showLightboxItem(); });
if (lbNext)  lbNext.addEventListener('click', () => { currentIndex = (currentIndex + 1) % currentItems.length; showLightboxItem(); });

document.addEventListener('keydown', e => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape')     closeLightbox();
  if (e.key === 'ArrowLeft')  { currentIndex = (currentIndex - 1 + currentItems.length) % currentItems.length; showLightboxItem(); }
  if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % currentItems.length; showLightboxItem(); }
});

lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

// ── Contact form ──────────────────────────────────────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  const form    = document.getElementById('cForm');
  const success = document.getElementById('cSuccess');
  const data    = new FormData(form);

  fetch(form.action, {
    method: 'POST',
    body: data,
    headers: { 'Accept': 'application/json' }
  }).then(r => {
    if (r.ok) {
      form.style.display    = 'none';
      success.style.display = 'block';
    } else {
      alert('Etwas ist schiefgelaufen. Bitte versuche es erneut.');
    }
  }).catch(() => {
    alert('Netzwerkfehler. Bitte versuche es erneut.');
  });
}

// ── Nav shrink on scroll ──────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const nav = document.querySelector('nav');
  if (nav) nav.style.padding = window.scrollY > 50 ? '14px 56px' : '22px 56px';
});


// ── Hamburger menu (mobile) ───────────────────────────────────────────────────
(function() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  // Inject hamburger button
  const hamburger = document.createElement('div');
  hamburger.className = 'nav-hamburger';
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  nav.appendChild(hamburger);

  const navLinks = document.querySelector('.nav-links');

  hamburger.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // Close on link click
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // Close on outside tap
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && navLinks.classList.contains('open')) {
      navLinks.classList.remove('open');
      hamburger.classList.remove('open');
      document.body.style.overflow = '';
    }
  });
})();
