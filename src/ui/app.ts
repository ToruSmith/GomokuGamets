import { cellName } from '../core/notation.ts';
import { stoneAtPly, BLACK } from '../core/types.ts';
import { t } from '../i18n/index.ts';
import { PlayMatch, PuzzleMatch, ReviewMatch } from '../state/match.ts';
import type { Match } from '../state/match.ts';
import { locale, settings } from '../state/settings.ts';
import { effect, onCleanup, signal } from '../state/signal.ts';
import { BoardView } from './board.ts';
import type { BoardModel } from './board.ts';
import { DEMO_GAME } from './demo-game.ts';
import { h } from './dom.ts';
import { match, openFromHash, route } from './router.ts';
import { homeView } from './views/home.ts';
import { onlineView } from './views/online.ts';
import { playView } from './views/play.ts';
import { puzzlesView } from './views/puzzles.ts';
import { recordsView } from './views/records.ts';
import { helpView, settingsView } from './views/settings.ts';
import { setupView } from './views/setup.ts';

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 首頁棋盤緩慢重播一局棋，播完就停在終盤。 */
const demoPly = signal(0);

function runDemo(): void {
  if (reducedMotion()) {
    demoPly.value = DEMO_GAME.length;
    return;
  }
  demoPly.value = Math.min(demoPly.peek(), DEMO_GAME.length);
  const timer = setInterval(() => {
    if (demoPly.peek() >= DEMO_GAME.length) clearInterval(timer);
    else demoPly.value++;
  }, 1100);
  onCleanup(() => clearInterval(timer));
}

function sealText(active: Match): string | null {
  const result = active instanceof ReviewMatch ? null : active.game.result;
  if (active instanceof ReviewMatch) {
    if (active.cursor.value < active.moves.length) return null;
    const final = active.game.result ?? active.finalResult;
    if (!final) return null;
    return sealFor(final.winner);
  }
  if (active instanceof PuzzleMatch && !active.game.result) return null;
  return result ? sealFor(result.winner) : null;
}

const sealFor = (winner: number | null): string =>
  t(winner === null ? 'seal.draw' : winner === BLACK ? 'seal.black' : 'seal.white');

function modelFor(active: Match | null): BoardModel {
  const { coords, numbers } = settings.value;
  const base = { coords, numbers };
  if (!active) {
    return {
      ...base,
      size: 15,
      moves: DEMO_GAME.slice(0, demoPly.value),
      line: [],
      forbidden: new Map(),
      hint: null,
      suggestion: null,
      interactive: false,
      turn: BLACK,
      seal: null,
      animate: true,
    };
  }
  active.revision.value;
  const interactive = active.acceptsInput() && !active.thinking.value;
  const game = active.game;
  let suggestion: number | null = null;
  if (active instanceof ReviewMatch) {
    active.reviews.value;
    suggestion = active.suggestionAt(active.cursor.value);
  }
  return {
    ...base,
    size: game.size,
    moves: [...game.moves],
    line: game.result?.line ?? [],
    forbidden: interactive ? game.forbiddenCells() : new Map(),
    hint: active.hint.value,
    suggestion,
    interactive,
    turn: game.turn,
    seal: sealText(active),
    animate: !(active instanceof ReviewMatch) || active.playing.peek(),
  };
}

function panel(): Node {
  const current = route.value;
  locale.value;
  switch (current.name) {
    case 'home':
      return homeView();
    case 'setup':
      return setupView(current.mode);
    case 'online':
      return onlineView();
    case 'puzzles':
      return puzzlesView();
    case 'records':
      return recordsView();
    case 'settings':
      return settingsView();
    case 'help':
      return helpView();
    case 'play': {
      const active = match.value;
      return active ? playView(active) : homeView();
    }
  }
}

function bindShortcuts(): void {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as Element).closest('input, textarea, dialog')) return;
    const active = match.peek();
    if (active instanceof PlayMatch) {
      if (event.key === 'u') active.undo();
      if (event.key === 'h') active.showHint();
    } else if (active instanceof PuzzleMatch) {
      if (event.key === 'h') active.showHint();
    } else if (active instanceof ReviewMatch) {
      if (event.key === 'ArrowLeft') active.seek(active.cursor.peek() - 1);
      if (event.key === 'ArrowRight') active.seek(active.cursor.peek() + 1);
    }
  });
}

export function mountApp(root: HTMLElement): void {
  const board = new BoardView(
    {
      onPlay: (cell) => match.peek()?.play(cell),
      touchConfirm: () => settings.peek().touchConfirm,
    },
    '',
  );

  const announcer = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
  const side = h('aside', { class: 'side' }, panel);

  root.append(
    h(
      'main',
      { class: () => (route.value.name === 'play' ? 'app is-playing' : 'app') },
      h('section', { class: 'stage' }, board.element),
      side,
    ),
    announcer,
    h('div', { id: 'toast', class: 'toast', role: 'status' }),
  );

  effect(() => {
    board.update(modelFor(match.value));
  });

  effect(() => {
    document.documentElement.lang = locale.value;
    document.title = t('app.title');
    const size = match.value?.game.size ?? 15;
    board.element.querySelector('svg')?.setAttribute('aria-label', t('board.label', { n: size }));
  });

  effect(() => {
    const { theme, skin } = settings.value;
    const element = document.documentElement;
    if (theme === 'system') element.removeAttribute('data-theme');
    else element.dataset.theme = theme;
    element.dataset.skin = skin;
  });

  effect(() => {
    if (route.value.name === 'home' && !match.value) runDemo();
  });

  // 讀螢幕軟體使用者聽得到每一手
  effect(() => {
    const active = match.value;
    if (!active) return;
    active.revision.value;
    const moves = active.game.moves;
    const last = moves.at(-1);
    if (last === undefined) return;
    announcer.textContent = t('board.announce.move', {
      n: moves.length,
      side: t(stoneAtPly(moves.length - 1) === BLACK ? 'common.black' : 'common.white'),
      cell: cellName(last, active.game.size),
    });
  });

  // 換頁後把焦點移到標題，鍵盤與讀屏使用者才知道畫面換了
  let firstRender = true;
  effect(() => {
    route.value;
    if (firstRender) {
      firstRender = false;
      return;
    }
    queueMicrotask(() => {
      side.scrollTop = 0;
      window.scrollTo(0, 0);
      side.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    });
  });

  bindShortcuts();
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}
