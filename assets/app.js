'use strict';

const COLORS = {
  festival:'#2563EB', party:'#DB2777', holiday:'#D97706', recreation:'#059669',
  entertainment:'#0891B2', quest:'#EA580C', tour:'#7C3AED', fashion:'#DB2777',
  'yarmarki-razvlecheniya-yarmarki':'#CA8A04', other:'#64748B'
};
const colorOf = c => COLORS[c] || '#2563EB';
const WD = ['вс','пн','вт','ср','чт','пт','сб'];
const isWeekend = d => { const x = new Date(d).getDay(); return x === 0 || x === 6; };

let DATA = null, calendar = null;
const offCats = new Set();         // выключенные категории
let segMode = 'weekend';

/* ---------- вкладки ---------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'calendar' && calendar) setTimeout(() => calendar.updateSize(), 30);
  });
});

/* ---------- модалка ---------- */
const overlay = document.getElementById('overlay');
function openModal(p){
  const cat = document.getElementById('m-cat');
  cat.innerHTML = `<span class="dot" style="background:${colorOf(p.category)}"></span>${p.category_label || 'Событие'}`;
  document.getElementById('m-title').textContent = (p.featured ? '★ ' : '') + (p.title || '');
  document.getElementById('m-when').innerHTML  = p.season_long
    ? '<span class="k">◷</span>идёт весь сезон'
    : '<span class="k">◷</span>' + fmtWhen(p);
  document.getElementById('m-where').innerHTML  = p.place
    ? '<span class="k">⌖</span>' + p.place + (p.address ? ', ' + p.address : '') : '';
  document.getElementById('m-price').innerHTML  = p.price ? '<span class="k">₽</span>' + p.price : '';
  document.getElementById('m-desc').textContent = p.description || '';
  const url = document.getElementById('m-url');
  if (p.url){ url.href = p.url; url.style.display = 'block'; } else { url.style.display = 'none'; }
  overlay.classList.add('show');
}
const closeModal = () => overlay.classList.remove('show');
document.getElementById('m-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function fmtWhen(p){
  try{
    const s = new Date(p.start);
    const base = p.allDay ? {day:'numeric',month:'long'} : {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'};
    let out = s.toLocaleString('ru-RU', base);
    if (p.end && !p.allDay){
      const e = new Date(p.end);
      if (e.toDateString() !== s.toDateString())
        out += ' – ' + e.toLocaleString('ru-RU', {day:'numeric',month:'long'});
    }
    return out;
  }catch(_){ return p.start || ''; }
}

/* ---------- фильтры ---------- */
function buildFilters(events){
  const cats = {};
  events.filter(e => !e.season_long).forEach(e => cats[e.category] = e.category_label || e.category);
  const box = document.getElementById('filters');
  box.innerHTML = '';
  Object.entries(cats).forEach(([slug, label]) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = `<span class="dot" style="background:${colorOf(slug)}"></span>${label}`;
    chip.addEventListener('click', () => {
      if (offCats.has(slug)){ offCats.delete(slug); chip.classList.remove('off'); }
      else { offCats.add(slug); chip.classList.add('off'); }
      renderAll();
    });
    box.appendChild(chip);
  });
}

const datedEvents = () => DATA.events.filter(e =>
  !e.season_long && !offCats.has(e.category) &&
  new Date(e.end || e.start) >= new Date(Date.now() - 86400000));

/* ---------- календарь ---------- */
function toFc(e){
  return { id:e.id, title:(e.featured ? '★ ' : '') + e.title, start:e.start, end:e.end, allDay:e.allDay,
    classNames:e.featured ? ['ev-feat'] : [], extendedProps:e };
}
function initCalendar(){
  const mobile = window.innerWidth < 700;
  calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    locale:'ru', firstDay:1, height:'auto',
    initialView: mobile ? 'listMonth' : 'dayGridMonth',
    initialDate: DATA.firstDate || undefined,
    headerToolbar:{ left:'prev,next today', center:'title', right: mobile ? '' : 'dayGridMonth,listMonth' },
    buttonText:{ today:'сегодня', month:'месяц', list:'список' },
    noEventsText:'В этом месяце пусто — листайте вперёд',
    displayEventTime:true, eventDisplay:'block',
    eventTimeFormat:{ hour:'2-digit', minute:'2-digit' },
    events: datedEvents().map(toFc),
    eventDidMount(info){ info.el.style.setProperty('--ev', colorOf(info.event.extendedProps.category)); },
    eventClick(info){ info.jsEvent.preventDefault(); openModal(info.event.extendedProps); }
  });
  calendar.render();
}
function refreshCalendar(){
  if (!calendar) return;
  calendar.removeAllEvents();
  calendar.addEventSource(datedEvents().map(toFc));
}

/* ---------- «Ближайшее» ---------- */
function buildUpcoming(){
  const box = document.getElementById('up-list');
  let list = datedEvents().sort((a,b) => a.start < b.start ? -1 : 1);
  if (segMode === 'weekend') list = list.filter(e => isWeekend(e.start));
  box.innerHTML = '';
  if (!list.length){
    box.innerHTML = '<div class="empty">' +
      (segMode === 'weekend' ? 'На ближайшие выходные пока ничего. Жми «Всё».' : 'Пока ничего.') + '</div>';
    return;
  }
  list.slice(0, 40).forEach(e => {
    const d = new Date(e.start), we = isWeekend(e.start);
    const card = document.createElement('div');
    card.className = 'uev' + (we ? ' wknd' : '');
    card.innerHTML =
      `<div class="date tnum">
         <span class="dd">${d.getDate()}</span>
         <span class="mo">${d.toLocaleString('ru-RU',{month:'short'}).replace('.','')}</span>
         <span class="wd ${we?'we':''}">${WD[d.getDay()]}</span>
       </div>
       <div class="info">
         <p class="ttl"><span class="cdot" style="background:${colorOf(e.category)}"></span>
            ${e.featured?'<span class="star">★</span> ':''}${e.title}</p>
         <p class="meta">${e.place || e.category_label || ''}${e.price ? ' · ' + e.price : ''}</p>
       </div>`;
    card.addEventListener('click', () => openModal(e));
    box.appendChild(card);
  });
}
document.getElementById('seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  segMode = b.dataset.seg;
  document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('on', x === b));
  buildUpcoming();
});

/* ---------- всё лето ---------- */
function buildSummer(){
  const box = document.getElementById('summer-cards');
  const list = DATA.events.filter(e => e.season_long).sort((a,b) => (b.featured?1:0)-(a.featured?1:0));
  box.innerHTML = '';
  list.forEach(e => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      `<span class="cc"><span class="dot" style="background:${colorOf(e.category)}"></span>${e.category_label||'Сезон'}</span>
       <h4>${e.featured?'★ ':''}${e.title}</h4>
       <p class="cw">${e.place || 'Москва'}</p>
       <p class="cd">${e.description || ''}</p>
       <span class="cgo">Подробнее →</span>`;
    card.addEventListener('click', () => openModal(e));
    box.appendChild(card);
  });
}

/* ---------- где ещё искать ---------- */
const ICON_GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18"/></svg>`;
const ICON_TG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 2.7 11.8c-1 .4-1 1.8.1 2.1l4.9 1.5 1.9 5.9c.3.8 1.3 1 1.9.3l2.6-2.6 4.9 3.6c.7.5 1.6.1 1.8-.7L23.1 5.5c.2-1-.6-1.7-1.2-1.2z"/></svg>`;
const AFISHA = [
  ['KudaGo', 'события Москвы', 'https://kudago.com/msk/'],
  ['Лето в Москве', 'городская программа', 'https://leto.mos.ru/'],
  ['Афиша', 'афиша города', 'https://www.afisha.ru/msk/']
];
const TG = [
  ['Москва. Афиша', '@afishams', 'https://t.me/afishams'],
  ['Бесплатная Москва', '@moscowafishi', 'https://t.me/moscowafishi'],
  ['Московские Гуляки', '@Mosgul', 'https://t.me/Mosgul'],
  ['Бесплатно в Москве', '@msk4free', 'https://t.me/msk4free'],
  ['MosTrips', '@MosTrips', 'https://t.me/MosTrips'],
  ['Вечерняя Москва', '@moscowes', 'https://t.me/moscowes']
];
function buildLinks(){
  const wrap = document.getElementById('links');
  const group = (title, items, icon) => {
    const cards = items.map(([t, s, u]) =>
      `<a class="lnk" href="${u}" target="_blank" rel="noopener">
         <span class="ic">${icon}</span><span>${t}<small>${s}</small></span></a>`).join('');
    return `<div class="links-group"><h3>${title}</h3><div class="linkcols">${cards}</div></div>`;
  };
  wrap.innerHTML = group('Афиши', AFISHA, ICON_GLOBE) + group('Телеграм-каналы', TG, ICON_TG);
}

/* ---------- рендер ---------- */
function renderAll(){ refreshCalendar(); buildUpcoming(); }

fetch('data/events.json?cb=' + Date.now())
  .then(r => r.json())
  .then(d => {
    DATA = d;
    const up = d.events.filter(e => !e.season_long && new Date(e.end||e.start) >= new Date(Date.now()-86400000))
                       .sort((a,b) => a.start < b.start ? -1 : 1);
    DATA.firstDate = up.length ? up[0].start : undefined;

    const g = d.generated_at ? new Date(d.generated_at) : null;
    document.getElementById('updated').textContent = g
      ? 'обновлено ' + g.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';

    buildFilters(d.events);
    initCalendar();
    buildUpcoming();
    buildSummer();
    buildLinks();
  })
  .catch(err => {
    document.getElementById('updated').textContent = 'ошибка загрузки';
    document.getElementById('up-list').innerHTML = '<div class="empty">Не удалось загрузить данные. ' + err + '</div>';
  });
