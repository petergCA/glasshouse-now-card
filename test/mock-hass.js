/* Mock Home Assistant `hass` for the Glasshouse Now card harness and node tests.
 * Generic demo data only. Timestamps are relative to "now" when the mock is created.
 * - callService mutates the mock state (a new state object per change, like HA) and publishes a
 *   fresh hass object to every subscriber.
 * - connection.subscribeMessage fakes `logbook/event_stream`: it sends the historical events in the
 *   window, then streams live events whenever a watched entity changes (or via mock.emit()). */
(function (root) {
  'use strict';

  const MIN = 60000;

  function s(entity_id, state, attributes, agoMin) {
    const t = new Date(Date.now() - (agoMin || 0) * MIN).toISOString();
    return { entity_id, state: String(state), attributes: attributes || {}, last_changed: t, last_updated: t, context: { id: 'x' } };
  }

  /** scenario: 'busy' (everything firing) or 'calm' (nothing needs you, nothing running). */
  function demoStates(scenario) {
    const calm = scenario === 'calm';
    const now = Date.now();
    const iso = (min) => new Date(now + min * MIN).toISOString();
    const list = [
      // locks and doors
      s('lock.side_entry', calm ? 'locked' : 'unlocked', { friendly_name: 'Side Entry Lock' }, calm ? 300 : 124),
      s('lock.front_door', 'locked', { friendly_name: 'Front Door Lock' }, 40),
      s('cover.garage_door', calm ? 'closed' : 'open', { friendly_name: 'Garage Door', device_class: 'garage' }, calm ? 18 : 22),
      s('binary_sensor.front_door', 'off', { friendly_name: 'Front Door', device_class: 'door' }, 2),
      s('binary_sensor.patio_slider', calm ? 'off' : 'on', { friendly_name: 'Patio Slider', device_class: 'door' }, 14),
      s('binary_sensor.study_window', calm ? 'off' : 'on', { friendly_name: 'Study Window', device_class: 'window' }, 51),
      s('binary_sensor.rain', calm ? 'off' : 'on', { friendly_name: 'Raining', device_class: 'moisture' }, 70),
      s('climate.thermostat', 'heat', { friendly_name: 'Thermostat', current_temperature: 68, temperature: 70 }, 300),
      s('binary_sensor.hall_motion', 'off', { friendly_name: 'Hall Motion', device_class: 'motion' }, 6),

      // rooms for lights_in_empty_rooms
      s('light.study_ceiling', calm ? 'off' : 'on', { friendly_name: 'Study Ceiling' }, 80),
      s('switch.study_desk_lamp', calm ? 'off' : 'on', { friendly_name: 'Desk Lamp' }, 80),
      s('binary_sensor.study_motion', 'off', { friendly_name: 'Study Motion', device_class: 'motion' }, 38),
      s('light.loft_lights', calm ? 'off' : 'on', { friendly_name: 'Loft Lights' }, 95),
      s('binary_sensor.stairs_motion', 'off', { friendly_name: 'Stairs Motion', device_class: 'motion' }, 26),
      s('light.den_lamps', 'on', { friendly_name: 'Den Lamps' }, 60),
      s('binary_sensor.den_motion', 'on', { friendly_name: 'Den Motion', device_class: 'motion' }, 1),

      // batteries
      s('sensor.side_gate_battery', calm ? '82' : '9', { friendly_name: 'Side Gate Sensor Battery', unit_of_measurement: '%', device_class: 'battery' }, 600),
      s('sensor.hall_remote_battery', calm ? '64' : '14', { friendly_name: 'Hall Remote Battery', unit_of_measurement: '%', device_class: 'battery' }, 900),
      s('sensor.porch_sensor_battery', '71', { friendly_name: 'Porch Sensor Battery', unit_of_measurement: '%', device_class: 'battery' }, 900),

      // appliances
      s('sensor.washer_state', calm ? 'off' : 'run', { friendly_name: 'Washer Machine State' }, 38),
      s('sensor.washer_percent_remaining', calm ? '0' : '36', { friendly_name: 'Washer Remaining', unit_of_measurement: '%' }, 1),
      s('sensor.washer_time_remaining', calm ? '0:00' : '0:42', { friendly_name: 'Washer Time Remaining' }, 1),
      s('sensor.dishwasher_state', calm ? 'off' : 'drying', { friendly_name: 'Dishwasher' }, 12),
      s('sensor.dishwasher_progress', calm ? '0' : '88', { unit_of_measurement: '%' }, 2),
      s('sensor.dishwasher_end', calm ? 'unknown' : iso(17), { device_class: 'timestamp' }, 50),
      s('sensor.printer_state', calm ? 'idle' : 'printing', { friendly_name: 'Printer' }, 90),
      s('sensor.printer_progress', calm ? '0' : '23', { unit_of_measurement: '%' }, 1),
      s('sensor.printer_remaining', calm ? '0' : '2.9', { unit_of_measurement: 'h' }, 1),
      s('timer.kitchen', calm ? 'idle' : 'active', { friendly_name: 'Pasta Timer', duration: '0:12:00',
        finishes_at: calm ? undefined : iso(4.5), remaining: '0:12:00' }, 7.5),

      // people
      s('person.alex', 'home', { friendly_name: 'Alex' }, 34),
      s('person.sam', 'not_home', { friendly_name: 'Sam' }, 190),
    ];
    const states = {};
    for (const x of list) states[x.entity_id] = x;
    return states;
  }

  /** Historical logbook events (when = epoch seconds, like HA). */
  function demoEvents(scenario) {
    const now = Date.now() / 1000;
    const ago = (m) => now - m * 60;
    const ev = (entity_id, state, m) => ({ entity_id, state, when: ago(m) });
    const list = [
      ev('binary_sensor.front_door', 'off', 2),
      ev('binary_sensor.front_door', 'on', 3),
      ev('cover.garage_door', 'open', 22),
      ev('person.alex', 'home', 34),
      ev('lock.front_door', 'locked', 40),
      ev('lock.front_door', 'unlocked', 41),
      ev('binary_sensor.patio_slider', 'on', 14),
      ev('lock.side_entry', 'unlocked', 124),
      ev('person.sam', 'not_home', 190),
      ev('cover.garage_door', 'closed', 205),
      ev('binary_sensor.front_door', 'off', 260),
    ];
    if (scenario === 'calm') return list.filter((e) => e.entity_id !== 'binary_sensor.patio_slider');
    return list;
  }

  function createHass(opts) {
    const o = opts || {};
    const subscribers = new Set();
    const calls = [];
    const streams = [];
    let unsubscribed = 0;
    let states = o.states || demoStates(o.scenario);
    const history = o.events || demoEvents(o.scenario);

    function commit(id, mutate) {
      const prev = states[id];
      if (!prev) return;
      const t = new Date().toISOString();
      const next = { ...prev, attributes: { ...prev.attributes }, last_updated: t };
      mutate(next, next.attributes);
      if (next.state !== prev.state) next.last_changed = t;
      states = { ...states, [id]: next };
      if (next.state !== prev.state) emit({ entity_id: id, state: next.state, when: Date.now() / 1000 });
      publish();
    }

    function publish() {
      const hass = makeHass();
      api.current = hass;
      subscribers.forEach((fn) => fn(hass));
    }

    function emit(event) {
      for (const st of streams) {
        if (st.closed) continue;
        if (st.ids && !st.ids.includes(event.entity_id)) continue;
        st.cb({ events: [event] });
      }
    }

    const SERVICE_STATE = {
      lock: { lock: 'locked', unlock: 'unlocked' },
      cover: { close_cover: 'closed', open_cover: 'open' },
      climate: { turn_off: 'off' },
    };

    function apply(domain, service, data) {
      const ids = [].concat(data.entity_id || []);
      for (const id of ids) {
        commit(id, (st) => {
          const mapped = SERVICE_STATE[domain] && SERVICE_STATE[domain][service];
          if (mapped) st.state = mapped;
          else if (service === 'turn_off') st.state = 'off';
          else if (service === 'turn_on') st.state = 'on';
          else if (service === 'toggle') st.state = st.state === 'on' ? 'off' : 'on';
        });
      }
    }

    const connection = {
      subscribeMessage(cb, msg) {
        if (o.noStream) return Promise.reject(new Error('unknown command'));
        const st = { cb, msg, ids: msg.entity_ids || null, closed: false };
        streams.push(st);
        const start = Date.parse(msg.start_time) / 1000;
        setTimeout(() => {
          if (st.closed) return;
          const evs = history.filter((e) => (!st.ids || st.ids.includes(e.entity_id)) && e.when >= start)
            .sort((a, b) => a.when - b.when);
          cb({ events: evs, start_time: start, end_time: Date.now() / 1000, partial: true });
          cb({ events: [], start_time: start, end_time: Date.now() / 1000 });
        }, o.streamDelay === undefined ? 5 : o.streamDelay);
        return Promise.resolve(() => { st.closed = true; unsubscribed += 1; });
      },
    };

    function makeHass() {
      return {
        states,
        user: { name: 'Demo' },
        language: 'en',
        locale: { language: 'en', time_format: o.timeFormat || 'language' },
        connection,
        callService(domain, service, data) {
          calls.push({ domain, service, data: JSON.parse(JSON.stringify(data || {})) });
          if (o.failService) return Promise.reject(new Error('service failed'));
          if (o.delay) setTimeout(() => apply(domain, service, data || {}), o.delay);
          else apply(domain, service, data || {});
          return Promise.resolve();
        },
      };
    }

    const api = {
      calls,
      streams,
      get unsubscribed() { return unsubscribed; },
      current: makeHass(),
      emit,
      subscribe(fn) { subscribers.add(fn); fn(api.current); return () => subscribers.delete(fn); },
      setState(id, state, attrs, agoMin) {
        commit(id, (st, a) => {
          st.state = String(state);
          Object.assign(a, attrs || {});
          if (agoMin !== undefined) st.last_changed = new Date(Date.now() - agoMin * MIN).toISOString();
        });
      },
    };
    return api;
  }

  /** The demo card configuration used by the harness and tests. */
  function demoConfig() {
    return {
      type: 'custom:glasshouse-now-card',
      title: 'Now',
      attention: [
        { entity: 'lock.side_entry', when: 'unlocked', for: 30, name: 'Side entry lock', message: 'unlocked for {duration}',
          severity: 'warn', icon: 'mdi:lock-open-variant', fix: { label: 'Lock', action: 'lock.lock' } },
        { group: 'lights_in_empty_rooms', name: 'Lights on in empty rooms', empty_for: 15, severity: 'info', fix: { label: 'Turn off' },
          rooms: [
            { name: 'Study', lights: ['light.study_ceiling', 'switch.study_desk_lamp'], occupancy: 'binary_sensor.study_motion' },
            { name: 'Loft', lights: ['light.loft_lights'], occupancy: 'binary_sensor.stairs_motion' },
            { name: 'Den', lights: ['light.den_lamps'], occupancy: 'binary_sensor.den_motion' },
          ] },
        { entity: 'binary_sensor.patio_slider', when: 'on', name: 'Patio slider', message: "open while it's raining",
          severity: 'alert', icon: 'mdi:weather-pouring', condition: { entity: 'binary_sensor.rain', state: 'on' } },
        { entity: 'binary_sensor.study_window', when: 'on', for: 5, name: 'Study window', message: 'open {duration} with the heat on',
          severity: 'warn', icon: 'mdi:window-open-variant', condition: { entity: 'climate.thermostat', state: 'heat' },
          fix: { label: 'Pause heat', action: 'climate.turn_off', target: { entity_id: 'climate.thermostat' } } },
        { entity: 'cover.garage_door', when: 'open', for: 15, name: 'Garage door', severity: 'warn',
          fix: { label: 'Close', action: 'cover.close_cover', confirm: true } },
        { group: 'low_battery', below: 20, entities: ['sensor.side_gate_battery', 'sensor.hall_remote_battery', 'sensor.porch_sensor_battery'] },
      ],
      running: [
        { name: 'Washer', icon: 'mdi:washing-machine', state: 'sensor.washer_state', active_when: ['run', 'running'],
          progress: 'sensor.washer_percent_remaining', progress_inverted: true, remaining: 'sensor.washer_time_remaining' },
        { name: 'Dishwasher', state: 'sensor.dishwasher_state', progress: 'sensor.dishwasher_progress', end_time: 'sensor.dishwasher_end', accent: 'water' },
        { name: '3D printer', state: 'sensor.printer_state', progress: 'sensor.printer_progress', remaining: 'sensor.printer_remaining', accent: 'media' },
        { state: 'timer.kitchen', accent: 'heat' },
      ],
      activity: {
        entities: ['binary_sensor.front_door', 'cover.garage_door', 'person.alex', 'person.sam', 'lock.front_door', 'lock.side_entry', 'binary_sensor.patio_slider'],
        max: 8, hours: 12,
      },
    };
  }

  root.GHNowMock = { demoStates, demoEvents, createHass, demoConfig };
})(typeof window !== 'undefined' ? window : globalThis);
