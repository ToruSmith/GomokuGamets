import { AI_LEVELS } from '../../ai/levels.ts';
import { DEFAULT_CONFIG } from '../../core/game.ts';
import { decodeRecord, movesFromText } from '../../core/notation.ts';
import { BLACK } from '../../core/types.ts';
import { t } from '../../i18n/index.ts';
import { ReviewMatch } from '../../state/match.ts';
import { gameLogs, removeGameLog, statsByLevel } from '../../state/records.ts';
import type { GameLog } from '../../state/records.ts';
import { signal } from '../../state/signal.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { goHome, openRecord, startMatch } from '../router.ts';
import { button, confirmDialog, pageHeader, section } from '../widgets.ts';

function opponentLabel(log: GameLog): string {
  if (log.kind === 'ai') {
    return t('player.computer', { level: t(`level.${log.level ?? 'medium'}`) });
  }
  if (log.kind === 'online') return t('records.vs', { name: log.opponent ?? t('player.opponent') });
  return t('home.local');
}

function resultLabel(log: GameLog): string {
  if (log.winner === null) return t('records.result.draw');
  if (log.human) return t(log.winner === log.human ? 'records.result.win' : 'records.result.lose');
  return t(log.winner === BLACK ? 'records.result.black' : 'records.result.white');
}

function logRow(log: GameLog): HTMLElement {
  const date = new Date(log.playedAt).toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
  });
  return h(
    'li',
    { class: 'log' },
    h(
      'button',
      {
        type: 'button',
        class: 'log-open',
        onClick: () =>
          startMatch(
            new ReviewMatch({ size: log.size, rule: log.rule }, log.moves, log.human, {
              winner: log.winner,
              reason: log.reason,
              line: [],
            }),
          ),
      },
      h(
        'span',
        { class: `log-result${log.human && log.winner === log.human ? ' is-win' : ''}` },
        resultLabel(log),
      ),
      h('span', { class: 'log-name' }, opponentLabel(log)),
      h('span', { class: 'log-meta' }, `${date}  ${t('records.moves', { n: log.moves.length })}`),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': t('common.delete'),
        onClick: async () => {
          if (await confirmDialog(t('confirm.deleteRecord'), t('common.delete'))) {
            removeGameLog(log.id);
          }
        },
      },
      icon('trash'),
    ),
  );
}

export function recordsView(): HTMLElement {
  const text = signal('');
  const error = signal('');
  const open = (): void => {
    const raw = text.peek().trim();
    const fromLink = decodeRecord(raw.split('#/g/').at(-1) ?? raw);
    if (fromLink) {
      openRecord(fromLink);
      return;
    }
    const moves = movesFromText(raw, DEFAULT_CONFIG);
    if (moves?.length) openRecord({ ...DEFAULT_CONFIG, moves });
    else error.value = t('records.importError');
  };
  return h(
    'div',
    { class: 'page' },
    pageHeader(t('records.title'), goHome),
    () => {
      const stats = statsByLevel(gameLogs.value);
      if (stats.size === 0) return null;
      return section(
        t('records.vsLevel'),
        h(
          'table',
          { class: 'stats' },
          h(
            'tbody',
            null,
            AI_LEVELS.filter((level) => stats.has(level)).map((level) => {
              const entry = stats.get(level) ?? { wins: 0, losses: 0 };
              return h(
                'tr',
                null,
                h('th', { scope: 'row' }, t(`level.${level}`)),
                h('td', null, t('records.winrate', { ...entry })),
              );
            }),
          ),
        ),
      );
    },
    () => {
      const logs = gameLogs.value;
      return logs.length === 0
        ? h('p', { class: 'note' }, t('records.empty'))
        : h('ul', { class: 'logs' }, logs.map(logRow));
    },
    section(
      t('records.import'),
      h('textarea', {
        class: 'input',
        rows: 3,
        placeholder: t('records.importHint'),
        'aria-label': t('records.importHint'),
        onInput: (event: Event) => {
          text.value = (event.target as HTMLTextAreaElement).value;
          error.value = '';
        },
      }),
      () => (error.value ? h('p', { class: 'error', role: 'alert' }, error.value) : null),
      button(null, t('records.importButton'), open, { class: 'button' }),
    ),
  );
}
