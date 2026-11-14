/* Tests for glasshouse-now-card, run with node + jsdom (not a repo dependency):
 *   mkdir /tmp/ghtest && cd /tmp/ghtest && npm i jsdom
 *   node /path/to/repo/test/now.test.cjs
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.cwd(), __dirname] }));

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60000;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed += 1; console.log('  ✓', msg); }
  else { failed += 1; console.log('  ✗', msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }
function throws(fn, re, msg) {
  try { fn(); ok(false, `${msg} (did not throw)`); } catch (e) { ok(re.test(e.message), `${msg} (${e.message})`); }
}

function makeWindow() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(`
    customElements.define('ha-card', class extends HTMLElement {});
    customElements.define('ha-icon', class extends HTMLElement {});
    customElements.define('ha-state-icon', class extends HTMLElement {});
  `);
  w.console.info = () => {};
  w.eval(read('test/mock-hass.js'));
  w.eval(read('glasshouse-now-card.js'));
  return w;
}

function setup(mockOpts, config) {
  const w = makeWindow();
  const mock = w.GHNowMock.createHass(mockOpts);
  const card = w.document.createElement('glasshouse-now-card');
  card.setConfig(config || w.GHNowMock.demoConfig());
  w.document.body.append(card);
  mock.subscribe((hass) => { card.hass = hass; });
  const events = [];
  card.addEventListener('hass-more-info', (e) => events.push(['more-info', e.detail.entityId]));
  card.addEventListener('haptic', (e) => events.push(['haptic', e.detail]));
  const $ = (sel) => card.shadowRoot.querySelector(sel);
  const $$ = (sel) => [...card.shadowRoot.querySelectorAll(sel)];
  const items = () => $$('.item:not(.leaving)');
  const item = (key) => $(`.item[data-key="${key}"]:not(.leaving)`);
  return { w, mock, card, events, $, $$, items, item };
}

const w0 = makeWindow();
const H = w0.customElements.get('glasshouse-now-card').helpers;
const NOW = Date.parse('2026-03-14T20:47:00Z');
const st = (entity_id, state, attributes, agoMin) => ({
  entity_id, state: String(state), attributes: attributes || {},
  last_changed: new Date(NOW - (agoMin || 0) * MIN).toISOString(),
});
const states = (...list) => Object.fromEntries(list.map((x) => [x.entity_id, x]));
const rule = (r) => H.normRule(r, 0);

(async () => {
  console.log('duration parsing and formatting');
  {
    eq(H.fmtDuration(0.4), '<1 min', 'under a minute');
    eq(H.fmtDuration(42), '42 min', 'minutes');
    eq(H.fmtDuration(120), '2 h', 'whole hours');
    eq(H.fmtDuration(124), '2 h 4 min', 'hours and minutes');
    eq(H.fmtDuration(14 * 60 + 20), '14 h', 'long durations drop minutes');
    eq(H.fmtDuration(26 * 60), '1 d 2 h', 'days');
    eq(H.fmtDuration(NaN), '—', 'unknown is a dash');
    eq(H.parseDuration('0:42'), 42, 'h:mm');
    eq(H.parseDuration('1:05:30'), 65.5, 'h:mm:ss');
    eq(H.parseDuration('2.9', 'h'), 174, 'hours with unit');
    eq(H.parseDuration('90', 's'), 1.5, 'seconds with unit');
    eq(H.parseDuration('25'), 25, 'bare number = minutes');
    eq(H.parseDuration('PT1H5M'), 65, 'ISO 8601 duration');
    eq(H.parseDuration('1h 5m'), 65, 'tokens');
    eq(H.parseDuration('1 day, 2:00:00'), 1560, 'python timedelta');
    ok(Number.isNaN(H.parseDuration('unknown')), 'unknown -> NaN');
    ok(Number.isNaN(H.parseDuration('soon')), 'garbage -> NaN');
    eq(H.fmtRelative(NOW - 20e3, NOW), 'Just now', 'relative: just now');
    eq(H.fmtRelative(NOW - 2 * MIN, NOW), '2 min ago', 'relative: minutes');
    eq(H.fmtRelative(NOW - 125 * MIN, NOW), '2 h ago', 'relative: hours');
  }

  console.log('templating');
  {
    eq(H.template('unlocked for {duration}', { duration: '2 h' }), 'unlocked for 2 h', '{duration}');
    eq(H.template('{name}: {state} ({count}) {names}', { name: 'Gate', state: 'open', count: 2, names: 'A and B' }),
      'Gate: open (2) A and B', 'all tokens');
    eq(H.template('{nope} stays', {}), '{nope} stays', 'unknown token kept');
    eq(H.joinNames(['A', 'B', 'C']), 'A, B and C', 'join three');
    eq(H.joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B +3', 'join many');
  }

  console.log('rule evaluation');
  {
    const lock = st('lock.gate', 'unlocked', { friendly_name: 'Gate Lock' }, 125);
    let r = rule({ entity: 'lock.gate', when: 'unlocked', for: 30, message: 'unlocked for {duration}', fix: { label: 'Lock', action: 'lock.lock' } });
    let out = H.evalAttention([r], states(lock), NOW);
    eq(out.length, 1, 'fires when held long enough');
    eq(out[0].title, 'Gate Lock', 'name defaults to friendly_name');
    eq(out[0].message, 'Unlocked for 2 h 5 min', 'message templated, sentence case');
    eq(out[0].fix.calls, [{ domain: 'lock', service: 'lock', data: { entity_id: 'lock.gate' } }], 'fix targets the entity');

    out = H.evalAttention([rule({ entity: 'lock.gate', when: 'unlocked', for: 30 })], states(st('lock.gate', 'unlocked', {}, 10)), NOW);
    eq(out.length, 0, 'does not fire before `for` minutes');
    {
      // count changed 2 min ago, but the oldest problem is 18 h old: since_attribute times `for` from it
      const since = new Date(NOW - 18 * 3600e3).toISOString();
      const cnt = st('sensor.sentinel', '5', { longest_down: { since } }, 2);
      out = H.evalAttention([rule({ entity: 'sensor.sentinel', above: 0, for: 15 })], states(cnt), NOW);
      eq(out.length, 0, 'last_changed-based `for` waits after the count moves');
      out = H.evalAttention([rule({ entity: 'sensor.sentinel', above: 0, for: 15, since_attribute: 'longest_down.since' })], states(cnt), NOW);
      eq(out.length, 1, 'since_attribute fires from the attribute timestamp');
    }
    out = H.evalAttention([rule({ entity: 'lock.gate', when: ['unlocked', 'jammed'] })], states(st('lock.gate', 'jammed')), NOW);
    eq(out.length, 1, 'when accepts a list');
    out = H.evalAttention([rule({ entity: 'lock.gate', when: 'unlocked' })], states(st('lock.gate', 'locked')), NOW);
    eq(out.length, 0, 'state mismatch -> nothing');
    out = H.evalAttention([rule({ entity: 'binary_sensor.door', when: true })], states(st('binary_sensor.door', 'on')), NOW);
    eq(out.length, 1, 'YAML boolean `on` is understood');
    out = H.evalAttention([rule({ entity: 'person.a', not: 'home' })], states(st('person.a', 'not_home')), NOW);
    eq(out.length, 1, '`not` fires for other states');
    out = H.evalAttention([rule({ entity: 'person.a', not: 'home' })], states(st('person.a', 'unavailable')), NOW);
    eq(out.length, 0, '`not` ignores unavailable');
    const temp = st('sensor.t', '84.5', { unit_of_measurement: '°F', friendly_name: 'Attic' });
    out = H.evalAttention([rule({ entity: 'sensor.t', above: 80, message: '{state}' })], states(temp), NOW);
    eq(out[0] && out[0].message, '84.5 °F', 'numeric above + {state} with unit');
    eq(H.evalAttention([rule({ entity: 'sensor.t', above: 80, below: 84 })], states(temp), NOW).length, 0, 'above and below together');
    eq(H.evalAttention([rule({ entity: 'sensor.t', below: 50 })], states(st('sensor.t', 'unknown')), NOW).length, 0, 'non-numeric state never matches numbers');
    eq(H.evalAttention([rule({ entity: 'lock.missing', when: 'unlocked' })], {}, NOW).length, 0, 'missing entity -> nothing');
    eq(H.evalAttention([rule({ entity: 'cover.g' })], states(st('cover.g', 'open')), NOW).length, 1, 'no state test: domain default (cover open)');

    const win = st('binary_sensor.win', 'on', { device_class: 'window', friendly_name: 'Window' }, 20);
    const gated = rule({ entity: 'binary_sensor.win', condition: { entity: 'climate.t', state: 'heat' }, message: '{state} with heat on' });
    eq(H.evalAttention([gated], states(win, st('climate.t', 'heat')), NOW).map((x) => x.message), ['Open with heat on'], 'condition passes');
    eq(H.evalAttention([gated], states(win, st('climate.t', 'off')), NOW).length, 0, 'condition gates');
    const rain = rule({ entity: 'binary_sensor.win', condition: { entity: 'sensor.rain', above: 0 } });
    eq(H.evalAttention([rain], states(win, st('sensor.rain', '0.4')), NOW).length, 1, 'numeric condition');

    const multi = rule({ entities: ['binary_sensor.a', 'binary_sensor.b', 'binary_sensor.c'], when: 'on', name: 'Windows open', message: '{count}: {names}' });
    out = H.evalAttention([multi], states(st('binary_sensor.a', 'on', { friendly_name: 'Kitchen' }), st('binary_sensor.b', 'off'), st('binary_sensor.c', 'on', { friendly_name: 'Bath' })), NOW);
    eq(out[0].message, '2: Kitchen and Bath', 'multi-entity rule counts and names');
  }

  console.log('sorting');
  {
    const S = states(
      st('lock.a', 'unlocked', {}, 10), st('lock.b', 'unlocked', {}, 300), st('binary_sensor.leak', 'on', {}, 1),
      st('binary_sensor.info', 'on', {}, 999),
    );
    const rules = [
      { entity: 'binary_sensor.info', severity: 'info' }, { entity: 'lock.a', severity: 'warn' },
      { entity: 'lock.b', severity: 'warn' }, { entity: 'binary_sensor.leak', severity: 'alert' },
    ].map(H.normRule);
    eq(H.evalAttention(rules, S, NOW).map((x) => x.entities[0]), ['binary_sensor.leak', 'lock.b', 'lock.a', 'binary_sensor.info'],
      'severity first, then oldest first');
  }

  console.log('lights in empty rooms');
  {
    const g = rule({
      group: 'lights_in_empty_rooms', empty_for: 15,
      rooms: [
        { name: 'Office', lights: ['light.o1', 'switch.o2'], occupancy: 'binary_sensor.om' },
        { name: 'Loft', lights: ['light.l1'], occupancy: 'binary_sensor.lm' },
        { name: 'Den', lights: ['light.d1'], occupancy: 'binary_sensor.dm' },
        { name: 'Guest', lights: ['light.g1'], occupancy: 'binary_sensor.gm' },
        { name: 'Bath', lights: ['light.b1'], occupancy: 'binary_sensor.bm' },
      ],
    });
    const S = states(
      st('light.o1', 'on'), st('switch.o2', 'on'), st('binary_sensor.om', 'off', {}, 40),
      st('light.l1', 'on'), st('binary_sensor.lm', 'off', {}, 20),
      st('light.d1', 'on'), st('binary_sensor.dm', 'on'),
      st('light.g1', 'off'), st('binary_sensor.gm', 'off', {}, 90),
      st('light.b1', 'on'), st('binary_sensor.bm', 'off', {}, 5),
    );
    const out = H.evalAttention([g], S, NOW);
    eq(out.length, 1, 'fires');
    eq(out[0].message, '3 lights on in Office and Loft', 'counts lit lights in empty rooms only');
    eq(out[0].entities, ['light.o1', 'switch.o2', 'light.l1'], 'occupied, unlit and recently-empty rooms excluded');
    eq(out[0].fix.label, 'Turn off', 'default fix label');
    eq(out[0].fix.calls, [
      { domain: 'light', service: 'turn_off', data: { entity_id: ['light.o1', 'light.l1'] } },
      { domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.o2' } },
    ], 'fix turns off lit lights, one call per domain');
    eq(out[0].severity, 'info', 'default severity info');
    const S2 = { ...S, 'binary_sensor.om': st('binary_sensor.om', 'unavailable', {}, 99), 'binary_sensor.lm': st('binary_sensor.lm', 'on') };
    eq(H.evalAttention([g], S2, NOW).length, 0, 'unknown occupancy is never treated as empty');
    const g2 = rule({ group: 'lights_in_empty_rooms', rooms: g.rooms, fix: { label: 'All off', action: 'homeassistant.turn_off' } });
    eq(H.evalAttention([g2], S, NOW)[0].fix.calls, [{ domain: 'homeassistant', service: 'turn_off', data: { entity_id: ['light.o1', 'switch.o2', 'light.l1'] } }],
      'custom action gets the lit lights');
  }

  console.log('low battery / unavailable groups');
  {
    const b = rule({ group: 'low_battery', below: 20, entities: ['sensor.a_battery', 'sensor.b_battery', 'sensor.c_battery'] });
    const S = states(
      st('sensor.a_battery', '9', { friendly_name: 'Gate Battery' }), st('sensor.b_battery', '14', { friendly_name: 'Remote Battery' }),
      st('sensor.c_battery', '70'),
    );
    const out = H.evalAttention([b], S, NOW);
    eq([out[0].title, out[0].message], ['Low batteries', 'Gate 9% and Remote 14%'], 'battery group lists levels');
    const u = rule({ group: 'unavailable', entities: ['light.x', 'light.y'], for: 10 });
    eq(H.evalAttention([u], states(st('light.x', 'unavailable', { friendly_name: 'Porch' }, 30), st('light.y', 'unavailable', {}, 2)), NOW)
      .map((x) => x.message), ['Porch · offline for 30 min'], 'unavailable group honours `for`');
  }

  console.log('fix inference');
  {
    eq(H.fixCalls({ label: 'Close' }, ['cover.g']).calls, [{ domain: 'cover', service: 'close_cover', data: { entity_id: 'cover.g' } }], 'cover -> close_cover');
    eq(H.fixCalls(true, ['lock.a']).label, 'Lock', 'lock -> Lock label');
    eq(H.fixCalls({ action: 'script.lock_up' }, ['lock.a']).calls, [{ domain: 'script', service: 'lock_up', data: {} }], 'other-domain action gets no entity target');
    eq(H.fixCalls({ action: 'climate.turn_off', target: { entity_id: 'climate.t' }, data: { x: 1 } }, ['binary_sensor.w']).calls,
      [{ domain: 'climate', service: 'turn_off', data: { x: 1, entity_id: 'climate.t' } }], 'explicit target + data');
    eq(H.fixCalls({ label: 'Hm' }, ['sensor.x']), null, 'no sensible fix -> no button');
  }

  console.log('progress math');
  {
    eq(H.progressPct('36', true), 64, 'percent remaining is inverted');
    eq(H.progressPct('112'), 100, 'clamped');
    eq(H.progressPct('42 %'), 42, 'tolerates a % sign');
    ok(Number.isNaN(H.progressPct('unknown')), 'unknown -> NaN');
    const items = [
      { name: 'Washer', state: 'sensor.ws', active_when: ['run'], progress: 'sensor.wp', progress_inverted: true, remaining: 'sensor.wr' },
      { name: 'Dish', state: 'sensor.ds', progress: 'sensor.dp', end_time: 'sensor.de' },
      { name: 'Dryer', state: 'sensor.dr' },
      { state: 'timer.t' },
      { name: 'Idle thing', state: 'sensor.idle' },
    ].map(H.normRunning);
    const S = states(
      st('sensor.ws', 'run'), st('sensor.wp', '36'), st('sensor.wr', '0:42'),
      st('sensor.ds', 'Drying'), st('sensor.dp', '88'), st('sensor.de', new Date(NOW + 17 * MIN).toISOString()),
      st('sensor.dr', 'cooling'),
      st('timer.t', 'active', { friendly_name: 'Pasta', duration: '0:12:00', finishes_at: new Date(NOW + 3 * MIN).toISOString() }),
      st('sensor.idle', 'Ready'),
    );
    const out = H.evalRunning(items, S, NOW, new Map());
    eq(out.map((x) => x.name), ['Washer', 'Dish', 'Dryer', 'Pasta'], 'inactive items hidden (default inactive set is case-insensitive)');
    eq([out[0].pct, out[0].remaining, out[0].end], [64, 42, NOW + 42 * MIN], 'washer: inverted %, remaining, done-at');
    eq([out[1].pct, out[1].end, Math.round(out[1].remaining)], [88, NOW + 17 * MIN, 17], 'dishwasher: end_time timestamp');
    eq([out[2].pct, out[2].end, out[2].status], [null, null, 'Cooling'], 'unknown progress -> indeterminate');
    eq([out[3].pct, out[3].end, out[3].icon.icon], [75, NOW + 3 * MIN, 'mdi:timer-outline'], 'timer: progress from duration + finishes_at');
    eq(H.evalRunning([H.normRunning({ name: 'W', state: 'sensor.ws', active_when: 'running' }, 0)], S, NOW, new Map()).length, 0,
      'active_when narrows what counts as running');

    const hist = new Map();
    const pr = [H.normRunning({ name: 'Printer', state: 'sensor.p', progress: 'sensor.pp' }, 0)];
    H.evalRunning(pr, states(st('sensor.p', 'printing'), st('sensor.pp', '20')), NOW, hist);
    const est = H.evalRunning(pr, states(st('sensor.p', 'printing'), st('sensor.pp', '30')), NOW + 10 * MIN, hist)[0];
    eq([est.estimated, Math.round(est.remaining)], [true, 70], 'ETA estimated from observed progress rate');
  }

  console.log('activity descriptions');
  {
    const S = states(
      st('binary_sensor.fd', 'off', { device_class: 'door', friendly_name: 'Front Door' }),
      st('person.a', 'home', { friendly_name: 'Alex' }), st('cover.g', 'closed', { device_class: 'garage', friendly_name: 'Garage' }),
      st('binary_sensor.contact_back_gate', 'off', { device_class: 'opening', friendly_name: 'Back Gate' }),
      st('binary_sensor.shed', 'off', { device_class: 'opening', friendly_name: 'Shed' }),
      st('binary_sensor.win', 'off', { device_class: 'window', friendly_name: 'Window' }),
    );
    const d = (e) => { const x = H.describeEvent(e, S, null); return `${x.name} ${x.verb}`; };
    eq(d({ entity_id: 'binary_sensor.fd', state: 'on' }), 'Front Door opened', 'door opened');
    eq(d({ entity_id: 'cover.g', state: 'closed' }), 'Garage closed', 'garage closed');
    const tone = (e) => H.describeEvent(e, S, null).tone;
    eq([tone({ entity_id: 'cover.g', state: 'closed' }), tone({ entity_id: 'cover.g', state: 'open' }), tone({ entity_id: 'binary_sensor.fd', state: 'off' }), tone({ entity_id: 'binary_sensor.fd', state: 'on' })],
      ['ok', 'warn', 'ok', 'warn'], 'doors and garages: closed green, open yellow (like locks)');
    eq([tone({ entity_id: 'binary_sensor.contact_back_gate', state: 'on' }), tone({ entity_id: 'binary_sensor.contact_back_gate', state: 'off' })], ['warn', 'ok'], 'a gate reads like a door');
    eq(H.describeEvent({ entity_id: 'binary_sensor.contact_back_gate', state: 'on' }, S, null).icon, { icon: 'mdi:gate-open' }, 'gate icon');
    eq(tone({ entity_id: 'binary_sensor.shed', state: 'off' }), 'neutral', 'other openings stay neutral');
    eq([tone({ entity_id: 'binary_sensor.win', state: 'on' }), tone({ entity_id: 'binary_sensor.win', state: 'off' })], ['warn', 'ok'], 'windows too');
    eq(d({ entity_id: 'person.a', state: 'home' }), 'Alex arrived home', 'arrived home');
    eq(d({ entity_id: 'person.a', state: 'not_home' }), 'Alex left home', 'left home');
    eq(d({ entity_id: 'lock.x', state: 'unlocked' }), 'X unlocked', 'unknown entity falls back to its id');
  }

  console.log('card: render, fix call, spinner -> check');
  {
    const { mock, $, $$, items, item, card, events } = setup({ delay: 30 });
    await sleep(30);
    const keys = items().map((el) => el.dataset.key);
    eq(keys, ['r2', 'r0', 'r3', 'r4', 'r5', 'r1'], 'demo: alert, then warns by age, then infos');
    eq(item('r0').querySelector('.m').textContent.startsWith('Unlocked for 2 h'), true, 'duration message rendered');
    ok(item('r2').querySelector('.fix').hidden, 'info-only rule has no button');
    eq($('.zone.att .count').textContent, '6', 'attention count');
    ok($('.summary').textContent.startsWith('6 things need you'), 'header summary');
    eq($$('.run').length, 4, 'four things running');
    eq(card.getGridOptions(), { columns: 'full', rows: 'auto' }, 'getGridOptions');

    const fix = item('r0').querySelector('.fix');
    fix.click();
    await sleep(0);
    ok(fix.classList.contains('busy'), 'spinner while the service call runs');
    eq(mock.calls.at(-1), { domain: 'lock', service: 'lock', data: { entity_id: 'lock.side_entry' } }, 'hass.callService(lock.lock)');
    await sleep(450);
    ok(fix.classList.contains('done'), 'check mark after the call');
    ok(events.some((e) => e[0] === 'haptic'), 'haptic feedback');
    ok(!!item('r0'), 'row stays while its check mark shows, even though the lock already reports locked');
    await sleep(1700);
    ok(!item('r0'), 'then the item leaves');
    eq(items().length, 5, 'five left');

    const lightsFix = item('r1').querySelector('.fix');
    lightsFix.click();
    await sleep(500);
    eq(mock.calls.slice(-2).map((c) => `${c.domain}.${c.service}`), ['light.turn_off', 'switch.turn_off'], 'group fix: one call per domain');

    const garage = item('r4').querySelector('.fix');
    const n = mock.calls.length;
    garage.click();
    await sleep(10);
    eq([mock.calls.length, garage.classList.contains('confirm'), garage.textContent.includes('Confirm')], [n, true, true], 'confirm: first tap asks');
    garage.click();
    await sleep(450);
    eq(mock.calls.at(-1).service, 'close_cover', 'confirm: second tap calls');

    item('r3').querySelector('.main').click();
    eq(events.filter((e) => e[0] === 'more-info').at(-1), ['more-info', 'binary_sensor.study_window'], 'tap row opens more-info');
  }

  console.log('card: failed service call');
  {
    const { item } = setup({ failService: true });
    const w = console.warn; console.warn = () => {};
    const fix = item('r0').querySelector('.fix');
    fix.click();
    await sleep(450);
    console.warn = w;
    ok(fix.classList.contains('error') && fix.textContent.includes('Retry'), 'error state offers retry');
  }

  console.log('card: calm');
  {
    const { $, items, $$ } = setup({ scenario: 'calm' });
    await sleep(30);
    eq(items().length, 0, 'nothing firing');
    ok(!$('.calm').hidden, 'calm state shown');
    eq($('.calm .t').textContent, 'Nothing needs you', 'calm title');
    eq($('.calm .m').textContent, 'All 6 checks clear', 'calm subline counts the checks');
    eq($$('.calm .ck').length, 6, 'each check listed');
    eq($$('.run').length, 0, 'nothing running');
    ok($$('section')[1].hidden, 'in-progress section hidden when nothing runs');
    ok($('.summary').textContent.startsWith('All calm'), 'summary says all calm');
  }

  console.log('card: activity stream');
  {
    const { mock, card, $$, w } = setup();
    eq(mock.streams.length, 1, 'subscribed once');
    const msg = mock.streams[0].msg;
    eq([msg.type, msg.entity_ids.length], ['logbook/event_stream', 7], 'logbook/event_stream with configured entities');
    ok(Math.abs(Date.parse(msg.start_time) - (Date.now() - 12 * 3600e3)) < 5000, 'start_time = now - hours');
    await sleep(30);
    const rows = $$('.ev');
    eq(rows.length, 8, 'max 8 events shown');
    eq(rows[0].querySelector('.et').textContent, 'Front Door closed', 'newest first, plain English');
    eq(rows[0].querySelector('time').textContent, '2 min ago', 'relative time');
    mock.setState('binary_sensor.front_door', 'on');
    await sleep(10);
    eq($$('.ev')[0].querySelector('.et').textContent, 'Front Door opened', 'live event prepended');
    eq($$('.ev')[0].querySelector('time').textContent, 'Just now', 'live event is just now');
    ok($$('.ev')[0].classList.contains('enter'), 'live event animates in');

    // relative times refresh on the tick
    card._now = () => Date.now() + 5 * MIN;
    card._render();
    eq($$('.ev')[0].querySelector('time').textContent, '5 min ago', 'relative time refreshes');

    card.remove();
    await sleep(5);
    eq(mock.unsubscribed, 1, 'unsubscribed on disconnect');
    w.document.body.append(card);
    await sleep(5);
    eq(mock.streams.length, 2, 'resubscribed on reconnect');
  }

  console.log('card: no logbook stream -> live state fallback');
  {
    const { mock, $$ } = setup({ noStream: true });
    const wn = console.warn; console.warn = () => {};
    await sleep(20);
    console.warn = wn;
    eq($$('.ev').length, 0, 'no history without the stream');
    mock.setState('cover.garage_door', 'closed');
    await sleep(5);
    eq($$('.ev').map((e) => e.querySelector('.et').textContent), ['Garage Door closed'], 'state change recorded');
  }

  console.log('robustness');
  {
    const { card, mock, $ } = setup();
    let threw = false;
    try {
      mock.setState('sensor.washer_percent_remaining', 'garbage');
      mock.setState('sensor.dishwasher_end', 'not a date');
      mock.setState('lock.side_entry', 'unlocked', null, 99999);
      card.hass = { states: { 'lock.side_entry': null } };
      card.hass = { states: {} };
    } catch (e) { threw = true; }
    ok(!threw, 'garbage states never throw');
    ok(!!$('ha-card'), 'still rendered');
    const c = makeWindow().document.createElement('glasshouse-now-card');
    throws(() => c.setConfig({}), /at least one/, 'empty config rejected');
    throws(() => c.setConfig({ attention: [{ when: 'on' }] }), /needs an "entity"/, 'rule without entity rejected');
    throws(() => c.setConfig({ attention: [{ group: 'nope' }] }), /unknown group/, 'unknown group rejected');
    throws(() => c.setConfig({ activity: { entities: [] } }), /at least one entity/, 'empty activity rejected');
    c.setConfig({ activity: { entities: ['lock.a'], visible: 6, hours: 6 } });
    eq([c._config.activity.visible, c._config.activity.max, c._config.activity.hours], [6, 100, 6], 'activity.visible keeps up to 100 events');
    c.setConfig({ activity: { entities: ['lock.a'], show_time: true } });
    eq(c._config.activity.showTime, true, 'activity.show_time parsed');
    c.setConfig({ activity: { entities: ['lock.a'] } });
    eq([c._config.activity.visible, c._config.activity.max], [null, 8], 'activity defaults unchanged');
    c.setConfig({ attention: [] });
    ok(true, 'attention: [] is valid (always calm)');
    const stub = c.constructor.getStubConfig({ states: { 'lock.a': { entity_id: 'lock.a', state: 'locked', attributes: {} } } });
    c.setConfig(stub);
    eq(stub.attention[0].entity, 'lock.a', 'stub config picks a lock');
    c.setConfig(c.constructor.getStubConfig({ states: {} }));
    ok(true, 'stub config works with no entities');
  }

  console.log('details actions: sensor_sentinel');
  {
    const w = makeWindow();
    const card = w.document.createElement('glasshouse-now-card');
    card.setConfig({ attention: [{ id: 'sent', entity: 'sensor.sent', above: 0, name: 'Devices unavailable',
      details: { attribute: 'entities', group_by: 'integration', actions: 'sensor_sentinel' } }] });
    w.document.body.append(card);
    const calls = [];
    const ago = new Date(Date.now() - 3600e3).toISOString();
    card.hass = {
      states: { 'sensor.sent': { entity_id: 'sensor.sent', state: '2', last_changed: ago, attributes: { entities: [
        { entity_id: 'sensor.a', name: 'Dehumidifier', integration: 'midea_ac_lan', area: 'Garage', since: ago },
        { entity_id: 'sensor.z', name: 'Door', integration: 'zwave_js', area: 'Hall', since: ago }] } } },
      user: { name: 'T' }, language: 'en', locale: { language: 'en' },
      connection: { subscribeMessage: () => Promise.resolve(() => {}) },
      callService: (d, s, data, target) => { calls.push([d, s, data, target]); return Promise.resolve(); },
      callWS: (m) => { calls.push(['ws', m.type, m]); return Promise.resolve(); },
    };
    await sleep(30);
    const $ = (sel) => card.shadowRoot.querySelector(sel);
    const $$ = (sel) => [...card.shadowRoot.querySelectorAll(sel)];
    $('.item .main').click();
    await sleep(30);
    eq($$('.det .drow').length, 2, 'each entity row has actions');
    const rowOf = (name) => $$('.det .drow').find((r) => r.textContent.includes(name));
    const act = (name, i) => rowOf(name).querySelectorAll('.da')[i];
    act('Door', 0).click(); await sleep(10);
    eq(calls.at(-1).slice(0, 2), ['zwave_js', 'ping'], 'z-wave ping');
    act('Dehumidifier', 0).click(); await sleep(10);
    eq(calls.at(-1), ['homeassistant', 'update_entity', {}, { entity_id: 'sensor.a' }], 'other entities are asked to refresh');
    act('Dehumidifier', 1).click(); await sleep(10);
    const chips = $$('.det .dsnz button');
    eq(chips.map((c) => c.textContent), ['1 h', '1 day', '7 days', '14 days', 'Always'], 'ignore presets');
    chips[3].click(); await sleep(10);
    eq(calls.at(-1).slice(0, 3), ['sensor_sentinel', 'snooze', { entity_id: 'sensor.a', minutes: 20160 }], 'ignore 14 days snoozes in Sentinel');
    act('Dehumidifier', 1).click(); await sleep(10);
    $$('.det .dsnz button')[4].click(); await sleep(10);
    eq(calls.at(-1).slice(0, 3), ['sensor_sentinel', 'exclude', { entity_id: 'sensor.a' }], 'Always excludes in Sentinel');
    const n = calls.length;
    act('Dehumidifier', 2).click(); await sleep(10);
    eq(calls.length, n, 'deactivate asks first');
    act('Dehumidifier', 2).click(); await sleep(10);
    eq(calls.at(-1).slice(0, 2), ['ws', 'config/entity_registry/update'], 'second tap disables the entity');
    eq(calls.at(-1)[2].disabled_by, 'user', 'disabled by user');
    $$('.det .dg .da')[0].click(); await sleep(10);
    eq(calls.at(-1)[1], 'reload_config_entry', 'group reload');
    ok(!!$('.det .dmsg'), 'feedback message shown');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
