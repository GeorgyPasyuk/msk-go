'use strict';

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WD = ['вс','пн','вт','ср','чт','пт','сб'];
const stripEmoji = s => (s || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '').trim();

let DATA = null;
const selCats = new Set();   // выбранные категории; пусто = показать все

/* ---------- даты / выходные ---------- */
function weekendSat(dateStr){
  const x = new Date(dateStr); const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -1 : 6 - day));
  x.setHours(0,0,0,0); return x;
}
function rangeLabel(sat){
  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  return sat.getMonth() === sun.getMonth()
    ? `${sat.getDate()}–${sun.getDate()} ${MONTHS[sat.getMonth()]}`
    : `${sat.getDate()} ${MONTHS[sat.getMonth()]} – ${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
}
function relLabel(sat){
  const cur = weekendSat(new Date());
  const diff = Math.round((sat - cur) / (7 * 864e5));
  if (diff <= 0) return 'Ближайшие выходные';
  if (diff === 1) return 'Следующие выходные';
  return '';
}

/* ---------- выборки ---------- */
const catKey = e => e.category_label || e.category || 'Событие';
const dated = () => DATA.events
  .filter(e => !e.season_long && (selCats.size === 0 || selCats.has(catKey(e))) &&
               new Date(e.end || e.start) >= new Date())   // только ещё не закончившиеся
  .sort((a,b) => a.start < b.start ? -1 : 1);

function groupByWeekend(list){
  const map = new Map();
  list.forEach(e => {
    const sat = weekendSat(e.start); const key = sat.getTime();
    if (!map.has(key)) map.set(key, { sat, items: [] });
    map.get(key).items.push(e);
  });
  return [...map.values()].sort((a,b) => a.sat - b.sat);
}

function fillWeekendGaps(groups){
  const now = new Date();
  const curSat = weekendSat(now);
  const last = groups.length ? groups[groups.length - 1].sat : curSat;
  const end = new Date(Math.max(last.getTime() + 7 * 864e5, curSat.getTime() + 56 * 864e5));
  const map = new Map(groups.map(g => [g.sat.getTime(), g]));
  const out = [];
  const cursor = new Date(curSat);
  while (cursor <= end) {
    const key = cursor.getTime();
    out.push(map.get(key) || { sat: new Date(cursor), items: [] });
    cursor.setDate(cursor.getDate() + 7);
    cursor.setHours(0, 0, 0, 0);
  }
  return out;
}

/* ---------- агенда ---------- */
let mode = 'upcoming';   // upcoming | past
function currentList(){
  if (mode === 'past')
    return (DATA.past || [])
      .filter(e => selCats.size === 0 || selCats.has(catKey(e)))
      .sort((a,b) => a.start < b.start ? 1 : -1);
  return dated();
}
function renderAgenda(){
  const root = document.getElementById('agenda');
  let groups = groupByWeekend(currentList());
  if (mode === 'past') groups = groups.reverse();   // свежие сверху
  root.innerHTML = '';
  if (!groups.length){
    const msg = mode === 'past' ? 'Прошлых событий пока нет.'
      : selCats.size ? 'Ничего не нашлось по этим категориям. Сними фильтры, чтобы увидеть всё.'
      : 'Пока ничего не нашлось. Загляни позже — события появляются каждый день.';
    root.innerHTML = '<p class="block-sub" style="padding-top:40px">' + msg + '</p>';
    return;
  }
  if (mode === 'upcoming') groups = fillWeekendGaps(groups);
  groups.forEach(g => {
    const rel = mode === 'past' ? '' : relLabel(g.sat), range = rangeLabel(g.sat);
    const sec = document.createElement('section');
    sec.className = 'weekend reveal';
    sec.innerHTML =
      `<div class="wk-head">
         <span class="wk-rel">${rel || range}</span>
         ${rel ? `<span class="wk-date">${range}</span>` : ''}
       </div>
       ${g.items.length
         ? '<div class="cards"></div>'
         : '<div class="empty-wk"><p class="empty-wk-t">В эти выходные ничего не нашлось</p><p class="empty-wk-s">Попробуй другие выходные или <a href="#links" class="empty-link">посмотри где ещё искать</a></p></div>'}`;
    if (g.items.length) {
      const cards = sec.querySelector('.cards');
      g.items.forEach(e => cards.appendChild(eventCard(e)));
    }
    root.appendChild(sec);
  });
  observeReveal();
}

function eventCard(e){
  const d = new Date(e.start);
  const price = (e.price && e.price !== 'уточняется') ? e.price : '';
  const free = /беспл|свобод/i.test(price);
  const el = document.createElement('article');
  el.className = 'ev'; el.tabIndex = 0;
  el.innerHTML =
    `<div class="ev-day"><span class="w">${WD[d.getDay()]}</span><span class="d">${d.getDate()}</span><span class="mo">${MONTHS[d.getMonth()].slice(0,3)}</span></div>
     <div class="ev-body">
       <span class="ev-cat">${e.category_label || 'Событие'}</span>
       <h3 class="ev-title">${stripEmoji(e.title)}</h3>
       ${e.place ? `<p class="ev-place">${e.place}</p>` : ''}
       ${price ? `<p class="ev-price ${free ? 'free' : ''}">${price}</p>` : ''}
       <span class="ev-cta">Подробнее →</span>
     </div>`;
  el.addEventListener('click', () => openSheet(e));
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') openSheet(e); });
  return el;
}

/* ---------- фильтры ---------- */
function buildFilters(){
  const labels = [...new Set([...DATA.events, ...(DATA.past || [])]
    .filter(e => !e.season_long).map(catKey))].sort((a, b) => a.localeCompare(b, 'ru'));
  const box = document.getElementById('filters');
  box.innerHTML = '';
  labels.forEach(label => {
    const chip = document.createElement('button');
    chip.className = 'chip'; chip.textContent = label;
    chip.addEventListener('click', () => {
      if (selCats.has(label)){ selCats.delete(label); chip.classList.remove('on'); }
      else { selCats.add(label); chip.classList.add('on'); }
      renderAgenda();
    });
    box.appendChild(chip);
  });
}

/* ---------- всё лето ---------- */
function buildSummer(){
  const box = document.getElementById('summer-cards');
  const list = DATA.events.filter(e => e.season_long).sort((a,b) => (b.featured?1:0)-(a.featured?1:0));
  box.innerHTML = '';
  list.forEach(e => {
    const card = document.createElement('article');
    card.className = 'card reveal';
    card.innerHTML =
      `<span class="tag">Всё лето</span>
       <h4>${stripEmoji(e.title)}</h4>
       <p class="cw">${e.place || 'Москва'}</p>
       <p class="cd">${e.description || ''}</p>
       <span class="cgo">Подробнее →</span>`;
    card.addEventListener('click', () => openSheet(e));
    box.appendChild(card);
  });
}

/* ---------- где искать ---------- */
const ICON_GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18"/></svg>`;
const ICON_TG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 2.7 11.8c-1 .4-1 1.8.1 2.1l4.9 1.5 1.9 5.9c.3.8 1.3 1 1.9.3l2.6-2.6 4.9 3.6c.7.5 1.6.1 1.8-.7L23.1 5.5c.2-1-.6-1.7-1.2-1.2z"/></svg>`;
const AFISHA = [['KudaGo','события Москвы','https://kudago.com/msk/'],['Лето в Москве','городская программа','https://leto.mos.ru/'],['Афиша','афиша города','https://www.afisha.ru/msk/']];
const TG = [['DEX','@club_dex','https://t.me/club_dex'],['Хлебозавод','@Hlebozavod9','https://t.me/Hlebozavod9'],['Supermetall','@supermetall','https://t.me/supermetall'],['Винзавод','@cca_winzavod','https://t.me/cca_winzavod']];
function buildLinks(){
  const grp = (title, items, icon) =>
    `<div class="lg"><h3>${title}</h3><div class="lcols">` +
    items.map(([t,s,u]) => `<a class="lnk" href="${u}" target="_blank" rel="noopener"><span class="ic">${icon}</span><span>${t}<small>${s}</small></span></a>`).join('') +
    `</div></div>`;
  document.getElementById('links-wrap').innerHTML = grp('Афиши', AFISHA, ICON_GLOBE) + grp('Телеграм-каналы', TG, ICON_TG);
}

/* ---------- sheet ---------- */
const overlay = document.getElementById('overlay');
function openSheet(p){
  document.getElementById('s-cat').textContent = p.category_label || 'Событие';
  document.getElementById('s-title').textContent = (p.featured ? '★ ' : '') + stripEmoji(p.title);
  document.getElementById('s-when').innerHTML  = '<span class="k">когда</span>' + (p.season_long ? 'весь сезон' : fmtWhen(p));
  document.getElementById('s-where').innerHTML = p.place ? '<span class="k">где</span>' + p.place + (p.address ? ', ' + p.address : '') : '';
  document.getElementById('s-price').innerHTML = (p.price && p.price !== 'уточняется') ? '<span class="k">цена</span>' + p.price : '';
  document.getElementById('s-desc').textContent = p.description || '';
  const url = document.getElementById('s-url');
  if (p.url){ url.href = p.url; url.style.display = 'block'; } else url.style.display = 'none';
  overlay.classList.add('show');
}
const closeSheet = () => overlay.classList.remove('show');
document.getElementById('sheetClose').addEventListener('click', closeSheet);
overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
function fmtWhen(p){
  try{
    const s = new Date(p.start);
    const base = p.allDay ? {day:'numeric',month:'long'} : {weekday:'short',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'};
    let out = s.toLocaleString('ru-RU', base);
    if (p.end && !p.allDay){ const e = new Date(p.end);
      if (e.toDateString() !== s.toDateString()) out += ' – ' + e.toLocaleString('ru-RU',{day:'numeric',month:'long'}); }
    return out;
  }catch(_){ return p.start || ''; }
}

/* ---------- reveal + hue ---------- */
let io;
function observeReveal(){
  if (!('IntersectionObserver' in window)){ document.querySelectorAll('.reveal').forEach(n=>n.classList.add('in')); return; }
  io = io || new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: .08, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach((n,i) => { n.style.transitionDelay = Math.min(i % 6, 5) * 45 + 'ms'; io.observe(n); });
  // подстраховка: если по какой-то причине наблюдатель не сработал — показать всё
  clearTimeout(window.__revealFb);
  window.__revealFb = setTimeout(() => document.querySelectorAll('.reveal:not(.in)').forEach(n => n.classList.add('in')), 2000);
}

/* ---------- свежесть данных ---------- */
const FRESH_HOURS = 24;    // до 24 ч — зелёный
const AGING_HOURS = 48;    // 24–48 ч — жёлтый, 48+ — красный + баннер
function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function formatAge(ageH){
  if (ageH < 1) return 'только что';
  if (ageH < 24){
    const h = Math.round(ageH);
    return `${h} ${plural(h,'час','часа','часов')} назад`;
  }
  const d = Math.floor(ageH / 24);
  return `${d} ${plural(d,'день','дня','дней')} назад`;
}
function updateFreshness(generated, gDate){
  const el = document.getElementById('freshness');
  const text = document.getElementById('f-text');
  if (!el || !text) return;
  if (!generated || isNaN(generated)){
    el.className = 'freshness stale';
    text.textContent = 'дата обновления неизвестна';
    return;
  }
  const ageH = (Date.now() - generated) / 36e5;
  if (ageH < FRESH_HOURS){
    el.className = 'freshness fresh';
    text.textContent = 'Обновлено сегодня · ' + gDate.toLocaleString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  } else if (ageH < AGING_HOURS){
    el.className = 'freshness aging';
    text.textContent = 'Обновлено ' + formatAge(ageH);
  } else {
    el.className = 'freshness stale';
    text.textContent = 'Обновлено ' + formatAge(ageH);
  }
}
function checkStale(generated){
  const banner = document.getElementById('staleBanner');
  if (!banner) return;
  if (!generated || isNaN(generated)){
    document.getElementById('staleAge').textContent = 'неизвестно когда';
    banner.hidden = false;
    return;
  }
  const ageH = (Date.now() - generated) / 36e5;
  if (ageH < AGING_HOURS){ banner.hidden = true; return; }
  const days = Math.floor(ageH / 24);
  document.getElementById('staleAge').textContent =
    days >= 1 ? `${days} ${plural(days,'день','дня','дней')} назад` : `${Math.round(ageH)} ч назад`;
  banner.hidden = false;
}

/* ---------- старт ---------- */
// Датированные ТГ-события втекают в общий календарь через бэкенд (fetch_events.py
// мёрджит их в events.json — НЕ дублируем concat'ом на фронте). telegram.json
// грузим только ради ленты «Из каналов» (сырые посты, в т.ч. без даты) —
// временная вкладка, пока не вытащим все события в календарь.
const cb = '?cb=' + Date.now();
Promise.all([
  fetch('data/events.json' + cb).then(r => r.json()),
  fetch('data/telegram.json' + cb).then(r => r.json()).catch(() => ({ posts: [], events: [] }))
]).then(([d, tg]) => {
    DATA = d;
    DATA.tg = tg;
    const g = d.generated_at ? new Date(d.generated_at) : null;
    const gTs = g ? g.getTime() : null;
    document.getElementById('stamp').textContent = g
      ? 'обновлено ' + g.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    updateFreshness(gTs, g);
    checkStale(gTs);
    buildFilters(); renderAgenda(); buildSummer(); buildLinks(); observeReveal();
  })
  .catch(err => { document.getElementById('agenda').innerHTML = '<p class="block-sub" style="padding-top:40px">Не удалось загрузить данные. ' + err + '</p>'; });

/* ---------- переключение видов ---------- */
document.querySelectorAll('.vtab').forEach(b => {
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    document.querySelectorAll('.vtab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
    document.querySelectorAll('[data-cal]').forEach(el => { el.style.display = v === 'calendar' ? '' : 'none'; });
    window.scrollTo(0, 0);
    if (v === 'feed' && !window.__feedLoaded){ window.__feedLoaded = true; loadFeed(); }
    if (v === 'map') loadMap();
  });
});

/* ---------- переключатель Ближайшие/Прошлые ---------- */
document.getElementById('seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.mode;
  document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('on', x === b));
  renderAgenda();
});

/* ---------- карта (Яндекс) ---------- */
const YKEY = '1febd3f7-9111-40fa-85da-4a9efca2f3d1';
function loadMap(){
  if (window.__mapInit) return; window.__mapInit = true;
  const s = document.createElement('script');
  s.src = `https://api-maps.yandex.ru/2.1/?apikey=${YKEY}&lang=ru_RU`;
  s.onload = () => window.ymaps && ymaps.ready(initMap);
  s.onerror = () => { document.getElementById('map').innerHTML = '<p class="block-sub" style="padding:20px">Не удалось загрузить карту.</p>'; window.__mapInit = false; };
  document.head.appendChild(s);
}
function initMap(){
  const pts = (DATA ? DATA.events : []).filter(e => e.lat && e.lon &&
    (e.season_long || new Date(e.end || e.start) >= new Date()));
  const map = new ymaps.Map('map', { center: [55.7522, 37.6156], zoom: 11,
    controls: ['zoomControl', 'geolocationControl'] }, { suppressMapOpenBlock: true });
  pts.forEach(e => {
    const pm = new ymaps.Placemark([e.lat, e.lon],
      { hintContent: stripEmoji(e.title), balloonContent: (e.place || '') + (e.price ? ' · ' + e.price : '') },
      { preset: e.featured ? 'islands#redStretchyIcon' : 'islands#orangeDotIcon',
        iconColor: '#FF4A1C' });
    pm.events.add('click', (ev) => { ev.preventDefault(); openSheet(e); });
    map.geoObjects.add(pm);
  });
  if (pts.length) map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
}


/* ---------- лента из каналов (временная, fallback для постов) ---------- */
function relTime(iso){
  const d = new Date(iso), diff = (Date.now() - d) / 36e5;
  if (diff < 1) return Math.max(1, Math.round(diff * 60)) + ' мин назад';
  if (diff < 24) return Math.round(diff) + ' ч назад';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function loadFeed(){
  const box = document.getElementById('feed');
  const d = DATA && DATA.tg;
  if (!d || !d.posts || !d.posts.length){ box.innerHTML = '<p class="block-sub">Пока пусто. Лента обновляется по расписанию.</p>'; return; }
  box.innerHTML = '';
  d.posts.forEach(p => {
    const a = document.createElement('a');
    a.className = 'post'; a.href = p.link; a.target = '_blank'; a.rel = 'noopener';
    const hints = [
      p.date_hint ? `<span class="hint dt">${p.date_hint}</span>` : '',
      p.place_hint ? `<span class="hint">${p.place_hint}</span>` : ''
    ].join('');
    a.innerHTML =
      `<div class="post-head"><span class="post-ch">${p.channel}</span><span class="post-time">${relTime(p.datetime)}</span></div>
       ${p.photo ? `<div class="post-img" style="background-image:url('${p.photo}')"></div>` : ''}
       <p class="post-text">${(p.text || '').replace(/</g,'&lt;')}</p>
       ${hints ? `<div class="post-hints">${hints}</div>` : ''}
       <span class="post-go">Открыть в канале →</span>`;
    box.appendChild(a);
  });
}
