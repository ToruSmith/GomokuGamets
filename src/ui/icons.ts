import { s } from './dom.ts';

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6',
  hint: 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM10 20.5h4',
  flag: 'M6 21V4m0 1c4-2.5 7 2 12 0v9c-5 2-8-2.5-12 0',
  door: 'M14 4H6v16h8M11 12h9m-3-3l3 3-3 3',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12l2-1.2-2-3.5-2.3.7a7 7 0 0 0-1.7-1L14.5 4h-5l-.5 3a7 7 0 0 0-1.7 1L5 7.3 3 10.8 5 12l-2 1.2 2 3.5 2.3-.7a7 7 0 0 0 1.7 1l.5 3h5l.5-3a7 7 0 0 0 1.7-1l2.3.7 2-3.5z',
  help: 'M9.5 9.2a2.6 2.6 0 1 1 3.9 2.3c-.9.6-1.4 1.1-1.4 2.2M12 17.2v.3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  first: 'M6 5v14M18 5l-8 7 8 7',
  prev: 'M16 5l-8 7 8 7',
  next: 'M8 5l8 7-8 7',
  last: 'M18 5v14M6 5l8 7-8 7',
  play: 'M7 4.5l12 7.5-12 7.5z',
  pause: 'M8 5v14M16 5v14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  chart: 'M4 19h16M6 15l4-5 4 3 5-7',
  again: 'M4 12a8 8 0 0 1 14-5.3L20 9m0-5v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
};

export function icon(name: keyof typeof PATHS | string): SVGElement {
  return s(
    'svg',
    { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none' },
    s('path', {
      d: PATHS[name] ?? '',
      stroke: 'currentColor',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}
