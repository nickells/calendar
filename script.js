import { dateKey, addDays, navigateDate, viewDates, validEvent, eventsForDate, eventLanes, eventColor, randomDarkColor, inferredTime } from './calendar.mjs';
import { loadEvents, saveEvent, deleteEvent, loadView, saveView } from './storage.mjs';

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
  const lanes = eventLanes(displayEvents, dateKey(first), dateKey(last), true);
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
    const hasArrow = items.some(event => event.endDate > event.date);
    if (hasArrow) {
      let dayLaneCount = 0;
      lanes.forEach((lane, laneIndex) => {
        if (lane?.some(event => event.date <= key && (event.endDate ?? event.date) >= key)) dayLaneCount = laneIndex + 1;
      });
      for (let laneIndex = 0; laneIndex < dayLaneCount; laneIndex++) {
        const event = lanes[laneIndex]?.find(event => event.date <= key && (event.endDate ?? event.date) >= key);
        const slot = event ? eventButton(event, event.endDate > event.date) : document.createElement('div');
        slot.dataset.lane = laneIndex;
        if (!event) {
          slot.className = 'event-spacer';
          slot.setAttribute('aria-hidden', 'true');
        }
        list.append(slot);
      }
    } else {
      for (const event of items) list.append(eventButton(event));
    }
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
function layoutInlineEvents() {
  for (const day of $('calendar').querySelectorAll('.day')) {
    const top = day.querySelector('.day-top');
    const list = day.querySelector('.day-events');
    const previous = top.querySelector('.event-inline');
    if (previous) {
      const placeholder = list.querySelector('.inline-placeholder');
      if (placeholder) {
        previous.dataset.lane = placeholder.dataset.lane;
        placeholder.replaceWith(previous);
      } else list.prepend(previous);
      previous.classList.remove('event-inline');
    }
    top.classList.remove('has-inline-event');
    // Untimed single-day names can fill the header above untimed arrows.
    // Explicit times must retain their chronological order.
    const candidates = [...list.querySelectorAll(':scope > .event')];
    const candidate = candidates.find((button, index) => !button.classList.contains('event-span') &&
      (index === 0 || (inferredTime(button.title) === null && candidates.slice(0, index).every(prior => inferredTime(prior.title) === null))));
    if (!candidate) continue;
    const heading = top.querySelector('.day-heading');
    const headingStyle = getComputedStyle(heading);
    const dateWidth = heading.querySelector('.day-number').getBoundingClientRect().width + parseFloat(headingStyle.paddingLeft) + parseFloat(headingStyle.paddingRight);
    const available = top.clientWidth - dateWidth - parseFloat(getComputedStyle(list).paddingLeft) - parseFloat(getComputedStyle(top).columnGap);
    const measure = candidate.querySelector('.event-title').cloneNode(true);
    Object.assign(measure.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre', width: 'max-content' });
    candidate.append(measure);
    const fits = measure.getBoundingClientRect().width <= available;
    measure.remove();
    if (!fits) continue;
    if (candidate.dataset.lane !== undefined) {
      const placeholder = document.createElement('div');
      placeholder.className = 'event-spacer inline-placeholder';
      placeholder.dataset.lane = candidate.dataset.lane;
      placeholder.setAttribute('aria-hidden', 'true');
      candidate.replaceWith(placeholder);
      delete candidate.dataset.lane;
    }
    candidate.style.order = '';
    candidate.style.height = '';
    candidate.style.marginTop = '';
    candidate.classList.add('event-inline');
    top.classList.add('has-inline-event');
    top.prepend(candidate);
  }
}
function drawEventLines() {
  const calendar = $('calendar');
  calendar.querySelector('.event-lines')?.remove();
  layoutInlineEvents();
  // Pack into free vertical intervals, including gaps above low shared arrows.
  const slots = [...calendar.querySelectorAll('.event[data-lane]')];
  slots.forEach(slot => { slot.style.height = ''; slot.style.marginTop = ''; slot.style.order = ''; });
  const days = new Map();
  const laneGroups = new Map();
  for (const slot of slots) {
    const day = slot.closest('.day');
    const list = day.querySelector('.day-events');
    if (!days.has(day)) days.set(day, {
      top: list.getBoundingClientRect().top,
      gap: parseFloat(getComputedStyle(list).rowGap),
      placed: []
    });
    const key = `${day.dataset.row}:${slot.dataset.eventId}`;
    if (!laneGroups.has(key)) laneGroups.set(key, []);
    laneGroups.get(key).push(slot);
  }
  const orderedGroups = [...laneGroups.values()].sort((a, b) => Number(a[0].dataset.lane) - Number(b[0].dataset.lane));
  for (const group of orderedGroups) {
    const height = Math.max(...group.map(slot => slot.getBoundingClientRect().height));
    const timed = inferredTime(group[0].title) !== null;
    const occupiedDays = group.map(slot => days.get(slot.closest('.day')));
    let top = Math.max(...occupiedDays.map(day => day.top));
    // Preserve chronological ordering whenever either event has an explicit time.
    for (const day of occupiedDays) {
      for (const prior of day.placed) {
        if (timed || prior.timed) top = Math.max(top, prior.top + prior.height + day.gap);
      }
    }
    let collision;
    do {
      collision = false;
      for (const day of occupiedDays) {
        for (const prior of day.placed) {
          if (top < prior.top + prior.height + day.gap && top + height + day.gap > prior.top) {
            top = prior.top + prior.height + day.gap;
            collision = true;
          }
        }
      }
    } while (collision);
    for (const slot of group) {
      days.get(slot.closest('.day')).placed.push({ slot, top, height, timed });
    }
  }
  for (const day of days.values()) {
    let cursor = day.top;
    day.placed.sort((a, b) => a.top - b.top).forEach(({ slot, top, height }, index) => {
      slot.style.order = index;
      slot.style.marginTop = `${Math.max(0, top - cursor)}px`;
      slot.style.height = `${height}px`;
      cursor = top + height + day.gap;
    });
  }
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
  $('delete-event').textContent = 'Delete event';
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
  if ($('delete-event').textContent !== 'Confirm delete') { $('delete-event').textContent = 'Confirm delete'; return; }
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
