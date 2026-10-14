import type { IconData } from './icons.js';

type Child = Node | string | null | false | undefined;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
  class?: string;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
};

/** Tiny element builder: properties, classes, data-*, attributes, children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, data, attrs, ...rest } = props;
  if (cls) el.className = cls;
  if (data) for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.assign(el, rest);
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** Stroke styling lives on the <svg> so CSS (stroke, fill, stroke-width) styles the whole icon. */
const ROOT_ONLY = new Set(['stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'key']);

export function icon(data: IconData, cls?: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(k, v);
  }
  if (cls) svg.setAttribute('class', cls);
  for (const [tag, attrs] of data) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (!ROOT_ONLY.has(k)) el.setAttribute(kebab(k), String(v));
    svg.append(el);
  }
  return svg;
}

/** An <img> that fades in when loaded and logs (rather than hides) a failure. */
export function artImg(src: string, alt: string): HTMLImageElement {
  const img = h('img', { src, alt, draggable: false, class: 'loading' });
  img.addEventListener('load', () => img.classList.remove('loading'));
  img.addEventListener('error', () => console.error(`Artwork failed to load: ${src}`));
  return img;
}
