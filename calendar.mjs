export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return dateKey(date) === key ? date : null;
}
export function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}
export function viewDates(anchor, view) {
  let start = anchor;
  let length = 30;
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    start = addDays(first, -first.getDay());
    length = 42;
  } else {
    start = addDays(anchor, -anchor.getDay());
    length = Math.ceil((anchor.getDay() + 30) / 7) * 7;
  }
  return Array.from({ length }, (_, i) => addDays(start, i));
}
export function navigateDate(anchor, view, direction) {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12);
  return addDays(anchor, direction * 30);
}
export function validEvent(event) {
  // Events saved without an end date span only their start date.
  return event && typeof event.id === 'string' && typeof event.title === 'string' && event.title.trim().length > 0 && event.title.length <= 100 && typeof event.date === 'string' && !!parseDate(event.date) && (event.endDate === undefined || (typeof event.endDate === 'string' && !!parseDate(event.endDate) && event.endDate >= event.date));
}
// Minutes since midnight; bare numbers and invalid clock times are not times.
export function inferredTime(title) {
  const pattern = /(?<![\p{L}\p{N}:./])(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}:./])(\d{1,2}):(\d{2})(?![\p{L}\p{N}:])|\b(noon|midnight)\b/giu;
  for (const match of title.matchAll(pattern)) {
    if (match[6]) return match[6].toLowerCase() === 'noon' ? 720 : 0;
    if (match[3]) {
      const hour = Number(match[1]), minute = Number(match[2] || 0);
      if (hour >= 1 && hour <= 12 && minute < 60) return (hour % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + minute;
    } else {
      const hour = Number(match[4]), minute = Number(match[5]);
      if (hour < 24 && minute < 60) return hour * 60 + minute;
    }
  }
  return null;
}
export function compareEvents(a, b) {
  const aTime = inferredTime(a.title), bTime = inferredTime(b.title);
  const shorterUntimed = aTime === null && bTime === null ? [...a.title.trim()].length - [...b.title.trim()].length : 0;
  return (aTime ?? -1) - (bTime ?? -1) || shorterUntimed || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
export function eventsForDate(events, key) {
  return events.filter(event => event.date <= key && (event.endDate ?? event.date) >= key).sort(compareEvents);
}

// Keep overlapping spans in separate rows, reusing rows after a span ends.
export function eventLanes(events, first, last, includeSingleDay = false) {
  if (includeSingleDay) {
    const lanes = [];
    const placed = [];
    const visible = events.filter(event => event.date <= last && (event.endDate ?? event.date) >= first).sort(compareEvents);
    for (const event of visible) {
      const overlaps = placed.filter(other => other.event.date <= (event.endDate ?? event.date) && (other.event.endDate ?? other.event.date) >= event.date);
      const index = overlaps.reduce((max, other) => Math.max(max, other.index + 1), 0);
      (lanes[index] ||= []).push(event);
      placed.push({ event, index });
    }
    return lanes;
  }
  const lanes = [];
  const spans = events.filter(event => event.endDate > event.date && event.date <= last && event.endDate >= first)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  for (const event of spans) {
    let lane = lanes.find(row => row.at(-1).endDate < event.date);
    if (!lane) { lane = []; lanes.push(lane); }
    lane.push(event);
  }
  return lanes;
}

export function eventColor(event) {
  return typeof event?.color === 'string' && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : '#222222';
}

export function randomDarkColor() {
  const colors = ['#0000ff', '#003dff', '#6000ff', '#8a00d4', '#b000b5', '#ce0050', '#d00020', '#b84900', '#008000', '#007860', '#007590', '#004eae'];
  return colors[Math.floor(Math.random() * colors.length)];
}
