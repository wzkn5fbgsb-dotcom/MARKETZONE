// Ilustraciones SVG de producto para los datos de DEMOSTRACIÓN (sin marcas ni logotipos reales).
// Formato de URL: art:<tipo>:<color>:<fondo>:<vista>   p. ej. art:hoodie:black:stone:0

const COLORS: Record<string, string> = {
  black: "#1f1f24", white: "#ecebe6", cream: "#e8dfcc", grey: "#8b8f96", heather: "#a9abaf", navy: "#27324b", olive: "#5c6243",
  sand: "#c8b08b", brown: "#6b4a36", crimson: "#b3122f", burgundy: "#6d1b2b", denim: "#4b6688", lightdenim: "#86a1c2",
  pink: "#e2a9b6", lilac: "#b8a8d4", forest: "#2f4a3a", orange: "#d9772b", amber: "#b7752c", gold: "#c9a55d", silver: "#c6c8cc",
  tan: "#b98b5e", teal: "#2f6e72", yellow: "#dfc24b", charcoal: "#3a3b41", rose: "#c98c86",
};

const BACKDROPS: Record<string, [string, string, string]> = {
  stone: ["#e6e2dc", "#d3cdc5", "#c4bdb3"],
  fog: ["#e1e5e8", "#ccd2d7", "#bcc3c9"],
  blush: ["#ecdcd6", "#dbc6be", "#cdb5ac"],
  sage: ["#dde1d4", "#c9cebe", "#b9bfac"],
  noir: ["#2c2c33", "#202026", "#17171b"],
  ember: ["#3b141b", "#2a0d13", "#1c090d"],
};

function hex(c: string) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toHex(r: number, g: number, b: number) { return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join(""); }
function shade(c: string, amt: number) { const [r, g, b] = hex(c); return amt < 0 ? toHex(r * (1 + amt), g * (1 + amt), b * (1 + amt)) : toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt); }
function lum(c: string) { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

type Draw = (c: string, d: string, l: string, k: string) => string;

const round = (pts: string, fill: string, sw = 22) => `<polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;

const DRAW: Record<string, { draw: Draw; box: [number, number, number]; focus: [number, number]; ground: number }> = {
  hoodie: {
    box: [400, 478, 1.15],
    focus: [400, 470], ground: 805,
    draw: (c, d, l, k) => `
      <path d="M318 300 Q400 160 482 300 Q440 336 400 336 Q360 336 318 300Z" fill="${d}"/>
      ${round("300,302 206,352 166,660 236,672 270,420", c)}${round("500,302 594,352 634,660 564,672 530,420", c)}
      ${round("166,662 236,674 232,708 162,696", d, 14)}${round("634,662 564,674 568,708 638,696", d, 14)}
      ${round("292,300 508,300 548,380 552,742 248,742 252,380", c)}
      <path d="M262 380 L248 742 L300 742 L292 400Z" fill="${d}" opacity=".35"/>
      <path d="M538 380 L552 742 L500 742 L508 400Z" fill="${l}" opacity=".25"/>
      ${round("248,742 552,742 552,790 248,790", d, 12)}
      <path d="M346 300 Q400 214 454 300 Q400 320 346 300Z" fill="${shade(d, -0.35)}"/>
      ${round("306,560 494,560 520,690 280,690", d, 10)}
      <path d="M306 560 L280 690 M494 560 L520 690" stroke="${shade(d, -0.2)}" stroke-width="4"/>
      <path d="M382 318 L376 440 M418 318 L424 440" stroke="${k}" stroke-width="7" stroke-linecap="round"/>
      <rect x="370" y="436" width="12" height="22" rx="4" fill="${shade(k, -0.2)}"/><rect x="418" y="436" width="12" height="22" rx="4" fill="${shade(k, -0.2)}"/>`,
  },
  tee: {
    box: [400, 529, 1.3],
    focus: [400, 420], ground: 790,
    draw: (c, d, l, k) => `
      ${round("300,300 204,346 178,470 250,490 276,404", c)}${round("500,300 596,346 622,470 550,490 524,404", c)}
      ${round("292,298 508,298 540,380 546,760 254,760 260,380", c)}
      <path d="M262 380 L254 760 L298 760 L290 404Z" fill="${d}" opacity=".3"/>
      <path d="M344 298 Q400 352 456 298" fill="none" stroke="${d}" stroke-width="16" stroke-linecap="round"/>
      <path d="M344 298 Q400 336 456 298" fill="${shade(d, -0.3)}"/>
      <g opacity=".95"><circle cx="400" cy="470" r="62" fill="${k}"/><rect x="330" y="552" width="140" height="14" rx="7" fill="${k}"/><rect x="352" y="576" width="96" height="10" rx="5" fill="${k}" opacity=".7"/></g>`,
  },
  jacket: {
    box: [400, 535, 1.28],
    focus: [400, 400], ground: 800,
    draw: (c, d, l, k) => `
      ${round("298,300 204,350 172,676 244,688 274,420", c)}${round("502,300 596,350 628,676 556,688 526,420", c)}
      ${round("172,676 244,688 240,716 168,704", d, 12)}${round("628,676 556,688 560,716 632,704", d, 12)}
      ${round("290,298 510,298 546,380 550,770 250,770 254,380", c)}
      <path d="M290 298 L360 300 L400 420 L440 300 L510 298 L470 330 L400 470 L330 330Z" fill="${d}"/>
      <path d="M400 420 L400 770" stroke="${shade(d, -0.25)}" stroke-width="6"/>
      ${[470, 540, 610, 680].map((y) => `<circle cx="414" cy="${y}" r="9" fill="${k}"/>`).join("")}
      ${round("296,430 370,430 368,500 298,500", d, 8)}${round("504,430 430,430 432,500 502,500", d, 8)}
      <path d="M262 380 L250 770 L300 770 L292 400Z" fill="${d}" opacity=".3"/>
      ${round("250,740 550,740 550,772 250,772", d, 8)}`,
  },
  pants: {
    box: [400, 515, 1.2],
    focus: [400, 520], ground: 830,
    draw: (c, d, l, k) => `
      ${round("292,222 508,222 508,262 292,262", d, 12)}
      ${round("292,262 400,262 392,812 312,812", c)}${round("508,262 400,262 408,812 488,812", c)}
      <path d="M400 262 L396 520" stroke="${d}" stroke-width="5"/>
      ${round("282,470 340,470 336,590 286,590", d, 10)}${round("518,470 460,470 464,590 514,590", d, 10)}
      <path d="M286 500 L338 500 M514 500 L462 500" stroke="${shade(d, -0.3)}" stroke-width="4"/>
      ${[320, 360, 440, 480].map((x) => `<rect x="${x - 6}" y="216" width="12" height="52" rx="4" fill="${shade(d, -0.2)}"/>`).join("")}
      <path d="M312 812 L392 812" stroke="${shade(d, -0.2)}" stroke-width="10"/><path d="M408 812 L488 812" stroke="${shade(d, -0.2)}" stroke-width="10"/>`,
  },
  dress: {
    box: [400, 500, 1.2],
    focus: [400, 380], ground: 820,
    draw: (c, d, l, k) => `
      <path d="M346 210 L356 300 M454 210 L444 300" stroke="${d}" stroke-width="10" stroke-linecap="round"/>
      ${round("338,300 462,300 474,420 326,420", c)}
      ${round("326,420 474,420 572,790 228,790", c)}
      <path d="M326 420 L474 420" stroke="${d}" stroke-width="12"/>
      <path d="M360 430 L300 790 M400 430 L400 790 M440 430 L500 790" stroke="${d}" stroke-width="5" opacity=".45"/>
      <path d="M356 300 Q400 330 444 300" fill="${d}"/>`,
  },
  sneaker: {
    box: [412, 596, 1.3],
    focus: [470, 560], ground: 742,
    draw: (c, d, l, k) => `
      <path d="M186 678 Q176 716 206 732 L612 734 Q648 730 648 698 L646 676 Z" fill="#f1efea"/>
      <path d="M200 720 L630 722" stroke="#d9d5cc" stroke-width="6"/>
      <path d="M190 734 L640 734 L640 744 Q420 752 196 744Z" fill="${shade(d, -0.4)}"/>
      <path d="M188 680 Q182 618 240 598 L362 556 Q402 498 470 480 L560 470 Q612 468 626 520 L642 680 Z" fill="${c}"/>
      <path d="M188 680 Q186 624 244 604 L302 588 Q292 640 302 680 Z" fill="${d}"/>
      <path d="M560 470 Q612 468 626 520 L642 680 L586 680 Q592 560 560 470Z" fill="${d}"/>
      <path d="M326 646 Q430 560 566 540 L572 578 Q452 594 352 664Z" fill="${k}"/>
      <path d="M468 482 Q518 452 560 470 Q542 494 500 498Z" fill="${shade(d, -0.45)}"/>
      <path d="M452 486 Q468 432 502 440 L512 470Z" fill="${l}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${384 + i * 20}" y="${540 - i * 13}" width="34" height="9" rx="4" fill="#f4f2ee" transform="rotate(-28 ${400 + i * 20} ${545 - i * 13})"/>`).join("")}
      <rect x="600" y="476" width="20" height="44" rx="6" fill="${k}"/>`,
  },
  cap: {
    box: [450, 517, 1.3],
    focus: [420, 470], ground: 690,
    draw: (c, d, l, k) => `
      <path d="M250 560 Q252 382 420 360 Q590 370 602 560Z" fill="${c}"/>
      <path d="M420 360 Q384 450 382 566 M420 360 Q470 450 500 566 M420 360 Q300 420 280 560" fill="none" stroke="${d}" stroke-width="5"/>
      <path d="M252 560 Q252 440 330 400 Q300 470 300 560Z" fill="${d}" opacity=".35"/>
      <circle cx="420" cy="362" r="12" fill="${d}"/>
      <rect x="350" y="470" width="96" height="46" rx="8" fill="${k}" transform="rotate(-3 398 493)"/>
      <path d="M238 560 Q420 600 642 572 Q706 600 652 642 Q430 684 250 624Z" fill="${d}"/>
      <path d="M250 600 Q430 640 640 606" fill="none" stroke="${shade(d, -0.3)}" stroke-width="4"/>`,
  },
  sunglasses: {
    box: [400, 522, 1.12],
    focus: [400, 520], ground: 640,
    draw: (c, d, l, k) => `
      <defs><linearGradient id="lens" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${shade(k, -0.2)}"/><stop offset="1" stop-color="${shade(k, -0.6)}"/></linearGradient></defs>
      <path d="M200 500 L120 470 M600 500 L680 470" stroke="${d}" stroke-width="14" stroke-linecap="round"/>
      <rect x="196" y="452" width="190" height="140" rx="58" fill="url(#lens)" stroke="${c}" stroke-width="18"/>
      <rect x="414" y="452" width="190" height="140" rx="58" fill="url(#lens)" stroke="${c}" stroke-width="18"/>
      <path d="M386 488 Q400 470 414 488" fill="none" stroke="${c}" stroke-width="16"/>
      <path d="M226 482 Q260 470 300 474" stroke="#fff" stroke-opacity=".35" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M444 482 Q478 470 518 474" stroke="#fff" stroke-opacity=".35" stroke-width="10" stroke-linecap="round" fill="none"/>`,
  },
  tote: {
    box: [400, 535, 1.2],
    focus: [400, 560], ground: 812,
    draw: (c, d, l, k) => `
      <path d="M318 430 Q318 270 400 270 Q482 270 482 430" fill="none" stroke="${d}" stroke-width="20"/>
      <path d="M338 430 Q338 300 400 300 Q462 300 462 430" fill="none" stroke="${shade(d, -0.2)}" stroke-width="10"/>
      ${round("262,422 538,422 566,800 234,800", c, 16)}
      <path d="M262 422 L234 800 L280 800 L292 440Z" fill="${d}" opacity=".3"/>
      <rect x="318" y="560" width="164" height="110" rx="10" fill="${k}" opacity=".9"/>
      <path d="M262 470 L538 470" stroke="${d}" stroke-width="6"/>`,
  },
  crossbody: {
    box: [400, 485, 1.2],
    focus: [400, 600], ground: 770,
    draw: (c, d, l, k) => `
      <path d="M268 520 Q300 210 400 214 Q500 210 532 520" fill="none" stroke="${shade(d, -0.15)}" stroke-width="16"/>
      <rect x="248" y="500" width="304" height="250" rx="44" fill="${c}"/>
      <path d="M248 548 Q248 500 292 500 L508 500 Q552 500 552 548 L552 640 Q400 694 248 640Z" fill="${d}"/>
      <rect x="380" y="628" width="40" height="34" rx="7" fill="${k}"/>
      <path d="M266 730 Q400 760 534 730" stroke="${shade(c, -0.25)}" stroke-width="5" fill="none"/>`,
  },
  serum: {
    box: [400, 559, 1.3],
    focus: [400, 600], ground: 806,
    draw: (c, d, l, k) => `
      <ellipse cx="400" cy="370" rx="40" ry="54" fill="#1b1b1f"/>
      <rect x="368" y="408" width="64" height="56" rx="8" fill="#26262c"/>
      <rect x="338" y="458" width="124" height="344" rx="32" fill="${c}" opacity=".92"/>
      <rect x="350" y="600" width="100" height="150" rx="8" fill="${k}"/>
      <rect x="366" y="626" width="68" height="10" rx="5" fill="${shade(k, -0.5)}"/><rect x="366" y="648" width="48" height="8" rx="4" fill="${shade(k, -0.35)}"/>
      <rect x="352" y="480" width="16" height="300" rx="8" fill="#fff" opacity=".25"/>`,
  },
  perfume: {
    box: [400, 592, 1.3],
    focus: [400, 600], ground: 806,
    draw: (c, d, l, k) => `
      <rect x="350" y="380" width="100" height="96" rx="10" fill="${k}"/>
      <rect x="378" y="468" width="44" height="24" fill="${shade(k, -0.3)}"/>
      <rect x="290" y="488" width="220" height="316" rx="26" fill="${c}" opacity=".55"/>
      <rect x="306" y="560" width="188" height="228" rx="16" fill="${c}" opacity=".85"/>
      <rect x="350" y="620" width="100" height="56" rx="6" fill="#f3efe8" opacity=".9"/>
      <rect x="306" y="500" width="22" height="280" rx="11" fill="#fff" opacity=".3"/>`,
  },
  watch: {
    box: [400, 500, 1.1],
    focus: [400, 500], ground: 840,
    draw: (c, d, l, k) => `
      <rect x="352" y="160" width="96" height="680" rx="26" fill="${c}"/>
      ${[230, 280, 720, 770].map((y) => `<rect x="392" y="${y}" width="16" height="10" rx="4" fill="${d}"/>`).join("")}
      <circle cx="400" cy="500" r="128" fill="${k}"/><circle cx="400" cy="500" r="104" fill="${shade(k, -0.75)}"/>
      ${Array.from({ length: 12 }, (_, i) => `<rect x="397" y="404" width="6" height="${i % 3 ? 10 : 20}" fill="${shade(k, 0.2)}" transform="rotate(${i * 30} 400 500)"/>`).join("")}
      <path d="M400 500 L400 430 M400 500 L452 520" stroke="#f2f2f2" stroke-width="7" stroke-linecap="round"/>
      <circle cx="400" cy="500" r="8" fill="#e33"/><rect x="524" y="486" width="22" height="28" rx="5" fill="${k}"/>`,
  },
};

const cache = new Map<string, string>();

export function artSvg(spec: string): string {
  const [, kind = "tee", color = "black", backdrop = "stone", view = "0", accent = ""] = spec.split(":");
  const def = DRAW[kind] ?? DRAW.tee;
  const c = COLORS[color] ?? color;
  const d = shade(c, lum(c) > 0.75 ? -0.14 : -0.24);
  const l = shade(c, 0.18);
  const k = accent && COLORS[accent] ? COLORS[accent] : lum(c) > 0.55 ? "#1f1f24" : "#ecebe6";
  const v = Number(view) || 0;
  const alt = backdrop === "noir" || backdrop === "ember" || lum(c) < 0.3 ? (backdrop === "fog" ? "stone" : "fog") : "noir";
  const bd = BACKDROPS[v === 2 ? alt : backdrop] ?? BACKDROPS.stone;
  const item = def.draw(c, d, l, k);
  const [fx, fy] = def.focus;
  const [cx, cy, sc] = def.box;
  const transform = v === 1 ? `translate(400 500) scale(${sc * 1.85}) translate(${-fx} ${-fy})`
    : v === 2 ? `rotate(-7 400 520) translate(400 530) scale(${sc * 0.95}) translate(${-cx} ${-cy})`
    : `translate(400 520) scale(${sc}) translate(${-cx} ${-cy})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
<defs><linearGradient id="wall" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${bd[0]}"/><stop offset=".72" stop-color="${bd[1]}"/><stop offset="1" stop-color="${bd[2]}"/></linearGradient>
<radialGradient id="sh"><stop offset="0" stop-color="#000" stop-opacity=".32"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="1000" fill="url(#wall)"/>
<g transform="${transform}"><ellipse cx="400" cy="${def.ground}" rx="250" ry="34" fill="url(#sh)"/>${item}</g>
${v === 2 ? `<g transform="rotate(8 640 210)"><path d="M590 150 h110 a10 10 0 0 1 10 10 v120 a10 10 0 0 1 -10 10 h-110 l-30 -70z" fill="#f6f3ec"/><circle cx="582" cy="220" r="7" fill="${bd[1]}"/><rect x="604" y="190" width="86" height="10" rx="5" fill="#2b2b30"/><rect x="604" y="212" width="60" height="8" rx="4" fill="#9a9aa2"/><rect x="604" y="236" width="74" height="16" rx="3" fill="#DC143C"/></g>` : ""}
</svg>`;
}

export function artDataUri(spec: string): string {
  let uri = cache.get(spec);
  if (!uri) {
    uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(artSvg(spec));
    cache.set(spec, uri);
  }
  return uri;
}

/** Fondo CSS que continúa la pared de una ilustración (para mostrarla completa sin recortes). */
export function artBackdropCss(spec: string): string {
  const [, , , backdrop = "stone"] = spec.split(":");
  const bd = BACKDROPS[backdrop] ?? BACKDROPS.stone;
  return `linear-gradient(180deg, ${bd[0]} 0%, ${bd[1]} 72%, ${bd[2]} 100%)`;
}
