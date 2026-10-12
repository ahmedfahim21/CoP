import { createElement, type IconNode } from 'lucide';

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

export function icon(node: IconNode, cls?: string): SVGElement {
  const svg = createElement(node);
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** An <img> that fades in when loaded and logs (rather than hides) a failure. */
export function artImg(src: string, alt: string): HTMLImageElement {
  const img = h('img', { src, alt, draggable: false, class: 'loading' });
  img.addEventListener('load', () => img.classList.remove('loading'));
  img.addEventListener('error', () => console.error(`Artwork failed to load: ${src}`));
  return img;
}
