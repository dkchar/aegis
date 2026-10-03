import { ROUTES, STATIONS, STATION_BY_ID, isErrorActivity } from "./model.js";

/**
 * Aether canvas engine. Owns the animation clock and every moving thing:
 * stations, motes (tickets), handoff packets, rings, and sparks. React
 * hands it scenes and signals; it never reads Aegis state itself.
 */

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_DPR = 2;
const MAX_SPARKS = 700;
const TRAIL_POINTS = 22;
const MONO_FONT = '"Geist Mono Variable", ui-monospace, "SFMono-Regular", Consolas, monospace';
const TONES = ["info", "primary", "violet", "warning", "danger", "success"];

const FALLBACK_PALETTE = {
  dark: true,
  background: { r: 18, g: 19, b: 24 },
  foreground: { r: 240, g: 241, b: 245 },
  muted: { r: 160, g: 164, b: 176 },
  info: { r: 92, g: 172, b: 238 },
  primary: { r: 60, g: 208, b: 190 },
  violet: { r: 168, g: 140, b: 238 },
  warning: { r: 236, g: 188, b: 80 },
  danger: { r: 240, g: 104, b: 112 },
  success: { r: 80, g: 210, b: 150 },
};

/**
 * Resolves the Olympus color tokens to RGB through a 1x1 canvas, so OKLCH
 * tokens work in canvas gradients with any alpha in both themes.
 */
export function readPalette(element = document.documentElement) {
  const styles = getComputedStyle(element);
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK_PALETTE;
  const toRgb = (token, fallback) => {
    const value = styles.getPropertyValue(token).trim();
    if (!value) return fallback;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  };
  return {
    dark: element.dataset.theme !== "light",
    background: toRgb("--surface-sunken", FALLBACK_PALETTE.background),
    foreground: toRgb("--foreground", FALLBACK_PALETTE.foreground),
    muted: toRgb("--muted-foreground", FALLBACK_PALETTE.muted),
    ...Object.fromEntries(TONES.map((tone) => [tone, toRgb(`--${tone}`, FALLBACK_PALETTE[tone])])),
  };
}

function rgba(color, alpha) {
  return `rgba(${color.r},${color.g},${color.b},${Math.max(0, Math.min(1, alpha))})`;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function quadPoint(p0, c, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

function controlPoint(from, to, bend) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { x: (from.x + to.x) / 2 - dy * bend, y: (from.y + to.y) / 2 + dx * bend };
}

function seeded(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function createAetherEngine(canvas, { reducedMotion = false } = {}) {
  const context = canvas.getContext("2d");
  const motes = new Map();
  const packets = [];
  const rings = [];
  const sparks = [];
  let stars = [];
  let palette = FALLBACK_PALETTE;
  let scene = { motes: [], load: {}, totals: {} };
  let width = 0;
  let height = 0;
  let dpr = 1;
  let clock = 0;
  let lastFrame = 0;
  let frameHandle = 0;
  let paused = false;
  let hoveredId = null;
  let selectedId = null;
  let showAllLabels = false;
  let sceneReady = false;

  // ---------------------------------------------------------------- geometry

  function stationRadius() {
    return Math.max(15, Math.min(28, Math.min(width, height) * 0.034));
  }

  /** Narrow canvases transpose the map so work flows top to bottom. */
  function isPortrait() {
    return width < 640;
  }

  function normalizedPosition(station) {
    return isPortrait() ? station.portrait : { x: station.x, y: station.y };
  }

  function stationPoint(id) {
    const position = normalizedPosition(STATION_BY_ID[id]);
    const padX = isPortrait() ? 24 : 36;
    const padTop = isPortrait() ? 160 : 70;
    const padBottom = isPortrait() ? 128 : 44;
    return {
      x: padX + position.x * (width - padX * 2),
      y: padTop + position.y * (height - padTop - padBottom),
    };
  }

  function routeGeometry(route) {
    const from = stationPoint(route.from);
    const to = stationPoint(route.to);
    return { from, to, control: controlPoint(from, to, route.bend) };
  }

  /** Station members in scene order, split the way the station lays them out. */
  function stationMembers() {
    const members = Object.fromEntries(STATIONS.map((station) => [station.id, { inner: [], outer: [] }]));
    for (const mote of scene.motes) {
      const group = members[mote.station];
      const inner = mote.status === "running" || mote.status === "ready" || mote.status === "done"
        || mote.status === "blocked" || mote.status === "failed";
      (inner ? group.inner : group.outer).push(mote.id);
    }
    return members;
  }

  let memberCache = null;
  function slotOf(id) {
    if (!memberCache) memberCache = stationMembers();
    const mote = motes.get(id);
    const station = STATION_BY_ID[mote.station];
    const center = stationPoint(station.id);
    const radius = stationRadius();
    const group = memberCache[station.id];
    if (station.layout === "orbit") {
      const innerIndex = group.inner.indexOf(id);
      if (innerIndex !== -1) {
        const angle = (innerIndex / group.inner.length) * TAU + clock * 0.45 - Math.PI / 2;
        return { x: center.x + Math.cos(angle) * (radius + 17), y: center.y + Math.sin(angle) * (radius + 17) };
      }
      const outerIndex = Math.max(0, group.outer.indexOf(id));
      const perRing = Math.max(8, Math.floor((TAU * (radius + 35)) / 17));
      const ring = Math.floor(outerIndex / perRing);
      const inRing = Math.min(perRing, group.outer.length - ring * perRing);
      const ringRadius = radius + 35 + ring * 15;
      const angle = ((outerIndex % perRing) / inRing) * TAU - clock * 0.12 + ring * 0.4;
      return { x: center.x + Math.cos(angle) * ringRadius, y: center.y + Math.sin(angle) * ringRadius };
    }
    // Clouds and the trunk spiral: phyllotaxis, so they grow evenly with count.
    const ordered = [...group.inner, ...group.outer];
    const index = Math.max(0, ordered.indexOf(id));
    const spiral = station.layout === "spiral";
    const distance = radius * (spiral ? 0.75 : 0.55) + (spiral ? 6.6 : 7.4) * Math.sqrt(index + 0.6);
    const angle = index * GOLDEN_ANGLE + clock * (spiral ? -0.035 : 0.04);
    return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
  }

  function cloudExtent(stationId) {
    const count = scene.load?.[stationId]?.total ?? 0;
    const radius = stationRadius();
    const spiral = STATION_BY_ID[stationId].layout === "spiral";
    return count === 0 ? radius : radius * (spiral ? 0.75 : 0.55) + (spiral ? 6.6 : 7.4) * Math.sqrt(count) + 6;
  }

  // ------------------------------------------------------------------ scene

  function startFlight(mote, fromStation, toStation) {
    const route = ROUTES.find((candidate) => candidate.from === fromStation && candidate.to === toStation);
    const start = { x: mote.x, y: mote.y };
    const control = route
      ? routeGeometry(route).control
      : controlPoint(start, stationPoint(toStation), 0.22);
    const distance = Math.hypot(stationPoint(toStation).x - start.x, stationPoint(toStation).y - start.y);
    mote.flight = reducedMotion ? null : { start, control, startedAt: clock, duration: 0.95 + Math.min(distance / 900, 0.85) };
    mote.trail = [];
  }

  function setScene(next) {
    scene = next;
    memberCache = null;
    const seen = new Set();
    for (const entry of next.motes) {
      seen.add(entry.id);
      const existing = motes.get(entry.id);
      if (!existing) {
        const origin = stationPoint(sceneReady ? "agora" : entry.station);
        const mote = { ...entry, x: origin.x, y: origin.y, alpha: 0, flight: null, trail: [], shakeUntil: 0 };
        motes.set(entry.id, mote);
        if (sceneReady && entry.station !== "agora") startFlight(mote, "agora", entry.station);
        else {
          memberCache = null;
          const slot = slotOf(entry.id);
          mote.x = slot.x;
          mote.y = slot.y;
        }
        continue;
      }
      const previousStation = existing.station;
      const previousActivity = existing.activity;
      Object.assign(existing, entry);
      if (previousStation !== entry.station) startFlight(existing, previousStation, entry.station);
      if (entry.status === "running" && entry.activity && previousActivity && entry.activity !== previousActivity) {
        burstSparks(existing, isErrorActivity(entry.activity) ? "danger" : entry.tone, 6, 70);
      }
    }
    for (const id of [...motes.keys()]) {
      if (!seen.has(id)) motes.delete(id);
    }
    memberCache = null;
    sceneReady = true;
  }

  // ---------------------------------------------------------------- effects

  function addRing(anchor, tone, { from = 4, to = 28, duration = 0.8, width: lineWidth = 2, alpha = 0.9 } = {}) {
    rings.push({ anchor, tone, from, to, duration, lineWidth, alpha, startedAt: clock });
  }

  function anchorPoint(anchor) {
    if (anchor.moteId) {
      const mote = motes.get(anchor.moteId);
      if (mote) return mote;
    }
    return anchor.point ?? stationPoint(anchor.station ?? "agora");
  }

  function burstSparks(origin, tone, count, speed) {
    if (reducedMotion) return;
    for (let index = 0; index < count && sparks.length < MAX_SPARKS; index += 1) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.4 + Math.random() * 0.8);
      sparks.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.7,
        size: 0.8 + Math.random() * 1.4,
        tone,
      });
    }
  }

  /** Plays the effect of one signal from `describeEvent`. */
  function trigger(signal) {
    const effect = signal?.effect;
    if (!effect) return;
    const mote = signal.issueId ? motes.get(signal.issueId) : null;
    const anchor = mote ? { moteId: mote.id } : { station: effect.station ?? "agora" };
    const tone = effect.tone ?? "info";
    const origin = anchorPoint(anchor);

    if (effect.kind === "packet") {
      const route = ROUTES.find((candidate) => candidate.id === effect.route);
      if (!route) return;
      packets.push({ route, tone, flare: effect.flare ?? null, startedAt: clock, duration: reducedMotion ? 0.01 : 1.15, trail: [] });
      return;
    }
    if (effect.kind === "ignite") {
      addRing(anchor, tone, { from: 3, to: 30, duration: 0.9 });
      addRing(anchor, tone, { from: 3, to: 16, duration: 0.6, alpha: 0.6 });
      burstSparks(origin, tone, 14, 95);
      return;
    }
    if (effect.kind === "shock") {
      addRing(anchor, "danger", { from: 4, to: 42, duration: 1.1, width: 2.5 });
      addRing(anchor, "danger", { from: 4, to: 24, duration: 0.7, alpha: 0.6 });
      burstSparks(origin, "danger", 18, 120);
      if (mote) mote.shakeUntil = clock + 0.6;
      return;
    }
    addRing(anchor, tone, { from: mote ? 5 : stationRadius(), to: mote ? 24 : stationRadius() * 2.1, duration: 1, alpha: 0.55, width: 1.5 });
  }

  function landPacket(packet) {
    const destination = stationPoint(packet.route.to);
    addRing({ station: packet.route.to }, packet.tone, { from: stationRadius() * 0.6, to: stationRadius() * 1.9, duration: 0.9, alpha: 0.7 });
    burstSparks(destination, packet.tone, 10, 80);
    if (packet.flare) {
      addRing({ station: packet.flare }, "success", { from: stationRadius(), to: stationRadius() * 4, duration: 1.6, width: 3, alpha: 0.8 });
      burstSparks(stationPoint(packet.flare), "success", 26, 150);
    }
  }

  // ----------------------------------------------------------------- update

  function update(dt) {
    for (const mote of motes.values()) {
      mote.alpha = Math.min(1, mote.alpha + dt * 2.5);
      const slot = slotOf(mote.id);
      if (mote.flight) {
        const progress = Math.min(1, (clock - mote.flight.startedAt) / mote.flight.duration);
        const point = quadPoint(mote.flight.start, mote.flight.control, slot, easeInOutCubic(progress));
        mote.x = point.x;
        mote.y = point.y;
        mote.trail.push({ x: point.x, y: point.y });
        if (mote.trail.length > TRAIL_POINTS) mote.trail.shift();
        if (progress >= 1) {
          mote.flight = null;
          addRing({ moteId: mote.id }, mote.tone, { from: 4, to: 18, duration: 0.6, alpha: 0.7 });
        }
      } else if (mote.id === hoveredId) {
        // A hovered ticket holds still so it can be clicked; it eases back after.
        if (mote.trail.length > 0) mote.trail.shift();
      } else {
        const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
        mote.x += (slot.x - mote.x) * follow;
        mote.y += (slot.y - mote.y) * follow;
        if (mote.trail.length > 0) mote.trail.shift();
      }
    }

    for (let index = packets.length - 1; index >= 0; index -= 1) {
      const packet = packets[index];
      const progress = (clock - packet.startedAt) / packet.duration;
      if (progress >= 1) {
        landPacket(packet);
        packets.splice(index, 1);
        continue;
      }
      const { from, to, control } = routeGeometry(packet.route);
      const point = quadPoint(from, control, to, easeInOutCubic(progress));
      packet.trail.push(point);
      if (packet.trail.length > TRAIL_POINTS) packet.trail.shift();
    }

    for (let index = rings.length - 1; index >= 0; index -= 1) {
      if (clock - rings[index].startedAt > rings[index].duration) rings.splice(index, 1);
    }

    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      spark.life += dt;
      if (spark.life >= spark.maxLife) {
        sparks.splice(index, 1);
        continue;
      }
      const drag = Math.exp(-dt * 2.6);
      spark.vx *= drag;
      spark.vy *= drag;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
    }
  }

  // ------------------------------------------------------------------- draw

  function glow(x, y, radius, color, alpha) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha));
    gradient.addColorStop(1, rgba(color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
  }

  function tone(name) {
    return palette[name] ?? palette.muted;
  }

  function drawBackdrop() {
    context.clearRect(0, 0, width, height);
    const center = stationPoint("titan");
    const wash = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(width, height) * 0.75);
    wash.addColorStop(0, rgba(palette.primary, palette.dark ? 0.07 : 0.05));
    wash.addColorStop(0.55, rgba(palette.violet, palette.dark ? 0.035 : 0.02));
    wash.addColorStop(1, rgba(palette.background, 0));
    context.fillStyle = wash;
    context.fillRect(0, 0, width, height);

    for (const star of stars) {
      const twinkle = reducedMotion ? 0.75 : 0.55 + 0.45 * Math.sin(clock * star.speed + star.phase);
      const x = reducedMotion ? star.x : (star.x + clock * star.depth * 4) % width;
      context.fillStyle = rgba(palette.dark ? palette.foreground : palette.muted, star.alpha * twinkle);
      context.fillRect(x, star.y, star.size, star.size);
    }
  }

  function routeTone(route) {
    if (route.kind === "rework") return "danger";
    if (route.kind === "escalate" || route.kind === "return") return "warning";
    return null;
  }

  function drawRoutes() {
    for (const route of ROUTES) {
      const { from, to, control } = routeGeometry(route);
      const special = routeTone(route);
      context.save();
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo(control.x, control.y, to.x, to.y);
      if (special) {
        context.setLineDash([3, 7]);
        context.lineDashOffset = reducedMotion ? 0 : -clock * 10;
        context.strokeStyle = rgba(tone(special), palette.dark ? 0.32 : 0.45);
        context.lineWidth = 1.25;
        context.stroke();
      } else {
        const fromTone = tone(STATION_BY_ID[route.from].tone);
        const toTone = tone(STATION_BY_ID[route.to].tone);
        const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
        gradient.addColorStop(0, rgba(fromTone, palette.dark ? 0.42 : 0.5));
        gradient.addColorStop(1, rgba(toTone, palette.dark ? 0.42 : 0.5));
        context.strokeStyle = gradient;
        context.lineWidth = 2;
        context.stroke();
        context.strokeStyle = rgba(palette.foreground, palette.dark ? 0.05 : 0.06);
        context.lineWidth = 9;
        context.stroke();
      }
      context.restore();
    }
  }

  function drawFlowParticles() {
    if (reducedMotion) return;
    ROUTES.filter((route) => route.kind === "flow").forEach((route, routeIndex) => {
      const { from, to, control } = routeGeometry(route);
      const busy = (scene.load?.[route.from]?.running ?? 0) + (scene.load?.[route.to]?.running ?? 0);
      const count = 3 + Math.min(6, busy * 2);
      const fromTone = tone(STATION_BY_ID[route.from].tone);
      const toTone = tone(STATION_BY_ID[route.to].tone);
      for (let index = 0; index < count; index += 1) {
        const u = (clock * (0.055 + busy * 0.012) + index / count + seeded(routeIndex) ) % 1;
        const point = quadPoint(from, control, to, u);
        const color = {
          r: fromTone.r + (toTone.r - fromTone.r) * u,
          g: fromTone.g + (toTone.g - fromTone.g) * u,
          b: fromTone.b + (toTone.b - fromTone.b) * u,
        };
        const fade = Math.sin(u * Math.PI);
        glow(point.x, point.y, 6, color, (palette.dark ? 0.5 : 0.35) * fade);
        context.fillStyle = rgba(color, 0.9 * fade);
        context.beginPath();
        context.arc(point.x, point.y, 1.4, 0, TAU);
        context.fill();
      }
    });
  }

  function drawStation(station) {
    const center = stationPoint(station.id);
    const radius = stationRadius();
    const color = tone(station.tone);
    const load = scene.load?.[station.id] ?? { total: 0, running: 0 };
    const breathing = reducedMotion ? 1 : 1 + 0.06 * Math.sin(clock * 1.6 + station.x * 9);
    const intensity = Math.min(1, 0.35 + load.running * 0.22 + load.total * 0.04);

    glow(center.x, center.y, radius * 4.2 * breathing, color, (palette.dark ? 0.16 : 0.1) * intensity + 0.03);

    if (station.layout !== "orbit") {
      // Clouds and the trunk read as a soft disc with a thin boundary.
      const extent = cloudExtent(station.id);
      context.strokeStyle = rgba(color, palette.dark ? 0.22 : 0.3);
      context.setLineDash([2, 5]);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(center.x, center.y, extent, 0, TAU);
      context.stroke();
      context.setLineDash([]);
      if (station.id === "trunk") drawTrunkProgress(center, extent + 7, color);
      drawStationCore(center, radius * 0.38, color, load);
      drawStationLabel(station, center, extent, load);
      return;
    }

    context.strokeStyle = rgba(color, palette.dark ? 0.5 : 0.6);
    context.lineWidth = 1.25;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, TAU);
    context.stroke();

    // Rotating arcs: their speed shows how many sessions the station runs.
    const spin = reducedMotion ? 0 : clock * (0.25 + load.running * 0.55);
    context.lineWidth = 2.25;
    context.lineCap = "round";
    for (let index = 0; index < 3; index += 1) {
      const start = spin + (index * TAU) / 3;
      context.strokeStyle = rgba(color, load.running > 0 ? 0.95 : 0.45);
      context.beginPath();
      context.arc(center.x, center.y, radius + 5, start, start + 0.7);
      context.stroke();
    }
    context.strokeStyle = rgba(color, 0.14);
    context.lineWidth = 1;
    context.beginPath();
    context.arc(center.x, center.y, radius + 35, 0, TAU);
    context.stroke();

    drawStationCore(center, radius * 0.42, color, load);
    drawStationLabel(station, center, radius + 44, load);
  }

  function drawStationCore(center, radius, color, load) {
    glow(center.x, center.y, radius * 2.6, color, palette.dark ? 0.55 : 0.35);
    context.fillStyle = rgba(color, 0.95);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, TAU);
    context.fill();
    if (load.total === 0) {
      // An empty station shows a specular highlight instead of its count.
      context.fillStyle = rgba(palette.foreground, palette.dark ? 0.7 : 0.55);
      context.beginPath();
      context.arc(center.x - radius * 0.25, center.y - radius * 0.25, radius * 0.35, 0, TAU);
      context.fill();
    } else {
      context.font = `600 11px ${MONO_FONT}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = palette.dark ? rgba(palette.background, 0.9) : rgba(palette.background, 0.95);
      context.fillText(String(load.total), center.x, center.y + 0.5);
    }
  }

  function drawTrunkProgress(center, radius, color) {
    const total = scene.totals?.tickets ?? 0;
    const done = scene.totals?.done ?? 0;
    if (total === 0) return;
    context.strokeStyle = rgba(palette.foreground, palette.dark ? 0.08 : 0.1);
    context.lineWidth = 3;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, TAU);
    context.stroke();
    context.strokeStyle = rgba(color, 0.95);
    context.lineCap = "round";
    context.beginPath();
    context.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + (done / total) * TAU);
    context.stroke();
  }

  function stationCaption(station, load) {
    if (station.id === "trunk") return `${scene.totals?.done ?? 0}/${scene.totals?.tickets ?? 0} landed`;
    if (station.layout !== "orbit") return load.total > 0 ? `${station.role} · ${load.total}` : station.role;
    const queued = load.total - load.running;
    const parts = [station.role];
    if (load.running > 0) parts.push(`${load.running} live`);
    if (queued > 0) parts.push(`${queued} waiting`);
    return parts.join(" · ");
  }

  /** Label below the station, or to its right in the portrait flow column; `extent` is the station's drawn radius. */
  function drawStationLabel(station, center, extent, load) {
    const beside = isPortrait() && station.portrait.y < 0.9;
    const x = beside ? center.x + extent + 10 : center.x;
    const y = beside ? center.y - 2 : center.y + extent + 22;
    context.textAlign = beside ? "left" : "center";
    context.textBaseline = "alphabetic";
    context.font = `600 11px ${MONO_FONT}`;
    if ("letterSpacing" in context) context.letterSpacing = "1.5px";
    context.fillStyle = rgba(tone(station.tone), 0.95);
    context.fillText(station.label.toUpperCase(), x, y);
    if ("letterSpacing" in context) context.letterSpacing = "0px";
    context.font = `500 10.5px ${MONO_FONT}`;
    context.fillStyle = rgba(palette.muted, 0.9);
    context.fillText(stationCaption(station, load), x, y + 14);
  }

  function drawTethers() {
    context.save();
    context.setLineDash([2, 4]);
    context.lineWidth = 1;
    for (const mote of motes.values()) {
      if (mote.status !== "blocked") continue;
      for (const blockerId of mote.blockedBy) {
        const blocker = motes.get(blockerId);
        if (!blocker) continue;
        context.strokeStyle = rgba(palette.warning, palette.dark ? 0.35 : 0.45);
        context.beginPath();
        context.moveTo(mote.x, mote.y);
        context.lineTo(blocker.x, blocker.y);
        context.stroke();
      }
    }
    context.restore();
  }

  function moteRadius(mote) {
    if (mote.status === "running") return 5.2;
    if (mote.status === "done" || mote.status === "backlog") return 3;
    return 4.2;
  }

  function moteTone(mote) {
    if (mote.status === "failed") return "danger";
    if (mote.status === "rework") return "danger";
    if (mote.status === "blocked" || mote.status === "backlog") return "muted";
    return mote.tone;
  }

  function drawMote(mote) {
    const color = tone(moteTone(mote));
    const radius = moteRadius(mote);
    let { x, y } = mote;
    if (mote.shakeUntil > clock && !reducedMotion) {
      x += Math.sin(clock * 60) * 2.5;
    }
    const alpha = mote.alpha * (mote.status === "backlog" ? 0.45 : mote.status === "blocked" ? 0.6 : 1);

    if (mote.trail.length > 1) {
      context.lineCap = "round";
      for (let index = 1; index < mote.trail.length; index += 1) {
        const fade = index / mote.trail.length;
        context.strokeStyle = rgba(color, 0.55 * fade * alpha);
        context.lineWidth = radius * 1.6 * fade;
        context.beginPath();
        context.moveTo(mote.trail[index - 1].x, mote.trail[index - 1].y);
        context.lineTo(mote.trail[index].x, mote.trail[index].y);
        context.stroke();
      }
    }

    if (mote.status === "running") {
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 3.2 + x * 0.05);
      glow(x, y, 18 + pulse * 6, color, (palette.dark ? 0.45 : 0.3) * alpha);
      context.strokeStyle = rgba(color, (0.35 + 0.4 * (1 - pulse)) * alpha);
      context.lineWidth = 1.25;
      context.beginPath();
      context.arc(x, y, radius + 4 + pulse * 3, 0, TAU);
      context.stroke();
      // The agent: a satellite orbiting the ticket it works.
      const angle = reducedMotion ? 0 : clock * 2.4 + x;
      context.fillStyle = rgba(palette.dark ? palette.foreground : color, 0.95 * alpha);
      context.beginPath();
      context.arc(x + Math.cos(angle) * (radius + 6), y + Math.sin(angle) * (radius + 6), 1.6, 0, TAU);
      context.fill();
    } else if (mote.status !== "backlog") {
      glow(x, y, 10, color, (palette.dark ? 0.28 : 0.16) * alpha);
    }

    if (mote.status === "queued" || mote.status === "rework") {
      context.fillStyle = rgba(color, 0.25 * alpha);
      context.strokeStyle = rgba(color, 0.95 * alpha);
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      context.stroke();
    } else {
      context.fillStyle = rgba(color, alpha);
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }
    if (mote.status === "failed" && !reducedMotion) {
      const beat = (clock * 0.9) % 1;
      context.strokeStyle = rgba(color, (1 - beat) * 0.7 * alpha);
      context.lineWidth = 1.25;
      context.beginPath();
      context.arc(x, y, radius + beat * 12, 0, TAU);
      context.stroke();
    }
  }

  function drawMoteLabel(mote, emphasis) {
    context.font = `${emphasis ? 600 : 500} 10.5px ${MONO_FONT}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    const x = mote.x + moteRadius(mote) + 7;
    const y = mote.y - moteRadius(mote) - 5;
    context.lineWidth = 3.5;
    context.strokeStyle = rgba(palette.background, 0.85);
    context.strokeText(mote.id, x, y);
    context.fillStyle = rgba(emphasis ? palette.foreground : palette.muted, mote.alpha);
    context.fillText(mote.id, x, y);
  }

  function drawPackets() {
    for (const packet of packets) {
      const color = tone(packet.tone);
      for (let index = 1; index < packet.trail.length; index += 1) {
        const fade = index / packet.trail.length;
        context.strokeStyle = rgba(color, 0.8 * fade);
        context.lineWidth = 3.5 * fade;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(packet.trail[index - 1].x, packet.trail[index - 1].y);
        context.lineTo(packet.trail[index].x, packet.trail[index].y);
        context.stroke();
      }
      const head = packet.trail[packet.trail.length - 1];
      if (!head) continue;
      glow(head.x, head.y, 16, color, palette.dark ? 0.8 : 0.5);
      context.save();
      context.translate(head.x, head.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = rgba(palette.dark ? palette.foreground : color, 1);
      context.fillRect(-3, -3, 6, 6);
      context.restore();
    }
  }

  function drawEffects() {
    for (const ring of rings) {
      const progress = Math.min(1, (clock - ring.startedAt) / ring.duration);
      const point = anchorPoint(ring.anchor);
      const radius = ring.from + (ring.to - ring.from) * easeOutCubic(progress);
      context.strokeStyle = rgba(tone(ring.tone), ring.alpha * (1 - progress));
      context.lineWidth = ring.lineWidth * (1 - progress * 0.5);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, TAU);
      context.stroke();
    }
    for (const spark of sparks) {
      const life = 1 - spark.life / spark.maxLife;
      context.fillStyle = rgba(tone(spark.tone), life);
      context.beginPath();
      context.arc(spark.x, spark.y, spark.size * life + 0.3, 0, TAU);
      context.fill();
    }
  }

  function drawSelection() {
    for (const [id, strong] of [[hoveredId, false], [selectedId, true]]) {
      const mote = id ? motes.get(id) : null;
      if (!mote) continue;
      context.strokeStyle = rgba(palette.foreground, strong ? 0.95 : 0.6);
      context.lineWidth = strong ? 1.75 : 1.25;
      context.setLineDash(strong ? [] : [2, 3]);
      context.beginPath();
      context.arc(mote.x, mote.y, moteRadius(mote) + 7, 0, TAU);
      context.stroke();
      context.setLineDash([]);
    }
  }

  function draw() {
    drawBackdrop();
    context.globalCompositeOperation = palette.dark ? "lighter" : "source-over";
    drawRoutes();
    drawFlowParticles();
    context.globalCompositeOperation = "source-over";
    drawTethers();
    for (const station of STATIONS) {
      context.globalCompositeOperation = "source-over";
      drawStation(station);
    }
    for (const mote of motes.values()) drawMote(mote);
    for (const mote of motes.values()) {
      const emphasis = mote.id === selectedId || mote.id === hoveredId;
      if (emphasis || mote.status === "running" || mote.status === "failed"
        || (showAllLabels && mote.status !== "done" && mote.status !== "backlog")) {
        drawMoteLabel(mote, emphasis);
      }
    }
    context.globalCompositeOperation = palette.dark ? "lighter" : "source-over";
    drawPackets();
    drawEffects();
    context.globalCompositeOperation = "source-over";
    drawSelection();
  }

  function frame(now) {
    frameHandle = requestAnimationFrame(frame);
    const seconds = now / 1000;
    const dt = lastFrame ? Math.min(0.05, seconds - lastFrame) : 0;
    lastFrame = seconds;
    if (!paused) {
      clock += dt;
      memberCache = null;
      update(dt);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function seedStars() {
    const count = Math.round((width * height) / 5200);
    stars = Array.from({ length: count }, (_, index) => ({
      x: seeded(index + 1) * width,
      y: seeded(index + 1000) * height,
      size: seeded(index + 2000) > 0.92 ? 1.6 : 1,
      alpha: 0.12 + seeded(index + 3000) * (palette.dark ? 0.4 : 0.18),
      speed: 0.6 + seeded(index + 4000) * 1.8,
      phase: seeded(index + 5000) * TAU,
      depth: 0.2 + seeded(index + 6000),
    }));
  }

  return {
    start() {
      if (!frameHandle) frameHandle = requestAnimationFrame(frame);
    },
    destroy() {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      seedStars();
      memberCache = null;
      // Snap motes to their new slots instead of flying across a resized canvas.
      for (const mote of motes.values()) {
        if (mote.flight) continue;
        const slot = slotOf(mote.id);
        mote.x = slot.x;
        mote.y = slot.y;
      }
    },
    setPalette(next) {
      palette = next;
      seedStars();
    },
    setScene,
    trigger,
    setPaused(value) {
      paused = value;
    },
    setHovered(id) {
      hoveredId = id;
    },
    setSelected(id) {
      selectedId = id;
    },
    setShowAllLabels(value) {
      showAllLabels = value;
    },
    /** Nearest mote under a canvas point (CSS pixels), or `null`. */
    hitTest(x, y) {
      let best = null;
      let bestDistance = 12;
      for (const mote of motes.values()) {
        const distance = Math.hypot(mote.x - x, mote.y - y);
        if (distance < bestDistance) {
          best = mote.id;
          bestDistance = distance;
        }
      }
      return best;
    },
  };
}
