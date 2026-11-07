type Route = "hosted" | "local";
type CheckState = "idle" | "queued" | "running" | "passed";

interface Check {
  name: string;
  /** Simulated job length in display seconds. */
  seconds: number;
  state: CheckState;
  startedAt: number;
  el: HTMLLIElement;
  dot: HTMLElement;
  meta: HTMLElement;
}

interface Pulse {
  path: SVGPathElement;
  startedAt: number;
  /** Index of the check this pulse starts, or null for ambient traffic. */
  check: number | null;
  route: Route;
  dot: SVGCircleElement;
  halo: SVGCircleElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const JOBS = [
  { name: "ci / test", seconds: 130 },
  { name: "ci / lint", seconds: 38 },
  { name: "ci / typecheck", seconds: 84 },
];
/** Simulated seconds shown per real second while a check runs. */
const SPEED = 38;
const PULSE_MS = 1500;
const PULSE_GAP_MS = 260;
const PUSH_EVERY_MS = 7200;
const AUTO_FLIP_MS = 6200;
const AMBIENT_EVERY_MS = 620;
const QUOTA = 2000;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const announcer = document.querySelector<HTMLElement>("[data-announce]");

function announce(message: string) {
  if (announcer) announcer.textContent = message;
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- Copy buttons ---------- */

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function setupCopy() {
  for (const box of document.querySelectorAll<HTMLElement>("[data-instruction]")) {
    const button = box.querySelector<HTMLButtonElement>("[data-copy]");
    const source = box.querySelector<HTMLElement>("[data-copy-text]");
    const label = box.querySelector<HTMLElement>("[data-copy-label]");
    if (!button || !source || !label) continue;
    const idle = label.textContent ?? "Copy";
    let timer = 0;
    button.addEventListener("click", async () => {
      const text = source.textContent?.trim() ?? "";
      const ok = await copyText(text);
      button.classList.toggle("copied", ok);
      label.textContent = ok ? "Copied" : "Copy failed. Select the text instead.";
      announce(label.textContent);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        button.classList.remove("copied");
        label.textContent = idle;
      }, 2600);
    });
  }
}

function setupInlineCopy() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-inline]")) {
    const code = button.querySelector("code");
    const text = button.dataset.copyInline ?? "";
    if (!code) continue;
    let timer = 0;
    button.addEventListener("click", async () => {
      const ok = await copyText(text);
      code.textContent = ok ? "Copied" : "Copy failed";
      button.classList.toggle("copied", ok);
      announce(code.textContent);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        code.textContent = text;
        button.classList.remove("copied");
      }, 2600);
    });
  }
}

/* ---------- Header ---------- */

function setupHeader() {
  const header = document.querySelector<HTMLElement>("[data-header]");
  if (!header) return;
  const update = () => header.classList.toggle("scrolled", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/* ---------- Quota bar ---------- */

function setupQuota() {
  const ticks = document.querySelector<HTMLElement>("[data-ticks]");
  if (!ticks) return;
  for (let i = 0; i < 100; i++) {
    const tick = document.createElement("i");
    tick.style.setProperty("--i", String(i));
    ticks.append(tick);
  }
  if (reducedMotion.matches || !("IntersectionObserver" in window)) return;
  ticks.classList.add("armed");
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      requestAnimationFrame(() => ticks.classList.add("play"));
    },
    { threshold: 0.5 },
  );
  observer.observe(ticks);
}

/* ---------- Page-wide route state ---------- */

function setupRouteControls() {
  const label = document.querySelector<HTMLElement>("[data-route-label]");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-set-route]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      document.dispatchEvent(
        new CustomEvent<Route>("route:set", {
          detail: button.dataset.setRoute === "local" ? "local" : "hosted",
        }),
      );
      const card = button.closest(".term-card");
      card?.classList.remove("replay");
      void (card as HTMLElement | null)?.offsetWidth;
      card?.classList.add("replay");
    });
  }
  document.addEventListener("route:changed", (event) => {
    const route = (event as CustomEvent<Route>).detail;
    if (label) label.textContent = route === "local" ? "Your machine" : "GitHub-hosted";
    for (const button of buttons) {
      const current = button.dataset.setRoute === route;
      button.disabled = current;
      button.textContent = current ? "Current route" : "Run in the demo";
    }
  });
}

/* ---------- Routing demo ---------- */

function setupDemo() {
  const found = document.querySelector<HTMLElement>("[data-viz]");
  if (!found) return;
  const viz: HTMLElement = found;
  const need = <T extends Element>(selector: string): T => {
    const el = viz.querySelector<T>(selector);
    if (!el) throw new Error(`Missing ${selector}`);
    return el;
  };
  const svg = need<SVGSVGElement>("[data-lines]");
  const trunk = need<SVGPathElement>("[data-trunk]");
  const pulseLayer = need<SVGGElement>("[data-pulses]");
  const term = need<HTMLElement>(".term");
  const junction = need<HTMLElement>(".route-toggle");
  const junctionCmd = need<HTMLElement>(".junction-cmd");
  const pushLine = need<HTMLElement>("[data-push-line]");
  const cmd = need<HTMLElement>("[data-cmd]");
  const minutesEl = need<HTMLElement>("[data-minutes]");
  const meter = need<HTMLElement>("[data-meter]");

  const branches = {} as Record<Route, SVGPathElement>;
  const panels = {} as Record<Route, HTMLElement>;
  const checks = {} as Record<Route, Check[]>;
  const toggles = [...viz.querySelectorAll<HTMLButtonElement>("[data-route]")];

  for (const route of ["hosted", "local"] as const) {
    const list = need<HTMLUListElement>(`[data-checks="${route}"]`);
    branches[route] = need<SVGPathElement>(`[data-branch="${route}"]`);
    panels[route] = need<HTMLElement>(`[data-panel="${route}"]`);
    checks[route] = JOBS.map((job) => {
      const el = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "st";
      const text = document.createElement("div");
      const name = document.createElement("span");
      name.className = "check-name";
      name.textContent = job.name;
      const meta = document.createElement("span");
      meta.className = "check-meta";
      text.append(name, meta);
      el.append(dot, text);
      list.append(el);
      return { ...job, state: "idle", startedAt: 0, el, dot, meta };
    });
  }

  let route: Route = "hosted";
  let minutes = 1184;
  let pr = 212;
  let autoFlip = true;
  let pulses: Pulse[] = [];
  let lastPush = -Infinity;
  let lastAmbient = -Infinity;
  let elapsed = 0;
  let lastFrame = 0;
  let visible = true;
  let frame = 0;

  function renderCheck(check: Check, owner: Route) {
    check.dot.dataset.s = check.state;
    if (check.state === "idle") {
      check.meta.textContent = owner === route ? "waiting for a push" : "idle";
    } else if (check.state === "queued") {
      check.meta.textContent = "queued";
    } else if (check.state === "running") {
      check.meta.textContent = `running · ${clock(((elapsed - check.startedAt) / 1000) * SPEED)}`;
    } else {
      check.meta.textContent = `passed · ${clock(check.seconds)}`;
    }
  }

  function renderMinutes() {
    minutesEl.textContent = minutes.toLocaleString("en-US");
    meter.style.width = `${Math.min(100, (minutes / QUOTA) * 100).toFixed(1)}%`;
  }

  function renderRoute() {
    viz.dataset.route = route;
    document.documentElement.dataset.activeRoute = route;
    document.dispatchEvent(new CustomEvent<Route>("route:changed", { detail: route }));
    for (const button of toggles)
      button.setAttribute("aria-checked", String(button.dataset.route === route));
    for (const key of ["hosted", "local"] as const) {
      panels[key].classList.toggle("active", key === route);
      branches[key].classList.toggle("active", key === route);
      for (const check of checks[key]) renderCheck(check, key);
    }
  }

  function layout() {
    const box = viz.getBoundingClientRect();
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
    };
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    const t = rel(term);
    const j = rel(junction);
    const tx = t.x + t.w / 2;
    trunk.setAttribute("d", `M${tx} ${t.y + t.h} V${j.y}`);
    const c = rel(junctionCmd);
    const jx = c.x + c.w / 2;
    const jy = c.y + c.h;
    for (const key of ["hosted", "local"] as const) {
      const p = rel(panels[key]);
      const px = p.x + p.w / 2;
      const py = p.y;
      const mid = (py - jy) * 0.55;
      branches[key].setAttribute(
        "d",
        `M${jx} ${jy} C${jx} ${jy + mid} ${px} ${py - mid} ${px} ${py}`,
      );
    }
  }

  function setRoute(next: Route, fromUser: boolean) {
    if (fromUser) autoFlip = false;
    if (next === route) return;
    route = next;
    pulses = pulses.filter((pulse) => {
      if (pulse.check !== null) return true;
      pulse.dot.remove();
      pulse.halo.remove();
      return false;
    });
    cmd.textContent = `relayrunner switch ${next}`;
    for (const check of checks[next]) if (check.state === "passed") check.state = "idle";
    renderRoute();
    lastPush = elapsed;
    push();
    announce(
      next === "local"
        ? "Route set to your machine. The next push runs locally."
        : "Route set to GitHub-hosted runners. The next push uses Actions minutes.",
    );
  }

  function push() {
    pr += 1;
    pushLine.textContent = `→ PR #${pr} · ci.yml`;
    pushLine.classList.remove("fresh");
    void pushLine.offsetWidth;
    pushLine.classList.add("fresh");
    for (const check of checks[route]) {
      check.state = "queued";
      renderCheck(check, route);
    }
    if (reducedMotion.matches) {
      for (const check of checks[route]) check.state = "passed";
      if (route === "hosted")
        minutes += JOBS.reduce((sum, job) => sum + Math.ceil(job.seconds / 60), 0);
      renderRoute();
      renderMinutes();
      return;
    }
    JOBS.forEach((_, index) => spawnPulse(index, elapsed + index * PULSE_GAP_MS));
  }

  function spawnPulse(check: number | null, startedAt: number) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `${trunk.getAttribute("d")} ${branches[route].getAttribute("d")}`);
    const halo = document.createElementNS(SVG_NS, "circle");
    halo.setAttribute("r", check === null ? "0" : "11");
    halo.setAttribute("class", "pulse-halo");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("r", check === null ? "3" : "5.5");
    dot.setAttribute("class", check === null ? "pulse-ambient" : "pulse");
    halo.style.opacity = "0";
    dot.style.opacity = "0";
    const colour = route === "local" ? "var(--go)" : "var(--run)";
    halo.style.fill = colour;
    dot.style.fill = colour;
    pulseLayer.append(halo, dot);
    pulses.push({ path, startedAt, check, route, dot, halo });
  }

  function tick(now: number) {
    frame = 0;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 16;
    lastFrame = now;
    elapsed += dt;

    if (autoFlip && route === "hosted" && elapsed >= AUTO_FLIP_MS) {
      setRoute("local", false);
      autoFlip = false;
    }
    if (elapsed - lastPush >= PUSH_EVERY_MS) {
      lastPush = elapsed;
      push();
    }
    if (elapsed - lastAmbient >= AMBIENT_EVERY_MS) {
      lastAmbient = elapsed;
      spawnPulse(null, elapsed);
    }

    pulses = pulses.filter((pulse) => {
      const progress = (elapsed - pulse.startedAt) / PULSE_MS;
      if (progress < 0) {
        pulse.dot.style.opacity = "0";
        pulse.halo.style.opacity = "0";
        return true;
      }
      if (progress >= 1) {
        pulse.dot.remove();
        pulse.halo.remove();
        if (pulse.check !== null) {
          const check = checks[pulse.route][pulse.check];
          check.state = "running";
          check.startedAt = elapsed;
          renderCheck(check, pulse.route);
        }
        return false;
      }
      const eased = 1 - Math.pow(1 - progress, 2.2);
      const point = pulse.path.getPointAtLength(eased * pulse.path.getTotalLength());
      for (const circle of [pulse.dot, pulse.halo]) {
        circle.setAttribute("cx", point.x.toFixed(1));
        circle.setAttribute("cy", point.y.toFixed(1));
        circle.style.opacity = progress > 0.92 ? String((1 - progress) / 0.08) : "1";
      }
      return true;
    });

    for (const key of ["hosted", "local"] as const) {
      for (const check of checks[key]) {
        if (check.state !== "running") continue;
        if (((elapsed - check.startedAt) / 1000) * SPEED >= check.seconds) {
          check.state = "passed";
          if (key === "hosted") {
            minutes += Math.ceil(check.seconds / 60);
            renderMinutes();
          }
        }
        renderCheck(check, key);
      }
    }

    if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function resume() {
    if (frame || reducedMotion.matches || !visible || document.hidden) return;
    lastFrame = 0;
    frame = requestAnimationFrame(tick);
  }

  for (const button of toggles) {
    button.addEventListener("click", () =>
      setRoute(button.dataset.route === "local" ? "local" : "hosted", true),
    );
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next: Route = route === "local" ? "hosted" : "local";
      setRoute(next, true);
      toggles.find((b) => b.dataset.route === next)?.focus();
    });
  }

  document.addEventListener("route:set", (event) => {
    const next = (event as CustomEvent<Route>).detail;
    setRoute(next, true);
  });

  new ResizeObserver(layout).observe(viz);
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) resume();
  }).observe(viz);
  document.addEventListener("visibilitychange", resume);

  if (reducedMotion.matches) {
    route = "local";
    autoFlip = false;
    cmd.textContent = "relayrunner switch local";
    for (const check of checks.local) check.state = "passed";
  }
  renderRoute();
  renderMinutes();
  layout();
  if (!reducedMotion.matches) {
    push();
    lastPush = 0;
    resume();
  }
}

setupCopy();
setupInlineCopy();
setupHeader();
setupQuota();
setupRouteControls();
setupDemo();
