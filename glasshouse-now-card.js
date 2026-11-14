/*!
 * Glasshouse Now Card v1.3.0
 * What matters in the home right now: what needs you, what is running, and what just happened.
 * Part of the Glasshouse card suite. MIT License (c) 2026 Peter Gray.
 */
(() => {
  'use strict';

  const VERSION = '1.3.0';
  const TAG = 'glasshouse-now-card';

  const TICK_MS = 30000;
  const DONE_MS = 1600;
  const ERROR_MS = 3200;
  const CONFIRM_MS = 3500;
  const MIN_BUSY_MS = 380;
  const LEAVE_MS = 300;

  const SEVERITIES = ['alert', 'warn', 'info'];
  const SEV_RANK = { alert: 0, warn: 1, info: 2 };
  const SEV_COLOR = { alert: 'var(--gh-alert)', warn: 'var(--gh-warn)', info: 'var(--gh-info)' };
  const GROUPS = ['lights_in_empty_rooms', 'low_battery', 'unavailable'];

  const DEAD = new Set(['unavailable', 'unknown', 'none', '']);
  const INACTIVE = new Set([
    'off', 'idle', 'stop', 'stopped', 'ready', 'none', 'unavailable', 'unknown', '0', '',
    'standby', 'finished', 'finish', 'complete', 'completed', 'end', 'not running', 'offline',
    'power off', 'power_off', 'inactive', 'false',
  ]);
  const ON_STATES = new Set(['on', 'open', 'opening', 'closing', 'unlocked', 'jammed', 'home', 'playing', 'active', 'triggered', 'heat', 'cool']);

  // Default fix per entity domain when the config gives a label but no action.
  const INFER_FIX = {
    lock: ['lock', 'Lock'],
    light: ['turn_off', 'Turn off'],
    switch: ['turn_off', 'Turn off'],
    fan: ['turn_off', 'Turn off'],
    input_boolean: ['turn_off', 'Turn off'],
    siren: ['turn_off', 'Silence'],
    humidifier: ['turn_off', 'Turn off'],
    climate: ['turn_off', 'Turn off'],
    cover: ['close_cover', 'Close'],
    valve: ['close_valve', 'Close'],
    media_player: ['media_pause', 'Pause'],
  };

  const BS_WORDS = {
    door: ['open', 'closed'], garage_door: ['open', 'closed'], window: ['open', 'closed'],
    opening: ['open', 'closed'], lock: ['unlocked', 'locked'], motion: ['motion', 'clear'],
    occupancy: ['occupied', 'clear'], presence: ['home', 'away'], moisture: ['wet', 'dry'],
    smoke: ['smoke', 'clear'], gas: ['gas detected', 'clear'], carbon_monoxide: ['CO detected', 'clear'],
    battery: ['low', 'normal'], problem: ['problem', 'OK'], connectivity: ['connected', 'disconnected'],
    plug: ['plugged in', 'unplugged'], power: ['on', 'off'], vibration: ['vibrating', 'still'],
    running: ['running', 'not running'], safety: ['unsafe', 'safe'], tamper: ['tampered', 'clear'],
    light: ['light', 'dark'], heat: ['hot', 'normal'], cold: ['cold', 'normal'], sound: ['sound', 'quiet'],
    update: ['update available', 'up to date'], battery_charging: ['charging', 'not charging'],
  };

  const RUN_WORDS = {
    run: 'running', running: 'running', wash: 'washing', washing: 'washing', rinse: 'rinsing',
    spin: 'spinning', dry: 'drying', drying: 'drying', print: 'printing', printing: 'printing',
    cool: 'cooling', cooling: 'cooling', heat: 'heating', heating: 'heating', active: 'running',
    prewash: 'pre-wash', main_wash: 'washing', soak: 'soaking', steam: 'steaming', clean: 'cleaning',
    cleaning: 'cleaning', paused: 'paused', pause: 'paused', on: 'running', delayed_start: 'delayed start',
  };

  const RUN_ICONS = [
    [/wash(er|ing)?\b|laundry/i, 'mdi:washing-machine'],
    [/dryer/i, 'mdi:tumble-dryer'],
    [/dish/i, 'mdi:dishwasher'],
    [/print/i, 'mdi:printer-3d-nozzle'],
    [/oven|cook|bake/i, 'mdi:stove'],
    [/vacuum|robot|mop/i, 'mdi:robot-vacuum'],
    [/charg|car\b|ev\b/i, 'mdi:ev-station'],
    [/timer/i, 'mdi:timer-outline'],
    [/coffee/i, 'mdi:coffee-maker'],
  ];

  const domainOf = (id) => String(id || '').split('.')[0];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isNum = (v) => v !== null && v !== undefined && typeof v !== 'boolean' && String(v).trim() !== '' && !Number.isNaN(Number(v));
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
  const toList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const norm = (v) => (v === true ? 'on' : v === false ? 'off' : String(v === null || v === undefined ? '' : v).trim().toLowerCase());
  const isDead = (st) => !st || DEAD.has(norm(st.state));
  const plural = (n, one, many) => (n === 1 ? one : many || `${one}s`);

  const STYLE = `
    :host {
      --gh-font: var(--glasshouse-font, -apple-system, "SF Pro Text", Inter, Roboto, system-ui, sans-serif);
      --gh-surface: var(--glasshouse-surface, rgba(255,255,255,0.045));
      --gh-surface-2: var(--glasshouse-surface-2, rgba(255,255,255,0.075));
      --gh-border: var(--glasshouse-border, rgba(255,255,255,0.09));
      --gh-blur: var(--glasshouse-blur, 18px);
      --gh-radius: var(--glasshouse-radius, 22px);
      --gh-radius-sm: var(--glasshouse-radius-sm, 14px);
      --gh-pad: var(--glasshouse-pad, 16px);
      --gh-gap: var(--glasshouse-gap, 10px);
      --gh-text: var(--glasshouse-text, #e9eef6);
      --gh-text-2: var(--glasshouse-text-2, #93a0b5);
      --gh-text-3: var(--glasshouse-text-3, #5d697d);
      --gh-ok: var(--glasshouse-ok, #3fb950);
      --gh-warn: var(--glasshouse-warn, #e3b341);
      --gh-alert: var(--glasshouse-alert, #ff5c5c);
      --gh-info: var(--glasshouse-info, #58a6ff);
      --gh-light: var(--glasshouse-light, #ffb547);
      --gh-fan: var(--glasshouse-fan, #4dd6e8);
      --gh-cover: var(--glasshouse-cover, #a3a8ff);
      --gh-switch: var(--glasshouse-switch, #7ee08a);
      --gh-heat: var(--glasshouse-heat, #ff7a59);
      --gh-cool: var(--glasshouse-cool, #58a6ff);
      --gh-media: var(--glasshouse-media, #c48cff);
      --gh-lock: var(--glasshouse-lock, #3fb950);
      --gh-security: var(--glasshouse-security, #ff5c5c);
      --gh-energy: var(--glasshouse-energy, #f6d365);
      --gh-water: var(--glasshouse-water, #4aa8ff);
      --gh-neutral: var(--glasshouse-neutral, #93a0b5);
      --gh-accent: var(--glasshouse-accent, var(--gh-info));
      --gh-ease: 160ms ease;
      --gh-spring: cubic-bezier(.2, .8, .2, 1);
      display: block;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    ha-card {
      display: block; position: relative;
      container: gh-now / inline-size;
      background: var(--gh-surface);
      border: 1px solid var(--gh-border);
      border-radius: var(--gh-radius);
      -webkit-backdrop-filter: blur(var(--gh-blur)) saturate(140%);
      backdrop-filter: blur(var(--gh-blur)) saturate(140%);
      padding: var(--gh-pad);
      color: var(--gh-text);
      font-family: var(--gh-font);
      font-size: 13px; font-weight: 500; line-height: 1.3;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }
    button {
      font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0;
      cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
    }
    button:focus { outline: none; }
    button:focus-visible { outline: 2px solid var(--gh-accent); outline-offset: 2px; }
    ha-icon, ha-state-icon { display: inline-flex; --mdc-icon-size: 20px; }
    .tnum { font-variant-numeric: tabular-nums; }

    /* ---------- header ---------- */
    .head { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 2px; }
    .titles { flex: 1 1 auto; min-width: 0; }
    .title { font-size: 16px; font-weight: 650; letter-spacing: -0.005em; line-height: 1.25;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .summary { display: flex; align-items: center; gap: 7px; margin-top: 3px; color: var(--gh-text-2);
      white-space: nowrap; overflow: hidden; }
    .summary .s { overflow: hidden; text-overflow: ellipsis; }
    .summary b { color: var(--gh-text); font-weight: 600; }
    @container gh-now (max-width: 460px) { .opt { display: none; } }
    .pulse { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--st, var(--gh-ok));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--st, var(--gh-ok)) 18%, transparent), 0 0 10px 0 var(--st, var(--gh-ok)); }
    .pulse.alert { animation: gh-dot 2.4s ease-in-out infinite; }
    @keyframes gh-dot { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--st) 0%, transparent), 0 0 14px 2px var(--st); } }
    .clock { flex: 0 0 auto; text-align: right; }
    .clock .tm { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .clock .tm small { font-size: 11px; font-weight: 600; color: var(--gh-text-2); margin-left: 2px; letter-spacing: .02em; }
    .clock .dt { margin-top: 3px; font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--gh-text-3); }

    /* ---------- layout ---------- */
    .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; margin-top: 16px; }
    .head[hidden] + .body { margin-top: 2px; }
    .col { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
    .main-col { container: gh-main / inline-size; }
    @container gh-main (min-width: 620px) {
      .list.run-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list.run-list > :last-child:nth-child(odd) { grid-column: 1 / -1; }
    }
    .col:empty, .col.empty { display: none; }
    @container gh-now (min-width: 700px) {
      .body.split { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 0; }
      .body.split .main-col { padding-right: 22px; }
      .body.split .side-col { padding-left: 22px; border-left: 1px solid var(--gh-border); }
      /* the left column sets the height; the feed fills it and scrolls instead of leaving blank space */
      .body.split .side-col { position: relative; min-height: 236px; }
      .body.split .side-col > .zone { position: absolute; inset: 0 0 0 22px; display: flex; flex-direction: column; }
      .body.split .side-col .feed { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none;
        -webkit-mask-image: linear-gradient(#000 calc(100% - 26px), transparent); mask-image: linear-gradient(#000 calc(100% - 26px), transparent); }
      .body.split .side-col .feed::-webkit-scrollbar { display: none; }
    }
    @container gh-now (max-width: 699px) {
      .body.split .side-col { padding-top: 18px; border-top: 1px solid var(--gh-border); }
    }

    .zone-h { display: flex; align-items: center; gap: 8px; height: 18px; margin: 0 2px 10px; }
    .label { font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--gh-text-2); }
    .count { min-width: 18px; height: 18px; padding: 0 6px; border-radius: 999px; display: inline-grid; place-items: center;
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
      color: var(--c, var(--gh-text-2)); background: color-mix(in srgb, var(--c, var(--gh-text-2)) 16%, transparent); }
    .zone-h .rule { flex: 1 1 auto; height: 1px; background: linear-gradient(90deg, var(--gh-border), transparent); }
    .live { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .09em;
      text-transform: uppercase; color: var(--gh-text-3); }
    .live i { width: 6px; height: 6px; border-radius: 50%; background: var(--gh-text-3); }
    .live.on { color: var(--gh-ok); }
    .live.on i { background: var(--gh-ok); box-shadow: 0 0 8px var(--gh-ok); animation: gh-live 2.4s ease-in-out infinite; }
    @keyframes gh-live { 50% { opacity: .35; } }
    .list { display: flex; flex-direction: column; gap: 8px; }

    /* ---------- attention ---------- */
    .item {
      --sev: var(--gh-info);
      position: relative; display: flex; align-items: center; gap: 12px;
      min-height: 64px; padding: 10px 10px 10px 16px;
      border-radius: var(--gh-radius-sm); overflow: hidden;
      background:
        linear-gradient(90deg, color-mix(in srgb, var(--sev) 11%, transparent) 0%, transparent 62%),
        var(--gh-surface-2);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
      transition: background var(--gh-ease), box-shadow var(--gh-ease), opacity var(--gh-ease);
    }
    .item.has-det { flex-wrap: wrap; }
    .item.has-det .main { cursor: pointer; }
    .item .caret { flex: 0 0 auto; color: var(--gh-text-3); transition: transform var(--gh-ease); }
    .item .caret ha-icon { --mdc-icon-size: 20px; }
    .item.open .caret { transform: rotate(180deg); }
    .det { flex: 1 0 100%; margin: 8px 0 2px 50px; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; scrollbar-width: thin; }
    .det[hidden] { display: none; }
    .det .dg { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; font-size: 11px; font-weight: 650; letter-spacing: .08em;
      text-transform: uppercase; color: var(--gh-text-2); }
    .det .dg b { color: var(--sev); font-variant-numeric: tabular-nums; }
    .det button.dr { display: flex; align-items: baseline; gap: 10px; padding: 5px 8px; border-radius: 8px; text-align: left; color: var(--gh-text);
      background: none; border: 0; font: inherit; cursor: pointer; min-width: 0; }
    .det button.dr:hover { background: var(--gh-surface); }
    .det .dn { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .det .ds { flex: 0 0 auto; color: var(--gh-text-3); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .det .dm { color: var(--gh-text-3); font-size: 12px; padding: 4px 8px; }
    .item.sev-alert { --sev: var(--gh-alert); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gh-alert) 22%, transparent); }
    .item.sev-warn { --sev: var(--gh-warn); }
    .item.sev-info { --sev: var(--gh-info); }
    .item .bar { position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0;
      background: var(--sev); box-shadow: 0 0 12px 0 var(--sev); }
    .item .main { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 12px; align-self: stretch; border-radius: 10px; }
    .chip { position: relative; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
      color: var(--sev); background: color-mix(in srgb, var(--sev) 15%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sev) 32%, transparent); }
    .item.sev-alert .chip { animation: gh-pulse 2.4s ease-in-out infinite; }
    @keyframes gh-pulse { 50% { box-shadow: inset 0 0 0 1px var(--gh-alert), 0 0 22px -4px var(--gh-alert); } }
    .txt { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .t { font-size: 14px; font-weight: 600; letter-spacing: -0.005em; color: var(--gh-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .m { color: var(--gh-text-2); font-variant-numeric: tabular-nums;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .m em { font-style: normal; color: color-mix(in srgb, var(--sev) 70%, var(--gh-text)); font-weight: 600; }

    .fix {
      --a: var(--gh-accent);
      position: relative; flex: 0 0 auto; height: 36px; min-width: 76px; padding: 0 16px; border-radius: 999px;
      display: inline-grid; place-items: center; text-align: center;
      font-size: 13px; font-weight: 650; letter-spacing: .01em; white-space: nowrap;
      color: var(--a); background: color-mix(in srgb, var(--a) 10%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--a) 52%, transparent);
      transition: background var(--gh-ease), color var(--gh-ease), box-shadow var(--gh-ease), transform 120ms ease;
    }
    .fix::before { content: ""; position: absolute; inset: -4px -2px; }
    .fix:hover { background: color-mix(in srgb, var(--a) 20%, transparent); }
    .fix:active { transform: scale(0.96); }
    .fix > * { grid-area: 1 / 1; }
    .fix .sp, .fix .ok { visibility: hidden; }
    .fix.busy { cursor: progress; }
    .fix.busy .lb, .fix.done .lb { visibility: hidden; }
    .fix.busy .sp { visibility: visible; width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--a) 30%, transparent); border-top-color: var(--a); animation: gh-spin .75s linear infinite; }
    @keyframes gh-spin { to { transform: rotate(360deg); } }
    .fix.done { --a: var(--gh-ok); background: color-mix(in srgb, var(--gh-ok) 16%, transparent); }
    .fix.done .ok { visibility: visible; width: 18px; height: 18px; }
    .fix.done .ok path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: gh-draw .42s var(--gh-spring) forwards; }
    .fix.error { --a: var(--gh-alert); animation: gh-shake .36s ease; }
    .fix.confirm { --a: var(--gh-warn); background: color-mix(in srgb, var(--gh-warn) 16%, transparent); }
    @keyframes gh-shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
    @keyframes gh-draw { to { stroke-dashoffset: 0; } }

    /* calm */
    .calm { display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 12px 14px;
      border-radius: var(--gh-radius-sm);
      background: radial-gradient(120% 140% at 0% 50%, color-mix(in srgb, var(--gh-ok) 10%, transparent), transparent 60%), var(--gh-surface-2);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03); }
    .tick { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; color: var(--gh-ok);
      filter: drop-shadow(0 0 10px color-mix(in srgb, var(--gh-ok) 55%, transparent)); }
    .tick circle { stroke-dasharray: 113; stroke-dashoffset: 0; transform: rotate(-90deg); transform-origin: 50% 50%; }
    .tick .bg { stroke-dasharray: none; opacity: .18; }
    .tick path { stroke-dasharray: 24; stroke-dashoffset: 0; }
    .calm.anim .tick circle:not(.bg) { stroke-dashoffset: 113; animation: gh-draw .9s var(--gh-spring) .05s forwards; }
    .calm.anim .tick path { stroke-dashoffset: 24; animation: gh-draw .5s var(--gh-spring) .7s forwards; }
    .calm .tick { animation: gh-breathe 4.8s ease-in-out 1.4s infinite; }
    @keyframes gh-breathe { 50% { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gh-ok) 30%, transparent)); } }
    .calm .t { font-size: 15px; }
    .calm .txt { flex: 1 1 auto; }
    .checks { display: none; }
    .ck { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 7px; border-radius: 999px;
      font-size: 12px; font-weight: 600; color: var(--gh-text-2); white-space: nowrap;
      background: rgba(255,255,255,0.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }
    .ck svg { width: 14px; height: 14px; color: var(--gh-ok); }
    .zone.att { display: flex; flex-direction: column; }
    @container gh-now (min-width: 700px) {
      .main-col { min-height: 100%; }
      .zone.att.is-calm { flex: 1 1 auto; }
      .zone.att.is-calm .calm { flex: 1 1 auto; flex-direction: column; justify-content: center; text-align: center;
        gap: 14px; padding: 28px 24px; min-height: 220px;
        background: radial-gradient(60% 70% at 50% 38%, color-mix(in srgb, var(--gh-ok) 11%, transparent), transparent 70%), var(--gh-surface-2); }
      .zone.att.is-calm .calm .tick { width: 64px; height: 64px; }
      .zone.att.is-calm .calm .txt { flex: 0 0 auto; align-items: center; gap: 4px; }
      .zone.att.is-calm .calm .t { font-size: 16px; font-weight: 650; }
      .zone.att.is-calm .checks { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 560px; margin-top: 4px; }
    }

    /* ---------- in progress ---------- */
    .run {
      --acc: var(--gh-fan);
      position: relative; display: flex; flex-direction: column; gap: 11px;
      padding: 12px 14px 14px 12px; border-radius: var(--gh-radius-sm);
      background: var(--gh-surface-2); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
    }
    .run .top { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .run .main { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 12px; border-radius: 10px; }
    .run .chip { color: var(--acc); background: color-mix(in srgb, var(--acc) 15%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 40%, transparent), 0 0 18px -6px var(--acc); }
    .run .m { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .run .m b { color: var(--gh-text); font-weight: 600; }
    .eta { flex: 0 0 auto; text-align: right; }
    .eta .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
    .eta .big small { font-size: 11px; font-weight: 650; color: var(--gh-text-2); margin-left: 3px; letter-spacing: .02em; }
    .eta .sub { margin-bottom: 5px; min-height: 13px; font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--gh-text-3); }
    .eta .big.dim { color: var(--gh-text-3); }
    .track { position: relative; height: 4px; border-radius: 4px; background: rgba(255,255,255,0.07); overflow: hidden; }
    .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 4px; overflow: hidden;
      background: linear-gradient(90deg, color-mix(in srgb, var(--acc) 55%, transparent), var(--acc));
      box-shadow: 0 0 10px 0 color-mix(in srgb, var(--acc) 60%, transparent);
      transition: width 600ms var(--gh-spring); }
    .fill::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
      animation: gh-sheen 2.8s ease-in-out infinite; }
    @keyframes gh-sheen { 60%, 100% { transform: translateX(100%); } }
    .track.indet .fill { width: 32% !important; animation: gh-indet 1.8s ease-in-out infinite; }
    @keyframes gh-indet { from { left: -32%; } to { left: 100%; } }
    .run.paused .fill { background: var(--gh-text-3); box-shadow: none; }
    .run.paused .fill::after { display: none; }

    /* ---------- activity ---------- */
    .feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    /* activity.visible: the feed keeps the height of that many rows and scrolls through the rest */
    .feed.capped { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
    .feed.capped::-webkit-scrollbar { display: none; }
    .feed.capped.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 26px), transparent); mask-image: linear-gradient(#000 calc(100% - 26px), transparent); }
    .ev { --tone: var(--gh-text-2); position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 4px 0; }
    .ev:not(:last-child)::after { content: ""; position: absolute; left: 14px; top: 36px; bottom: -8px; width: 1px;
      background: linear-gradient(rgba(255,255,255,0.16), rgba(255,255,255,0.07)); }
    .ev .dot { position: relative; z-index: 1; flex: 0 0 auto; width: 29px; height: 29px; border-radius: 50%; display: grid; place-items: center;
      color: var(--tone); background: color-mix(in srgb, var(--tone) 14%, rgb(14, 19, 29));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 34%, transparent); }
    .ev .dot ha-icon, .ev .dot ha-state-icon { --mdc-icon-size: 16px; }
    .ev .et { flex: 1 1 auto; min-width: 0; color: var(--gh-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev .et span { color: var(--gh-text-2); }
    .ev time { flex: 0 0 auto; color: var(--gh-text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
    .ev.fresh .dot { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 60%, transparent), 0 0 16px -4px var(--tone); }
    .ev.fresh time { color: var(--gh-text-2); }
    .ev.old .et { color: var(--gh-text-2); }
    .ev.old .et span { color: var(--gh-text-3); }
    .quiet { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--gh-text-3); padding: 0 2px; }
    .quiet .q-dot { width: 29px; height: 29px; border-radius: 50%; display: grid; place-items: center;
      box-shadow: inset 0 0 0 1px var(--gh-border); color: var(--gh-text-3); }

    .tone-ok { --tone: var(--gh-ok); } .tone-warn { --tone: var(--gh-warn); } .tone-alert { --tone: var(--gh-alert); }
    .tone-info { --tone: var(--gh-info); } .tone-cover { --tone: var(--gh-cover); } .tone-light { --tone: var(--gh-light); }
    .tone-switch { --tone: var(--gh-switch); } .tone-media { --tone: var(--gh-media); } .tone-heat { --tone: var(--gh-heat); }
    .tone-water { --tone: var(--gh-water); } .tone-neutral { --tone: var(--gh-text-2); } .tone-fan { --tone: var(--gh-fan); }

    /* ---------- motion ---------- */
    .enter { animation: gh-in 420ms var(--gh-spring) both; }
    @keyframes gh-in { from { opacity: 0; transform: translateY(8px) scale(.985); } }
    .leaving { pointer-events: none; overflow: hidden;
      transition: opacity 220ms ease, transform 300ms var(--gh-spring), max-height 300ms ease, margin 300ms ease, padding 300ms ease, min-height 300ms ease;
      opacity: 0 !important; transform: translateX(14px); }
    .leaving.collapse { max-height: 0 !important; min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; margin-bottom: -8px; }
    .main:hover .t { color: #fff; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
      .calm.anim .tick circle:not(.bg), .calm.anim .tick path { stroke-dashoffset: 0; }
      .fix.done .ok path { stroke-dashoffset: 0; }
    }
  `;

  /* ---------------------------------------------------------------- helpers */

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children) for (const c of [].concat(children)) if (c) el.append(c);
    return el;
  }

  function setText(el, text) {
    const t = text === undefined || text === null ? '' : String(text);
    if (el.textContent !== t) el.textContent = t;
  }

  function setCls(el, name, on) {
    if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(markup, cls, vb) {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', vb || '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    if (cls) el.setAttribute('class', cls);
    el.innerHTML = markup;
    return el;
  }
  const CHECK_SVG = '<path d="M5.5 12.5l4.2 4.2L18.5 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

  /** Swap an icon into `host` only when it changed. spec: {icon} or {stateObj, hass}. */
  function setIcon(host, spec, hass) {
    const key = spec.icon ? `i:${spec.icon}` : `s:${spec.stateObj ? `${spec.stateObj.entity_id}|${spec.stateObj.state}` : ''}`;
    if (host._iconKey === key) {
      if (!spec.icon && host.firstChild && hass) host.firstChild.hass = hass;
      return;
    }
    host._iconKey = key;
    let el;
    if (spec.icon) {
      el = document.createElement('ha-icon');
      el.setAttribute('icon', spec.icon);
      el.icon = spec.icon;
    } else {
      el = document.createElement('ha-state-icon');
      if (hass) el.hass = hass;
      el.stateObj = spec.stateObj;
    }
    host.replaceChildren(el);
  }

  function friendly(st, id, override) {
    if (override) return String(override);
    if (st && st.attributes && st.attributes.friendly_name) return String(st.attributes.friendly_name);
    const raw = String(id || (st && st.entity_id) || '').split('.').pop() || '';
    return cap(raw.replace(/_/g, ' ')) || '—';
  }

  function fmtNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  }

  function humanState(st) {
    if (!st) return '—';
    const s = String(st.state === undefined || st.state === null ? '' : st.state);
    const n = norm(s);
    if (n === 'unavailable') return 'unavailable';
    if (DEAD.has(n)) return '—';
    const d = domainOf(st.entity_id);
    const a = st.attributes || {};
    if (d === 'binary_sensor') {
      const pair = BS_WORDS[a.device_class] || ['on', 'off'];
      if (n === 'on') return pair[0];
      if (n === 'off') return pair[1];
    }
    if (isNum(s)) {
      const u = a.unit_of_measurement;
      return fmtNum(s) + (u ? (u === '%' ? '%' : ` ${u}`) : '');
    }
    if (n === 'not_home') return 'away';
    return s.replace(/_/g, ' ');
  }

  /** Minutes from a duration in any common shape. NaN when it can't be read. */
  function parseDuration(v, unit) {
    if (v === null || v === undefined || typeof v === 'boolean') return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? unitToMin(v, unit) : NaN;
    const s = String(v).trim().toLowerCase();
    if (!s || DEAD.has(s)) return NaN;
    if (isNum(s)) return unitToMin(Number(s), unit);
    let m = s.match(/^p(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?$/);
    if (m && s !== 'p' && s !== 'pt') return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60;
    m = s.match(/^(?:(\d+)\s*days?,?\s*)?(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/);
    if (m) return (+m[1] || 0) * 1440 + (+m[2]) * 60 + (+m[3]) + (+m[4] || 0) / 60;
    const re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g;
    let total = 0, hit = false, r;
    while ((r = re.exec(s))) {
      hit = true;
      const n = Number(r[1]), u = r[2][0];
      total += u === 'd' ? n * 1440 : u === 'h' ? n * 60 : u === 'm' ? n : n / 60;
    }
    return hit ? total : NaN;
  }

  function unitToMin(n, unit) {
    const u = norm(unit);
    if (!u || u === 'min' || u === 'mins' || u === 'minutes' || u === 'minute' || u === 'm') return n;
    if (u === 's' || u === 'sec' || u === 'secs' || u === 'seconds' || u === 'second') return n / 60;
    if (u === 'h' || u === 'hr' || u === 'hrs' || u === 'hours' || u === 'hour') return n * 60;
    if (u === 'd' || u === 'day' || u === 'days') return n * 1440;
    if (u === 'ms') return n / 60000;
    return n;
  }

  /** Epoch ms from an ISO string, epoch seconds/ms, or a clock time ("22:15", today or tomorrow). */
  function parseTime(v, now) {
    if (v === null || v === undefined || typeof v === 'boolean') return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? (v > 1e12 ? v : v * 1000) : NaN;
    const s = String(v).trim();
    if (!s || DEAD.has(s.toLowerCase())) return NaN;
    const cm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (cm) {
      const d = new Date(now === undefined ? Date.now() : now);
      d.setHours(+cm[1], +cm[2], +cm[3] || 0, 0);
      let t = d.getTime();
      if (now !== undefined && t < now - 12 * 3600e3) t += 864e5;
      return t;
    }
    if (isNum(s)) return parseTime(Number(s));
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  function fmtDuration(min) {
    if (!Number.isFinite(min) || min < 0) return '—';
    if (min < 1) return '<1 min';
    if (min < 60) return `${Math.floor(min)} min`;
    const hrs = Math.floor(min / 60), mins = Math.floor(min % 60);
    if (hrs < 24) return mins && hrs < 10 ? `${hrs} h ${mins} min` : `${hrs} h`;
    const d = Math.floor(hrs / 24), hh = hrs % 24;
    return hh && d < 7 ? `${d} d ${hh} h` : `${d} d`;
  }

  function fmtRelative(ms, now) {
    if (!Number.isFinite(ms)) return '—';
    const s = Math.max(0, (now - ms) / 1000);
    if (s < 45) return 'Just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const d = Math.floor(hrs / 24);
    return d === 1 ? 'Yesterday' : `${d} d ago`;
  }

  function joinNames(names, max) {
    const list = names.filter(Boolean);
    const lim = max || 3;
    if (list.length <= 1) return list[0] || '';
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    if (list.length <= lim) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return `${list.slice(0, lim - 1).join(', ')} +${list.length - (lim - 1)}`;
  }

  function template(str, vars) {
    return String(str === undefined || str === null ? '' : str).replace(/\{(\w+)\}/g, (m, k) =>
      (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  }

  /** Does a state satisfy {when|state, not, above, below}? With none of those, "active" for the domain. */
  function stateMatches(st, spec) {
    if (!st) return false;
    const sp = spec || {};
    const s = norm(st.state);
    const when = sp.when !== undefined ? sp.when : sp.state;
    const hasWhen = when !== undefined;
    const hasNot = sp.not !== undefined;
    const hasNum = sp.above !== undefined || sp.below !== undefined;
    if (!hasWhen && !hasNot && !hasNum) return defaultActive(st);
    if (hasWhen && !toList(when).map(norm).includes(s)) return false;
    if (hasNot) {
      if (DEAD.has(s)) return false;
      if (toList(sp.not).map(norm).includes(s)) return false;
    }
    if (hasNum) {
      const v = numericValue(st);
      if (!Number.isFinite(v)) return false;
      if (sp.above !== undefined && isNum(sp.above) && !(v > Number(sp.above))) return false;
      if (sp.below !== undefined && isNum(sp.below) && !(v < Number(sp.below))) return false;
    }
    return true;
  }

  function numericValue(st) {
    if (!st) return NaN;
    const v = parseFloat(String(st.state).replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
  }

  function defaultActive(st) {
    const s = norm(st.state);
    const d = domainOf(st.entity_id);
    if (d === 'lock') return s === 'unlocked' || s === 'jammed' || s === 'open' || s === 'opening';
    if (d === 'cover' || d === 'valve') return s === 'open' || s === 'opening' || s === 'closing';
    if (d === 'climate') return !DEAD.has(s) && s !== 'off';
    if (d === 'alarm_control_panel') return s === 'triggered';
    if (d === 'media_player') return s === 'playing';
    return ON_STATES.has(s);
  }

  function sinceOf(st) {
    const t = st ? parseTime(st.last_changed || st.last_updated) : NaN;
    return Number.isFinite(t) ? t : NaN;
  }

  /* ----------------------------------------------------------- attention */

  function normRule(r, i) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error(`${TAG}: attention item ${i + 1} must be an object`);
    }
    const out = { ...r, key: r.id ? `id:${r.id}` : `r${i}` };
    const sev = norm(r.severity);
    out.severity = SEVERITIES.includes(sev) ? sev : (sev === 'critical' || sev === 'error' || sev === 'danger' ? 'alert'
      : sev === 'warning' ? 'warn' : null);
    if (r.group !== undefined) {
      const g = norm(r.group);
      if (!GROUPS.includes(g)) {
        throw new Error(`${TAG}: attention item ${i + 1}: unknown group "${r.group}" (use ${GROUPS.join(', ')})`);
      }
      out.group = g;
      if (g === 'lights_in_empty_rooms') {
        if (!Array.isArray(r.rooms) || !r.rooms.length) {
          throw new Error(`${TAG}: attention item ${i + 1}: lights_in_empty_rooms needs a "rooms" list`);
        }
        out.rooms = r.rooms.filter((x) => x && typeof x === 'object').map((x, j) => ({
          name: x.name || `Room ${j + 1}`,
          lights: toList(x.lights || x.entities).filter((e) => typeof e === 'string'),
          occupancy: toList(x.occupancy).filter((e) => typeof e === 'string'),
          empty_for: x.empty_for,
        }));
        if (!out.severity) out.severity = 'info';
        if (out.fix === undefined) out.fix = { label: 'Turn off' };
      } else {
        out.entities = toList(r.entities || r.entity).filter((e) => typeof e === 'string');
        if (!out.entities.length) throw new Error(`${TAG}: attention item ${i + 1}: group ${g} needs "entities"`);
        if (!out.severity) out.severity = g === 'unavailable' ? 'warn' : 'info';
      }
    } else {
      const ents = toList(r.entities !== undefined ? r.entities : r.entity).filter((e) => typeof e === 'string' && e.includes('.'));
      if (!ents.length) throw new Error(`${TAG}: attention item ${i + 1} needs an "entity" (or "entities", or a "group")`);
      out.entities = ents;
      if (!out.severity) out.severity = 'warn';
    }
    const f = parseDuration(r.for);
    out.forMin = Number.isFinite(f) ? Math.max(0, f) : 0;
    out.conditions = toList(r.condition || r.conditions).filter((c) => c && typeof c === 'object' && c.entity);
    return out;
  }

  /** The fix as a list of service calls, or null. */
  function fixCalls(fix, targets) {
    if (!fix) return null;
    const f = fix === true ? {} : typeof fix === 'string' ? { label: fix } : fix;
    const action = f.action || f.service;
    if (action && String(action).includes('.')) {
      const [domain, service] = String(action).split('.', 2);
      const data = { ...(f.data && typeof f.data === 'object' ? f.data : {}) };
      const t = f.target !== undefined ? f.target : f.entity_id;
      if (t && typeof t === 'object' && !Array.isArray(t)) Object.assign(data, t);
      else if (t !== undefined && t !== null) data.entity_id = t;
      else if (data.entity_id === undefined) {
        const ids = domain === 'homeassistant' ? targets : targets.filter((id) => domainOf(id) === domain);
        if (ids.length) data.entity_id = ids.length === 1 ? ids[0] : ids;
      }
      return { label: f.label || cap(service.replace(/_/g, ' ')), calls: [{ domain, service, data }], confirm: !!f.confirm };
    }
    const byDomain = new Map();
    for (const id of targets) {
      const d = domainOf(id);
      if (!INFER_FIX[d]) continue;
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(id);
    }
    if (!byDomain.size) return null;
    const calls = [...byDomain].map(([d, ids]) => ({
      domain: d, service: INFER_FIX[d][0], data: { entity_id: ids.length === 1 ? ids[0] : ids },
    }));
    const label = f.label || INFER_FIX[[...byDomain.keys()][0]][1];
    return { label, calls, confirm: !!f.confirm };
  }

  function defaultRuleIcon(st, rule) {
    if (rule.icon) return { icon: rule.icon };
    if (!st) return { icon: 'mdi:alert-circle-outline' };
    const d = domainOf(st.entity_id), a = st.attributes || {}, s = norm(st.state);
    if (d === 'lock') return { icon: s === 'locked' ? 'mdi:lock' : 'mdi:lock-open-variant' };
    if (d === 'cover' || d === 'binary_sensor') {
      const dc = a.device_class;
      const open = s === 'on' || s === 'open' || s === 'opening';
      if (dc === 'garage_door' || dc === 'garage') return { icon: open ? 'mdi:garage-open-variant' : 'mdi:garage-variant' };
      if (dc === 'door') return { icon: open ? 'mdi:door-open' : 'mdi:door-closed' };
      if (dc === 'window') return { icon: open ? 'mdi:window-open-variant' : 'mdi:window-closed-variant' };
      if (dc === 'moisture') return { icon: 'mdi:water-alert' };
      if (dc === 'smoke' || dc === 'gas' || dc === 'carbon_monoxide') return { icon: 'mdi:smoke-detector-alert' };
      if (dc === 'battery') return { icon: 'mdi:battery-alert-variant-outline' };
    }
    if (d === 'sensor' && a.device_class === 'temperature') return { icon: 'mdi:thermometer-alert' };
    if (d === 'sensor' && a.device_class === 'humidity') return { icon: 'mdi:water-percent-alert' };
    return { stateObj: st };
  }

  function evalRule(rule, states, now) {
    try {
      if (rule.group === 'lights_in_empty_rooms') return evalEmptyRooms(rule, states, now);
      if (rule.group === 'low_battery') return evalBattery(rule, states, now);
      if (rule.group === 'unavailable') return evalUnavailable(rule, states, now);
      return evalEntityRule(rule, states, now);
    } catch (e) {
      return null;
    }
  }

  function gateOk(rule, states) {
    return rule.conditions.every((c) => stateMatches(states[c.entity], c));
  }

  function evalEntityRule(rule, states, now) {
    const firing = [];
    for (const id of rule.entities) {
      const st = states[id];
      if (!st || !stateMatches(st, rule)) continue;
      const since = sinceOf(st);
      const held = Number.isFinite(since) ? (now - since) / 60000 : NaN;
      if (rule.forMin > 0 && !(held >= rule.forMin)) continue;
      firing.push({ id, st, since });
    }
    if (!firing.length || !gateOk(rule, states)) return null;
    const first = firing[0];
    const oldest = Math.min(...firing.map((f) => (Number.isFinite(f.since) ? f.since : now)));
    const names = firing.map((f) => friendly(f.st, f.id));
    const name = rule.name ? String(rule.name)
      : firing.length === 1 ? names[0] : `${names[0]} +${firing.length - 1}`;
    const durMin = (now - oldest) / 60000;
    const vars = {
      duration: fmtDuration(durMin), state: humanState(first.st), name, count: firing.length,
      names: joinNames(names), value: humanState(first.st),
    };
    let msgT = rule.message;
    if (msgT === undefined || msgT === null) {
      msgT = firing.length > 1 ? `{names} · {state} for {duration}` : '{state} for {duration}';
    }
    const fix = fixCalls(rule.fix, firing.map((f) => f.id), states);
    return {
      key: rule.key, severity: rule.severity, title: name, message: cap(template(msgT, vars)),
      icon: defaultRuleIcon(first.st, rule), since: oldest, entities: firing.map((f) => f.id), fix,
    };
  }

  const OCC_ON = new Set(['on', 'home', 'detected', 'occupied', 'true']);

  function evalEmptyRooms(rule, states, now) {
    const lit = [], rooms = [];
    let latestEmpty = -Infinity;
    for (const room of rule.rooms) {
      if (!room.occupancy.length) continue;
      const occ = room.occupancy.map((id) => states[id]);
      if (occ.some((st) => isDead(st))) continue;
      if (occ.some((st) => OCC_ON.has(norm(st.state)) || (isNum(st.state) && Number(st.state) > 0))) continue;
      const emptySince = Math.max(...occ.map((st) => (Number.isFinite(sinceOf(st)) ? sinceOf(st) : now)));
      const need = parseDuration(room.empty_for !== undefined ? room.empty_for : rule.empty_for !== undefined ? rule.empty_for : 15);
      if ((now - emptySince) / 60000 < (Number.isFinite(need) ? need : 15)) continue;
      const on = room.lights.filter((id) => states[id] && norm(states[id].state) === 'on');
      if (!on.length) continue;
      lit.push(...on);
      rooms.push(room.name);
      latestEmpty = Math.max(latestEmpty, emptySince);
    }
    if (!lit.length || !gateOk(rule, states)) return null;
    const count = lit.length;
    const vars = {
      count, names: joinNames(rooms), lights: plural(count, 'light'), rooms: rooms.length,
      duration: fmtDuration((now - latestEmpty) / 60000), name: rule.name || 'Lights on in empty rooms', state: 'on',
    };
    const msgT = rule.message !== undefined ? rule.message : '{count} {lights} on in {names}';
    return {
      key: rule.key, severity: rule.severity, title: vars.name, message: cap(template(msgT, vars)),
      icon: { icon: rule.icon || 'mdi:lightbulb-on-outline' }, since: latestEmpty, entities: lit,
      fix: fixCalls(rule.fix, lit, states),
    };
  }

  function batteryLevel(st) {
    if (!st) return NaN;
    if (domainOf(st.entity_id) === 'binary_sensor') return norm(st.state) === 'on' ? 0 : 100;
    const v = numericValue(st);
    if (Number.isFinite(v)) return v;
    const a = st.attributes || {};
    return isNum(a.battery_level) ? Number(a.battery_level) : isNum(a.battery) ? Number(a.battery) : NaN;
  }

  function evalBattery(rule, states, now) {
    const below = isNum(rule.below) ? Number(rule.below) : 20;
    const low = [];
    for (const id of rule.entities) {
      const lv = batteryLevel(states[id]);
      if (Number.isFinite(lv) && lv < below) low.push({ id, lv, st: states[id] });
    }
    if (!low.length || !gateOk(rule, states)) return null;
    low.sort((a, b) => a.lv - b.lv);
    const names = low.map((x) => friendly(x.st, x.id).replace(/\s+battery( level)?$/i, ''));
    const levels = low.map((x, k) => (domainOf(x.id) === 'binary_sensor' ? names[k] : `${names[k]} ${fmtNum(x.lv)}%`));
    const lowest = low[0];
    const vars = {
      count: low.length, names: joinNames(names), levels: joinNames(levels), name: rule.name || plural(low.length, 'Low battery', 'Low batteries'),
      state: domainOf(lowest.id) === 'binary_sensor' ? 'low' : `${fmtNum(lowest.lv)}%`, duration: '—',
    };
    const msgT = rule.message !== undefined ? rule.message
      : low.length === 1 ? '{names} · {state}' : '{levels}';
    const since = Math.min(...low.map((x) => (Number.isFinite(sinceOf(x.st)) ? sinceOf(x.st) : now)));
    vars.duration = fmtDuration((now - since) / 60000);
    return {
      key: rule.key, severity: rule.severity, title: vars.name, message: cap(template(msgT, vars)),
      icon: { icon: rule.icon || 'mdi:battery-alert-variant-outline' }, since, entities: low.map((x) => x.id),
      fix: fixCalls(rule.fix, low.map((x) => x.id), states),
    };
  }

  function evalUnavailable(rule, states, now) {
    const need = rule.forMin > 0 ? rule.forMin : 10;
    const off = [];
    for (const id of rule.entities) {
      const st = states[id];
      if (!st || norm(st.state) !== 'unavailable') continue;
      const since = sinceOf(st);
      if (Number.isFinite(since) && (now - since) / 60000 < need) continue;
      off.push({ id, st, since: Number.isFinite(since) ? since : now });
    }
    if (!off.length || !gateOk(rule, states)) return null;
    const since = Math.min(...off.map((x) => x.since));
    const names = off.map((x) => friendly(x.st, x.id));
    const vars = {
      count: off.length, names: joinNames(names), name: rule.name || plural(off.length, 'Device offline', 'Devices offline'),
      duration: fmtDuration((now - since) / 60000), state: 'offline',
    };
    const msgT = rule.message !== undefined ? rule.message : off.length === 1 ? '{names} · offline for {duration}' : '{names}';
    return {
      key: rule.key, severity: rule.severity, title: vars.name, message: cap(template(msgT, vars)),
      icon: { icon: rule.icon || 'mdi:lan-disconnect' }, since, entities: off.map((x) => x.id),
      fix: fixCalls(rule.fix, off.map((x) => x.id), states),
    };
  }

  /** Short name of what a rule watches, for the calm state. */
  function checkName(rule, states) {
    if (rule.name) return String(rule.name);
    if (rule.group === 'lights_in_empty_rooms') return 'Lights in empty rooms';
    if (rule.group === 'low_battery') return 'Batteries';
    if (rule.group === 'unavailable') return 'Devices online';
    const id = rule.entities[0];
    return friendly(states[id], id) + (rule.entities.length > 1 ? ` +${rule.entities.length - 1}` : '');
  }

  function evalAttention(rules, states, now) {
    const out = [];
    rules.forEach((r, i) => {
      const it = evalRule(r, states || {}, now);
      if (it) { it.order = i; out.push(it); }
    });
    out.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity])
      || ((Number.isFinite(a.since) ? a.since : now) - (Number.isFinite(b.since) ? b.since : now))
      || (a.order - b.order));
    return out;
  }

  /* ------------------------------------------------------------- running */

  function normRunning(r, i) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`${TAG}: running item ${i + 1} must be an object`);
    const stateId = r.state || r.entity;
    if (!stateId && !r.progress && !r.remaining && !r.end_time) {
      throw new Error(`${TAG}: running item ${i + 1} needs "state", "progress", "remaining" or "end_time"`);
    }
    return {
      ...r, key: `run${i}`, stateId: typeof stateId === 'string' ? stateId : null,
      active: r.active_when !== undefined ? toList(r.active_when).map(norm) : null,
    };
  }

  /** Percent progress from a value, optionally inverted (percent remaining). */
  function progressPct(raw, inverted) {
    if (raw === null || raw === undefined || typeof raw === 'boolean') return NaN;
    const v = parseFloat(String(raw).replace('%', '').replace(',', '.'));
    if (!Number.isFinite(v)) return NaN;
    return clamp(inverted ? 100 - v : v, 0, 100);
  }

  function runningName(item, st) {
    if (item.name) return String(item.name);
    if (st) {
      return friendly(st, item.stateId).replace(/\s+(machine\s+)?(state|status|operation state|run state)$/i, '');
    }
    return 'Running';
  }

  function runningIcon(item, st, name) {
    if (item.icon) return { icon: item.icon };
    if (st && domainOf(st.entity_id) === 'timer') return { icon: 'mdi:timer-outline' };
    for (const [re, ic] of RUN_ICONS) if (re.test(name) || (item.stateId && re.test(item.stateId))) return { icon: ic };
    return st ? { stateObj: st } : { icon: 'mdi:progress-clock' };
  }

  function statusWord(st) {
    if (!st) return 'Running';
    const n = norm(st.state);
    if (RUN_WORDS[n]) return cap(RUN_WORDS[n]);
    return cap(humanState(st));
  }

  /** Evaluate one running item. hist: Map for progress-rate ETA estimates (mutated). */
  function evalRunningItem(item, states, now, hist) {
    const st = item.stateId ? states[item.stateId] : null;
    const isTimer = !!st && domainOf(st.entity_id) === 'timer';
    const progSt = item.progress ? states[item.progress] : null;
    let pct = progSt ? progressPct(progSt.state, !!item.progress_inverted) : NaN;

    const remSt = item.remaining ? states[item.remaining] : null;
    let remaining = remSt ? parseDuration(remSt.state, remSt.attributes && remSt.attributes.unit_of_measurement) : NaN;

    let active;
    if (item.active) active = !!st && item.active.includes(norm(st.state));
    else if (st) active = isTimer ? ['active', 'paused'].includes(norm(st.state)) : !INACTIVE.has(norm(st.state));
    else active = (Number.isFinite(pct) && pct > 0 && pct < 100) || (Number.isFinite(remaining) && remaining > 0);
    if (!active) { if (hist) hist.delete(item.key); return null; }

    const paused = !!st && ['paused', 'pause'].includes(norm(st.state));
    let end = NaN, estimated = false;
    const endSt = item.end_time ? states[item.end_time] : null;
    if (endSt) end = parseTime(endSt.state, now);
    if (!Number.isFinite(end) && Number.isFinite(remaining) && remaining >= 0 && !paused) end = now + remaining * 60000;

    if (isTimer) {
      const a = st.attributes || {};
      const total = parseDuration(a.duration);
      const fin = parseTime(a.finishes_at, now);
      if (!paused && Number.isFinite(fin) && !Number.isFinite(end)) end = fin;
      if (!Number.isFinite(remaining)) {
        remaining = paused ? parseDuration(a.remaining) : Number.isFinite(fin) ? Math.max(0, (fin - now) / 60000) : NaN;
      }
      if (!Number.isFinite(pct) && Number.isFinite(total) && total > 0 && Number.isFinite(remaining)) {
        pct = clamp((1 - remaining / total) * 100, 0, 100);
      }
    }
    if (Number.isFinite(end) && !Number.isFinite(remaining)) remaining = Math.max(0, (end - now) / 60000);

    // ETA from how fast the progress has been moving (observed by this card).
    if (hist) {
      let h = hist.get(item.key);
      if (!h) { h = []; hist.set(item.key, h); }
      if (Number.isFinite(pct) && (!h.length || h[h.length - 1].p !== pct)) h.push({ t: now, p: pct });
      while (h.length > 2 && now - h[0].t > 45 * 60000) h.shift();
      if (h.length > 24) h.splice(0, h.length - 24);
      if (!Number.isFinite(end) && !paused && Number.isFinite(pct) && h.length >= 2) {
        const a0 = h[0], a1 = h[h.length - 1];
        const dt = (a1.t - a0.t) / 60000, dp = a1.p - a0.p;
        if (dt >= 2 && dp > 0 && pct < 100) {
          remaining = (100 - pct) / (dp / dt);
          end = now + remaining * 60000;
          estimated = true;
        }
      }
    }

    const name = runningName(item, st);
    return {
      key: item.key, name, icon: runningIcon(item, st, name), accent: item.accent || item.color,
      status: paused ? 'Paused' : st ? statusWord(st) : 'Running',
      pct: Number.isFinite(pct) ? Math.round(pct) : null,
      end: Number.isFinite(end) ? end : null, remaining: Number.isFinite(remaining) ? remaining : null,
      estimated, paused, entity: item.stateId || item.progress || item.remaining || item.end_time,
    };
  }

  function evalRunning(items, states, now, hist) {
    const out = [];
    for (const it of items) {
      try {
        const r = evalRunningItem(it, states || {}, now, hist);
        if (r) out.push(r);
      } catch (e) { /* never break the card */ }
    }
    return out;
  }

  /* ------------------------------------------------------------ activity */

  function normActivity(a) {
    if (!a) return null;
    const src = Array.isArray(a) ? { entities: a } : typeof a === 'object' ? a : null;
    if (!src) throw new Error(`${TAG}: "activity" must be a list of entities or an object with "entities"`);
    const ents = toList(src.entities).map((e) => (typeof e === 'string' ? { entity: e } : e))
      .filter((e) => e && typeof e.entity === 'string' && e.entity.includes('.'));
    if (!ents.length) throw new Error(`${TAG}: "activity.entities" needs at least one entity`);
    const visible = isNum(src.visible) ? clamp(Math.round(Number(src.visible)), 1, 50) : null;
    const max = isNum(src.max) ? clamp(Math.round(Number(src.max)), 1, 100) : visible ? 100 : 8;
    const hours = isNum(src.hours) ? clamp(Number(src.hours), 0.25, 168) : 12;
    const byId = {};
    for (const e of ents) {
      byId[e.entity] = { name: e.name, icon: e.icon, states: e.states !== undefined ? toList(e.states).map(norm) : null };
    }
    return { entities: ents.map((e) => e.entity), byId, max, hours, visible };
  }

  const TONE_OF_DOMAIN = { light: 'light', switch: 'switch', input_boolean: 'switch', fan: 'fan', media_player: 'media', climate: 'heat', cover: 'cover' };

  /** Plain-English line, icon and tone for one logbook event. */
  function describeEvent(ev, states, opts) {
    const id = ev.entity_id;
    const st = states && states[id];
    const a = (st && st.attributes) || {};
    const o = (opts && opts.byId && opts.byId[id]) || {};
    const name = o.name || friendly(st, id, ev.name && !st ? ev.name : undefined);
    const d = domainOf(id);
    const s = norm(ev.state);
    const out = (verb, icon, tone, subject) => ({ name: subject || name, verb, icon: o.icon ? { icon: o.icon } : icon, tone });
    if ((ev.state === undefined || ev.state === null) && ev.message) {
      return out(String(ev.message), { icon: 'mdi:information-outline' }, 'neutral');
    }
    const dc = a.device_class;
    if (d === 'person' || d === 'device_tracker') {
      if (s === 'home') return out('arrived home', { icon: 'mdi:home-import-outline' }, 'info');
      if (s === 'not_home') return out('left home', { icon: 'mdi:home-export-outline' }, 'neutral');
      const zone = states && Object.values(states).find((z) => domainOf(z.entity_id) === 'zone' && norm(z.attributes && z.attributes.friendly_name) === s);
      return out(`arrived at ${zone ? zone.attributes.friendly_name : String(ev.state).replace(/_/g, ' ')}`, { icon: 'mdi:map-marker-outline' }, 'info');
    }
    if (d === 'lock') {
      if (s === 'locked') return out('locked', { icon: 'mdi:lock' }, 'ok');
      if (s === 'unlocked') return out('unlocked', { icon: 'mdi:lock-open-variant' }, 'warn');
      if (s === 'jammed') return out('jammed', { icon: 'mdi:lock-alert' }, 'alert');
      if (s === 'open') return out('opened', { icon: 'mdi:lock-open-variant' }, 'warn');
    }
    if (d === 'cover' || (d === 'binary_sensor' && ['door', 'garage_door', 'window', 'opening'].includes(dc))) {
      const open = s === 'on' || s === 'open';
      const closed = s === 'off' || s === 'closed';
      const verb = open ? 'opened' : closed ? 'closed' : s === 'opening' ? 'opening' : s === 'closing' ? 'closing' : humanState({ ...st, entity_id: id, state: ev.state });
      const kind = dc === 'garage_door' || dc === 'garage' ? 'garage' : dc === 'door' ? 'door' : dc === 'window' ? 'window' : d === 'cover' ? 'shutter' : 'opening';
      const icons = {
        garage: ['mdi:garage-open-variant', 'mdi:garage-variant'], door: ['mdi:door-open', 'mdi:door-closed'],
        window: ['mdi:window-open-variant', 'mdi:window-closed-variant'], shutter: ['mdi:window-shutter-open', 'mdi:window-shutter'],
        opening: ['mdi:square-rounded-outline', 'mdi:square-rounded'],
      }[kind];
      return out(verb, { icon: open || s === 'opening' ? icons[0] : icons[1] }, open || s === 'opening' ? 'cover' : 'neutral');
    }
    if (d === 'binary_sensor') {
      const on = s === 'on';
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') {
        return out(on ? 'detected motion' : 'cleared', { icon: on ? 'mdi:motion-sensor' : 'mdi:motion-sensor-off' }, on ? 'info' : 'neutral');
      }
      if (dc === 'moisture') return out(on ? 'detected a leak' : 'is dry again', { icon: on ? 'mdi:water-alert' : 'mdi:water-check' }, on ? 'alert' : 'ok');
      if (['smoke', 'gas', 'carbon_monoxide', 'safety', 'problem', 'tamper'].includes(dc)) {
        return out(on ? 'triggered' : 'cleared', { icon: on ? 'mdi:alert' : 'mdi:check-circle-outline' }, on ? 'alert' : 'ok');
      }
      const pair = BS_WORDS[dc];
      if (pair) return out(`is ${on ? pair[0] : pair[1]}`, { stateObj: { ...(st || {}), entity_id: id, state: ev.state, attributes: a } }, on ? 'info' : 'neutral');
      return out(on ? 'turned on' : 'turned off', { stateObj: { ...(st || {}), entity_id: id, state: ev.state, attributes: a } }, on ? 'info' : 'neutral');
    }
    if (d === 'alarm_control_panel') {
      if (s === 'disarmed') return out('disarmed', { icon: 'mdi:shield-off-outline' }, 'neutral');
      if (s === 'triggered') return out('triggered', { icon: 'mdi:shield-alert' }, 'alert');
      if (s.startsWith('armed')) return out(`armed${s.length > 6 ? ` (${s.slice(6).replace(/_/g, ' ')})` : ''}`, { icon: 'mdi:shield-lock' }, 'ok');
      if (s === 'arming' || s === 'pending') return out(s, { icon: 'mdi:shield-sync' }, 'warn');
    }
    if (['light', 'switch', 'fan', 'input_boolean'].includes(d) && (s === 'on' || s === 'off')) {
      const icons = { light: ['mdi:lightbulb', 'mdi:lightbulb-outline'], fan: ['mdi:fan', 'mdi:fan-off'] }[d]
        || ['mdi:toggle-switch-variant', 'mdi:toggle-switch-variant-off'];
      return out(s === 'on' ? 'turned on' : 'turned off', { icon: s === 'on' ? icons[0] : icons[1] }, s === 'on' ? TONE_OF_DOMAIN[d] : 'neutral');
    }
    if (d === 'media_player') {
      if (s === 'playing') return out('started playing', { icon: 'mdi:play-circle-outline' }, 'media');
      if (s === 'paused' || s === 'idle' || s === 'off') return out(s === 'off' ? 'turned off' : 'stopped', { icon: 'mdi:pause-circle-outline' }, 'neutral');
    }
    const fake = { ...(st || {}), entity_id: id, state: ev.state, attributes: a };
    return out(`is ${humanState(fake)}`, { stateObj: fake }, TONE_OF_DOMAIN[d] || 'neutral');
  }

  function eventWhen(ev) {
    const w = ev.when !== undefined ? ev.when : ev.time_fired || ev.last_changed;
    if (typeof w === 'number') return w > 1e12 ? w : w * 1000;
    return parseTime(w);
  }

  /* ---------------------------------------------------------------- card */

  class GlasshouseNowCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._seen = new Map();
      this._rows = { att: new Map(), run: new Map(), act: new Map() };
      this._hist = new Map();
      this._events = [];
      this._evKeys = new Set();
      this._lastState = new Map();
      this._sub = null;
      this._subToken = 0;
      this._streamOk = false;
      this._actLoaded = false;
      this._primed = false;
      this._connected = false;
      this._now = () => Date.now();
    }

    static getStubConfig(hass) {
      const states = (hass && hass.states) || {};
      const ids = Object.keys(states);
      const dc = (id) => (states[id] && states[id].attributes && states[id].attributes.device_class) || '';
      const lock = ids.find((id) => id.startsWith('lock.'));
      const doors = ids.filter((id) => id.startsWith('binary_sensor.') && ['door', 'garage_door', 'window'].includes(dc(id))).slice(0, 3);
      const covers = ids.filter((id) => id.startsWith('cover.') && dc(id) === 'garage').slice(0, 1);
      const people = ids.filter((id) => id.startsWith('person.')).slice(0, 2);
      const cfg = { title: 'Now', attention: [] };
      if (lock) cfg.attention.push({ entity: lock, when: 'unlocked', for: 30, severity: 'warn', fix: { label: 'Lock', action: 'lock.lock' } });
      if (covers[0]) cfg.attention.push({ entity: covers[0], when: 'open', for: 15, severity: 'warn', fix: { label: 'Close', action: 'cover.close_cover' } });
      if (doors[0]) cfg.attention.push({ entity: doors[0], when: 'on', for: 10, severity: 'warn' });
      const act = [...doors, ...covers, ...people, ...(lock ? [lock] : [])].slice(0, 8);
      if (act.length) cfg.activity = { entities: act, max: 8, hours: 12 };
      return cfg;
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error(`${TAG}: invalid configuration`);
      const att = config.attention;
      if (att !== undefined && att !== null && !Array.isArray(att)) throw new Error(`${TAG}: "attention" must be a list`);
      const run = config.running;
      if (run !== undefined && run !== null && !Array.isArray(run)) throw new Error(`${TAG}: "running" must be a list`);
      if (att == null && run == null && config.activity == null) {
        throw new Error(`${TAG}: add at least one of "attention", "running" or "activity"`);
      }
      const c = {
        title: config.title === undefined ? 'Now' : config.title,
        clock: config.clock !== false,
        attention: (att || []).map(normRule),
        attentionOn: Array.isArray(att),
        running: (run || []).map(normRunning),
        activity: normActivity(config.activity),
        calm_message: config.calm_message,
      };
      const watch = new Set();
      for (const r of c.attention) {
        (r.entities || []).forEach((e) => watch.add(e));
        (r.rooms || []).forEach((rm) => { rm.lights.forEach((e) => watch.add(e)); rm.occupancy.forEach((e) => watch.add(e)); });
        r.conditions.forEach((x) => watch.add(x.entity));
      }
      for (const r of c.running) [r.stateId, r.progress, r.remaining, r.end_time].forEach((e) => typeof e === 'string' && watch.add(e));
      if (c.activity) c.activity.entities.forEach((e) => watch.add(e));
      this._config = c;
      this._watch = [...watch];
      this._built = false;
      this._primed = false;
      this._seen.clear();
      this._hist.clear();
      Object.values(this._rows).forEach((m) => m.clear());
      this._resetActivity();
      if (this._hass) this.hass = this._hass;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config || !hass) return;
      try {
        if (!this._built) this._build();
        let changed = !this._primed;
        const states = hass.states || {};
        for (const id of this._watch) {
          const st = states[id];
          if (st !== this._seen.get(id) || !this._seen.has(id)) {
            this._seen.set(id, st);
            changed = true;
          }
        }
        this._observeActivity(states);
        this._ensureSub();
        if (changed) this._render();
      } catch (e) {
        this._warn(e);
      }
    }

    get hass() { return this._hass; }

    connectedCallback() {
      this._connected = true;
      if (!this._tick) this._tick = setInterval(() => this._render(), TICK_MS);
      this._ensureSub();
      if (this._built) this._render();
    }

    disconnectedCallback() {
      this._connected = false;
      clearInterval(this._tick);
      this._tick = null;
      this._unsubscribe();
      for (const map of Object.values(this._rows)) {
        for (const row of map.values()) if (row.timer) clearTimeout(row.timer);
      }
    }

    getCardSize() {
      const c = this._config;
      if (!c) return 4;
      const a = this._last ? this._last.att.length : 1;
      const r = this._last ? this._last.run.length : 0;
      const ev = c.activity ? Math.min(c.activity.visible || c.activity.max, 8) : 0;
      return 1 + Math.max(1, a) + r * 2 + Math.ceil(ev / 1.5);
    }

    getGridOptions() {
      return { columns: 'full', rows: 'auto' };
    }

    _warn(e) {
      if (this._warned) return;
      this._warned = true;
      // eslint-disable-next-line no-console
      console.warn(`${TAG}:`, e);
    }

    /* ------------------------------------------------------- activity feed */

    _resetActivity() {
      this._unsubscribe();
      this._events = [];
      this._evKeys.clear();
      this._lastState.clear();
      this._streamOk = false;
      this._actLoaded = false;
    }

    _ensureSub() {
      const c = this._config;
      if (!c || !c.activity || !this._connected || !this._hass || this._sub) return;
      const conn = this._hass.connection;
      if (!conn || typeof conn.subscribeMessage !== 'function') { this._actLoaded = true; return; }
      const token = ++this._subToken;
      this._actLoaded = false;
      const start = new Date(this._now() - c.activity.hours * 3600e3).toISOString();
      let p;
      try {
        p = conn.subscribeMessage((msg) => {
          if (token !== this._subToken) return;
          this._onStream(msg);
        }, { type: 'logbook/event_stream', start_time: start, entity_ids: c.activity.entities });
      } catch (e) {
        p = Promise.reject(e);
      }
      this._sub = Promise.resolve(p).then((unsub) => {
        if (token !== this._subToken) { if (typeof unsub === 'function') unsub(); return null; }
        this._streamOk = true;
        return unsub;
      }, (err) => {
        if (token === this._subToken) { this._streamOk = false; this._actLoaded = true; this._render(); }
        this._warn(err);
        return null;
      });
    }

    _unsubscribe() {
      this._subToken += 1;
      const p = this._sub;
      this._sub = null;
      this._streamOk = false;
      if (p) p.then((u) => { try { if (typeof u === 'function') u(); } catch (e) { /* ignore */ } });
    }

    _onStream(msg) {
      try {
        const evs = (msg && Array.isArray(msg.events)) ? msg.events : [];
        const live = this._actLoaded;
        this._actLoaded = true;
        this._streamOk = true;
        this._addEvents(evs, live);
        this._render();
      } catch (e) {
        this._warn(e);
      }
    }

    _addEvents(evs, live) {
      const c = this._config && this._config.activity;
      if (!c) return;
      let added = false;
      for (const ev of evs) {
        if (!ev || !ev.entity_id || !c.byId[ev.entity_id]) continue;
        const when = eventWhen(ev);
        if (!Number.isFinite(when)) continue;
        const s = norm(ev.state);
        if ((ev.state !== undefined && ev.state !== null) && DEAD.has(s)) continue;
        const only = c.byId[ev.entity_id].states;
        if (only && !only.includes(s)) continue;
        const key = `${ev.entity_id}|${Math.round(when)}|${s}`;
        if (this._evKeys.has(key)) continue;
        this._evKeys.add(key);
        this._events.push({ key, entity_id: ev.entity_id, state: ev.state, message: ev.message, name: ev.name, when, live: !!live });
        added = true;
      }
      if (!added) return;
      this._events.sort((a, b) => b.when - a.when);
      const keep = c.max * 3;
      if (this._events.length > keep) {
        for (const e of this._events.splice(keep)) this._evKeys.delete(e.key);
      }
    }

    /** Fallback when the logbook stream is unavailable: record state changes we see live. */
    _observeActivity(states) {
      const c = this._config.activity;
      if (!c) return;
      for (const id of c.entities) {
        const st = states[id];
        const prev = this._lastState.get(id);
        this._lastState.set(id, st ? st.state : undefined);
        if (this._streamOk || this._sub && !this._actLoaded) continue;
        if (prev === undefined || !st || prev === st.state) continue;
        this._addEvents([{ entity_id: id, state: st.state, when: parseTime(st.last_changed) || this._now() }], true);
      }
    }

    /* ---------------------------------------------------------- build/render */

    _build() {
      const root = this.shadowRoot;
      root.innerHTML = '';
      root.append(h('style', { text: STYLE }));
      const card = document.createElement('ha-card');

      this._el = {};
      const E = this._el;
      E.title = h('div', { class: 'title' });
      E.pulse = h('span', { class: 'pulse', 'aria-hidden': 'true' });
      E.sum = h('span', { class: 's' });
      E.time = h('div', { class: 'tm' });
      E.date = h('div', { class: 'dt' });
      E.clock = h('div', { class: 'clock', 'aria-hidden': 'true' }, [E.time, E.date]);
      E.head = h('div', { class: 'head' }, [
        h('div', { class: 'titles' }, [E.title, h('div', { class: 'summary', role: 'status' }, [E.pulse, E.sum])]),
        E.clock,
      ]);

      const zone = (label, extra) => {
        const count = h('span', { class: 'count tnum' });
        const list = h('div', { class: 'list', role: 'list' });
        const head = h('div', { class: 'zone-h' }, [h('span', { class: 'label', text: label }), count, h('span', { class: 'rule' }), extra]);
        const sec = h('section', { class: 'zone', 'aria-label': label }, [head, list]);
        return { sec, count, list };
      };
      E.att = zone('Needs attention');
      E.att.sec.classList.add('att');
      E.run = zone('In progress');
      E.run.list.classList.add('run-list');
      E.liveTag = h('span', { class: 'live' }, [h('i'), h('span', { text: 'Live' })]);
      E.act = zone('Activity', E.liveTag);
      E.act.count.remove();
      const feed = h('ol', { class: 'feed' });
      E.act.list.replaceWith(feed);
      E.act.list = feed;
      feed.addEventListener('scroll', () => this._capFeedMore(), { passive: true });
      E.quiet = h('div', { class: 'quiet' }, [h('span', { class: 'q-dot' }, [svg('<circle cx="12" cy="12" r="2.4" fill="currentColor"/>')]), h('span')]);
      E.act.sec.append(E.quiet);

      E.calm = h('div', { class: 'calm', role: 'status' }, [
        svg('<circle class="bg" cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="2"/>'
          + '<circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
          + '<path d="M13.2 20.6l4.6 4.6 9-9.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>', 'tick', '0 0 40 40'),
        h('div', { class: 'txt' }, [h('div', { class: 't', text: 'Nothing needs you' }), h('div', { class: 'm' })]),
        h('div', { class: 'checks', 'aria-hidden': 'true' }),
      ]);
      E.att.sec.append(E.calm);

      E.mainCol = h('div', { class: 'col main-col' }, [E.att.sec, E.run.sec]);
      E.sideCol = h('div', { class: 'col side-col' }, [E.act.sec]);
      E.body = h('div', { class: 'body' }, [E.mainCol, E.sideCol]);
      card.append(E.head, E.body);
      root.append(card);
      this._card = card;
      this._built = true;
    }

    _render() {
      if (!this._built || !this._hass || !this._config) return;
      try {
        this._renderInner();
      } catch (e) {
        this._warn(e);
      }
    }

    _fmt() {
      const hass = this._hass || {};
      const lang = (hass.locale && hass.locale.language) || hass.language || undefined;
      const tf = hass.locale && hass.locale.time_format;
      const opts = { hour: 'numeric', minute: '2-digit' };
      if (tf === '24') opts.hourCycle = 'h23';
      if (tf === '12') opts.hour12 = true;
      const key = `${lang}|${tf}`;
      if (this._fmtKey !== key) {
        this._fmtKey = key;
        try {
          this._timeFmt = new Intl.DateTimeFormat(lang, opts);
          this._dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'short' });
          this._dateFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', month: 'short', day: 'numeric' });
        } catch (e) {
          this._timeFmt = new Intl.DateTimeFormat(undefined, opts);
          this._dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
          this._dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        }
      }
      return this;
    }

    /** Fill `el` with a clock time, the AM/PM marker set small. Returns plain text. */
    _clockInto(el, ms, now) {
      this._fmt();
      const parts = this._timeFmt.formatToParts(new Date(ms));
      const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
      const dp = parts.filter((p) => p.type === 'dayPeriod').map((p) => p.value).join('');
      const sameDay = now === undefined || new Date(ms).toDateString() === new Date(now).toDateString();
      const prefix = sameDay ? '' : `${this._dayFmt.format(new Date(ms))} `;
      const text = `${prefix}${main}${dp ? ` ${dp}` : ''}`;
      if (el._txt !== text) {
        el._txt = text;
        el.replaceChildren(document.createTextNode(prefix + main));
        if (dp) el.append(h('small', { text: dp }));
      }
      return text;
    }

    _renderInner() {
      const c = this._config;
      const E = this._el;
      const hass = this._hass;
      const states = hass.states || {};
      const now = this._now();

      const att = c.attentionOn ? evalAttention(c.attention, states, now) : [];
      const run = c.running.length ? evalRunning(c.running, states, now, this._hist) : [];
      this._last = { att, run };

      // header
      const showHead = c.title !== false && c.title !== null && c.title !== '';
      E.head.hidden = !showHead;
      if (showHead) {
        setText(E.title, c.title);
        E.clock.hidden = !c.clock;
        if (c.clock) {
          this._clockInto(E.time, now);
          setText(E.date, this._fmt()._dateFmt.format(new Date(now)));
        }
        const parts = [];
        const top = att[0] && att[0].severity;
        if (c.attentionOn) {
          parts.push(att.length ? `<b>${att.length}</b> ${att.length === 1 ? 'thing needs' : 'things need'} you` : 'All calm');
        }
        if (run.length) {
          const soon = run.filter((r) => r.end).sort((a, b) => a.end - b.end)[0];
          const t = soon ? this._clockInto(document.createElement('span'), soon.end, now) : '';
          if (soon && run.length === 1) parts.push(`${esc(soon.name)} done ${soon.estimated ? '~' : ''}${esc(t)}`);
          else if (soon) parts.push(`${run.length} running<span class="opt">, next ${soon.estimated ? '~' : ''}${esc(t)}</span>`);
          else parts.push(`${run.length} running`);
        }
        if (!parts.length && c.activity) {
          const ev = this._events[0];
          parts.push(ev ? `Last activity ${esc(fmtRelative(ev.when, now).toLowerCase())}` : 'Listening for activity');
        }
        const html = parts.join(' · ');
        if (E.sum._html !== html) { E.sum._html = html; E.sum.innerHTML = html; }
        E.pulse.style.setProperty('--st', top ? SEV_COLOR[top] : 'var(--gh-ok)');
        setCls(E.pulse, 'alert', top === 'alert');
      }

      // zones
      E.att.sec.hidden = !c.attentionOn;
      if (c.attentionOn) this._renderAttention(att, now);
      E.run.sec.hidden = !run.length;
      this._renderRunning(run, now);
      E.act.sec.hidden = !c.activity;
      if (c.activity) this._renderActivity(now);

      const split = !!c.activity && (c.attentionOn || c.running.length > 0);
      setCls(E.body, 'split', split);
      setCls(E.mainCol, 'empty', !c.attentionOn && !run.length);
      setCls(E.sideCol, 'empty', !c.activity);
      this._primed = true;
    }

    /* reconcile a keyed list of rows */
    _reconcile(list, map, items, create, update, animFn) {
      const animate = this._primed;
      const seen = new Set();
      let prev = null;
      // Rows kept while their fix finishes hold their old position instead of sinking to the end.
      const wanted = new Set(items.map((it) => it.key));
      const order = items.map((it) => ({ it }));
      for (const [k, row] of map) {
        if (!wanted.has(k) && (row.phase === 'busy' || row.phase === 'done')) {
          order.splice(Math.min(row.idx || 0, order.length), 0, { kept: row });
        }
      }
      order.forEach((o, i) => { const r = o.kept || map.get(o.it.key); if (r) r.idx = i; });
      for (const o of order) {
        if (o.kept) {
          const ref = prev ? prev.el.nextSibling : list.firstChild;
          if (o.kept.el !== ref) list.insertBefore(o.kept.el, ref);
          prev = o.kept;
          continue;
        }
        const it = o.it;
        let row = map.get(it.key);
        if (!row) {
          row = create(it);
          map.set(it.key, row);
          if (animate && (!animFn || animFn(it))) row.el.classList.add('enter');
        }
        row.item = it;
        update(row, it);
        row.idx = order.indexOf(o);
        seen.add(it.key);
        const ref = prev ? prev.el.nextSibling : list.firstChild;
        if (row.el !== ref) list.insertBefore(row.el, ref);
        prev = row;
      }
      for (const [k, row] of [...map]) {
        if (seen.has(k)) continue;
        // A row whose fix is running (or just succeeded) stays until its check mark has been seen.
        if (row.phase === 'busy' || row.phase === 'done') { row.stale = true; continue; }
        map.delete(k);
        if (row.timer) clearTimeout(row.timer);
        this._leave(row.el, animate);
      }
    }

    _leave(el, animate) {
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!animate || reduced) { el.remove(); return; }
      el.style.maxHeight = `${el.offsetHeight || 80}px`;
      el.classList.remove('enter');
      el.classList.add('leaving');
      void el.offsetHeight;
      requestAnimationFrame(() => el.classList.add('collapse'));
      setTimeout(() => el.remove(), LEAVE_MS + 40);
    }

    _renderAttention(items, now) {
      const E = this._el;
      const c = this._config;
      const count = items.length;
      setText(E.att.count, count ? String(count) : '');
      E.att.count.hidden = !count;
      E.att.count.style.setProperty('--c', count ? SEV_COLOR[items[0].severity] : 'var(--gh-ok)');

      const wasCalm = !E.calm.hidden;
      E.calm.hidden = count > 0;
      setCls(E.att.sec, 'is-calm', !count);
      if (!count) {
        const n = c.attention.length;
        setText(E.calm.querySelector('.m'), c.calm_message || (n ? `All ${n} ${plural(n, 'check')} clear` : 'Everything is where it should be'));
        const names = c.attention.map((r) => checkName(r, this._hass.states || {}));
        const sig = names.join('|');
        const box = E.calm.querySelector('.checks');
        if (box._sig !== sig) {
          box._sig = sig;
          box.replaceChildren(...names.map((nm) => h('span', { class: 'ck' }, [svg(CHECK_SVG), h('span', { text: nm })])));
        }
        if (!wasCalm || !this._primed) {
          E.calm.classList.remove('anim');
          void E.calm.offsetWidth;
          E.calm.classList.add('anim');
        }
      }

      this._reconcile(E.att.list, this._rows.att, items, (it) => this._createItem(it), (row, it) => this._updateItem(row, it, now));
    }

    _createItem() {
      const row = {};
      row.bar = h('span', { class: 'bar', 'aria-hidden': 'true' });
      row.chip = h('span', { class: 'chip', 'aria-hidden': 'true' });
      row.t = h('span', { class: 't' });
      row.m = h('span', { class: 'm' });
      row.main = h('button', { class: 'main', type: 'button' }, [row.chip, h('span', { class: 'txt' }, [row.t, row.m])]);
      row.main.addEventListener('click', () => {
        if (row.rule && row.rule.details) { row.open = !row.open; this._updateItem(row, row.item); return; }
        const id = row.item && row.item.entities[0]; if (id) this._moreInfo(id);
      });
      row.caret = h('span', { class: 'caret', 'aria-hidden': 'true' });
      row.caret.innerHTML = '<ha-icon icon="mdi:chevron-down"></ha-icon>';
      row.det = h('div', { class: 'det', hidden: true });
      row.lb = h('span', { class: 'lb' });
      row.fix = h('button', { class: 'fix', type: 'button' }, [row.lb, h('span', { class: 'sp' }), svg(CHECK_SVG, 'ok')]);
      row.fix.addEventListener('click', (e) => { e.stopPropagation(); this._runFix(row); });
      row.el = h('div', { class: 'item', role: 'listitem' }, [row.bar, row.main, row.caret, row.fix, row.det]);
      row.phase = 'idle';
      return row;
    }

    _updateItem(row, it) {
      row.rule = ((this._config && this._config.attention) || []).find((r) => r.key === it.key) || null;
      const det = row.rule && row.rule.details;
      row.el.className = `item sev-${it.severity}${row.el.classList.contains('enter') ? ' enter' : ''}${det ? ' has-det' : ''}${det && row.open ? ' open' : ''}`;
      row.caret.hidden = !det;
      row.main.setAttribute('aria-expanded', det ? String(!!row.open) : 'false');
      row.det.hidden = !(det && row.open);
      if (det && row.open) this._renderDetails(row, it, det);
      row.el.dataset.key = it.key;
      setIcon(row.chip, it.icon, this._hass);
      setText(row.t, it.title);
      setText(row.m, it.message);
      row.main.setAttribute('aria-label', `${it.title}. ${it.message}`);
      row.fix.hidden = !it.fix;
      if (it.fix) {
        const label = row.phase === 'confirm' ? 'Confirm' : row.phase === 'error' ? 'Retry' : it.fix.label;
        setText(row.lb, label);
        row.fix.setAttribute('aria-label', `${it.fix.label}: ${it.title}`);
        row.fix.setAttribute('aria-busy', row.phase === 'busy' ? 'true' : 'false');
        ['busy', 'done', 'error', 'confirm'].forEach((p) => setCls(row.fix, p, row.phase === p));
      }
    }

    /** details: { attribute, name_key, sub_keys, group_by, max } — list rows from a list attribute of the rule's entity */
    _renderDetails(row, it, det) {
      const d = typeof det === 'object' ? det : {};
      const st = this._hass && this._hass.states[it.entities[0]];
      const raw = st && st.attributes ? st.attributes[d.attribute || 'entities'] : null;
      const list = Array.isArray(raw) ? raw.filter((x) => x && typeof x === 'object') : [];
      const nameKey = d.name_key || 'name';
      const subKeys = toList(d.sub_keys || ['area', 'since']);
      const max = Number(d.max) > 0 ? Number(d.max) : 15;
      const now = this._now();
      const fmtSub = (x) => subKeys.map((k) => {
        const v = x[k];
        if (v == null || v === '') return '';
        if (/since|changed|time|at$/i.test(k) && !Number.isNaN(Date.parse(v))) return fmtRelative(Date.parse(v), now);
        return String(v);
      }).filter(Boolean).join(' · ');
      const groups = new Map();
      for (const x of list) {
        const g = d.group_by ? String(x[d.group_by] || 'other') : '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(x);
      }
      const sig = JSON.stringify([list.length, list.slice(0, max).map((x) => [x[nameKey], x.entity_id, fmtSub(x)])]);
      if (sig === row.detSig) return;
      row.detSig = sig;
      const kids = [];
      let shown = 0;
      const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [g, xs] of sorted) {
        if (g) kids.push(h('div', { class: 'dg' }, [h('span', { text: g.replace(/_/g, ' ') }), h('b', { text: String(xs.length) })]));
        for (const x of xs) {
          if (shown >= max) break;
          shown++;
          const b = h('button', { class: 'dr', type: 'button' }, [h('span', { class: 'dn', text: String(x[nameKey] || x.entity_id || '—') }), h('span', { class: 'ds', text: fmtSub(x) })]);
          if (x.entity_id) b.addEventListener('click', (e) => { e.stopPropagation(); this._moreInfo(x.entity_id); });
          kids.push(b);
        }
      }
      if (list.length > shown) kids.push(h('div', { class: 'dm', text: `+${list.length - shown} more` }));
      if (!list.length) kids.push(h('div', { class: 'dm', text: 'No details available' }));
      row.det.replaceChildren(...kids);
    }

    _setPhase(row, phase, ms) {
      if (row.timer) clearTimeout(row.timer);
      row.timer = null;
      row.phase = phase;
      if (ms) {
        row.timer = setTimeout(() => {
          row.timer = null;
          row.phase = 'idle';
          if (row.item) this._updateItem(row, row.item);
          if (row.stale) this._render();
        }, ms);
      }
      if (row.item) this._updateItem(row, row.item);
    }

    async _runFix(row) {
      const it = row.item;
      if (!it || !it.fix || row.phase === 'busy' || row.phase === 'done') return;
      if (it.fix.confirm && row.phase !== 'confirm') { this._setPhase(row, 'confirm', CONFIRM_MS); return; }
      this._haptic('light');
      this._setPhase(row, 'busy');
      const t0 = this._now();
      let ok = true;
      try {
        await Promise.all(it.fix.calls.map((call) => Promise.resolve(this._hass.callService(call.domain, call.service, call.data))));
      } catch (e) {
        ok = false;
        this._warn(e);
      }
      const wait = MIN_BUSY_MS - (this._now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._setPhase(row, ok ? 'done' : 'error', ok ? DONE_MS : ERROR_MS);
      if (ok) this._haptic('success');
    }

    _renderRunning(items, now) {
      const E = this._el;
      setText(E.run.count, items.length ? String(items.length) : '');
      E.run.count.hidden = !items.length;
      E.run.count.style.setProperty('--c', 'var(--gh-fan)');
      this._reconcile(E.run.list, this._rows.run, items, () => this._createRun(), (row, it) => this._updateRun(row, it, now));
    }

    _createRun() {
      const row = {};
      row.chip = h('span', { class: 'chip', 'aria-hidden': 'true' });
      row.t = h('span', { class: 't' });
      row.m = h('span', { class: 'm' });
      row.main = h('button', { class: 'main', type: 'button' }, [row.chip, h('span', { class: 'txt' }, [row.t, row.m])]);
      row.main.addEventListener('click', () => { if (row.item && row.item.entity) this._moreInfo(row.item.entity); });
      row.big = h('div', { class: 'big' });
      row.sub = h('div', { class: 'sub' });
      row.eta = h('div', { class: 'eta' }, [row.sub, row.big]);
      row.fill = h('div', { class: 'fill' });
      row.track = h('div', { class: 'track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [row.fill]);
      row.el = h('div', { class: 'run', role: 'listitem' }, [h('div', { class: 'top' }, [row.main, row.eta]), row.track]);
      return row;
    }

    _updateRun(row, it, now) {
      setCls(row.el, 'paused', it.paused);
      if (it.accent) {
        const acc = /^[a-z_]+$/i.test(it.accent) ? `var(--gh-${it.accent.replace(/_/g, '-')})` : it.accent;
        row.el.style.setProperty('--acc', acc);
      } else row.el.style.removeProperty('--acc');
      setIcon(row.chip, it.icon, this._hass);
      setText(row.t, it.name);
      let html = esc(it.status);
      if (it.pct !== null) html += ` · <b>${it.pct}%</b>`;
      if (it.remaining !== null && !it.paused) {
        // the ETA already says when; the countdown is extra detail that narrow cards drop
        html += `<span class="${it.end ? 'opt' : ''}"> · ${it.estimated ? '~' : ''}${esc(fmtDuration(it.remaining))} left</span>`;
      } else if (it.remaining !== null && it.paused) html += ` · ${esc(fmtDuration(it.remaining))} to go`;
      if (row.m._html !== html) { row.m._html = html; row.m.innerHTML = html; }

      if (it.end && !it.paused) {
        const t = this._clockInto(row.big, it.end, now);
        setCls(row.big, 'dim', false);
        setText(row.sub, it.estimated ? 'Est. done' : 'Done');
        row.main.setAttribute('aria-label', `${it.name}, ${it.status}${it.pct !== null ? `, ${it.pct}%` : ''}, done ${t}`);
      } else {
        row.big._txt = null;
        setText(row.big, it.paused ? 'Paused' : '—');
        setCls(row.big, 'dim', true);
        setText(row.sub, it.paused ? '' : 'Done');
        row.main.setAttribute('aria-label', `${it.name}, ${it.status}${it.pct !== null ? `, ${it.pct}%` : ''}`);
      }
      const indet = it.pct === null;
      setCls(row.track, 'indet', indet && !it.paused);
      row.fill.style.width = indet ? '' : `${it.pct}%`;
      if (indet) row.track.removeAttribute('aria-valuenow'); else row.track.setAttribute('aria-valuenow', String(it.pct));
    }

    _renderActivity(now) {
      const E = this._el;
      const c = this._config.activity;
      setCls(E.liveTag, 'on', this._streamOk);
      E.liveTag.hidden = !this._streamOk;
      const states = this._hass.states || {};
      const evs = this._events.slice(0, c.max).map((ev, i) => ({ ...ev, idx: i, d: describeEvent(ev, states, c) }));
      E.quiet.hidden = evs.length > 0;
      if (!evs.length) {
        setText(E.quiet.lastChild, this._actLoaded || !this._streamOk && !this._sub
          ? `Quiet: nothing in the last ${c.hours >= 1 ? `${fmtNum(c.hours)} h` : `${Math.round(c.hours * 60)} min`}`
          : 'Listening…');
      }
      this._reconcile(E.act.list, this._rows.act, evs, () => this._createEvent(), (row, ev) => this._updateEvent(row, ev, now), (ev) => ev.live);
      this._capFeed();
    }

    /** activity.visible: size the feed to that many rows (outside the split layout, which fills its column instead). */
    _capFeed() {
      const c = this._config.activity;
      const feed = this._el.act.list;
      const zoneEl = feed.parentElement;
      const split = zoneEl && getComputedStyle(zoneEl).position === 'absolute';
      const rows = [...feed.children].filter((r) => !r.classList.contains('leaving'));
      if (!c.visible || split || rows.length <= c.visible) {
        if (feed.classList.contains('capped')) { feed.classList.remove('capped', 'more'); feed.style.maxHeight = ''; }
        return;
      }
      const top = rows[0].getBoundingClientRect().top;
      const last = rows[c.visible - 1].getBoundingClientRect();
      const px = Math.round(last.bottom - top);
      if (px <= 0) return;
      feed.classList.add('capped');
      if (feed.style.maxHeight !== `${px}px`) feed.style.maxHeight = `${px}px`;
      this._capFeedMore();
    }

    _capFeedMore() {
      const feed = this._el.act.list;
      setCls(feed, 'more', feed.classList.contains('capped') && feed.scrollTop + feed.clientHeight < feed.scrollHeight - 2);
    }

    _createEvent() {
      const row = {};
      row.dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
      row.text = h('span', { class: 'et' });
      row.time = h('time', { class: 'tnum' });
      row.el = h('li', { class: 'ev' }, [row.dot, row.text, row.time]);
      row.el.addEventListener('click', () => row.item && this._moreInfo(row.item.entity_id));
      return row;
    }

    _updateEvent(row, ev, now) {
      const d = ev.d;
      const tone = `tone-${d.tone}`;
      if (row.tone !== tone) { if (row.tone) row.el.classList.remove(row.tone); row.el.classList.add(tone); row.tone = tone; }
      setCls(row.el, 'fresh', now - ev.when < 15 * 60000);
      setCls(row.el, 'old', ev.idx >= 4);
      setIcon(row.dot, d.icon, this._hass);
      const html = `${esc(d.name)} <span>${esc(d.verb)}</span>`;
      if (row.text._html !== html) { row.text._html = html; row.text.innerHTML = html; }
      setText(row.time, fmtRelative(ev.when, now));
      const iso = new Date(ev.when).toISOString();
      if (row.time.getAttribute('datetime') !== iso) {
        row.time.setAttribute('datetime', iso);
        row.time.title = new Date(ev.when).toLocaleString();
      }
    }

    /* -------------------------------------------------------------- events */

    _moreInfo(entityId) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
    }

    _haptic(kind) {
      this.dispatchEvent(new CustomEvent('haptic', { detail: kind, bubbles: true, composed: true }));
    }
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Pure helpers, exposed for tests and for anyone extending the card.
  GlasshouseNowCard.helpers = {
    VERSION, parseDuration, parseTime, fmtDuration, fmtRelative, template, humanState, stateMatches,
    normRule, evalAttention, fixCalls, normRunning, evalRunning, progressPct, normActivity, describeEvent, joinNames,
  };

  if (!customElements.get(TAG)) {
    customElements.define(TAG, GlasshouseNowCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: TAG,
      name: 'Glasshouse Now Card',
      description: 'What matters right now: what needs you (with one-tap fixes), what is running, and what just happened.',
      preview: true,
      documentationURL: 'https://github.com/petergCA/glasshouse-now-card',
    });
    // eslint-disable-next-line no-console
    console.info(
      `%c GLASSHOUSE-NOW-CARD %c v${VERSION} `,
      'color:#0a0f18;background:#58a6ff;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px',
      'color:#e9eef6;background:#1b2333;font-weight:600;border-radius:0 4px 4px 0;padding:2px 4px',
    );
  }
})();
