import { AI_LEVELS } from '../../ai/levels.ts';
import type { AiLevel } from '../../ai/levels.ts';
import type { RuleSet, Stone } from '../../core/types.ts';
import { BLACK, BOARD_SIZES, WHITE } from '../../core/types.ts';
import type { BoardSize } from '../../core/types.ts';
import { t } from '../../i18n/index.ts';
import { load, save } from '../../platform/storage.ts';
import { PlayMatch } from '../../state/match.ts';
import { signal } from '../../state/signal.ts';
import { h } from '../dom.ts';
import { goHome, startMatch } from '../router.ts';
import { button, pageHeader, segmented } from '../widgets.ts';

type Side = 'black' | 'white' | 'random';

interface Choices {
  level: AiLevel;
  side: Side;
  rule: RuleSet;
  size: BoardSize;
  minutes: number;
}

const stored = signal<Choices>({
  level: 'medium',
  side: 'black',
  rule: 'freestyle',
  size: 15,
  minutes: 0,
  ...load('setup', {}),
});

function choose(patch: Partial<Choices>): void {
  stored.value = { ...stored.peek(), ...patch };
  save('setup', stored.peek());
}

const pickSide = (side: Side): Stone =>
  side === 'random' ? (Math.random() < 0.5 ? BLACK : WHITE) : side === 'black' ? BLACK : WHITE;

export function ruleField(current: () => RuleSet, onChange: (rule: RuleSet) => void): HTMLElement {
  return h(
    'div',
    null,
    segmented(
      t('setup.rule'),
      (['freestyle', 'standard', 'renju'] as const).map((value) => ({
        value,
        label: t(`rule.${value}`),
      })),
      current,
      onChange,
    ),
    h('p', { class: 'field-hint' }, () => t(`rule.${current()}.hint`)),
  );
}

export function sizeField(current: () => BoardSize, onChange: (size: BoardSize) => void) {
  return segmented(
    t('setup.size'),
    BOARD_SIZES.map((value) => ({ value, label: t('setup.size.value', { n: value }) })),
    current,
    onChange,
  );
}

export function setupView(mode: 'ai' | 'local'): HTMLElement {
  const current = (): Choices => stored.value;
  const begin = (): void => {
    const { level, side, rule, size, minutes } = stored.peek();
    // 連珠的棋盤固定 15 路
    const config = { rule, size: rule === 'renju' ? 15 : size } as const;
    startMatch(
      new PlayMatch({
        kind: mode,
        config,
        ...(mode === 'ai' ? { level, human: pickSide(side) } : {}),
        ...(minutes ? { clockMs: minutes * 60_000 } : {}),
      }),
    );
  };
  return h(
    'div',
    { class: 'page' },
    pageHeader(t(mode === 'ai' ? 'home.ai' : 'home.local'), goHome),
    h(
      'form',
      {
        class: 'form',
        onSubmit: (event: Event) => {
          event.preventDefault();
          begin();
        },
      },
      mode === 'ai'
        ? [
            segmented(
              t('setup.level'),
              AI_LEVELS.map((value) => ({ value, label: t(`level.${value}`) })),
              () => current().level,
              (level) => choose({ level }),
            ),
            segmented<Side>(
              t('setup.side'),
              [
                { value: 'black', label: t('common.black') },
                { value: 'white', label: t('common.white') },
                { value: 'random', label: t('setup.side.random') },
              ],
              () => current().side,
              (side) => choose({ side }),
            ),
          ]
        : null,
      ruleField(
        () => current().rule,
        (rule) => choose({ rule }),
      ),
      () =>
        current().rule === 'renju'
          ? null
          : sizeField(
              () => current().size,
              (size) => choose({ size }),
            ),
      segmented(
        t('setup.clock'),
        [0, 5, 10].map((value) => ({
          value,
          label: value ? t('setup.clock.minutes', { n: value }) : t('setup.clock.none'),
        })),
        () => current().minutes,
        (minutes) => choose({ minutes }),
      ),
      button(null, t('common.start'), begin, {
        class: 'button is-primary is-wide',
        type: 'submit',
      }),
    ),
  );
}
