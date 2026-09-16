import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, parseDate, addDays, viewDates, navigateDate, validEvent, eventsForDate, eventLanes, eventColor, inferredTime, randomDarkColor, colorLuminance, MAX_EVENT_COLOR_LUMINANCE } from '../calendar.mjs';
test('dates round-trip locally and reject nonexistent dates', () => {
  assert.equal(dateKey(parseDate('2028-02-29')), '2028-02-29');
  assert.equal(parseDate('2026-02-29'), null);
  assert.equal(parseDate('2026-13-01'), null);
});
test('rolling view pads every start weekday to complete weeks across DST', () => {
  for (let offset = 0; offset < 7; offset++) {
    const anchor = addDays(parseDate('2026-03-01'), offset);
    const dates = viewDates(anchor, 'rolling');
    assert.equal(dates.length % 7, 0);
    assert.equal(dates[0].getDay(), 0);
    assert.equal(dates.at(-1).getDay(), 6);
    assert.equal(new Set(dates.map(dateKey)).size, dates.length);
    const active = dates.filter(date => dateKey(date) >= dateKey(anchor) && dateKey(date) <= dateKey(addDays(anchor, 29)));
    assert.equal(active.length, 30);
    dates.slice(1).forEach((date, index) => assert.equal(dateKey(date), dateKey(addDays(dates[index], 1))));
  }
});
const event = { id: 'test', title: 'Lunch', date: '2026-09-16' };
test('events require only a name and valid date; legacy timed events remain valid', () => {
  assert.ok(validEvent(event));
  for (const update of [{ title: ' ' }, { date: '2026-02-30' }, { title: null }]) assert.ok(!validEvent({ ...event, ...update }));
  assert.ok(validEvent({ ...event, allDay: false, start: '12:00', end: '13:00' }));
  assert.ok(validEvent({ ...event, allDay: true, start: '', end: '' }));
});
test('untimed events sort shortest first regardless of legacy time fields', () => {
  const items = [event, { ...event, id: 'early', title: 'Walk', start: '08:00' }, { ...event, id: 'all-day', title: 'Birthday', allDay: true }, { ...event, id: 'other', date: '2026-09-17' }];
  assert.deepEqual(eventsForDate(items, event.date).map(item => item.id), ['early', 'test', 'all-day']);
});

test('month view restores six full weeks including adjacent-month dates', () => {
  const dates = viewDates(parseDate('2028-02-20'), 'month');
  assert.equal(dates.length, 42);
  assert.equal(dates[0].getDay(), 0);
  assert.equal(dateKey(dates[0]), '2028-01-30');
  assert.equal(dateKey(dates.at(-1)), '2028-03-11');
  assert.equal(dates.filter(date => date.getMonth() === 1).length, 29);
});
test('month navigation does not skip short months and crosses years', () => {
  assert.equal(dateKey(navigateDate(parseDate('2026-01-31'), 'month', 1)), '2026-02-01');
  assert.equal(dateKey(navigateDate(parseDate('2026-01-31'), 'month', -1)), '2025-12-01');
  assert.equal(dateKey(navigateDate(parseDate('2026-12-31'), 'month', 1)), '2027-01-01');
});

test('multi-day events include both endpoints across months, years, and leap day', () => {
  for (const [start, end, inside] of [
    ['2026-09-30', '2026-10-02', '2026-10-01'],
    ['2026-12-31', '2027-01-02', '2027-01-01'],
    ['2028-02-28', '2028-03-01', '2028-02-29'],
    ['2026-03-07', '2026-03-09', '2026-03-08']
  ]) {
    const span = { ...event, date: start, endDate: end };
    assert.ok(validEvent(span));
    for (const key of [start, inside, end]) assert.equal(eventsForDate([span], key).length, 1);
    for (const key of [dateKey(addDays(parseDate(start), -1)), dateKey(addDays(parseDate(end), 1))]) assert.equal(eventsForDate([span], key).length, 0);
  }
  assert.ok(validEvent({ ...event, endDate: event.date }));
  for (const endDate of ['2026-09-15', '2026-02-30', '', null]) assert.ok(!validEvent({ ...event, endDate }));
  assert.equal(eventsForDate([event], '2026-09-17').length, 0);
});

test('overlapping spans keep separate rows and reuse rows after ending', () => {
  const a = { id: 'a', title: 'Trip', date: '2026-09-15', endDate: '2026-09-18' };
  const b = { id: 'b', title: 'Visit', date: '2026-09-18', endDate: '2026-09-20' };
  const c = { id: 'c', title: 'Away', date: '2026-09-19', endDate: '2026-09-23' };
  const outside = { ...a, id: 'outside', date: '2025-01-01', endDate: '2025-01-02' };
  assert.deepEqual(eventLanes([b, c, a, outside], '2026-09-16', '2026-09-22').map(lane => lane.map(event => event.id)), [['a', 'c'], ['b']]);
});

test('event color accepts hex colors and preserves a default for legacy events', () => {
  assert.equal(eventColor({ color: '#Ab1234' }), '#Ab1234');
  for (const color of [undefined, null, 'sage', 'invalid']) assert.equal(eventColor({ color }), '#222222');
});

test('infer common clock formats without changing event names', () => {
  for (const [title, expected] of [['birthday 4pm', 960], ['lunch 12pm', 720], ['Lunch 12:00', 720], ['Coffee 9 am', 540], ['Meet 4:30 P.M.', 990], ['Meet 4.30pm', 990], ['Train 16:05', 965], ['12 AM', 0], ['00:00', 0], ['noon lunch', 720], ['midnight', 0], ['Party 23:59', 1439]]) assert.equal(inferredTime(title), expected, title);
  for (const title of ['Birthday 4', 'Room 123', '25:00', '12:99', '13pm', '0am', '1400', 'Build12:00', '12:00:30']) assert.equal(inferredTime(title), null, title);
});
test('sort all daily events chronologically including spans', () => {
  const items = ['birthday 4pm', 'lunch 12pm', 'coffee 09:00', 'Holiday'].map((title, i) => ({ ...event, id: String(i), title, ...(i === 0 ? { endDate: '2026-09-18' } : {}) }));
  const expected = ['Holiday', 'coffee 09:00', 'lunch 12pm', 'birthday 4pm'];
  assert.deepEqual(eventsForDate(items, event.date).map(item => item.title), expected);
  const lanes = eventLanes(items, event.date, '2026-09-20', true);
  assert.deepEqual(lanes.flatMap(lane => lane.filter(item => item.date === event.date)).map(item => item.title), expected);
});

test('new-event colors satisfy the luminance threshold across the RGB gamut', () => {
  let seed = 4321;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const colors = new Set();
  for (let i = 0; i < 1000; i++) {
    const color = randomDarkColor(random);
    colors.add(color);
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.ok(colorLuminance(color) <= MAX_EVENT_COLOR_LUMINANCE);
  }
  assert.ok(colors.size > 900, 'Generate colors beyond the former small palette');
});

test('luminance allows pure red and blue, but rejects bright green and yellow', () => {
  for (const [color, expected] of [['#000000', 0], ['#ffffff', 1], ['#ff0000', .2126], ['#0000ff', .0722], ['#00ff00', .7152]]) {
    assert.ok(Math.abs(colorLuminance(color) - expected) < 1e-10);
  }
  for (const color of ['#ff0000', '#0000ff']) {
    assert.equal(randomDarkColor(() => parseInt(color.slice(1), 16) / 0x1000000), color);
  }
  const candidates = [0xffffff, 0xffff00, 0x00ff00, 0xff0000];
  assert.equal(randomDarkColor(() => candidates.shift() / 0x1000000), '#ff0000');
  assert.equal(randomDarkColor(() => 0xffffff / 0x1000000), '#0000ff', 'Bounded retries');
});

test('short untimed names lead while explicit times stay chronological', () => {
  const titles = ['Long untimed event', 'Lunch 12pm', 'BB', 'A', 'Birthday 4pm'];
  const items = titles.map((title, index) => ({ ...event, id: String(index), title }));
  assert.deepEqual(eventsForDate(items, event.date).map(item => item.title), ['A', 'BB', 'Long untimed event', 'Lunch 12pm', 'Birthday 4pm']);
});
