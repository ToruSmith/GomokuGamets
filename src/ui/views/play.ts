import { cellName, encodeRecord, movesToText } from '../../core/notation.ts';
import { PUZZLES } from '../../core/puzzle-data.ts';
import type { Stone } from '../../core/types.ts';
import { BLACK, WHITE, stoneAtPly } from '../../core/types.ts';
import { t } from '../../i18n/index.ts';
import { OnlineMatch, PlayMatch, PuzzleMatch, ReviewMatch } from '../../state/match.ts';
import type { Match } from '../../state/match.ts';
import { effect, onCleanup, signal } from '../../state/signal.ts';
import { chanceChart } from '../chance-chart.ts';
import { h } from '../dom.ts';
import type { Child } from '../dom.ts';
import { downloadBoardImage } from '../export.ts';
import { icon } from '../icons.ts';
import { goHome, route, setHash, startMatch } from '../router.ts';
import { button, confirmDialog, copyText, section, toast } from '../widgets.ts';

/** 單檔試玩版沒有穩定網址，也不能下載檔案 */
declare const __DEMO__: boolean;

export const REACTIONS = ['👍', '😄', '😮', '🤔', '😅', '🔥', '👏', '🙏'];

const sideName = (stone: Stone): string => t(stone === BLACK ? 'common.black' : 'common.white');

function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function nameOf(match: Match, stone: Stone): string {
  if (match instanceof OnlineMatch) {
    const view = match.view.value;
    const seat = stone === BLACK ? 'black' : 'white';
    return view?.room.players[seat]?.name ?? '…';
  }
  if (match instanceof PlayMatch && match.kind === 'ai') {
    return stone === match.human
      ? t('player.you')
      : t('player.computer', { level: t(`level.${match.level ?? 'medium'}`) });
  }
  return sideName(stone);
}

function playerRow(match: Match, stone: Stone): HTMLElement {
  return h(
    'div',
    {
      class: () => {
        match.revision.value;
        const game = match.game;
        return `player${!game.result && game.turn === stone ? ' is-turn' : ''}`;
      },
    },
    h('span', {
      class: `stone-chip ${stone === BLACK ? 'black' : 'white'}`,
      'aria-hidden': 'true',
    }),
    h('span', { class: 'player-name' }, () => {
      match.revision.value;
      return nameOf(match, stone);
    }),
    match instanceof PlayMatch
      ? () => {
          const clocks = match.clocks.value;
          return clocks
            ? h(
                'span',
                { class: `clock${clocks[stone] < 30_000 ? ' is-low' : ''}` },
                formatClock(clocks[stone]),
              )
            : null;
        }
      : null,
    match instanceof OnlineMatch
      ? () => {
          const seat = stone === BLACK ? 'black' : 'white';
          const reaction = match.lastReaction.value;
          return reaction?.seat === seat
            ? h('span', { class: 'reaction' }, REACTIONS[reaction.emoji] ?? '')
            : null;
        }
      : null,
  );
}

/** 目前狀態的一句話 */
function statusLine(match: Match): string {
  match.revision.value;
  const game = match.game;
  const result = game.result;
  const human = match.human;
  if (result) {
    if (result.winner === null) return t('status.draw');
    if (human) return t(result.winner === human ? 'status.win.you' : 'status.lose.you');
    return t('status.win.side', { side: sideName(result.winner) });
  }
  if (match.thinking.value) return t('status.thinking');
  if (match instanceof OnlineMatch) {
    const view = match.view.value;
    if (!view) return t('online.connecting');
    if (!view.opponentJoined) return t('status.waiting');
    if (!view.seat) return t('status.spectating');
    if (!view.opponentOnline) return t('status.opponentAway');
    return t(view.myTurn ? 'status.yourTurn' : 'status.opponentTurn');
  }
  if (human) return t(game.turn === human ? 'status.yourTurn' : 'status.opponentTurn');
  return t('status.turn', { side: sideName(game.turn) });
}

function reasonLine(match: Match): string | null {
  match.revision.value;
  const result = match.game.result;
  if (!result || result.reason === 'draw') return null;
  if (result.reason === 'resign') {
    const iLost = match.human !== null && result.winner !== match.human;
    return t(iLost ? 'status.reason.selfResign' : 'status.reason.resign');
  }
  return t(`status.reason.${result.reason}`);
}

function noticeLine(match: Match): HTMLElement {
  return h('p', { class: 'notice' }, () => {
    const notice = match.notice.value;
    return notice && notice !== 'occupied' && notice !== 'over' && notice !== 'out-of-bounds'
      ? t(`forbidden.${notice}`)
      : null;
  });
}

function moveList(
  match: Match,
  options: {
    moves: () => readonly number[];
    onPick?: (ply: number) => void;
    current?: () => number;
  },
): HTMLElement {
  const list = h('ol', { class: 'moves', 'aria-label': t('moves.title') }, () => {
    const moves = options.moves();
    const size = match.game.size;
    const review = match instanceof ReviewMatch ? match.reviews.value : null;
    const current = options.current?.();
    if (moves.length === 0) return h('li', { class: 'moves-empty' }, t('moves.empty'));
    return moves.map((move, ply) => {
      const quality = review?.[ply]?.quality;
      const flagged = quality === 'blunder' || quality === 'missed-win' || quality === 'inaccuracy';
      return h(
        'li',
        { class: `move${current === ply + 1 ? ' is-current' : ''}` },
        h(
          options.onPick ? 'button' : 'span',
          {
            class: 'move-entry',
            ...(options.onPick ? { type: 'button', onClick: () => options.onPick?.(ply + 1) } : {}),
          },
          h('span', { class: 'move-number' }, ply + 1),
          h('span', {
            class: `stone-chip small ${stoneAtPly(ply) === BLACK ? 'black' : 'white'}`,
            'aria-hidden': 'true',
          }),
          h('span', { class: 'move-name' }, cellName(move, size)),
          flagged ? h('span', { class: `move-flag ${quality}` }, t(`quality.${quality}`)) : null,
        ),
      );
    });
  });
  effect(() => {
    options.moves();
    options.current?.();
    queueMicrotask(() => {
      const target = list.querySelector('.is-current') ?? list.lastElementChild;
      target?.scrollIntoView({ block: 'nearest' });
    });
  });
  return list;
}

function resultActions(match: PlayMatch | OnlineMatch): HTMLElement {
  const game = (): typeof match.game => match.game;
  const share = async (): Promise<void> => {
    const url = `${location.origin}${location.pathname}#/g/${encodeRecord({
      ...game().config,
      moves: [...game().moves],
    })}`;
    toast(t((await copyText(url)) ? 'common.copied' : 'toast.copyFailed'));
  };
  return h(
    'div',
    { class: 'button-stack' },
    match instanceof PlayMatch
      ? button('again', t('action.again'), () => startMatch(new PlayMatch(match.againOptions)), {
          class: 'button is-primary',
        })
      : null,
    button('chart', t('action.review'), () => {
      const current = game();
      startMatch(new ReviewMatch(current.config, [...current.moves], match.human, current.result));
    }),
    __DEMO__ ? null : button('link', t('action.share'), () => void share()),
    __DEMO__
      ? null
      : button('image', t('action.image'), () => {
          void downloadBoardImage(game(), 'gomoku.png').then(() => toast(t('toast.imageSaved')));
        }),
  );
}

function header(title: Child, onLeave: () => void): HTMLElement {
  return h(
    'header',
    { class: 'page-header' },
    h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        onClick: onLeave,
        'aria-label': t('action.leave'),
      },
      icon('back'),
    ),
    h('h1', { class: 'page-title', tabindex: -1 }, title),
  );
}

function localPanel(match: PlayMatch): HTMLElement {
  const leave = async (): Promise<void> => {
    // 無時限的對局會自動保存，直接離開沒有損失
    const mustConfirm = match.clocks.peek() !== null && !match.game.result;
    if (!mustConfirm || (await confirmDialog(t('confirm.leave'), t('action.leave')))) goHome();
  };
  const resign = async (): Promise<void> => {
    if (await confirmDialog(t('confirm.resign'), t('action.resign'))) match.resign();
  };
  return h(
    'div',
    { class: 'page' },
    header(t(match.kind === 'ai' ? 'home.ai' : 'home.local'), () => void leave()),
    h('div', { class: 'players' }, playerRow(match, BLACK), playerRow(match, WHITE)),
    h('p', { class: 'status', role: 'status' }, () => statusLine(match)),
    h('p', { class: 'status-reason' }, () => reasonLine(match)),
    noticeLine(match),
    () => {
      match.revision.value;
      if (match.game.result) return resultActions(match);
      return h(
        'div',
        { class: 'toolbar' },
        button('undo', t('action.undo'), () => match.undo(), {
          disabled: () => {
            match.revision.value;
            return !match.canUndo();
          },
        }),
        button('hint', t('action.hint'), () => match.showHint(), {
          disabled: () => match.thinking.value || match.hint.value !== null,
        }),
        button('flag', t('action.resign'), () => void resign()),
      );
    },
    section(
      t('moves.title'),
      moveList(match, {
        moves: () => {
          match.revision.value;
          return [...match.game.moves];
        },
      }),
    ),
  );
}

function puzzlePanel(match: PuzzleMatch): HTMLElement {
  const puzzle = PUZZLES[match.index];
  const limit = t('puzzles.limit', { n: puzzle?.winIn ?? 0 });
  const nextIndex = match.index + 1;
  return h(
    'div',
    { class: 'page' },
    header(t('puzzles.item', { n: match.index + 1 }), () => {
      match.dispose();
      route.value = { name: 'puzzles' };
    }),
    h('p', { class: 'status' }, () => {
      match.revision.value;
      match.thinking.value;
      if (match.solved) return t('puzzles.success');
      if (match.failed) return t('puzzles.failure');
      return t('puzzles.side', { side: sideName(match.solver), limit });
    }),
    h('p', { class: 'status-reason' }, () => {
      match.revision.value;
      return match.solved || match.failed ? null : t('puzzles.left', { n: match.left.value });
    }),
    () => {
      match.revision.value;
      match.thinking.value;
      return h(
        'div',
        { class: 'button-stack' },
        match.solved && PUZZLES[nextIndex]
          ? button('next', t('puzzles.next'), () => startMatch(new PuzzleMatch(nextIndex)), {
              class: 'button is-primary',
            })
          : null,
        match.failed
          ? button('again', t('puzzles.retry'), () => startMatch(new PuzzleMatch(match.index)), {
              class: 'button is-primary',
            })
          : null,
        !match.solved && !match.failed
          ? button('hint', t('action.hint'), () => match.showHint(), {
              disabled: () => match.thinking.value || match.hint.value !== null,
            })
          : null,
        !match.solved && !match.failed
          ? button('again', t('puzzles.retry'), () => startMatch(new PuzzleMatch(match.index)))
          : null,
      );
    },
  );
}

function onlinePanel(match: OnlineMatch): HTMLElement {
  const rematchSent = signal(false);
  const leave = async (): Promise<void> => {
    const view = match.view.peek();
    const inProgress = view && !view.game.result && view.seat;
    if (!inProgress || (await confirmDialog(t('confirm.leaveOnline'), t('action.leave')))) {
      goHome();
    }
  };
  const resign = async (): Promise<void> => {
    if (await confirmDialog(t('confirm.resign'), t('action.resign'))) match.resign();
  };
  const invite = async (code: string): Promise<void> => {
    const url = `${location.origin}${location.pathname}#/r/${code}`;
    toast(t((await copyText(url)) ? 'common.copied' : 'toast.copyFailed'));
  };

  // 再戰後換到新房間，網址也要跟著換
  effect(() => {
    const view = match.view.value;
    if (view) setHash(`/r/${view.code}`);
    if (view && !view.game.result) rematchSent.value = false;
  });

  // 表情顯示幾秒後收起
  effect(() => {
    if (!match.lastReaction.value) return;
    const timer = setTimeout(() => {
      match.lastReaction.value = null;
    }, 3000);
    onCleanup(() => clearTimeout(timer));
  });

  return h(
    'div',
    { class: 'page' },
    header(
      () => {
        const view = match.view.value;
        return view ? t('online.room', { code: view.code }) : t('online.connecting');
      },
      () => void leave(),
    ),
    () =>
      match.closed.value ? h('p', { class: 'error', role: 'alert' }, t('online.roomClosed')) : null,
    h('div', { class: 'players' }, playerRow(match, BLACK), playerRow(match, WHITE)),
    h('p', { class: 'status', role: 'status' }, () => statusLine(match)),
    h('p', { class: 'status-reason' }, () => reasonLine(match)),
    noticeLine(match),
    () => {
      const view = match.view.value;
      if (!view) return null;
      if (!view.opponentJoined) {
        return h(
          'div',
          { class: 'invite' },
          h('p', { class: 'room-code' }, view.code),
          h('p', { class: 'field-hint' }, t('online.inviteHint')),
          button('link', t('online.invite'), () => void invite(view.code), {
            class: 'button is-primary',
          }),
        );
      }
      if (view.game.result) {
        const opponentAsked =
          view.seat && view.room.rematch?.[view.seat === 'black' ? 'white' : 'black'];
        return h(
          'div',
          { class: 'button-stack' },
          view.seat
            ? button(
                'again',
                t(
                  rematchSent.value
                    ? 'action.rematchWaiting'
                    : opponentAsked
                      ? 'action.rematchIncoming'
                      : 'action.rematch',
                ),
                () => {
                  rematchSent.value = true;
                  match.rematch();
                },
                { class: 'button is-primary', disabled: rematchSent.value },
              )
            : null,
          resultActions(match),
        );
      }
      return view.seat
        ? [
            h(
              'div',
              { class: 'reactions', role: 'group', 'aria-label': t('online.react') },
              REACTIONS.map((emoji, index) =>
                h(
                  'button',
                  { type: 'button', class: 'reaction-button', onClick: () => match.react(index) },
                  emoji,
                ),
              ),
            ),
            h(
              'div',
              { class: 'toolbar' },
              button('flag', t('action.resign'), () => void resign()),
            ),
          ]
        : null;
    },
    section(
      t('moves.title'),
      moveList(match, {
        moves: () => {
          match.revision.value;
          return [...match.game.moves];
        },
      }),
    ),
  );
}

function reviewPanel(match: ReviewMatch): HTMLElement {
  const total = match.moves.length;
  const transport = (name: string, label: string, onClick: () => void): HTMLElement =>
    h(
      'button',
      { type: 'button', class: 'icon-button', 'aria-label': label, title: label, onClick },
      icon(name),
    );
  const continueHere = (): void => {
    const ply = match.cursor.peek();
    startMatch(
      new PlayMatch({
        kind: 'local',
        config: match.config,
        moves: match.moves.slice(0, ply),
      }),
    );
  };
  return h(
    'div',
    { class: 'page' },
    header(t('review.title'), goHome),
    h('p', { class: 'status' }, () => t('review.position', { n: match.cursor.value, total })),
    h('p', { class: 'status-reason' }, () => {
      const ply = match.cursor.value;
      const reviews = match.reviews.value;
      const suggestion = reviews?.[ply]?.suggestion;
      return suggestion === undefined
        ? null
        : t('review.suggestion', { cell: cellName(suggestion, match.config.size) });
    }),
    h('input', {
      class: 'scrubber',
      type: 'range',
      min: 0,
      max: total,
      'aria-label': t('review.position', { n: '', total }),
      value: () => match.cursor.value,
      onInput: (event: Event) => match.seek(Number((event.target as HTMLInputElement).value)),
    }),
    h(
      'div',
      { class: 'transport' },
      transport('first', t('review.first'), () => match.seek(0)),
      transport('prev', t('review.prev'), () => match.seek(match.cursor.peek() - 1)),
      () =>
        transport(
          match.playing.value ? 'pause' : 'play',
          t(match.playing.value ? 'review.pause' : 'review.play'),
          () => match.togglePlaying(),
        ),
      transport('next', t('review.next'), () => match.seek(match.cursor.peek() + 1)),
      transport('last', t('review.last'), () => match.seek(total)),
    ),
    () => {
      const reviews = match.reviews.value;
      const progress = match.progress.value;
      if (reviews) {
        return section(
          t('review.chart'),
          chanceChart(
            reviews,
            match.moves,
            match.config.size,
            () => match.cursor.value,
            (ply) => match.seek(ply),
          ),
          h('p', { class: 'field-hint' }, t('review.chartHelp')),
        );
      }
      if (progress) {
        return h(
          'div',
          { class: 'progress' },
          h('p', { class: 'field-hint', role: 'status' }, t('review.analysing', progress)),
          h('progress', { max: progress.total, value: progress.done }),
        );
      }
      return total > 0
        ? button('chart', t('review.analyse'), () => match.analyse(), {
            class: 'button is-primary is-wide',
          })
        : null;
    },
    () => {
      match.cursor.value;
      return match.game.result
        ? null
        : button('next', t('review.playAgain'), continueHere, { class: 'button is-wide' });
    },
    section(
      t('moves.title'),
      moveList(match, {
        moves: () => match.moves,
        onPick: (ply) => match.seek(ply),
        current: () => match.cursor.value,
      }),
    ),
    h('p', { class: 'record-text' }, movesToText(match.moves, match.config.size)),
  );
}

export function playView(match: Match): HTMLElement {
  if (match instanceof PlayMatch) return localPanel(match);
  if (match instanceof PuzzleMatch) return puzzlePanel(match);
  if (match instanceof OnlineMatch) return onlinePanel(match);
  return reviewPanel(match as ReviewMatch);
}
