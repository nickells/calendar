// Use the date corner only as overflow relief, never just to compact a sparse day.
export function packRow(items, days, options = {}) {
  const normal = packCandidates(items.map(item => ({ ...item, header: false })), days, options);
  const bottoms = placements => days.map((day, column) => Math.max(day.bodyTop,
    ...placements.filter(p => items[p.index].columns.includes(column))
      .map(p => p.top + p.heights[column])));
  const normalBottoms = bottoms(normal);
  const crowded = days.map((day, column) =>
    normalBottoms[column] > (day.bottom ?? Infinity) + .5 &&
    items.filter(item => item.columns.includes(column)).length > 1);
  if (!crowded.some(Boolean)) return normal;
  const compact = packCandidates(items.map(item => ({
    ...item, header: item.header && crowded[item.columns[0]]
  })), days, options);
  const overflow = placements => bottoms(placements).reduce((sum, bottom, column) =>
    sum + Math.max(0, bottom - (days[column].bottom ?? Infinity)), 0);
  return overflow(compact) < overflow(normal) - .5 ? compact : normal;
}

// Pure, deterministic packing of one calendar row. Measurements are CSS pixels.
// Items arrive in preferred name/time order. Only time order is mandatory.
function packCandidates(items, days, { beamWidth = 8, choices = 4, previousTops = new Map() } = {}) {
  const overlaps = (a, b) => a.columns.some(column => b.columns.includes(column));
  const predecessors = items.map((item, index) => items.flatMap((prior, i) =>
    i < index && (item.timed || prior.timed) && overlaps(item, prior) ? [i] : []));

  const heightAt = (placement, column) => placement.heights?.[column] ?? placement.height;

  function place(state, index) {
    const item = items[index];
    const relevant = state.placed.filter(p => overlaps(item, items[p.index]));
    const minimum = predecessors[index].reduce((top, i) => {
      const prior = state.placed.find(p => p.index === i);
      return Math.max(top, ...item.columns.filter(c => items[i].columns.includes(c)).map(c => prior.top + heightAt(prior, c) + days[c].gap));
    }, -Infinity);
    const header = item.header && relevant.every(p => !p.header) &&
      days[item.columns[0]].headerTop >= minimum;
    let top = header ? days[item.columns[0]].headerTop :
      Math.max(minimum, ...item.columns.map(c => days[c].bodyTop));
    const height = header ? item.headerHeight : item.height;
    const heights = Object.fromEntries(item.columns.map(c => [c, header ? height : (item.heights?.[c] ?? height)]));
    if (!header) {
      const obstacles = relevant.filter(p => !p.header);
      let previous;
      do {
        previous = top;
        for (const prior of obstacles) {
          for (const c of item.columns.filter(c => items[prior.index].columns.includes(c))) {
            if (top < prior.top + heightAt(prior, c) + days[c].gap &&
                top + heights[c] + days[c].gap > prior.top) {
              top = prior.top + heightAt(prior, c) + days[c].gap;
            }
          }
        }
      } while (top !== previous);
    }
    return { placed: [...state.placed, { index, top, height, heights, header: !!header }] };
  }

  function score(state) {
    const bottoms = days.map(day => day.bodyTop);
    let tops = 0, inversions = 0, continuationSwaps = 0;
    for (const p of state.placed) {
      for (const c of items[p.index].columns) bottoms[c] = Math.max(bottoms[c], p.top + heightAt(p, c));
      tops += p.top;
      for (const q of state.placed) {
        if (q.index < p.index && overlaps(items[p.index], items[q.index])) {
          if (q.top > p.top) inversions++;
          const previousP = previousTops.get(items[p.index].id);
          const previousQ = previousTops.get(items[q.index].id);
          if (previousP !== undefined && previousQ !== undefined &&
              (previousP - previousQ) * (p.top - q.top) < 0) continuationSwaps++;
        }
      }
    }
    // Preserve continuing arrows' relative order across week boundaries before
    // optimizing height, preferred name order, unused space, and top alignment.
    return [continuationSwaps, Math.max(...bottoms), inversions, bottoms.reduce((a, b) => a + b, 0), tops];
  }
  const signature = state => state.placed.slice().sort((a, b) => a.index - b.index)
    .map(p => `${p.index}:${p.top}:${+p.header}`).join('|');
  const rank = (a, b) => {
    const left = score(a), right = score(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return signature(a).localeCompare(signature(b));
  };

  // Keep a greedy baseline; bounded search may find a better ordering without
  // letting a crowded calendar cause an unbounded combinatorial search.
  let baseline = { placed: [] };
  for (let i = 0; i < items.length; i++) baseline = place(baseline, i);
  // Seed a continuity-first alternative so the bounded beam cannot lose a
  // stable ordering just because continuing items fall outside its next choices.
  let continuity = { placed: [] };
  for (let depth = 0; depth < items.length; depth++) {
    const done = new Set(continuity.placed.map(p => p.index));
    const eligible = items.map((_, i) => i).filter(i =>
      !done.has(i) && predecessors[i].every(prior => done.has(prior)));
    eligible.sort((a, b) => (previousTops.get(items[a].id) ?? Infinity) -
      (previousTops.get(items[b].id) ?? Infinity) || a - b);
    continuity = place(continuity, eligible[0]);
  }
  let beam = [{ placed: [] }];
  for (let depth = 0; depth < items.length; depth++) {
    const candidates = new Map();
    for (const state of beam) {
      const done = new Set(state.placed.map(p => p.index));
      const eligible = items.map((_, i) => i).filter(i =>
        !done.has(i) && predecessors[i].every(prior => done.has(prior))).slice(0, choices);
      for (const index of eligible) {
        const next = place(state, index);
        candidates.set(signature(next), next);
      }
    }
    beam = [...candidates.values()].sort(rank).slice(0, beamWidth);
  }
  const best = [baseline, continuity, ...beam].sort(rank)[0];
  return best.placed.map(p => ({ ...p, id: items[p.index].id }));
}
