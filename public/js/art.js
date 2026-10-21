// Hand-built SVG illustrations standing in for photographs.
// Shapes come from a seeded random generator so every render is identical.

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint-displacement ridgeline closed to the bottom edge. */
function ridge({ seed, width, height, base, amp, rough = 0.55, steps = 7, peaks = [] }) {
  const rand = rng(seed);
  const n = 2 ** steps;
  const ys = new Array(n + 1);
  ys[0] = base + (rand() - 0.5) * amp;
  ys[n] = base + (rand() - 0.5) * amp;
  let span = n;
  let a = amp;
  while (span > 1) {
    const half = span / 2;
    for (let i = half; i < n; i += span) {
      ys[i] = (ys[i - half] + ys[i + half]) / 2 + (rand() - 0.5) * a;
    }
    span = half;
    a *= rough;
  }
  // Pull chosen x-positions upward to form named peaks.
  for (const { at, lift, spread } of peaks) {
    for (let i = 0; i <= n; i++) {
      const d = (i / n - at) / spread;
      ys[i] -= lift * Math.exp(-d * d * 4) * (1 - Math.abs(d) * 0.15);
    }
  }
  let d = `M0 ${height} L0 ${ys[0].toFixed(1)}`;
  for (let i = 1; i <= n; i++) d += ` L${((i / n) * width).toFixed(1)} ${ys[i].toFixed(1)}`;
  const top = Math.min(...ys);
  return { d: `${d} L${width} ${height} Z`, top };
}

function trees({ seed, width, baseY, count, minH, maxH, color, jitter = 10 }) {
  const rand = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (i / count) * width + rand() * (width / count);
    const h = minH + rand() * (maxH - minH);
    const w = h * 0.36;
    const y = baseY + rand() * jitter;
    out += `<path d="M${x.toFixed(1)} ${(y - h).toFixed(1)} L${(x + w / 2).toFixed(1)} ${y.toFixed(1)} L${(x - w / 2).toFixed(1)} ${y.toFixed(1)}Z"/>`;
  }
  return `<g fill="${color}">${out}</g>`;
}

/** Sunset mountain range used for page banners. */
export function alpineArt({ width = 1600, height = 240 } = {}) {
  const sky = nextId('sky'), warm = nextId('warm'), sun = nextId('sun'), snow1 = nextId('sn'), snow2 = nextId('sn'), haze = nextId('hz');
  const far = ridge({ seed: 11, width, height, base: height * 0.5, amp: height * 0.42, rough: 0.62, steps: 8, peaks: [{ at: 0.22, lift: height * 0.16, spread: 0.06 }, { at: 0.55, lift: height * 0.2, spread: 0.06 }, { at: 0.68, lift: height * 0.14, spread: 0.05 }, { at: 0.9, lift: height * 0.1, spread: 0.05 }] });
  const mid = ridge({ seed: 23, width, height, base: height * 0.72, amp: height * 0.4, rough: 0.6, steps: 8, peaks: [{ at: 0.4, lift: height * 0.2, spread: 0.06 }, { at: 0.8, lift: height * 0.3, spread: 0.06 }, { at: 0.1, lift: height * 0.12, spread: 0.07 }] });
  const near = ridge({ seed: 37, width, height, base: height * 0.88, amp: height * 0.22, rough: 0.55, peaks: [{ at: 0.36, lift: height * 0.2, spread: 0.1 }, { at: 0.62, lift: height * 0.06, spread: 0.08 }] });
  const front = ridge({ seed: 53, width, height, base: height * 0.96, amp: height * 0.1, rough: 0.6, steps: 8 });
  return `<svg class="art" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f83b8"/><stop offset=".55" stop-color="#a9bfdc"/><stop offset="1" stop-color="#e6dcd4"/></linearGradient>
    <linearGradient id="${warm}" x1="0" y1="0" x2="1" y2="0"><stop offset=".35" stop-color="#ffb46a" stop-opacity="0"/><stop offset="1" stop-color="#ffb46a" stop-opacity=".75"/></linearGradient>
    <radialGradient id="${sun}" cx=".93" cy=".42" r=".3"><stop offset="0" stop-color="#fff3d6"/><stop offset=".25" stop-color="#ffd59a" stop-opacity=".85"/><stop offset="1" stop-color="#ffc483" stop-opacity="0"/></radialGradient>
    <linearGradient id="${snow1}" gradientUnits="userSpaceOnUse" x1="0" y1="${far.top}" x2="0" y2="${far.top + height * 0.42}"><stop offset="0" stop-color="#fbf7f4"/><stop offset=".35" stop-color="#dfe3ec"/><stop offset="1" stop-color="#9fb1cb"/></linearGradient>
    <linearGradient id="${snow2}" gradientUnits="userSpaceOnUse" x1="0" y1="${mid.top}" x2="0" y2="${mid.top + height * 0.5}"><stop offset="0" stop-color="#f1f1f4"/><stop offset=".22" stop-color="#a9b8cf"/><stop offset=".6" stop-color="#6e82a3"/><stop offset="1" stop-color="#55698a"/></linearGradient>
    <linearGradient id="${haze}" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#d9c7bd" stop-opacity="0"/><stop offset="1" stop-color="#d9c7bd" stop-opacity=".5"/></linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#${sky})"/>
  <rect width="${width}" height="${height}" fill="url(#${warm})"/>
  <rect width="${width}" height="${height}" fill="url(#${sun})"/>
  <path d="${far.d}" fill="url(#${snow1})" opacity=".9"/>
  <rect width="${width}" height="${height}" fill="url(#${haze})"/>
  <path d="${mid.d}" fill="url(#${snow2})"/>
  <path d="${near.d}" fill="#4b5c74"/>
  <path d="${near.d}" fill="url(#${warm})" opacity=".45"/>
  ${trees({ seed: 71, width, baseY: height * 0.9, count: 70, minH: height * 0.05, maxH: height * 0.13, color: '#2c3c42', jitter: height * 0.06 })}
  <path d="${front.d}" fill="#26353a"/>
</svg>`;
}

function blossoms(rand, cx, cy, r, count) {
  const pinks = ['#f9d3df', '#f4b6c9', '#fde7ee', '#efa3ba', '#f7c4d3'];
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    const size = 3 + rand() * 7;
    out += `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d * 0.7).toFixed(1)}" r="${size.toFixed(1)}" fill="${pinks[Math.floor(rand() * pinks.length)]}" opacity="${(0.65 + rand() * 0.35).toFixed(2)}"/>`;
  }
  return out;
}

/** Calm sea at golden hour with headland cliffs. */
/** Misty pine forest in layered greens. */
let bannerCache = null;
export const bannerArt = () => (bannerCache ||= alpineArt());
