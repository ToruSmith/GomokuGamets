import { PUZZLES } from '../../core/puzzle-data.ts';
import { t } from '../../i18n/index.ts';
import { PuzzleMatch } from '../../state/match.ts';
import { solvedPuzzles } from '../../state/records.ts';
import { h } from '../dom.ts';
import { goHome, startMatch } from '../router.ts';
import { pageHeader } from '../widgets.ts';

export function puzzlesView(): HTMLElement {
  return h(
    'div',
    { class: 'page' },
    pageHeader(t('puzzles.title'), goHome),
    h('p', { class: 'lede' }, t('puzzles.intro')),
    h(
      'ol',
      { class: 'puzzle-list' },
      PUZZLES.map((puzzle, index) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'puzzle',
              onClick: () => startMatch(new PuzzleMatch(index)),
            },
            h('span', { class: 'puzzle-name' }, t('puzzles.item', { n: index + 1 })),
            h('span', { class: 'puzzle-limit' }, t('puzzles.limit', { n: puzzle.winIn })),
            () =>
              solvedPuzzles.value.includes(index)
                ? h('span', { class: 'puzzle-solved' }, t('puzzles.solved'))
                : null,
          ),
        ),
      ),
    ),
  );
}
