import { dateKey, addDays, navigateDate, viewDates, validEvent, eventsForDate, compareEvents, eventColor, randomDarkColor, inferredTime } from './calendar.mjs';
import { loadEvents, saveEvent, deleteEvent, loadView, saveView } from './storage.mjs';

import { packRow } from './layout.mjs';

const $ = id => document.getElementById(id);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('calendar-changes') : null;
let storageReady = false;
let saving = false;
let events = [];
let view = 'month';
let viewSelected = false;
let anchor = new Date();
let editingId = null;
let lastDay = dateKey(new Date());
let toastTimer;
let daySelection = null;
let draftEvent = null;
function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
async function refreshEvents() {
  const saved = await loadEvents();
  if (!saved.every(validEvent)) throw new Error('Invalid saved events');
  events = saved;
  storageReady = true;
  render();
}
async function persist(action) {
  if (saving) return false;
  saving = true;
  const buttons = [...$('event-form').querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await action();
    await refreshEvents();
    channel?.postMessage('changed');
    return true;
  } catch {
    $('form-error').textContent = 'Could not save. Device storage may be full or unavailable. Please try again.';
    return false;
  } finally {
    saving = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}
const format = (date, options) => new Intl.DateTimeFormat(undefined, options).format(date);
function render(preserveSelection = false) {
  if (!preserveSelection) cancelDaySelection(false);
  const dates = viewDates(anchor, view);
  const first = dates[0], last = dates.at(-1), today = dateKey(new Date());
  $('today').disabled = view === 'month'
    ? dateKey(anchor).slice(0, 7) === today.slice(0, 7)
    : dateKey(anchor) === today;
  const rangeStart = view === 'rolling' ? anchor : first;
  const rangeEnd = view === 'rolling' ? addDays(anchor, 29) : last;
  $('heading').textContent = view === 'month' ? format(anchor, { month: 'long', year: 'numeric' }) : rangeStart.getMonth() === rangeEnd.getMonth() ? format(rangeStart, { month: 'long', year: 'numeric' }) : `${format(rangeStart, { month: 'short', ...(rangeStart.getFullYear() !== rangeEnd.getFullYear() ? { year: 'numeric' } : {}) })} — ${format(rangeEnd, { month: 'short', year: 'numeric' })}`;
  $('month-view').setAttribute('aria-pressed', view === 'month');
  $('rolling-view').setAttribute('aria-pressed', view === 'rolling');
  $('previous').setAttribute('aria-label', `Previous ${view === 'month' ? 'month' : '30 days'}`);
  $('next').setAttribute('aria-label', `Next ${view === 'month' ? 'month' : '30 days'}`);
  const calendar = $('calendar');
  calendar.className = `calendar ${view}`;
  calendar.replaceChildren();
  document.documentElement.style.setProperty('--month-color', `hsl(${240 + anchor.getMonth() / 12 * 360}deg, 100%, 50%)`);
  calendar.style.setProperty('--rows', dates.length / 7);
  [...$('day-grid').children].forEach((label, index) => {
    label.textContent = format(dates[index], { weekday: 'short' });
  });
  const displayEvents = events.filter(event => event.id !== draftEvent?.id);
  if (draftEvent) displayEvents.push(draftEvent);
  if (daySelection) {
    const [date, endDate] = [daySelection.start, daySelection.end].sort();
    displayEvents.push({ id: daySelection.previewId, title: 'New event', date, endDate, color: daySelection.color });
  }
  for (const [index, date] of dates.entries()) {
    const key = dateKey(date);
    const day = document.createElement('section');
    const muted = view === 'rolling'
      ? key < dateKey(rangeStart) || key > dateKey(rangeEnd)
      : date.getMonth() !== anchor.getMonth();
    day.className = `day${key === today ? ' is-today' : ''}${muted ? ' other-month' : ''}`;
    day.dataset.date = key;
    day.dataset.row = Math.floor(index / 7);
    day.setAttribute('aria-label', format(date, { dateStyle: 'full' }));
    const surface = document.createElement('div');
    surface.className = 'day-selection-surface';
    surface.setAttribute('aria-hidden', 'true');
    day.append(surface);
    const heading = document.createElement('div');
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.className = 'day-heading';
    heading.setAttribute('aria-label', `Add event on ${format(date, { dateStyle: 'full' })}`);
    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = date.getDate();
    heading.append(number);
    heading.addEventListener('click', event => {
      // Keyboard and assistive-technology activation still works without a pointer.
      if (event.detail === 0) openEvent(key);
    });
    heading.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEvent(key);
      }
    });
    const top = document.createElement('div');
    top.className = 'day-top';
    top.append(heading);
    day.append(top);
    const list = document.createElement('div');
    list.className = 'day-events';
    function eventButton(event, multi = false) {
      const button = document.createElement('button');
      button.className = 'event';
      if (event.id === daySelection?.previewId || event.id === draftEvent?.id) {
        button.classList.add('event-preview');
        button.tabIndex = -1;
        button.setAttribute('aria-hidden', 'true');
      }
      button.setAttribute('aria-label', `Edit ${event.title}`);
      button.title = event.title;
      button.dataset.eventId = event.id;
      button.style.color = eventColor(event);
      const showName = !multi || key === event.date || key === dateKey(first);
      if (showName) {
        const title = document.createElement('span');
        title.className = 'event-title';
        title.textContent = event.title;
        button.append(title);
      }
      if (multi) {
        button.classList.add('event-span');
        button.classList.toggle('span-end', key === event.endDate);
        button.classList.toggle('span-continuation', !showName);
        const line = document.createElement('span');
        line.className = 'event-line';
        line.setAttribute('aria-hidden', 'true');
        button.append(line);
      }
      button.addEventListener('click', () => openEvent(key, event));
      return button;
    }
    const items = eventsForDate(displayEvents, key);
    for (const event of items) list.append(eventButton(event, event.endDate > event.date));
    day.append(list);
    calendar.append(day);
  }
  scheduleEventLines();
}
let lineFrame;
function scheduleEventLines() {
  cancelAnimationFrame(lineFrame);
  lineFrame = requestAnimationFrame(drawEventLines);
}
function layoutEvents() {
  const rows = new Map();
  // Restore natural sizes before measuring; previous positions never become inputs.
  for (const day of $('calendar').querySelectorAll('.day')) {
    const list = day.querySelector('.day-events');
    const top = day.querySelector('.day-top');
    const inline = top.querySelector('.event-inline');
    if (inline) { inline.classList.remove('event-inline'); list.append(inline); }
    top.classList.remove('has-inline-event');
    const buttons = [...list.querySelectorAll('.event')].sort((a, b) =>
      compareEvents({ title: a.title, id: a.dataset.eventId }, { title: b.title, id: b.dataset.eventId }));
    for (const button of buttons) {
      button.style.height = '';
      button.style.marginTop = '';
      button.style.order = '';
      list.append(button);
    }
    if (!rows.has(day.dataset.row)) rows.set(day.dataset.row, []);
    rows.get(day.dataset.row).push({ day, list, top, buttons });
  }
  let previousTops = new Map();
  for (const row of rows.values()) {
    const groups = new Map();
    const metrics = row.map(({ day, list, top, buttons }, column) => {
      // Account for per-cell scrolling so scrolling doesn't change the packing.
      const origin = day.getBoundingClientRect().top - day.scrollTop;
      const heading = top.querySelector('.day-heading');
      const headingStyle = getComputedStyle(heading);
      const listStyle = getComputedStyle(list);
      const dateWidth = heading.querySelector('.day-number').getBoundingClientRect().width +
        parseFloat(headingStyle.paddingLeft) + parseFloat(headingStyle.paddingRight);
      const available = top.clientWidth - dateWidth - parseFloat(listStyle.paddingLeft) - parseFloat(getComputedStyle(top).columnGap);
      for (const button of buttons) {
        const id = button.dataset.eventId;
        if (!groups.has(id)) groups.set(id, { id, title: button.title, columns: [], buttons: [], height: 0, heights: {}, timed: inferredTime(button.title) !== null });
        const item = groups.get(id);
        item.columns.push(column);
        item.buttons.push(button);
        item.heights[column] = button.getBoundingClientRect().height;
        item.height = Math.max(item.height, item.heights[column]);
        if (!button.classList.contains('event-span')) {
          const measure = button.querySelector('.event-title').cloneNode(true);
          Object.assign(measure.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre', width: 'max-content' });
          button.append(measure);
          item.header = measure.getBoundingClientRect().width <= available;
          measure.remove();
          // Measure the actual header style, including its smaller touch target.
          const clone = button.cloneNode(true);
          clone.classList.add('event-inline');
          Object.assign(clone.style, { position: 'absolute', visibility: 'hidden' });
          top.append(clone);
          item.headerHeight = clone.getBoundingClientRect().height;
          clone.remove();
        }
      }
      return {
        bodyTop: list.getBoundingClientRect().top - origin,
        bottom: day.clientHeight + day.clientTop - parseFloat(listStyle.paddingBottom),
        headerTop: top.getBoundingClientRect().top - origin + parseFloat(getComputedStyle(top).paddingTop),
        gap: parseFloat(listStyle.rowGap)
      };
    });
    const items = [...groups.values()].sort(compareEvents);
    const placements = packRow(items, metrics, { previousTops });
    // Carry only spans reaching the week boundary; start fresh on every layout.
    previousTops = new Map(placements.filter(p => items[p.index].columns.includes(row.length - 1) &&
      items[p.index].buttons[0].classList.contains('event-span')).map(p => [p.id, p.top]));
    for (const [column, { list, top }] of row.entries()) {
      let cursor = metrics[column].bodyTop;
      const local = placements.filter(p => items[p.index].columns.includes(column)).sort((a, b) => a.top - b.top);
      for (const [order, placement] of local.entries()) {
        const item = items[placement.index];
        const button = item.buttons[item.columns.indexOf(column)];
        if (placement.header) {
          button.classList.add('event-inline');
          top.classList.add('has-inline-event');
          top.prepend(button);
        } else {
          button.style.order = order;
          const height = placement.heights[column];
          button.style.height = `${height}px`;
          button.style.marginTop = `${Math.max(0, placement.top - cursor)}px`;
          cursor = placement.top + height + metrics[column].gap;
        }
      }
    }
  }
}
function drawEventLines() {
  const calendar = $('calendar');
  calendar.querySelector('.event-lines')?.remove();
  layoutEvents();
  const bounds = calendar.getBoundingClientRect();
  const groups = new Map();
  for (const line of calendar.querySelectorAll('.event-line')) {
    const button = line.closest('.event-span');
    const day = button.closest('.day');
    const rect = line.getBoundingClientRect();
    const dayBounds = day.getBoundingClientRect();
    if (rect.top < dayBounds.top || rect.bottom > dayBounds.bottom) continue;
    const id = button.dataset.eventId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ row: day.dataset.row, left: rect.left - bounds.left, right: rect.right - bounds.left, y: rect.top - bounds.top + .5 });
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('event-lines');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', bounds.width);
  svg.setAttribute('height', bounds.height);
  for (const [id, segments] of groups) {
    const rows = [];
    for (const segment of segments) {
      const previous = rows.at(-1);
      if (previous && previous.row === segment.row && Math.abs(previous.y - segment.y) < 1) previous.right = segment.right;
      else rows.push({ ...segment });
    }
    const path = document.createElementNS(ns, 'path');
    path.dataset.eventId = id;
    const preview = id === daySelection?.previewId || id === draftEvent?.id;
    path.classList.toggle('preview-line', preview);
    path.style.stroke = id === draftEvent?.id ? eventColor(draftEvent) : id === daySelection?.previewId ? daySelection.color : eventColor(events.find(event => event.id === id));
    // One continuous segment and arrowhead per calendar row.
    path.setAttribute('d', rows.map(row =>
      `M ${row.left} ${row.y} H ${row.right} M ${row.right - 5} ${row.y - 4} L ${row.right} ${row.y} L ${row.right - 5} ${row.y + 4}`
    ).join(' '));
    svg.append(path);
  }
  calendar.append(svg);
}
new ResizeObserver(scheduleEventLines).observe($('calendar'));
document.fonts.ready.then(scheduleEventLines);
$('calendar').addEventListener('scroll', scheduleEventLines, true);
function openEvent(key = dateKey(new Date()), event = null, endKey = key, previewId = crypto.randomUUID(), previewColor = null) {
  if (!storageReady) { notify('Event storage is unavailable. Reload to try again.'); return; }
  editingId = event?.id || null;
  $('event-form').reset();
  $('dialog-title').textContent = event ? 'Edit event' : 'Add event';
  $('event-title').value = event?.title || '';
  $('event-date').value = event?.date || key;
  $('event-end-date').value = event?.endDate || event?.date || endKey;
  $('event-end-date').min = $('event-date').value;
  $('event-color').value = event ? eventColor(event) : previewColor || randomDarkColor();
  $('delete-event').hidden = !event;
  $('form-error').textContent = '';
  draftEvent = event ? null : { id: previewId, title: 'New event', date: key, endDate: endKey, color: $('event-color').value };
  $('event-dialog').showModal();
  render();
}
function dayAtPoint(event) {
  const day = document.elementFromPoint(event.clientX, event.clientY)?.closest('.day');
  return day && $('calendar').contains(day) ? day : null;
}
function previewSelection() {
  render(true);
}
function cancelDaySelection(redraw = true) {
  const selection = daySelection;
  daySelection = null;
  if (selection && $('calendar').hasPointerCapture(selection.pointerId)) $('calendar').releasePointerCapture(selection.pointerId);
  if (selection && redraw) render();
}
$('calendar').addEventListener('pointerdown', event => {
  if (!event.isPrimary) { cancelDaySelection(); return; }
  if (event.button !== 0 || event.target.closest('.event') || $('event-dialog').open) return;
  const day = dayAtPoint(event);
  if (!day) return;
  event.preventDefault();
  daySelection = { previewId: crypto.randomUUID(), color: randomDarkColor(), pointerId: event.pointerId, start: day.dataset.date, end: day.dataset.date };
  $('calendar').setPointerCapture(event.pointerId);
  previewSelection();
});
$('calendar').addEventListener('pointermove', event => {
  if (daySelection?.pointerId !== event.pointerId) return;
  const day = dayAtPoint(event);
  if (day && day.dataset.date !== daySelection.end) { daySelection.end = day.dataset.date; previewSelection(); }
});
$('calendar').addEventListener('pointerup', event => {
  if (daySelection?.pointerId !== event.pointerId) return;
  const day = dayAtPoint(event);
  const { start, previewId, color } = daySelection;
  cancelDaySelection(false);
  if (!day) { render(); return; }
  const [from, to] = [start, day.dataset.date].sort();
  openEvent(from, null, to, previewId, color);
});
$('calendar').addEventListener('pointercancel', cancelDaySelection);
$('calendar').addEventListener('lostpointercapture', cancelDaySelection);
window.addEventListener('blur', cancelDaySelection);
document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelDaySelection(); });
$('event-date').addEventListener('input', () => {
  const start = $('event-date').value;
  const end = $('event-end-date');
  end.min = start;
  if (!end.value || end.value < start) end.value = start;
});
$('event-form').addEventListener('input', () => {
  if (!draftEvent) return;
  const candidate = {
    ...draftEvent,
    title: $('event-title').value.trim() || 'New event',
    date: $('event-date').value,
    endDate: $('event-end-date').value,
    color: $('event-color').value
  };
  // Keep the last valid range while a date field is temporarily incomplete.
  if (validEvent(candidate)) draftEvent = candidate;
  else draftEvent = { ...draftEvent, title: candidate.title, color: candidate.color };
  render();
});
$('event-dialog').addEventListener('close', () => {
  if (!$('event-dialog').open && draftEvent) {
    draftEvent = null;
    render();
  }
});
for (const id of ['close-dialog', 'cancel-dialog']) $(id).addEventListener('click', () => $('event-dialog').close());
$('event-form').addEventListener('submit', async event => {
  event.preventDefault();
  const item = { id: editingId || draftEvent?.id || crypto.randomUUID(), title: $('event-title').value.trim(), date: $('event-date').value, endDate: $('event-end-date').value, color: $('event-color').value };
  if (!validEvent(item)) { $('form-error').textContent = 'Enter an event name and valid dates. End date must be on or after start date.'; return; }
  if (!await persist(() => saveEvent(item))) return;
  $('event-dialog').close(); render();
});
$('delete-event').addEventListener('click', async () => {
  if (!await persist(() => deleteEvent(editingId))) return;
  $('event-dialog').close(); render();
});
function selectView(next) {
  viewSelected = true;
  view = next;
  render();
  saveView(next).catch(() => notify('Could not save the selected view.'));
}
$('month-view').addEventListener('click', () => selectView('month'));
$('rolling-view').addEventListener('click', () => selectView('rolling'));
function navigate(direction) { anchor = navigateDate(anchor, view, direction); render(); }
$('previous').addEventListener('click', () => navigate(-1));
$('next').addEventListener('click', () => navigate(1));
$('today').addEventListener('click', () => { anchor = new Date(); render(); });
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1); }
});
if (channel) channel.onmessage = () => refreshEvents().catch(() => notify('Could not refresh events from another window.'));
$('event-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
function refreshDay() { const now = dateKey(new Date()); if (now !== lastDay) { if (dateKey(anchor) === lastDay) anchor = new Date(); lastDay = now; render(); } }
setInterval(refreshDay, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshDay(); refreshEvents().catch(() => notify('Could not refresh saved events.')); } });
async function initialize() {
  try {
    const saved = await loadView();
    if (!viewSelected && ['month', 'rolling'].includes(saved)) view = saved;
    if (!viewSelected && saved === 'week') await saveView('month');
    await refreshEvents();
  } catch {
    render();
    notify('Event storage is unavailable. Reload to try again.');
  }
}
initialize();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => notify('Offline setup failed. Reopen the calendar online to try again.'));
