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
const dated = () => DATA.events
  .filter(e => !e.season_long && (selCats.size === 0 || selCats.has(e.category)) &&
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

/* ---------- агенда ---------- */
function renderAgenda(){
  const root = document.getElementById('agenda');
  const groups = groupByWeekend(dated());
  root.innerHTML = '';
  if (!groups.length){ root.innerHTML = '<p class="block-sub" style="padding-top:40px">Ничего не нашлось — сними фильтры.</p>'; return; }
  groups.forEach(g => {
    const rel = relLabel(g.sat), range = rangeLabel(g.sat);
    const sec = document.createElement('section');
    sec.className = 'weekend reveal';
    sec.innerHTML =
      `<div class="wk-head">
         <span class="wk-rel">${rel || range}</span>
         ${rel ? `<span class="wk-date">${range}</span>` : ''}
       </div>
       <div class="cards"></div>`;
    const cards = sec.querySelector('.cards');
    g.items.forEach(e => cards.appendChild(eventCard(e)));
    root.appendChild(sec);
  });
  observeReveal();
}

function eventCard(e){
  const d = new Date(e.start);
  const free = /беспл|свобод/i.test(e.price || '');
  const el = document.createElement('article');
  el.className = 'ev'; el.tabIndex = 0;
  el.innerHTML =
    `<div class="ev-day"><span class="w">${WD[d.getDay()]}</span><span class="d">${d.getDate()}</span><span class="mo">${MONTHS[d.getMonth()].slice(0,3)}</span></div>
     <div class="ev-body">
       <span class="ev-cat">${e.category_label || 'Событие'}</span>
       <h3 class="ev-title">${stripEmoji(e.title)}</h3>
       ${e.place ? `<p class="ev-place">${e.place}</p>` : ''}
       <p class="ev-price ${free ? 'free' : ''}">${e.price || 'уточняется'}</p>
       <span class="ev-cta">Подробнее →</span>
     </div>`;
  el.addEventListener('click', () => openSheet(e));
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') openSheet(e); });
  return el;
}

/* ---------- фильтры ---------- */
function buildFilters(){
  const cats = {};
  DATA.events.filter(e => !e.season_long).forEach(e => cats[e.category] = e.category_label || e.category);
  const box = document.getElementById('filters');
  box.innerHTML = '';
  Object.entries(cats).forEach(([slug, label]) => {
    const chip = document.createElement('button');
    chip.className = 'chip'; chip.textContent = label;
    chip.addEventListener('click', () => {
      if (selCats.has(slug)){ selCats.delete(slug); chip.classList.remove('on'); }
      else { selCats.add(slug); chip.classList.add('on'); }
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
const TG = [['Москва. Афиша','@afishams','https://t.me/afishams'],['Бесплатная Москва','@moscowafishi','https://t.me/moscowafishi'],['Московские Гуляки','@Mosgul','https://t.me/Mosgul'],['Бесплатно в Москве','@msk4free','https://t.me/msk4free'],['MosTrips','@MosTrips','https://t.me/MosTrips'],['Вечерняя Москва','@moscowes','https://t.me/moscowes']];
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
  document.getElementById('s-price').innerHTML = p.price ? '<span class="k">цена</span>' + p.price : '';
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

/* ---------- старт ---------- */
fetch('data/events.json?cb=' + Date.now())
  .then(r => r.json())
  .then(d => {
    DATA = d;
    const g = d.generated_at ? new Date(d.generated_at) : null;
    document.getElementById('stamp').textContent = g
      ? 'обновлено ' + g.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    buildFilters(); renderAgenda(); buildSummer(); buildLinks(); observeReveal();
  })
  .catch(err => { document.getElementById('agenda').innerHTML = '<p class="block-sub" style="padding-top:40px">Не удалось загрузить данные. ' + err + '</p>'; });

/* ---------- переключение видов ---------- */
document.querySelectorAll('.vtab').forEach(b => {
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    document.querySelectorAll('.vtab').forEach(x => x.classList.toggle('active', x === b));
    document.getElementById('view-calendar').hidden = v !== 'calendar';
    document.getElementById('view-feed').hidden = v !== 'feed';
    document.querySelectorAll('[data-cal]').forEach(el => { el.style.display = v === 'calendar' ? '' : 'none'; });
    window.scrollTo(0, 0);
    if (v === 'feed' && !window.__feedLoaded){ window.__feedLoaded = true; loadFeed(); }
  });
});

/* ---------- лента из каналов ---------- */
function relTime(iso){
  const d = new Date(iso), diff = (Date.now() - d) / 36e5;
  if (diff < 1) return Math.max(1, Math.round(diff * 60)) + ' мин назад';
  if (diff < 24) return Math.round(diff) + ' ч назад';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function loadFeed(){
  const box = document.getElementById('feed');
  box.innerHTML = '<p class="block-sub">Загружаю…</p>';
  fetch('data/telegram.json?cb=' + Date.now())
    .then(r => r.json())
    .then(d => {
      if (!d.posts || !d.posts.length){ box.innerHTML = '<p class="block-sub">Пока пусто. Лента обновляется раз в день.</p>'; return; }
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
    })
    .catch(() => { box.innerHTML = '<p class="block-sub">Не удалось загрузить ленту.</p>'; });
}
