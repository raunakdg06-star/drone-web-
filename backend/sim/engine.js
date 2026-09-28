/**
 * OUTPOST simulation engine.
 *
 * Pure logic, no I/O: it owns the "world" (drones, victims, rescue teams,
 * shelters, resources, zones) and advances it one tick at a time. Every
 * change is reported through an `emit(type, payload)` callback.
 *
 *  - On the server (backend/server.js) emit() broadcasts over Socket.io.
 *  - In the browser (frontend/index.html embeds a copy of this file) emit()
 *    drives the map directly, which is the offline-demo fallback.
 *
 * Positions are kept in "map space" (0..1000 on both axes, y = north).
 * Every entity also carries real-world GPS, projected through a bounding box
 * around MAP_CENTER, so a physical drone posting real lat/lng lands in the
 * right place on the map.
 *
 * Events emitted: drone, victim, team, shelter, victim:remove, stats, feed
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OutpostEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HARDWARE_TIMEOUT_MS = 15000;
  var VALID_STATUS = ['PATROL', 'RETURNING_TO_BASE', 'CHARGING', 'GROUNDED', 'OFFLINE'];
  var PRIORITY_BONUS = { CRITICAL: 300, HIGH: 150, MODERATE: 0, LOW: -100 };

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp1000(v) { return Math.max(0, Math.min(1000, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function heading(dx, dy) { return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; }

  function pointInPolygon(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      var hit = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  function create(opts) {
    opts = opts || {};
    var center = opts.center || { lat: 22.5726, lng: 88.3639 };
    var span = opts.spanDeg || 0.05; // degrees of lat/lng covered by the 1000x1000 map

    function toGps(pos) {
      return {
        lat: center.lat - span / 2 + (pos.y / 1000) * span,
        lng: center.lng - span / 2 + (pos.x / 1000) * span
      };
    }
    function fromGps(g) {
      return {
        x: ((g.lng - (center.lng - span / 2)) / span) * 1000,
        y: ((g.lat - (center.lat - span / 2)) / span) * 1000
      };
    }

    /* ------------------------------ world ------------------------------ */
    var state = {
      tick: 0,
      rescued: 0,
      victimSeq: 1,
      zones: [
        { id: 'ZN-01', name: 'Riverside Flood Zone', type: 'FLOOD', severity: 'SEVERE', color: '#5f8fa3',
          pts: [[120, 760], [260, 690], [420, 700], [440, 860], [260, 900], [130, 860]] },
        { id: 'ZN-02', name: 'Warehouse District Collapse', type: 'COLLAPSE', severity: 'CRITICAL', color: '#a8342b',
          pts: [[640, 300], [760, 280], [790, 400], [700, 440], [620, 400]] },
        { id: 'ZN-03', name: 'Northside Fire Perimeter', type: 'FIRE', severity: 'ACTIVE', color: '#d6923e',
          pts: [[300, 120], [420, 140], [440, 240], [330, 260], [270, 200]] }
      ],
      shelters: [
        { id: 'SHL-01', pos: { x: 80, y: 950 }, capacity: 200, occupancy: 126 },
        { id: 'SHL-02', pos: { x: 900, y: 900 }, capacity: 150, occupancy: 94 },
        { id: 'SHL-03', pos: { x: 900, y: 80 }, capacity: 180, occupancy: 60 }
      ],
      resources: [
        { id: 'RES-MED-1', pos: { x: 250, y: 700 }, type: 'Medical', quantity: 40 },
        { id: 'RES-WTR-1', pos: { x: 650, y: 450 }, type: 'Water', quantity: 120 },
        { id: 'RES-FUEL-1', pos: { x: 480, y: 150 }, type: 'Fuel/Power', quantity: 60 }
      ],
      drones: [],
      victims: [],
      teams: []
    };

    [
      { id: 'DRN-01', c: [300, 780], r: 110, s: 0.55, a: 0, b: 78 },
      { id: 'DRN-02', c: [700, 360], r: 90, s: 0.7, a: 2, b: 61 },
      { id: 'DRN-03', c: [370, 190], r: 70, s: 0.9, a: 4, b: 38 },
      { id: 'DRN-04', c: [550, 600], r: 130, s: 0.4, a: 1, b: 90 }
    ].forEach(function (d) {
      state.drones.push({
        id: d.id, source: 'sim', status: 'PATROL', battery: d.b, angle: d.a,
        def: { center: d.c, radius: d.r, speed: d.s },
        pos: { x: d.c[0] + Math.cos(d.a) * d.r, y: d.c[1] + Math.sin(d.a) * d.r * 0.7 },
        heading: 0, alt: 40, dock: null, gps: null, offMap: false, lastHardwareAt: 0,
        sensor: { thermalReading: 20, gasReading: 400, signalStrength: -55 }
      });
    });

    [[200, 800, 'CRITICAL'], [260, 850, 'HIGH'], [150, 820, 'MODERATE'], [700, 340, 'CRITICAL'],
     [730, 410, 'HIGH'], [340, 180, 'MODERATE'], [400, 220, 'HIGH'], [580, 610, 'MODERATE']
    ].forEach(function (v) { newVictim({ x: v[0], y: v[1] }, v[2]); });

    [['TEAM-ALPHA', 420, 900], ['TEAM-BRAVO', 850, 300], ['TEAM-CHARLIE', 500, 100]].forEach(function (t) {
      state.teams.push({ id: t[0], pos: { x: t[1], y: t[2] }, availability: 'AVAILABLE', victimId: null, heading: 0 });
    });

    function newVictim(pos, priority) {
      var v = { id: 'VIC-' + pad2(state.victimSeq++), pos: { x: pos.x, y: pos.y }, priority: priority, status: 'UNRESCUED', teamId: null };
      state.victims.push(v);
      return v;
    }
    function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function nearestShelter(pos) {
      return state.shelters.slice().sort(function (a, b) { return dist(pos, a.pos) - dist(pos, b.pos); })[0];
    }

    /* --------------------------- wire formats --------------------------- */
    function wireDrone(d) {
      var gps = d.source === 'hardware' && d.gps ? d.gps : toGps(d.pos);
      return {
        id: d.id, source: d.source, status: d.status, offMap: !!d.offMap,
        pos: { x: d.pos.x, y: d.pos.y },
        gps: { lat: gps.lat, lng: gps.lng, altitude: round1(d.alt), heading: Math.round(d.heading) },
        battery: round1(d.battery),
        sensor: { thermalReading: round1(d.sensor.thermalReading), gasReading: Math.round(d.sensor.gasReading), signalStrength: Math.round(d.sensor.signalStrength) }
      };
    }
    function wireVictim(v) {
      return { id: v.id, pos: { x: v.pos.x, y: v.pos.y }, gps: toGps(v.pos), priority: v.priority, status: v.status, teamId: v.teamId };
    }
    function wireTeam(t) {
      return { id: t.id, pos: { x: t.pos.x, y: t.pos.y }, gps: toGps(t.pos), availability: t.availability, victimId: t.victimId, heading: Math.round(t.heading) };
    }
    function shelterStatus(s) {
      var r = s.occupancy / s.capacity;
      return r >= 1 ? 'FULL' : r > 0.85 ? 'NEAR_FULL' : 'OPEN';
    }
    function wireShelter(s) {
      return { id: s.id, pos: { x: s.pos.x, y: s.pos.y }, gps: toGps(s.pos), capacity: s.capacity, occupancy: s.occupancy, status: shelterStatus(s) };
    }
    function wireResource(r) {
      return { id: r.id, pos: { x: r.pos.x, y: r.pos.y }, gps: toGps(r.pos), type: r.type, quantity: r.quantity, status: 'AVAILABLE' };
    }
    function wireZone(z) {
      return { id: z.id, name: z.name, type: z.type, severity: z.severity, color: z.color, pts: z.pts.map(function (p) { return [p[0], p[1]]; }) };
    }

    function snapshot() {
      return {
        serverTime: Date.now(),
        stats: { rescued: state.rescued },
        config: { center: center, spanDeg: span },
        drones: state.drones.map(wireDrone),
        victims: state.victims.map(wireVictim),
        teams: state.teams.map(wireTeam),
        shelters: state.shelters.map(wireShelter),
        resources: state.resources.map(wireResource),
        zones: state.zones.map(wireZone)
      };
    }

    /* ------------------------------- tick ------------------------------- */
    function feed(emit, msg, level) { emit('feed', { msg: msg, level: level || 'info', t: Date.now() }); }

    function stepDrone(d, emit) {
      var before = { x: d.pos.x, y: d.pos.y };

      if (d.status === 'PATROL') {
        var target = {
          x: d.def.center[0] + Math.cos(d.angle + d.def.speed * 0.08) * d.def.radius,
          y: d.def.center[1] + Math.sin(d.angle + d.def.speed * 0.08) * d.def.radius * 0.7
        };
        if (dist(d.pos, target) > 30) {
          // coming back from a charge: fly to the patrol circle instead of teleporting
          var dd = dist(d.pos, target);
          d.pos.x += (target.x - d.pos.x) / dd * 30;
          d.pos.y += (target.y - d.pos.y) / dd * 30;
        } else {
          d.angle += d.def.speed * 0.08;
          d.pos.x = target.x; d.pos.y = target.y;
        }
        d.battery -= 0.35;
        if (d.battery <= 22) {
          d.status = 'RETURNING_TO_BASE';
          d.dock = nearestShelter(d.pos);
          feed(emit, d.id + ' battery critical (' + Math.round(d.battery) + '%) — returning to ' + d.dock.id + '.', 'warn');
        }
      } else if (d.status === 'RETURNING_TO_BASE') {
        var dock = d.dock || nearestShelter(d.pos);
        var dr = dist(d.pos, dock.pos);
        if (dr > 8) {
          d.pos.x += (dock.pos.x - d.pos.x) / dr * Math.min(30, dr);
          d.pos.y += (dock.pos.y - d.pos.y) / dr * Math.min(30, dr);
          d.battery = Math.max(3, d.battery - 0.1);
        } else {
          d.pos.x = dock.pos.x; d.pos.y = dock.pos.y;
          d.status = 'CHARGING';
          feed(emit, d.id + ' docked at ' + dock.id + ' — charging.', 'info');
        }
      } else if (d.status === 'CHARGING') {
        d.battery += 1.5;
        if (d.battery >= 95) {
          d.battery = 95; d.status = 'PATROL';
          feed(emit, d.id + ' recharged — resuming patrol.', 'ok');
        }
      }

      var mx = d.pos.x - before.x, my = d.pos.y - before.y;
      if (Math.hypot(mx, my) > 0.5) d.heading = heading(mx, my);
      d.alt = 40 + Math.sin(state.tick / 5 + d.angle) * 5;
      d.sensor = {
        thermalReading: 17 + Math.random() * 6,
        gasReading: 380 + Math.random() * 40,
        signalStrength: -50 - Math.random() * 20
      };
    }

    function assignTeams(emit) {
      state.teams.forEach(function (t) {
        if (t.availability !== 'AVAILABLE') return;
        var open = state.victims.filter(function (v) { return v.status === 'UNRESCUED'; });
        if (!open.length) return;
        // triage: closer victims first, but critical cases pull harder
        open.sort(function (a, b) {
          return (dist(t.pos, a.pos) - PRIORITY_BONUS[a.priority]) - (dist(t.pos, b.pos) - PRIORITY_BONUS[b.priority]);
        });
        var v = open[0];
        v.status = 'ASSIGNED'; v.teamId = t.id;
        t.victimId = v.id; t.availability = 'DEPLOYED';
        emit('victim', wireVictim(v));
        emit('team', wireTeam(t));
        feed(emit, t.id + ' dispatched to ' + v.id + ' (' + v.priority + ') — route plotted.', 'warn');
      });
    }

    function stepTeam(t, emit) {
      if (!t.victimId) return;
      var v = byId(state.victims, t.victimId);
      if (!v) { t.victimId = null; t.availability = 'AVAILABLE'; emit('team', wireTeam(t)); return; }
      var d = dist(t.pos, v.pos);
      if (d > 8) {
        var step = Math.min(7, d);
        t.heading = heading(v.pos.x - t.pos.x, v.pos.y - t.pos.y);
        t.pos.x += (v.pos.x - t.pos.x) / d * step;
        t.pos.y += (v.pos.y - t.pos.y) / d * step;
        emit('team', wireTeam(t));
      } else {
        v.status = 'RESCUED';
        state.rescued++;
        var shelter = nearestShelter(v.pos);
        if (shelter.occupancy < shelter.capacity) { shelter.occupancy++; emit('shelter', wireShelter(shelter)); }
        t.victimId = null; t.availability = 'AVAILABLE';
        emit('victim', wireVictim(v));
        emit('team', wireTeam(t));
        emit('stats', { rescued: state.rescued });
        feed(emit, v.id + ' rescued by ' + t.id + ' — transported to ' + shelter.id + '.', 'ok');
      }
    }

    function maybeSpawnVictim(emit) {
      if (state.tick % 25 !== 0) return;
      var openCount = state.victims.filter(function (v) { return v.status !== 'RESCUED'; }).length;
      if (openCount >= 7) return;
      var zone = state.zones[Math.floor(Math.random() * state.zones.length)];
      var xs = zone.pts.map(function (p) { return p[0]; }), ys = zone.pts.map(function (p) { return p[1]; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      var pos = null;
      for (var i = 0; i < 40 && !pos; i++) {
        var p = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
        if (pointInPolygon(p, zone.pts)) pos = p;
      }
      if (!pos) return;
      var roll = Math.random();
      var v = newVictim(pos, roll < 0.25 ? 'CRITICAL' : roll < 0.65 ? 'HIGH' : 'MODERATE');
      var scout = state.drones.filter(function (d) { return d.status === 'PATROL'; })
        .sort(function (a, b) { return dist(a.pos, pos) - dist(b.pos, pos); })[0];
      emit('victim', wireVictim(v));
      feed(emit, (scout ? scout.id : 'A drone') + ' thermal signature confirmed — ' + v.id + ' (' + v.priority + ') logged in ' + zone.name + '.', 'crit');
    }

    function pruneVictims(emit) {
      while (state.victims.length > 24) {
        var idx = -1;
        for (var i = 0; i < state.victims.length; i++) if (state.victims[i].status === 'RESCUED') { idx = i; break; }
        if (idx < 0) break;
        var gone = state.victims.splice(idx, 1)[0];
        emit('victim:remove', { id: gone.id });
      }
    }

    function tick(emit) {
      state.tick++;
      var now = Date.now();
      state.drones.forEach(function (d) {
        if (d.source === 'hardware') {
          if (now - d.lastHardwareAt < HARDWARE_TIMEOUT_MS) return; // real telemetry is in charge
          if (d.def) {
            d.source = 'sim'; d.gps = null; d.offMap = false;
            feed(emit, d.id + ' telemetry lost — falling back to simulation.', 'warn');
          } else {
            if (d.status !== 'OFFLINE') {
              d.status = 'OFFLINE';
              feed(emit, d.id + ' telemetry link lost.', 'warn');
              emit('drone', wireDrone(d));
            }
            return;
          }
        }
        stepDrone(d, emit);
        emit('drone', wireDrone(d));
      });
      state.teams.forEach(function (t) { stepTeam(t, emit); });
      assignTeams(emit);
      maybeSpawnVictim(emit);
      pruneVictims(emit);
    }

    /* ---------------------- external inputs (hardware) ---------------------- */
    // A real drone reports { droneId, gps:{lat,lng,altitude,heading}, battery, status, sensorData }.
    function ingestDrone(p, emit) {
      var d = byId(state.drones, p.droneId);
      var first = false;
      if (!d) {
        d = { id: p.droneId, def: null, angle: 0, dock: null, heading: 0, alt: 0, battery: 100, status: 'PATROL',
              sensor: { thermalReading: 0, gasReading: 0, signalStrength: 0 }, pos: { x: 500, y: 500 } };
        state.drones.push(d);
      }
      if (d.source !== 'hardware') first = true;
      d.source = 'hardware';
      d.lastHardwareAt = Date.now();
      var g = p.gps || {};
      d.gps = { lat: Number(g.lat), lng: Number(g.lng) };
      var raw = fromGps(d.gps);
      d.offMap = raw.x < 0 || raw.x > 1000 || raw.y < 0 || raw.y > 1000;
      d.pos = { x: clamp1000(raw.x), y: clamp1000(raw.y) };
      if (g.altitude != null) d.alt = Number(g.altitude);
      if (g.heading != null) d.heading = Number(g.heading);
      if (p.battery != null) d.battery = Math.max(0, Math.min(100, Number(p.battery)));
      d.status = VALID_STATUS.indexOf(p.status) >= 0 ? p.status : 'PATROL';
      var s = p.sensorData || {};
      d.sensor = {
        thermalReading: s.thermalReading != null ? Number(s.thermalReading) : d.sensor.thermalReading,
        gasReading: s.gasReading != null ? Number(s.gasReading) : d.sensor.gasReading,
        signalStrength: s.signalStrength != null ? Number(s.signalStrength) : d.sensor.signalStrength
      };
      if (first) feed(emit, d.id + ' hardware telemetry link established — live GPS.', 'ok');
      if (d.sensor.thermalReading > 36 && Date.now() - (d.lastHeatAlert || 0) > 10000) {
        d.lastHeatAlert = Date.now();
        feed(emit, d.id + ' possible heat signature (' + round1(d.sensor.thermalReading) + '°C) — verify on site.', 'crit');
      }
      var w = wireDrone(d);
      emit('drone', w);
      return w;
    }

    // Log a victim from outside (dispatcher, or a drone detection pipeline).
    function addVictim(spec, emit) {
      var pos = spec.lat != null && spec.lng != null ? fromGps({ lat: Number(spec.lat), lng: Number(spec.lng) }) : { x: Number(spec.x), y: Number(spec.y) };
      pos = { x: clamp1000(pos.x), y: clamp1000(pos.y) };
      var pr = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].indexOf(spec.priority) >= 0 ? spec.priority : 'MODERATE';
      var v = newVictim(pos, pr);
      var w = wireVictim(v);
      emit('victim', w);
      feed(emit, v.id + ' (' + v.priority + ') reported at ' + w.gps.lat.toFixed(4) + ', ' + w.gps.lng.toFixed(4) + '.', 'crit');
      return w;
    }

    return { snapshot: snapshot, tick: tick, ingestDrone: ingestDrone, addVictim: addVictim, toGps: toGps, fromGps: fromGps, state: state };
  }

  return { create: create };
});
