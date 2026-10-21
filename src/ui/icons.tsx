// Iconos lineales propios (24×24), sin dependencias externas.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.2-4.2",
  plus: "M12 5v14M5 12h14",
  heart: "M12 20s-7-4.4-9.2-8.6C1.2 8.2 3 4.8 6.4 4.5c2-.2 3.7.9 4.6 2.5h2c.9-1.6 2.6-2.7 4.6-2.5 3.4.3 5.2 3.7 3.6 6.9C19 15.6 12 20 12 20z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9c.6-4 3.8-6 8-6s7.4 2 8 6",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  store: "M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11zM5 13v8h14v-8M10 21v-5h4v5",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.4 7.4 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.4 7.4 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 3 2 20h20zM12 10v4m0 3h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-11v6m0-9h.01",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M21 5h-4M5 17v4M7 19H3",
  camera: "M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  pause: "M8 5v14M16 5v14",
  play: "M7 5v14l11-7z",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  share: "M12 3v13M7 8l5-5 5 5M5 14v6h14v-6",
  megaphone: "M3 10v4h3l7 4V6L6 10zM16 9a3 3 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  truck: "M2 6h12v10H2zM14 10h4l4 4v2h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  star: "M12 3l2.8 5.8 6.2.9-4.5 4.3 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.7l6.2-.9z",
  copy: "M8 8h12v12H8zM4 16V4h12",
  logout: "M10 4H4v16h6M15 8l4 4-4 4M19 12H9",
  layers: "M12 3l9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  offer: "M4 4h7l9 9-7 7-9-9zM8 8h.01M14 9l-5 5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  flag: "M5 21V4h11l-2 4 2 4H5",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  menu: "M4 7h16M4 12h16M4 17h16",
  minus: "M5 12h14",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  auto: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  categories: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  block: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, stroke = 1.8, ...rest }: { name: IconName; size?: number; stroke?: number } & Omit<SVGProps<SVGSVGElement>, "stroke" | "size" | "ref">) {
  const fillable = name === "heart" || name === "star";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name]} fill={fillable && rest.fill ? rest.fill : "none"} />
    </svg>
  );
}
