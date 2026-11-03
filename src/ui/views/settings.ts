import { LOCALES, t } from '../../i18n/index.ts';
import type { Locale } from '../../i18n/index.ts';
import { BOARD_SKINS, settings, updateSettings } from '../../state/settings.ts';
import { h } from '../dom.ts';
import { goHome } from '../router.ts';
import { pageHeader, section, segmented, toggle } from '../widgets.ts';

export function settingsView(): HTMLElement {
  const current = () => settings.value;
  return h(
    'div',
    { class: 'page' },
    pageHeader(t('settings.title'), goHome),
    h(
      'div',
      { class: 'form' },
      segmented(
        t('settings.theme'),
        (['system', 'light', 'dark'] as const).map((value) => ({
          value,
          label: t(`settings.theme.${value}`),
        })),
        () => current().theme,
        (theme) => updateSettings({ theme }),
      ),
      segmented(
        t('settings.skin'),
        BOARD_SKINS.map((value) => ({ value, label: t(`settings.skin.${value}`) })),
        () => current().skin,
        (skin) => updateSettings({ skin }),
      ),
      segmented<Locale>(
        t('settings.language'),
        (Object.keys(LOCALES) as Locale[]).map((value) => ({ value, label: LOCALES[value] })),
        () => current().locale,
        (locale) => updateSettings({ locale }),
      ),
      toggle(
        t('settings.sound'),
        () => current().sound,
        (sound) => updateSettings({ sound }),
      ),
      toggle(
        t('settings.coords'),
        () => current().coords,
        (coords) => updateSettings({ coords }),
      ),
      toggle(
        t('settings.numbers'),
        () => current().numbers,
        (numbers) => updateSettings({ numbers }),
      ),
      toggle(
        t('settings.touchConfirm'),
        () => current().touchConfirm,
        (touchConfirm) => updateSettings({ touchConfirm }),
        t('settings.touchConfirm.hint'),
      ),
    ),
  );
}

export function helpView(): HTMLElement {
  return h(
    'div',
    { class: 'page prose' },
    pageHeader(t('help.title'), goHome),
    section(t('help.goal.title'), h('p', null, t('help.goal'))),
    section(
      t('help.rules.title'),
      h(
        'dl',
        null,
        (['freestyle', 'standard', 'renju'] as const).flatMap((rule) => [
          h('dt', null, t(`rule.${rule}`)),
          h('dd', null, t(`rule.${rule}.hint`)),
        ]),
      ),
    ),
    section(t('help.controls.title'), h('p', null, t('help.controls'))),
    section(
      t('help.terms.title'),
      h(
        'ul',
        null,
        h('li', null, t('help.terms.four')),
        h('li', null, t('help.terms.three')),
        h('li', null, t('help.terms.vcf')),
      ),
    ),
  );
}
