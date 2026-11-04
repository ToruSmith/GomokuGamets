import type { BoardSize, RuleSet } from '../../core/types.ts';
import { t } from '../../i18n/index.ts';
import { onlineAvailable } from '../../online/index.ts';
import { normaliseRoomCode } from '../../online/session.ts';
import type { Seat } from '../../online/types.ts';
import { OnlineMatch } from '../../state/match.ts';
import { settings, updateSettings } from '../../state/settings.ts';
import { signal } from '../../state/signal.ts';
import { h } from '../dom.ts';
import { displayName, goHome, joinRoom, setHash, startMatch } from '../router.ts';
import { button, pageHeader, section, segmented } from '../widgets.ts';
import { ruleField, sizeField } from './setup.ts';

export function onlineView(): HTMLElement {
  if (!onlineAvailable) {
    return h(
      'div',
      { class: 'page' },
      pageHeader(t('home.online'), goHome),
      h('p', { class: 'note' }, t('online.error.unavailable')),
    );
  }

  const rule = signal<RuleSet>('freestyle');
  const size = signal<BoardSize>(15);
  const seat = signal<Seat | 'random'>('black');
  const minutes = signal(0);
  const code = signal('');
  const error = signal('');
  const busy = signal(false);

  const create = async (): Promise<void> => {
    busy.value = true;
    error.value = '';
    const room = new OnlineMatch();
    const pick = seat.peek();
    const yourSeat: Seat = pick === 'random' ? (Math.random() < 0.5 ? 'black' : 'white') : pick;
    const config = {
      rule: rule.peek(),
      size: rule.peek() === 'renju' ? 15 : size.peek(),
      ...(minutes.peek() ? { clockMs: minutes.peek() * 60_000 } : {}),
    };
    try {
      const created = await room.create(config, displayName(), yourSeat);
      setHash(`/r/${created}`);
      startMatch(room);
    } catch (failure) {
      console.error(failure);
      error.value = t('online.error.connect');
    } finally {
      busy.value = false;
    }
  };

  const join = async (): Promise<void> => {
    const normalised = normaliseRoomCode(code.peek());
    if (!normalised) {
      error.value = t('online.error.code');
      return;
    }
    busy.value = true;
    error.value = '';
    error.value = (await joinRoom(normalised)) ?? '';
    busy.value = false;
  };

  return h(
    'div',
    { class: 'page' },
    pageHeader(t('home.online'), goHome),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, t('online.name')),
      h('input', {
        class: 'input',
        maxlength: 16,
        autocomplete: 'nickname',
        value: settings.peek().name,
        onChange: (event: Event) =>
          updateSettings({ name: (event.target as HTMLInputElement).value.trim() }),
      }),
    ),
    section(
      t('online.join'),
      h(
        'form',
        {
          class: 'join-row',
          onSubmit: (event: Event) => {
            event.preventDefault();
            void join();
          },
        },
        h('input', {
          class: 'input',
          placeholder: t('online.code'),
          'aria-label': t('online.code'),
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          onInput: (event: Event) => {
            code.value = (event.target as HTMLInputElement).value;
          },
        }),
        button(null, t('online.joinButton'), () => void join(), {
          class: 'button',
          disabled: () => busy.value,
        }),
      ),
    ),
    section(
      t('online.create'),
      h(
        'div',
        { class: 'form' },
        ruleField(
          () => rule.value,
          (value) => {
            rule.value = value;
          },
        ),
        () =>
          rule.value === 'renju'
            ? null
            : sizeField(
                () => size.value,
                (value) => {
                  size.value = value;
                },
              ),
        segmented<number>(
          t('setup.clock'),
          [0, 5, 10].map((value) => ({
            value,
            label: value ? t('setup.clock.minutes', { n: value }) : t('setup.clock.none'),
          })),
          () => minutes.value,
          (value) => {
            minutes.value = value;
          },
        ),
        segmented<Seat | 'random'>(
          t('online.seat'),
          [
            { value: 'black', label: t('common.black') },
            { value: 'white', label: t('common.white') },
            { value: 'random', label: t('setup.side.random') },
          ],
          () => seat.value,
          (value) => {
            seat.value = value;
          },
        ),
        button(null, t('online.create'), () => void create(), {
          class: 'button is-primary is-wide',
          disabled: () => busy.value,
        }),
      ),
    ),
    () => (error.value ? h('p', { class: 'error', role: 'alert' }, error.value) : null),
  );
}
