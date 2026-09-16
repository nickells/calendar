const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:8000');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.equal(await page.locator('.day').count(), 42);
  assert.equal(await page.locator('[aria-pressed="true"]').textContent(), 'Month');
  assert.equal(await page.getByRole('button', { name: 'Week', exact: true }).count(), 0);
  await page.evaluate(() => {
    window.dialogFocusTargets = [];
    document.getElementById('event-dialog').addEventListener('focusin', event => window.dialogFocusTargets.push(event.target.id));
    window.calendarBeforeDialog = document.getElementById('calendar');
    window.calendarRectBeforeDialog = JSON.stringify(window.calendarBeforeDialog.getBoundingClientRect());
    window.scrollBeforeDialog = [scrollX, scrollY];
  });
  await page.locator('.is-today .day-heading').click();
  assert.deepEqual(await page.evaluate(() => window.dialogFocusTargets), ['event-title']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'event-title');
  assert.ok(await page.evaluate(() => document.getElementById('calendar') === window.calendarBeforeDialog));
  assert.ok(await page.evaluate(() => JSON.stringify(document.getElementById('calendar').getBoundingClientRect()) === window.calendarRectBeforeDialog));
  assert.ok(await page.evaluate(() => JSON.stringify([scrollX, scrollY]) === JSON.stringify(window.scrollBeforeDialog)));
  assert.equal(await page.locator('#event-dialog').evaluate(dialog => getComputedStyle(dialog, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0)');

  await page.locator('#event-title').fill('Team breakfast');
  await page.locator('#event-color').fill('#1759a3');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.equal(await page.locator('.event').count(), 1);
  await page.reload();
  await page.waitForSelector('.event');
  assert.equal(await page.locator('.event-title').textContent(), 'Team breakfast');
  assert.equal(await page.locator('.event').evaluate(button => getComputedStyle(button).color), 'rgb(23, 89, 163)');
  const databases = await page.evaluate(() => indexedDB.databases());
  assert.ok(databases.some(database => database.name === 'calendar'));
  assert.equal(await page.locator('.event').textContent(), 'Team breakfast');
  assert.equal(await page.locator('input[type="time"], #all-day, .event-time').count(), 0);
  // Previously stored timed events still load and render only their names.
  await page.evaluate(async () => {
    const { loadEvents, saveEvent } = await import('./storage.mjs');
    const event = (await loadEvents())[0];
    await saveEvent({ ...event, allDay: false, start: '12:00', end: '13:00' });
  });
  await page.reload();
  await page.waitForSelector('.event');
  assert.equal(await page.locator('.event').textContent(), 'Team breakfast');
  await page.locator('.event').click();
  assert.equal(await page.locator('#event-form input').count(), 4);
  assert.equal(await page.locator('#event-color').inputValue(), '#1759a3');
  await page.locator('#event-title').fill(' ');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  assert.equal(await page.locator('#form-error').textContent(), 'Enter an event name and valid dates. End date must be on or after start date.');
  await page.locator('#event-title').fill('Team breakfast');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.deepEqual(await page.evaluate(async () => {
    const { loadEvents } = await import('./storage.mjs');
    return Object.keys((await loadEvents())[0]).sort();
  }), ['color', 'date', 'endDate', 'id', 'title']);
  await page.getByRole('button', { name: '30 day', exact: true }).click();
  assert.equal((await page.locator('.day').count()) % 7, 0);
  assert.equal(await page.locator('.day:not(.other-month)').count(), 30);
  for (const day of [page.locator('.other-month').first(), page.locator('.other-month').last()]) {
    await day.locator('.day-heading').click();
    assert.equal(await page.locator('#event-dialog').isVisible(), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  const firstDate = await page.locator('.day').first().getAttribute('aria-label');
  await page.getByRole('button', { name: 'Next 30 days', exact: true }).click();
  assert.notEqual(await page.locator('.day').first().getAttribute('aria-label'), firstDate);
  await page.getByRole('button', { name: 'Previous 30 days', exact: true }).click();
  assert.equal(await page.locator('.day').first().getAttribute('aria-label'), firstDate);
  // Saving an event on another date must not recenter any view.
  for (const view of ['Month', '30 day']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const snapshot = async () => ({
      dates: await page.locator('.day').evaluateAll(days => days.map(day => day.getAttribute('aria-label'))),
      heading: await page.locator('#heading').textContent(),
      selected: await page.locator('[aria-pressed="true"]').textContent()
    });
    const before = await snapshot();
    await page.locator('.day-heading').first().click();
    await page.locator('#event-title').fill('Future event');
    await page.locator('#event-date').fill('2035-06-15');
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    await page.waitForSelector('#event-dialog', { state: 'hidden' });
    assert.deepEqual(await snapshot(), before, `Saving preserves ${view} and range`);
    await page.evaluate(async () => {
      const { loadEvents, deleteEvent } = await import('./storage.mjs');
      for (const event of await loadEvents()) if (event.title === 'Future event') await deleteEvent(event.id);
    });
  }
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  assert.equal(await page.locator('.day').count(), 42);
  const monthHeading = await page.locator('#heading').textContent();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  assert.notEqual(await page.locator('#heading').textContent(), monthHeading);
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  assert.equal(await page.locator('#heading').textContent(), monthHeading);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const view of ['Month', '30 day']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${viewport.width}, ${view}`);
    }
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.event');
  await page.locator('.event').click();
  await page.locator('#event-title').fill('Offline breakfast');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  await page.reload();
  await page.waitForSelector('.event');
  assert.equal(await page.locator('.event-title').textContent(), 'Offline breakfast');
  await page.screenshot({ path: '/tmp/calendar-ipad.png', fullPage: true });
  await page.locator('.event').click();
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.equal(await page.locator('.event').count(), 0);
  await page.reload();
  await page.waitForFunction(async () => {
    const { loadEvents } = await import('./storage.mjs');
    return (await loadEvents()).length === 0;
  });
  // Multi-day events edit the same record from any day, including offline.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.locator('.is-today .day-heading').click();
  await page.locator('#event-title').fill('Trip');
  const start = await page.locator('#event-date').inputValue();
  const end = await page.evaluate(async start => {
    const { parseDate, addDays, dateKey } = await import('./calendar.mjs');
    return dateKey(addDays(parseDate(start), 2));
  }, start);
  await page.locator('#event-end-date').fill(end);
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  for (const view of ['Month', '30 day']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    assert.equal(await page.locator('.event').count(), 3);
    assert.equal(await page.locator('.event-title').count(), 1);
    assert.equal(await page.locator('.span-continuation').count(), 2);
    assert.equal(await page.locator('.span-end').count(), 1);
    await page.waitForSelector('.event-lines path', { state: 'attached' });
    assert.equal(await page.locator('.event-lines path').count(), 1);
    const path = await page.locator('.event-lines path').getAttribute('d');
    assert.equal((path.match(/ L /g) || []).length, (path.match(/ H /g) || []).length * 2);
    assert.equal(await page.locator('.event-line').first().evaluate(line => getComputedStyle(line, '::after').content), 'none');
  }
  await page.reload();
  await page.waitForSelector('.event');
  assert.equal(await page.locator('.event').count(), 3);
  await page.screenshot({ path: '/tmp/calendar-event-span.png', fullPage: true });
  await page.locator('.event').last().click();
  assert.equal(await page.locator('#event-date').inputValue(), start);
  assert.equal(await page.locator('#event-end-date').inputValue(), end);
  await page.locator('#event-title').fill('Renamed trip');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.deepEqual(await page.locator('.event-title').allTextContents(), ['Renamed trip']);
  await page.locator('.event').last().click();
  await page.locator('#event-end-date').fill(start);
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.equal(await page.locator('.event').count(), 1);
  await page.locator('.event').click();
  await page.locator('#event-end-date').fill(end);
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  await page.locator('.event').last().click();
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.equal(await page.locator('.event').count(), 0);
  // A wrapped span has one arrow per row, never one per day.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.locator('.day-heading').nth(5).click();
  await page.locator('#event-title').fill('Camping with family and friends');
  await page.locator('#event-color').fill('#a32951');
  const wrappedStart = await page.locator('#event-date').inputValue();
  const wrappedEnd = await page.evaluate(async start => {
    const { parseDate, addDays, dateKey } = await import('./calendar.mjs');
    return dateKey(addDays(parseDate(start), 10));
  }, wrappedStart);
  await page.locator('#event-end-date').fill(wrappedEnd);
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  await page.waitForSelector('.event-lines path', { state: 'attached' });
  const wrappedPath = await page.locator('.event-lines path').getAttribute('d');
  assert.equal(await page.locator('.event-lines path').evaluate(path => getComputedStyle(path).stroke), 'rgb(163, 41, 81)');
  assert.equal(await page.locator('.event').first().evaluate(button => getComputedStyle(button).color), 'rgb(163, 41, 81)');
  assert.equal(await page.locator('.event-title').count(), 1);
  assert.equal((wrappedPath.match(/ H /g) || []).length, 3);
  assert.ok(await page.locator('.event-title').evaluate(title => title.getBoundingClientRect().height > 30));
  assert.equal(await page.locator('.event-title').evaluate(title => getComputedStyle(title).whiteSpace), 'normal');
  const lineHeights = await page.locator('.day[data-row="0"] .event-line').evaluateAll(lines => lines.map(line => line.getBoundingClientRect().top));
  assert.ok(Math.max(...lineHeights) - Math.min(...lineHeights) < 1);
  assert.equal((wrappedPath.match(/ L /g) || []).length, 6);
  // Days without arrows must not inherit blank event lanes from their neighbors.
  const emptyDay = page.locator('.day').first();
  assert.equal(await emptyDay.locator('.event-spacer').count(), 0);
  await emptyDay.locator('.day-heading').click();
  await page.locator('#event-title').fill('Birthday');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  const birthday = page.getByRole('button', { name: 'Edit Birthday', exact: true });
  const gap = await birthday.evaluate(button => button.getBoundingClientRect().top - button.closest('.day').querySelector('.day-heading').getBoundingClientRect().bottom);
  assert.ok(gap < 3, `Unexpected space above single-day event: ${gap}`);
  await birthday.click();
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  await page.screenshot({ path: '/tmp/calendar-wrapped-arrow.png', fullPage: true });
  await page.locator('.event').last().click();
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  for (const [label, value] of [['Month', 'month'], ['30 day', 'rolling']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(async expected => {
      const { loadView } = await import('./storage.mjs');
      return (await loadView()) === expected;
    }, value);
    await page.reload();
    await page.waitForSelector('.day');
    assert.equal(await page.locator('[aria-pressed="true"]').textContent(), label);
    const reopened = await context.newPage();
    await reopened.goto('http://localhost:8000');
    await reopened.waitForSelector('.day');
    assert.equal(await reopened.locator('[aria-pressed="true"]').textContent(), label);
    await reopened.close();
  }
  await page.evaluate(async () => {
    const { saveView } = await import('./storage.mjs');
    await saveView('week');
  });
  await page.reload();
  await page.waitForSelector('.day');
  assert.equal(await page.locator('[aria-pressed="true"]').textContent(), 'Month');
  assert.equal(await page.evaluate(async () => (await import('./storage.mjs')).loadView()), 'month');
  // Touch selection opens only on release and supports reverse ranges across rows.
  const touch = await context.newCDPSession(page);
  const cells = await page.locator('.day').evaluateAll(days => days.map(day => {
    const rect = day.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height - 12, date: day.dataset.date };
  }));
  for (const [from, to] of [[2, 2], [5, 9], [12, 6]]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cells[from].x, y: cells[from].y }] });
    assert.equal(await page.locator('#event-dialog').isVisible(), false);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cells[to].x, y: cells[to].y }] });
    assert.equal(await page.locator('#event-dialog').isVisible(), false);
    assert.equal(await page.locator('.event-preview').count(), Math.abs(to - from) + 1);
    assert.equal(await page.locator('.event-preview .event-title').textContent(), 'New event');
    const dragColor = await page.locator('.event-preview').first().evaluate(button => button.style.color);
    if (from !== to) await page.waitForSelector('.preview-line', { state: 'attached' });
    assert.equal(await page.evaluate(async () => (await (await import('./storage.mjs')).loadEvents()).length), 0);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForSelector('#event-dialog[open]');
    assert.equal(await page.locator('#event-date').inputValue(), cells[Math.min(from, to)].date);
    assert.equal(await page.locator('#event-end-date').inputValue(), cells[Math.max(from, to)].date);
    assert.equal(await page.locator('.event-preview').count(), Math.abs(to - from) + 1);
    assert.equal(await page.locator('.event-preview .event-title').textContent(), 'New event');
    assert.equal(await page.locator('.event-preview').first().evaluate(button => button.style.color), dragColor);
    assert.equal(await page.locator('#event-color').evaluate(input => { const span = document.createElement('span'); span.style.color = input.value; return span.style.color; }), dragColor);
    await page.locator('#event-title').fill('Live draft 4pm');
    assert.equal(await page.locator('.event-preview .event-title').textContent(), 'Live draft 4pm');
    await page.locator('#event-title').fill('');
    assert.equal(await page.locator('.event-preview .event-title').textContent(), 'New event');
    assert.equal(await page.evaluate(async () => (await (await import('./storage.mjs')).loadEvents()).length), 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.event-preview'));

  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cells[3].x, y: cells[3].y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await page.locator('#event-dialog').isVisible(), false);
  assert.equal(await page.locator('.event-preview').count(), 0);
  await touch.detach();
  const todayCell = page.locator('.is-today');
  for (const title of ['birthday 4pm', 'lunch 12pm', 'coffee 09:00', 'Holiday']) {
    await todayCell.locator('.day-heading').click();
    await page.locator('#event-title').fill(title);
    if (title === 'birthday 4pm') {
      const start = await page.locator('#event-date').inputValue();
      const end = await page.evaluate(async start => {
        const { dateKey, parseDate, addDays } = await import('./calendar.mjs');
        return dateKey(addDays(parseDate(start), 1));
      }, start);
      await page.locator('#event-end-date').fill(end);
    }
    await page.getByRole('button', { name: 'Save event', exact: true }).click();
    await page.waitForSelector('#event-dialog', { state: 'hidden' });
  }
  assert.deepEqual(await todayCell.locator('.event-title').allTextContents(), ['Holiday', 'coffee 09:00', 'lunch 12pm', 'birthday 4pm']);
  await page.reload();
  await page.waitForSelector('.event');
  assert.deepEqual(await todayCell.locator('.event-title').allTextContents(), ['Holiday', 'coffee 09:00', 'lunch 12pm', 'birthday 4pm']);
  await todayCell.getByRole('button', { name: 'Edit birthday 4pm', exact: true }).click();
  await page.locator('#event-title').fill('birthday 8am');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.waitForSelector('#event-dialog', { state: 'hidden' });
  assert.deepEqual(await todayCell.locator('.event-title').allTextContents(), ['Holiday', 'birthday 8am', 'coffee 09:00', 'lunch 12pm']);
  assert.deepEqual(errors, []);
  await require('./worker-update.cjs')(browser);
  await browser.close();
  console.log('PASS: IndexedDB create/edit/delete, reload persistence, name-only events and legacy timed data, date navigation, iPad portrait/landscape and phone layout, offline reload and editing; no browser errors.');
})().catch(error => { console.error(error); process.exit(1); });
