'use strict';

const COLORS = {
  festival:'#7c5cff', party:'#ff5d8f', holiday:'#ffd166', recreation:'#37d4a7',
  entertainment:'#3ec6ff', quest:'#ff7a59', tour:'#b388ff', fashion:'#ff5d8f',
  'yarmarki-razvlecheniya-yarmarki':'#ffb04d', other:'#9aa0b0'
};
const colorOf = c => COLORS[c] || '#7c5cff';

let DATA = null;
let calendar = null;
const activeCats = new Set();      // пустой = показывать все

// ---------- вкладки ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'calendar' && calendar) calendar.updateSize();
  });
});

// ---------- модалка ----------
const overlay = document.getElementById('overlay');
function openModal(p){
  const cat = document.getElementById('m-cat');
  cat.textContent = p.category_label || 'Событие';
  cat.style.background = colorOf(p.category);
  document.getElementById('m-title').textContent = p.title || '';
  document.getElementById('m-when').textContent = p.season_long ? '🗓 идёт всё лето' : ('🕒 ' + fmtWhen(p));
  document.getElementById('m-where').textContent = p.place ? ('📍 ' + p.place + (p.address ? ', ' + p.address : '')) : '';
  document.getElementById('m-price').textContent = p.price ? ('💸 ' + p.price) : '';
  document.getElementById('m-desc').textContent = p.description || '';
  const url = document.getElementById('m-url');
  if (p.url){ url.href = p.url; url.style.display = 'block'; } else { url.style.display = 'none'; }
  overlay.classList.add('show');
}
function closeModal(){ overlay.classList.remove('show'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function fmtWhen(p){
  const opt = { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' };
  try{
    const s = new Date(p.start);
    let out = s.toLocaleString('ru-RU', p.allDay ? {day:'numeric',month:'long'} : opt);
    if (p.end && !p.allDay){
      const e = new Date(p.end);
      if (e.toDateString() !== s.toDateString())
        out += ' – ' + e.toLocaleString('ru-RU', {day:'numeric',month:'long'});
    }
    return out;
  }catch(_){ return p.start || ''; }
}

// ---------- фильтры-чипы ----------
function buildFilters(events){
  const cats = {};
  events.filter(e => !e.season_long).forEach(e => {
    cats[e.category] = e.category_label || e.category;
  });
  const box = document.getElementById('filters');
  box.innerHTML = '';
  Object.entries(cats).forEach(([slug, label]) => {
    const chip = document.createElement('span');
    chip.className = 'chip on';
    chip.style.background = colorOf(slug);
    chip.innerHTML = `<span class="dot" style="background:#0e0f13"></span>${label}`;
    chip.addEventListener('click', () => {
      if (activeCats.has(slug)){ activeCats.delete(slug); chip.classList.remove('on');
        chip.style.background=''; chip.style.color=''; }
      else { activeCats.add(slug); chip.classList.add('on'); chip.style.background=colorOf(slug); }
      refreshCalendar();
    });
    activeCats.add(slug);
    box.appendChild(chip);
  });
}

function visibleEvents(){
  return DATA.events.filter(e => !e.season_long && (activeCats.size === 0 || activeCats.has(e.category)));
}
function refreshCalendar(){
  if (!calendar) return;
  calendar.removeAllEvents();
  calendar.addEventSource(visibleEvents().map(toFcEvent));
}
function toFcEvent(e){
  const col = colorOf(e.category);
  return {
    id:e.id, title:(e.featured?'⭐ ':'') + e.title, start:e.start, end:e.end, allDay:e.allDay,
    backgroundColor:col, borderColor:col, textColor:'#0e0f13',
    classNames:e.featured?['ev-featured']:[], extendedProps:e
  };
}

// ---------- календарь ----------
function initCalendar(){
  const el = document.getElementById('calendar');
  const isMobile = window.innerWidth < 600;
  calendar = new FullCalendar.Calendar(el, {
    locale:'ru', firstDay:1, height:'auto',
    initialView: isMobile ? 'listMonth' : 'dayGridMonth',
    initialDate: DATA.firstEventDate || undefined,
    headerToolbar:{ left:'prev,next today', center:'title', right:'dayGridMonth,listMonth' },
    buttonText:{ today:'сегодня', month:'месяц', list:'список' },
    noEventsText:'В этот месяц пока пусто — листай вперёд или загляни во «Всё лето»',
    displayEventTime:true, eventDisplay:'block',
    eventTimeFormat:{ hour:'2-digit', minute:'2-digit' },
    events: visibleEvents().map(toFcEvent),
    eventClick(info){ info.jsEvent.preventDefault(); openModal(info.event.extendedProps); }
  });
  calendar.render();
}

// ---------- «Всё лето» ----------
function buildSummer(events){
  const box = document.getElementById('summer-cards');
  const list = events.filter(e => e.season_long)
    .sort((a,b) => (b.featured?1:0) - (a.featured?1:0));
  box.innerHTML = '';
  if (!list.length){ box.innerHTML = '<p class="panel-lead">Пока ничего сезонного.</p>'; return; }
  list.forEach(e => {
    const card = document.createElement('div');
    card.className = 'card' + (e.featured ? ' featured' : '');
    card.innerHTML =
      `<span class="c-cat" style="background:${colorOf(e.category)}">${e.category_label||'Сезон'}</span>
       <h4>${e.featured?'⭐ ':''}${e.title}</h4>
       <p class="c-where">📍 ${e.place||'Москва'}</p>
       <p class="c-desc">${e.description||''}</p>
       <span class="c-go">Подробнее ↗</span>`;
    card.addEventListener('click', () => openModal(e));
    box.appendChild(card);
  });
}

// ---------- источники ----------
function buildSources(){
  const c = DATA.counts || {};
  const ok = DATA.kudago_ok;
  document.getElementById('sources-status').innerHTML =
    `<div class="stat"><b>${c.total||0}</b>событий всего</div>
     <div class="stat"><b>${c.curated||0}</b>курируемых</div>
     <div class="stat ${ok?'ok':'bad'}"><b>${c.kudago||0}</b>из KudaGo ${ok?'✓':'⚠'}</div>
     <div class="stat"><b>${c.season_long||0}</b>на всё лето</div>`;
}

// ---------- старт ----------
fetch('data/events.json?cb=' + Date.now())
  .then(r => r.json())
  .then(d => {
    DATA = d;
    const dated = d.events.filter(e => !e.season_long && new Date(e.start) >= new Date(Date.now()-86400000));
    DATA.firstEventDate = dated.length ? dated.sort((a,b)=>a.start<b.start?-1:1)[0].start : undefined;

    const gen = d.generated_at ? new Date(d.generated_at) : null;
    document.getElementById('updated').textContent = gen
      ? 'обновлено ' + gen.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
      : '';

    buildFilters(d.events);
    initCalendar();
    buildSummer(d.events);
    buildSources();
  })
  .catch(err => {
    document.getElementById('updated').textContent = 'ошибка загрузки данных';
    document.getElementById('calendar').innerHTML =
      '<p class="hint">Не удалось загрузить data/events.json. ' + err + '</p>';
  });
