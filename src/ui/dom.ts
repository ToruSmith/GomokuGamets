import { effect } from '../state/signal.ts';

/**
 * 輕量的宣告式 DOM 建構。屬性或子節點傳函式就會變成響應式：
 *   h('p', { class: () => (on.value ? 'on' : '') }, () => count.value)
 */

type Primitive = string | number | boolean | null | undefined;
export type Child = Primitive | Node | Child[] | (() => Child);
type PropValue = Primitive | (() => Primitive) | EventListener | ((event: never) => void);
export type Props = Record<string, PropValue>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttribute(element: Element, name: string, value: Primitive): void {
  if (name in element && (name === 'value' || name === 'checked' || name === 'disabled')) {
    (element as unknown as Record<string, Primitive>)[name] = value;
    return;
  }
  if (value === null || value === undefined || value === false) element.removeAttribute(name);
  else element.setAttribute(name, value === true ? '' : String(value));
}

function applyProps(element: Element, props: Props | null | undefined): void {
  if (!props) return;
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (typeof value === 'function') {
      const read = value as () => Primitive;
      effect(() => setAttribute(element, name, read()));
    } else {
      setAttribute(element, name, value);
    }
  }
}

/** 第一次渲染時區塊尚未掛到父節點，內容先暫存，等開始標記就位再放入 */
const pendingRegions = new WeakMap<Node, Node[]>();

function place(parent: Node, node: Node, before: Node | null): void {
  parent.insertBefore(node, before);
  const pending = pendingRegions.get(node);
  if (!pending) return;
  pendingRegions.delete(node);
  for (const item of pending) place(parent, item, before);
}

function toNodes(child: Child, out: Node[]): void {
  if (child === null || child === undefined || typeof child === 'boolean') return;
  if (Array.isArray(child)) for (const item of child) toNodes(item, out);
  else if (child instanceof Node) out.push(child);
  else if (typeof child === 'function') {
    // 響應式區塊：用兩個註解節點標記範圍，內容變動時整段替換
    const start = document.createComment('');
    const end = document.createComment('');
    out.push(start, end);
    const read = child as () => Child;
    effect(() => {
      const nodes: Node[] = [];
      toNodes(read(), nodes);
      const parent = start.parentNode;
      if (parent) {
        while (start.nextSibling !== end) parent.removeChild(start.nextSibling as Node);
        for (const node of nodes) place(parent, node, end);
      } else {
        pendingRegions.set(start, nodes);
      }
    });
  } else out.push(document.createTextNode(String(child)));
}

function appendAll(parent: Element, children: Child[]): void {
  const nodes: Node[] = [];
  toNodes(children, nodes);
  for (const node of nodes) place(parent, node, null);
}

export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  applyProps(element, props);
  appendAll(element, children);
  return element;
}

export function s(tag: string, props?: Props | null, ...children: Child[]): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  applyProps(element, props);
  appendAll(element, children);
  return element;
}

export function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}
