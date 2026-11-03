import { t } from '../../i18n/index.ts';
import type { MessageKey } from '../../i18n/index.ts';
import { PlayMatch, loadSavedGame } from '../../state/match.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { route, startMatch } from '../router.ts';
import type { Route } from '../router.ts';

function entry(
  titleKey: MessageKey,
  hint: string,
  target: () => void,
  primary = false,
): HTMLElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: primary ? 'mode is-primary' : 'mode', onClick: target },
      h('span', { class: 'mode-title' }, t(titleKey)),
      h('span', { class: 'mode-hint' }, hint),
    ),
  );
}

const go = (next: Route) => (): void => {
  route.value = next;
};

export function homeView(): HTMLElement {
  const saved = loadSavedGame();
  return h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'wordmark' },
      h('h1', { class: 'wordmark-title', tabindex: -1 }, t('app.title')),
      h('p', { class: 'wordmark-tagline' }, t('app.tagline')),
    ),
    h(
      'nav',
      { 'aria-label': t('app.title') },
      h(
        'ul',
        { class: 'modes' },
        saved
          ? entry(
              'home.continue',
              t('home.continue.hint', {
                n: saved.moves.length,
                mode: t(saved.kind === 'ai' ? 'home.ai' : 'home.local'),
              }),
              () => startMatch(new PlayMatch(saved)),
              true,
            )
          : null,
        entry('home.ai', t('home.ai.hint'), go({ name: 'setup', mode: 'ai' })),
        entry('home.local', t('home.local.hint'), go({ name: 'setup', mode: 'local' })),
        entry('home.online', t('home.online.hint'), go({ name: 'online' })),
        entry('home.puzzles', t('home.puzzles.hint'), go({ name: 'puzzles' })),
        entry('home.records', t('home.records.hint'), go({ name: 'records' })),
      ),
    ),
    h(
      'footer',
      { class: 'home-footer' },
      h(
        'button',
        { type: 'button', class: 'quiet', onClick: go({ name: 'help' }) },
        icon('help'),
        t('home.help'),
      ),
      h(
        'button',
        { type: 'button', class: 'quiet', onClick: go({ name: 'settings' }) },
        icon('gear'),
        t('home.settings'),
      ),
    ),
  );
}
