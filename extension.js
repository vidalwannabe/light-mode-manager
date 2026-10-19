import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {BackgroundMenu} from 'resource:///org/gnome/shell/ui/backgroundMenu.js';
import {QuickMenuToggle, QuickSettingsItem, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {createProfiles} from './profiles.js';

// Everything from this marker on (login/lock screen) is kept as is.
const MARKER = '.login-dialog,\n.unlock-dialog {\n  color: #e1e1e1;';

// [setting key, color used in templates/light.css, same color as "r, g, b"]
// Several template colors can share one setting.
const TOKENS = [
    ['color-fg', '#222226', '34, 34, 38'],
    ['color-fg-muted', '#767679', '118, 118, 121'],
    ['color-card', '#e8e8e8', '232, 232, 232'],
    ['color-card', '#cecece', '206, 206, 206'],
    ['color-general', '#dcdcdc', '220, 220, 220'],
    ['color-general', '#e1e1e1', '225, 225, 225'],
    ['color-general', 'whitesmoke', '245, 245, 245'],
];

// Matches every token color and its rgba() variants.
const TOKEN_RE = new RegExp(
    `${TOKENS.map(([, c]) => c.startsWith('#') ? `${c}\\b` : `\\b${c}\\b`).join('|')}|` +
    `rgba\\((${TOKENS.map(([, , rgb]) => rgb).join('|')}), ([\\d.]+)\\)`,
    'gi');

// Top bar text and icons. The lock/login screen keeps its white text.
const PANEL_TEXT_SEL = '#panel .panel-button, #panel .panel-button.clock-display, ' +
    '#panel:overview .panel-button, #panel:overview .panel-button.clock-display';
// The overview button's workspace dots (drawn with a background color), and Dash to
// Panel's app grid button, whose own stylesheet makes it white (the #panel id outranks it).
const PANEL_DOTS_SEL = '#panel .panel-button#panelActivities .workspace-dot, ' +
    '#panel:overview .panel-button#panelActivities .workspace-dot';
const PANEL_SHOW_APPS_SEL = '#panel .show-apps .overview-icon';
const PANEL_LOCK_SEL = '#panel.unlock-screen .panel-button, #panel.login-screen .panel-button, ' +
    '#panel.unlock-screen .panel-button.clock-display, #panel.login-screen .panel-button.clock-display';

// Dark mode has no template: each setting overrides a list of elements.
// [selectors, property, setting key]
const DARK_RULES = [
    [[
        '.popup-menu-content', '.candidate-popup-content',
        '.switcher-list', '.osd-window', '.workspace-switcher', '.resize-popup',
    ], 'background-color', 'color-general-dark'],
    [[
        '.notification-banner',
    ], 'background-color', 'color-card-dark'],
    [[
        '#dash .dash-background',
    ], 'background-color', 'color-dash-dark'],
    [[
        '.overview-tile', '.grid-search-result', '.app-folder', '.app-folder-dialog',
        '.app-folder-dialog .folder-name-container .folder-name-label', '.page-navigation-arrow',
    ], 'color', 'color-grid-fg-dark'],
    [[
        'stage', '.popup-menu', '.popup-menu-item', '.popup-inactive-menu-item', '.message',
        '.quick-toggle-menu', '.events-button', '.world-clocks-button', '.weather-button',
        '.datemenu-today-button', '.calendar .calendar-day', '.calendar .calendar-month-header .calendar-month-label',
        '.modal-dialog', '.osd-window', '.switcher-list .item-box',
        '.list-search-result', '.search-section-content',
    ], 'color', 'color-fg-dark'],
    [[
        '.message .message-header', '.message .message-header .message-header-content .event-time',
        '.events-button .events-box .events-title', '.events-button .events-box .events-list .event-box .event-time',
        '.events-button .events-box .events-list .event-placeholder', '.world-clocks-button .world-clocks-header',
        '.world-clocks-button .world-clocks-grid .world-clocks-timezone',
        '.weather-button .weather-box .weather-header-box .weather-header',
        '.calendar .calendar-day.calendar-weekend', '.calendar .calendar-week-number',
        '.list-search-result .list-search-result-description', '.device-subtitle',
    ], 'color', 'color-fg-muted-dark'],
].map(([selectors, prop, key]) => [selectors.join(', '), prop, key]);

// Dark mode cards that are buttons: Quick Settings menus, notifications and the cards
// below the calendar. They get every state, as GNOME draws them (see buttonCss).
const CARD_BUTTONS = ['.message', '.events-button', '.world-clocks-button', '.weather-button'];
const DARK_CARD_BUTTONS = ['.quick-toggle-menu', ...CARD_BUTTONS];

// Color settings of each mode.
const LIGHT_KEYS = [...new Set(TOKENS.map(([key]) => key)), 'color-border', 'color-qs-button', 'color-panel-fg',
    'color-qs-active-fg', 'color-qs-active', 'color-highlight', 'color-today', 'color-today-fg', 'color-dash', 'color-grid-fg', 'color-panel',
    'color-overview'];
const DARK_KEYS = DARK_RULES.map(([, , key]) => key);
// Settings that rebuild the theme of each mode (colors and Appearance tab options);
// other keys (profiles...) never do.
const EFFECT_KEYS = ['general-opacity', 'panel-opacity', 'card-opacity', 'match-arrow-buttons', 'merge-arrow-buttons',
    'calendar-background', 'lock-screen-native'];
const LIGHT_THEME_KEYS = [...LIGHT_KEYS, ...EFFECT_KEYS];
const DARK_THEME_KEYS = [...DARK_KEYS, 'color-border-dark', 'color-qs-button-dark', 'color-panel-fg-dark',
    'color-qs-active-fg-dark', 'color-qs-active-dark', 'color-highlight-dark', 'color-today-dark', 'color-today-fg-dark',
    'color-panel-dark',
    'color-overview-dark', ...EFFECT_KEYS];

// Accepted color values: #rgb, #rrggbb, rgb()/rgba() or a name. Anything else (edited in
// dconf or imported) counts as system default, so it can never break the stylesheet.
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([\d\s.,]+\)|[a-z]+)$/i;

// The template's own top bar color (templates/light.css), for a general background on
// system default.
const TEMPLATE_PANEL = '#f5f5f5';

// The menus' border: Quick Settings, the calendar and notifications, panel and context menus.
const BORDER_SEL = '.popup-menu-content, .candidate-popup-content';

// The overview and modal dialogs (Power Off, passwords, "not responding"...) keep an
// opaque general background, whatever the shell opacity: dialogs ask for attention, so
// they stay easy to read.
const DARK_OPAQUE_SEL = '#overviewGroup, .modal-dialog';
// Light template rules of the overview and dialogs that use the general background.
const LIGHT_OPAQUE_RE = /overview|grid-search-result|modal-dialog|audio-device-selection-dialog/;
// The overview's grid (dash, search results, app folder icons and the dialog a folder
// opens) keeps the system's colors: "Cards background" only paints cards. In light mode the
// template paints it with the card tokens, so those rules get the template's own card
// colors back.
const GRID_RE = /#dash|search|app-folder/;
const CARD_TOKENS = TOKENS.filter(([key]) => key === 'color-card');
// The app grid (app and folder names, folder dialogs, page arrows) has its own text color,
// "App grid text": "Idle buttons and cards titles and icons" does not paint it. In light mode
// the template paints it with the text token, so those rules are repeated with that color
// (the template's own when empty).
const APP_GRID_RE = /overview-tile|app-folder|grid-search-result|page-navigation-arrow/;
const TEXT_TOKEN_RE = /#222226|34, 34, 38/;

// GNOME draws a shadow under the whole menu, so a translucent menu showed it through
// and looked darker than the panel. Below 100% opacity these shadows are removed.
const SHADOW_SEL = '.popup-menu-content, .candidate-popup-content, .switcher-list';

// Hover/active shading (darker in light mode, lighter in dark mode) and focus tint of
// GNOME 48's buttons.
const shade = dark => dark ? 'st-lighten' : 'st-darken';
const focusTint = dark => dark ? 'st-mix(-st-accent-color, #ffffff, 60%)' : '-st-accent-color';

// The background of a button (one selector or a list) in every state, with the expressions
// GNOME 48 uses. Extension stylesheets rank above GNOME's whatever the specificity, so a
// plain rule would also replace GNOME's hover and active colors.
function buttonCss(selectors, base, dark) {
    const adjust = shade(dark);
    const focus = focusTint(dark);
    return [
        ['', base],
        [':hover', `${adjust}(${base}, 4%)`],
        [':active', `${adjust}(${base}, 9%)`],
        [':active:hover', `${adjust}(${adjust}(${base}, 9%), 4%)`],
        [':focus', `st-mix(${focus}, ${base}, 5%)`],
        [':focus:hover', `st-mix(${focus}, ${adjust}(${base}, 4%), 5%)`],
        [':active:focus', `st-mix(${focus}, ${adjust}(${base}, 9%), 5%)`],
        [':insensitive', `${shade(!dark)}(${base}, 3%)`],
    ].map(([state, color]) => rule([selectors].flat().map(sel => sel + state).join(', '),
        'background-color', color)).join('');
}

// Idle Quick Settings buttons: toggles that are off and the round buttons at the top;
// the menus they expand (Wi-Fi, Power Off...) use the same color. Checked toggles get
// GNOME's accent states again after them, and the Background Apps item (also a toggle)
// its transparent background, which still gives way to the hover.
// The slider buttons (volume icon and "›", brightness icon) are flat buttons GNOME paints in
// the menu's own color, a pill that shows on a translucent menu: they join them.
const QS_BUTTONS = ['.quick-toggle', '.quick-settings-system-item .icon-button', '.quick-slider .icon-button'];
const QS_MENU = '.quick-toggle-menu';
// The open menu is not reactive, so St gives it :insensitive, which GNOME (and buttonCss)
// draws a shade lighter: it keeps its own color instead.
const menuCss = (color, dark) => buttonCss(QS_MENU, color, dark) +
    rule(`${QS_MENU}:insensitive`, 'background-color', color);
const QS_CHECKED = '.quick-toggle:checked';
const QS_MENU_ICON_ON = '.quick-toggle-menu .header .icon.active';
const QS_FLAT = '.background-apps-quick-toggle';

// Quick Settings arrow buttons ("›"). GNOME 48 draws them a shade apart from their toggle,
// off and on; "Match arrows to toggles" gives them the toggle's own color. Light mode
// expressions use the template's tokens, filled in like the rest of the template.
const ARROW_SEL = '.quick-toggle-has-menu .quick-toggle-menu-button';
// The 1px gap between a toggle and its arrow; "Merge arrows into toggles" closes it.
const ARROW_GAP_SEL = '.quick-toggle-has-menu .quick-toggle-separator';
// GNOME's toggle color when off, and its own arrow color off and on.
const toggleOff = dark => dark ? 'st-mix(#ffffff, #36363a, 9%)' : 'st-mix(#222226, whitesmoke, 12%)';
const arrowOff = dark => dark ? 'st-mix(#ffffff, #4a4a4f, 9%)' : 'st-mix(#222226, #e8e8e8, 12%)';
const arrowChecked = dark => dark ? 'st-mix(-st-accent-color, #ffffff, 85%)' : 'st-mix(-st-accent-color, #222226, 92%)';
// How far GNOME's arrow is from its toggle when off (lighter in dark mode, darker in light).
const ARROW_SHADE = {dark: 8, light: 5};

// Calendar as card: the month calendar gets the color of the cards below it (Today,
// World Clocks, Weather). Its days, headings, month and arrows are flat buttons painted
// with the menu's color (a pill that only shows on another background), so they become
// transparent and keep their hover. Extension stylesheets rank above GNOME's whatever the
// specificity, so today's accent circle is set again after them.
const CALENDAR_FLAT = [
    '.calendar-day-heading', '.calendar-day',
    '.calendar-month-header .calendar-month-label', '.calendar-month-header .pager-button',
].map(sel => `.calendar ${sel}`);
const CALENDAR_TODAY = '.calendar .calendar-day.calendar-today';
// GNOME 48's dark card color, for cards on system default (GNOME profile).
const NATIVE_CARD = '#47474c';
function calendarCss(card, dark) {
    const adjust = shade(dark);
    const flat = (...states) => states.flatMap(state => CALENDAR_FLAT.map(sel => sel + state)).join(', ');
    return `.calendar {\n  background-color: ${card};\n  padding: 6px;\n}\n` +
        // The month name and weekday headings are not reactive, so St marks them
        // :insensitive, which GNOME paints with the menu color: transparent too.
        rule(flat('', ':insensitive'), 'background-color', 'transparent') +
        rule(flat(':hover'), 'background-color', `${adjust}(${card}, 7%)`) +
        rule(flat(':active', ':selected'), 'background-color', `${adjust}(${card}, 10%)`) +
        rule(flat(':active:hover', ':selected:hover'), 'background-color', `${adjust}(${card}, 14%)`) +
        rule(flat(':focus'), 'background-color', `st-mix(${focusTint(dark)}, ${card}, 5%)`) +
        buttonCss(CALENDAR_TODAY, '-st-accent-color', dark);
}

// GNOME 48's own (dark) backgrounds of the general background elements. With the general
// background on system default (GNOME profile) the shell uses this dark style in both
// modes, so the opacity is applied to these colors. Dialogs are left out: always opaque.
// GNOME 48's own (dark) top bar color.
const NATIVE_PANEL = '#000000';
const NATIVE_GENERAL = [
    ['.popup-menu-content, .candidate-popup-content', '#36363a'],
    ['.switcher-list, .osd-window, .workspace-switcher, .resize-popup', '#2e2e33'],
];

// GNOME's own delay before fading out the snapshot of the old screen.
const TRANSITION_DELAY = 250;

const DTP_UUID = 'dash-to-panel@jderose9.github.com';
// Dash to Panel settings read through this extension: its custom panel color and opacity
// (always off) and its window preview title color.
const DTP_FORCED_OFF = ['trans-use-custom-bg', 'trans-use-custom-opacity'];
const DTP_TITLE_KEY = 'window-preview-title-font-color';
// The desktop right-click menu entry.
const MENU_TITLE = 'Shell Color Manager…';

const rule = (selector, prop, value) => `${selector} {\n  ${prop}: ${value};\n}\n`;
const noShadowCss = rule(SHADOW_SEL, 'box-shadow', 'none');
const insensitive = selectors => selectors.map(s => `${s}:insensitive`).join(', ');

// Quick Settings text and icons on GNOME's dark style, which keeps them white: toggles and
// their arrows, the round buttons at the top and the slider buttons.
const QS_TEXT = ['.quick-settings .button', '.quick-settings .icon-button'];
function quickSettingsTextCss(color) {
    return rule(QS_TEXT.join(', '), 'color', color) +
        rule(insensitive(QS_TEXT), 'color', `st-transparentize(${color}, 0.5)`);
}

// "Active buttons text and icons": Quick Settings toggles that are on (and their arrows and
// subtitles), and the icon of the menu they open. GNOME's own: the accent's text color.
const QS_ACTIVE = ['.quick-settings .quick-toggle:checked',
    '.quick-settings .quick-toggle-has-menu .quick-toggle-menu-button:checked'];
const QS_ACTIVE_TEXT = [...QS_ACTIVE, '.quick-settings .quick-toggle:checked .quick-toggle-subtitle',
    '.quick-toggle-menu .header .icon.active'];
function activeTextCss(color) {
    return rule(QS_ACTIVE_TEXT.join(', '), 'color', color) +
        rule(insensitive(QS_ACTIVE), 'color', `st-transparentize(${color}, 0.5)`);
}

// Text roles. "Idle buttons and cards titles and icons" colors titles and icons, "...subtitles" only the line
// that comes under a title (a notification's body and time, a location, "No Events"...).
// GNOME dims some titles too (a notification's app name, "Today", "Weather", weekends), so
// each role is set here explicitly, after the template or GNOME's own rules.
const MAIN_TEXT = [
    '.message .message-header .message-header-content .message-source-title',
    '.message .message-header .message-source-icon',
    '.message .message-box .message-content .message-title',
    '.message-notification-group .message-group-header .message-group-title',
    '.events-button .events-box .events-title',
    '.events-button .events-box .events-list .event-box .event-summary',
    '.world-clocks-button .world-clocks-header',
    '.world-clocks-button .world-clocks-grid .world-clocks-city',
    '.world-clocks-button .world-clocks-grid .world-clocks-time',
    '.weather-button .weather-box .weather-header-box .weather-header',
    '.weather-button .weather-box .weather-grid .weather-forecast-icon',
    '.weather-button .weather-box .weather-grid .weather-forecast-temp',
    '.datemenu-today-button .date-label',
    '.calendar .calendar-month-header .calendar-month-label',
    '.calendar .calendar-day.calendar-weekend',
    '.quick-toggle-menu .header .title',
    '.message-dialog-content .message-dialog-title',
];
const SECONDARY_TEXT = [
    '.message .message-box .message-content .message-body',
    '.message .message-header .message-header-content .event-time',
    '.events-button .events-box .events-list .event-box .event-time',
    '.events-button .events-box .events-list .event-placeholder',
    '.world-clocks-button .world-clocks-grid .world-clocks-timezone',
    '.weather-button .weather-box .weather-header-box .weather-header.location',
    '.weather-button .weather-box .weather-grid .weather-forecast-time',
    '.datemenu-today-button .day-label',
    '.quick-toggle-menu .header .subtitle',
    '.quick-settings .quick-toggle .quick-toggle-subtitle',
    '.message-dialog-content .message-dialog-description',
];
// Calendar days that keep their own look over the main color: other months dimmed, today on
// the accent.
const CALENDAR_OTHER_MONTH = '.calendar .calendar-day.calendar-other-month, ' +
    '.calendar .calendar-day.calendar-other-month.calendar-weekend';
function textRolesCss(main, secondary) {
    let css = '';
    if (main) {
        css += rule(MAIN_TEXT.join(', '), 'color', main) +
            rule(CALENDAR_OTHER_MONTH, 'color', `st-transparentize(${main}, 0.5)`) +
            rule(CALENDAR_TODAY, 'color', '-st-accent-fg-color');
    }
    if (secondary)
        css += rule(SECONDARY_TEXT.join(', '), 'color', secondary);
    return css;
}

// "Overview and top bar highlights" on the top bar buttons: a hovered or focused one, and
// the one whose menu is open, get the color. GNOME fills them with an inset shadow
// (they fake their padding with a transparent border); the clock fills its inner .clock
// instead. The lock and login screens show the top bar over the wallpaper, so their buttons
// keep GNOME's own white fills (17%, 28% and 32% white), set again after ours because
// extension stylesheets outrank GNOME's.
const PANEL_BUTTONS = ['#panel .panel-button', '#panel:overview .panel-button'];
const PANEL_LOCK_BAR_SEL = '#panel.unlock-screen, #panel.login-screen';
const PANEL_LOCK_BUTTONS = ['#panel.unlock-screen .panel-button', '#panel.login-screen .panel-button'];
function panelButtonsCss(color) {
    const select = (bases, states, child = '') =>
        bases.flatMap(base => states.map(state => `${base}${state}${child}`)).join(', ');
    const fills = (bases, hover, active, activeHover) => [false, true].map(clock => {
        const sel = states => clock
            ? select(bases.map(base => `${base}.clock-display`), states, ' .clock')
            : select(bases, states);
        return rule(sel([':hover', ':focus']), 'box-shadow', `inset 0 0 0 100px ${hover}`) +
            rule(sel([':active', ':checked']), 'box-shadow', `inset 0 0 0 100px ${active}`) +
            rule(sel([':active:hover', ':checked:hover']), 'box-shadow', `inset 0 0 0 100px ${activeHover}`);
    }).join('') + rule(select(bases.map(base => `${base}.clock-display`),
        ['', ':hover', ':focus', ':active', ':checked', ':active:hover', ':checked:hover']), 'box-shadow', 'none');
    const white = alpha => `rgba(255, 255, 255, ${alpha})`;
    return fills(PANEL_BUTTONS, color, color, color) +
        fills(PANEL_LOCK_BUTTONS, white(0.17), white(0.28), white(0.32));
}

// "Overview and top bar highlights" on the overview search entry and the password entry of
// the lock and login screens, with GNOME's hover shade and focus tint (its focus ring is
// kept). The password entry's text takes the titles color and its hint the subtitles one.
const PROMPT_SEL = ['.unlock-dialog .login-dialog-prompt-entry', '.login-dialog .login-dialog-prompt-entry'];
const ENTRY_SEL = ['.search-entry', ...PROMPT_SEL];
function entriesCss(color, dark, text, hint) {
    const sel = (list, ...states) => list.flatMap(base => states.map(state => base + state)).join(', ');
    return rule(sel(ENTRY_SEL, '', ':insensitive'), 'background-color', color) +
        rule(sel(ENTRY_SEL, ':hover'), 'background-color', `${shade(dark)}(${color}, 4%)`) +
        rule(sel(ENTRY_SEL, ':focus'), 'background-color', `st-mix(-st-accent-color, ${color}, 5%)`) +
        (text ? rule(sel(PROMPT_SEL, '', ':hover', ':focus'), 'color', text) : '') +
        (hint ? rule(sel(PROMPT_SEL, ' StLabel.hint-text'), 'color', hint) : '');
}

// "Top bar text and icons". The lock and login screens keep GNOME's white text and icons,
// which sit on the wallpaper there.
const panelTextCss = color => rule(PANEL_TEXT_SEL, 'color', color) + rule(PANEL_LOCK_SEL, 'color', '#ffffff') +
    rule(PANEL_DOTS_SEL, 'background-color', color) + rule(PANEL_SHOW_APPS_SEL, 'color', color);

// "r, g, b" of a #rgb, #rrggbb, rgb() or rgba() color, so hover/active variants follow it.
function colorToRgb(value) {
    if (/^#[0-9a-f]{3}$/i.test(value))
        value = `#${[...value.slice(1)].map(c => c + c).join('')}`;
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (m)
        return m.slice(1).map(h => parseInt(h, 16)).join(', ');
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*[,)]/i.exec(value);
    return m ? m.slice(1).join(', ') : null;
}

// The general background with the opacity from the Appearance tab. Any alpha already in the
// color (older settings or profiles) is ignored: the Appearance tab is the only source.
// A solid color without alpha is kept as written.
function withOpacity(value, opacity) {
    const rgb = value ? colorToRgb(value) : null;
    if (!rgb || (opacity >= 100 && !/^rgba/i.test(value)))
        return value;
    return `rgba(${rgb}, ${opacity / 100})`;
}

// `color` at `opacity` percent, for any CSS color expression: st-transparentize() lowers
// only the alpha, and St's shades (st-darken/st-lighten) keep it.
function translucent(color, opacity) {
    return opacity >= 100 ? color : `st-transparentize(${color}, ${(100 - opacity) / 100})`;
}

// The CSS property of the value at `offset` in `css`.
function propertyAt(css, offset) {
    const start = Math.max(css.lastIndexOf(';', offset), css.lastIndexOf('{', offset)) + 1;
    return css.slice(start, css.indexOf(':', start)).trim().split(/\s+/).pop();
}

// Whether GTK 3 can load this theme: built in (Adwaita) or installed in one of its theme
// folders, with one of the subfolders it reads (gtk-3.0 to gtk-3.24).
const GTK3_SUBDIRS = Array.from({length: 13}, (_v, i) => `gtk-3.${i * 2}`);
function gtk3ThemeExists(name) {
    if (name === 'Adwaita' || name === 'Adwaita-dark')
        return true;
    if (!name)
        return false;
    const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
        .map(d => GLib.build_filenamev([d, 'themes']));
    dirs.push(GLib.build_filenamev([GLib.get_home_dir(), '.themes']));
    return dirs.some(d => GTK3_SUBDIRS.some(sub =>
        GLib.file_test(GLib.build_filenamev([d, name, sub]), GLib.FileTest.IS_DIR)));
}

// get_preferred_height() of `actor` with "any width" (-1) replaced by width(), when known.
function heightAtWidth(actor, width) {
    return forWidth => {
        const w = forWidth < 0 ? width() : forWidth;
        return Clutter.Actor.prototype.get_preferred_height.call(actor, w > 0 ? w : forWidth);
    };
}

const PROFILE_ICON = 'preferences-desktop-appearance-symbolic';

// Color changes (a profile applied, a color or option edited) fade like a mode switch when
// they change something on screen: the top bar is always visible, the overview and the menus
// (Quick Settings, calendar...) only while open. Keys without "-dark".
const TOP_BAR_KEYS = ['color-panel', 'color-panel-fg', 'panel-opacity'];
const OVERVIEW_KEYS = ['color-overview', 'color-grid-fg', 'color-dash'];
const AUTO_KEYS = ['auto-switch', 'auto-switch-1-time', 'auto-switch-1-mode', 'auto-switch-2-time'];
// How often the automatic switch checks the clock. A check is a few comparisons; checking
// often (instead of one long timer) also catches up right after a suspend.
const AUTO_CHECK_SECONDS = 30;

// Quick Settings button: switches the color sets (profiles) of the current mode, light or
// dark; its menu also opens these preferences (on their first tab, Appearance). The subtitle
// shows the applied color set of the current mode.
const ProfileToggle = GObject.registerClass(
class ProfileToggle extends QuickMenuToggle {
    _init(extension) {
        super._init({title: 'Color Set', iconName: PROFILE_ICON, toggleMode: false});
        const settings = extension.getSettings();
        this._models = createProfiles(settings);
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._modeItems = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._modeItems);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => {
            Main.panel.closeQuickSettings();
            extension.openPreferences();
        });
        this.connect('clicked', () => this.menu.open());

        // Applying a profile changes several keys at once; rebuild only once.
        for (const key of [...this._models.light.keys, ...this._models.dark.keys])
            settings.connectObject(`changed::${key}`, () => this._queueSync(), this);
        this._interface.connectObject('changed::color-scheme', () => this._queueSync(), this);
        this._sync();
    }

    _queueSync() {
        this._syncId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Fills a menu section with a model's profiles, the applied one checked; returns it.
    _fill(section, model) {
        const profiles = model.all();
        const applied = model.applied(profiles);
        section.removeAll();
        for (const profile of profiles) {
            const item = new PopupMenu.PopupMenuItem(profile.name);
            item.setOrnament(profile.name === applied?.name ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => model.apply(profile));
            section.addMenuItem(item);
        }
        return applied;
    }

    _sync() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        this.menu.setHeader(PROFILE_ICON, 'Color Set', dark ? 'Dark mode' : 'Light mode');
        const applied = this._fill(this._modeItems, dark ? this._models.dark : this._models.light);
        this.subtitle = applied?.name ?? 'Unsaved';
    }

    destroy() {
        if (this._syncId)
            GLib.Source.remove(this._syncId);
        this._syncId = 0;
        this._interface.disconnectObject(this);
        super.destroy();
    }
});

const ProfileIndicator = GObject.registerClass(
class ProfileIndicator extends SystemIndicator {
    _init(extension) {
        super._init();
        this.quickSettingsItems.push(new ProfileToggle(extension));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

// Lock screen ("unlock-dialog" session mode)
// ------------------------------------------
// metadata.json lists the "user" and "unlock-dialog" session modes, so GNOME Shell keeps this
// extension enabled while the screen is locked instead of calling disable() on lock and
// enable() on unlock. The reasons:
// - disable() has to give the desktop back as it was: it turns the interface color scheme
//   from "prefer-light" back to "default" and switches legacy GTK 3 apps back to their
//   theme. Doing that on every lock would make every open app change its style twice per
//   lock/unlock, behind the lock screen and again after unlocking.
// - Unloading and reloading the stylesheet (about 170 KB in light mode) on every unlock would
//   make the shell flash between GNOME's colors and the user's colors.
// - The automatic switch (light/dark mode at set times) has to keep its timer while locked,
//   so a switch time that passes during the lock is applied on time.
// "Use GNOME colors on the lock screen" (lock-screen-native, off by default) unloads the
// stylesheet on lock and loads it again on unlock (_lockedNative, the session mode
// "updated" handler), for users who want GNOME's own lock screen; the rest below still
// applies. Without it, while locked the extension only keeps its stylesheet loaded, so what
// the lock screen shows (the top bar, Quick Settings opened from it, notifications, OSDs and the password
// field) keeps the user's colors. Nothing interactive of its own is shown there:
// - the Quick Settings profile switcher is removed on lock and added back on unlock
//   (_syncQuickSettings, called from the session mode "updated" signal);
// - the desktop right-click menu entry only exists in the desktop's background menus,
//   which the lock screen does not have;
// - Dash to Panel hides its panels on the lock screen itself.
// The lock and login screens keep GNOME's own look where it sits on the wallpaper: a
// transparent top bar (_panelCss), white top bar text and icons (panelTextCss) and GNOME's
// white hover and pressed fills on top bar buttons (panelButtonsCss).
export default class ShellColorManagerExtension extends Extension {
    // ---------- Color scheme ----------
    _getColorScheme() {
        return this._interface.get_string('color-scheme');
    }

    _isDark() {
        return this._getColorScheme() === 'prefer-dark';
    }

    // Legacy GTK 3 apps: switches between "Theme" and "Theme-dark", only to an installed theme.
    _setLegacyColorScheme(scheme) {
        const theme = this._interface.get_string('gtk-theme');
        const isDark = theme.endsWith('-dark');
        let next = theme;
        if (scheme === 'prefer-dark' && !isDark)
            next = `${theme}-dark`;
        else if (scheme !== 'prefer-dark' && isDark)
            next = theme.slice(0, -5);
        if (next !== theme && gtk3ThemeExists(next))
            this._interface.set_string('gtk-theme', next);
    }

    _schemeChanged() {
        const scheme = this._getColorScheme();
        // GNOME's "Default" (light) becomes "prefer-light" so the shell turns light too.
        // That change fires this handler again, which then applies the theme.
        if (scheme === 'default') {
            this._interface.set_string('color-scheme', 'prefer-light');
            return;
        }
        this._setLegacyColorScheme(scheme);
        this._applyTheme();
        this._restartTransition();
    }

    // When the style is toggled, GNOME fades out a snapshot of the old screen. Rebuilding the
    // theme blocks the shell long enough for that fade to be skipped, so it is restarted
    // once the new theme is in place, with the duration chosen in the Appearance tab.
    _restartTransition() {
        const transition = Main.layoutManager.screenTransition;
        const snapshot = transition.visible ? transition.content : null;
        if (!snapshot)
            return;
        // Stopping GNOME's fade hides the actor and drops the snapshot; it is put back below.
        transition.remove_all_transitions();
        const duration = this._settings.get_int('transition-duration');
        if (!duration) {
            transition.hide();
            return;
        }
        transition.content = snapshot;
        transition.opacity = 255;
        transition.show();
        transition.ease({
            opacity: 0,
            duration,
            delay: TRANSITION_DELAY,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => transition.hide(),
        });
    }

    // ---------- Quick Settings switcher ----------
    // Shown when enabled, but never on the lock screen: switching profiles changes colors
    // for the whole session, so it is not offered to whoever is in front of a locked
    // screen. Called again from the session mode "updated" signal on every lock and unlock,
    // which destroys the switcher on lock and creates it again on unlock.
    _syncQuickSettings() {
        const show = this._settings.get_boolean('quick-settings-profiles') && !Main.sessionMode.isLocked;
        if (show && !this._indicator) {
            this._indicator = new ProfileIndicator(this);
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // ---------- Quick Settings overrides ----------
    // Both options below replace a GNOME method on one object. What was there before is
    // kept and put back on restore, and only if the method is still ours, so an override
    // from another extension is never lost.
    _override(object, name, fn) {
        this._overrides ??= new Map();
        const own = Object.hasOwn(object, name);
        this._overrides.set(fn, {object, name, own, previous: object[name]});
        object[name] = fn;
    }

    _restore(fn) {
        const saved = this._overrides?.get(fn);
        if (!saved)
            return;
        this._overrides.delete(fn);
        const {object, name, own, previous} = saved;
        if (object[name] !== fn)
            return;
        if (own)
            object[name] = previous;
        else
            delete object[name];
    }

    // While one of its menus is open, GNOME darkens Quick Settings with a Clutter effect
    // (not CSS), from QuickSettingsMenu._setDimmed(). With no-qs-dimming it does nothing.
    _syncQsDimming(remove = this._settings.get_boolean('no-qs-dimming')) {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        if (typeof menu?._setDimmed !== 'function' || remove === !!this._noDimming)
            return;
        if (remove) {
            // Undo a dimming already in place (a menu open right now).
            menu._setDimmed(false);
            this._noDimming = () => {};
            this._override(menu, '_setDimmed', this._noDimming);
        } else {
            this._restore(this._noDimming);
            this._noDimming = null;
            menu._setDimmed(!!menu._activeMenu);
        }
    }

    // GNOME measures an expanded Quick Settings menu, and the room the buttons below make for
    // it, with get_preferred_height(-1): at no particular width. Text that wraps (Bluetooth
    // off: "Turn on Bluetooth to connect to devices") then counts as one line and the menu
    // covers the buttons below (GNOME issue 7622). With fix-qs-menu-height both are measured
    // at the width of the menus' overlay, in any language:
    // - QuickToggleMenu.open(), for the opening animation;
    // - the grid's placeholder, whose height the Quick Settings layout reads as the room for
    //   an open menu. Its height is bound to the overlay by a constraint that measures it
    //   in C, at -1, so the placeholder's own get_preferred_height() is replaced.
    _syncQsMenuHeight(fix = this._settings.get_boolean('fix-qs-menu-height')) {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        const overlay = menu?._overlay;
        const placeholder = menu?._grid?.layout_manager?._overlay;
        if (!overlay || !placeholder || fix === !!this._menuOpen)
            return;
        if (fix) {
            // QuickToggleMenu is not exported: its prototype comes from a throwaway item.
            const item = new QuickSettingsItem({hasMenu: true});
            const proto = Object.getPrototypeOf(item.menu);
            item.menu.destroy();
            item.destroy();
            const open = proto.open;
            this._menuOpen = function (animate) {
                const {actor} = this;
                actor.get_preferred_height = heightAtWidth(actor, () => actor.get_parent()?.width ?? 0);
                try {
                    open.call(this, animate);
                } finally {
                    delete actor.get_preferred_height;
                }
            };
            this._overlayHeight = heightAtWidth(overlay, () => overlay.width);
            this._override(proto, 'open', this._menuOpen);
            this._override(placeholder, 'get_preferred_height', this._overlayHeight);
        } else {
            this._restore(this._menuOpen);
            this._restore(this._overlayHeight);
            this._menuOpen = this._overlayHeight = null;
        }
        // A menu open right now gets the new height.
        menu._grid.queue_relayout();
    }

    // ---------- Automatic switch ----------
    // Two times of day: the first sets the chosen mode, the second the opposite one. The
    // most recent switch time that has passed is applied once (its moment is kept in dconf),
    // so a mode picked by hand in between, even across logins, stays until the next one.

    _autoTimes() {
        return [1, 2].map(i => this._settings.get_int(`auto-switch-${i}-time`));
    }

    // The most recent switch moment (unix time) before `now` and its color scheme.
    _latestSwitch(now) {
        const [t1, t2] = this._autoTimes();
        const dark = this._settings.get_string('auto-switch-1-mode') === 'dark';
        const midnight = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
        return [[t1, dark], [t2, !dark]]
            .map(([minutes, isDark]) => {
                let moment = midnight.add_minutes(minutes);
                if (moment.compare(now) > 0)
                    moment = moment.add_days(-1);
                return {time: moment.to_unix(), scheme: isDark ? 'prefer-dark' : 'prefer-light'};
            })
            .reduce((a, b) => a.time >= b.time ? a : b);
    }

    _checkAutoSwitch() {
        const latest = this._latestSwitch(GLib.DateTime.new_now_local());
        if (latest.time <= this._settings.get_int64('auto-switch-applied'))
            return;
        this._settings.set_int64('auto-switch-applied', latest.time);
        if (this._getColorScheme() !== latest.scheme)
            this._interface.set_string('color-scheme', latest.scheme);
    }

    // Changing the schedule (on, times or mode) applies its current mode right away. At login
    // only a switch time newer than the last applied one does, so a mode picked by hand stays
    // until the next switch. Equal times count as off, even with "Enable" on.
    _syncAutoSwitch(changed = false) {
        this._clearSource('_autoId');
        const [t1, t2] = this._autoTimes();
        if (!this._settings.get_boolean('auto-switch') || t1 === t2)
            return;
        if (changed)
            this._settings.set_int64('auto-switch-applied', 0);
        this._checkAutoSwitch();
        this._autoId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_CHECK_SECONDS, () => {
            this._checkAutoSwitch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ---------- Dash to Panel colors ----------
    // With override-dtp-colors, Dash to Panel reads three of its own settings through this
    // extension: no custom panel color and no custom panel opacity, so it takes both from
    // the loaded stylesheets (its own default behavior), and window preview titles in black
    // or white to match the shell. Its settings are never written, and everything else it
    // does (dynamic opacity, gradients, borders, preview opacity...) is left as it is.
    // Its settings object comes from its own module, already loaded by GNOME Shell.
    _syncDtp() {
        const token = this._dtpToken = (this._dtpToken ?? 0) + 1;
        const ext = Main.extensionManager.lookup(DTP_UUID);
        const wanted = ext?.state === ExtensionState.ACTIVE && this._settings.get_boolean('override-dtp-colors');
        const settings = wanted
            ? import(ext.dir.get_child('extension.js').get_uri()).then(module => module.SETTINGS ?? null)
            : Promise.resolve(null);
        settings.then(dtpSettings => {
            // Disabled, or synced again, in the meantime.
            if (token !== this._dtpToken || !this._settings)
                return;
            if (dtpSettings === this._dtpSettings)
                return;
            this._unhookDtp();
            if (typeof dtpSettings?.get_boolean === 'function')
                this._hookDtp(dtpSettings);
        }).catch(e => console.error(`[ShellColorManager] ${e.message}`));
    }

    _hookDtp(settings) {
        const {get_boolean: getBoolean, get_string: getString} = settings;
        const extension = this;
        this._dtpBoolean = function (key) {
            return DTP_FORCED_OFF.includes(key) ? false : getBoolean.call(this, key);
        };
        this._dtpString = function (key) {
            if (key !== DTP_TITLE_KEY)
                return getString.call(this, key);
            return extension._isDark() || extension._forcedDark ? '#ffffff' : '#000000';
        };
        this._override(settings, 'get_boolean', this._dtpBoolean);
        this._override(settings, 'get_string', this._dtpString);
        this._dtpSettings = settings;
        this._notifyDtp();
    }

    _unhookDtp() {
        if (!this._dtpSettings)
            return;
        this._restore(this._dtpBoolean);
        this._restore(this._dtpString);
        this._notifyDtp();
        this._dtpSettings = this._dtpBoolean = this._dtpString = null;
    }

    // Dash to Panel updates its panels when these settings change.
    _notifyDtp() {
        for (const key of DTP_FORCED_OFF) {
            try {
                this._dtpSettings.emit(`changed::${key}`, key);
            } catch (e) {
                console.error(`[ShellColorManager] ${e.message}`);
            }
        }
    }

    // ---------- Desktop menu entry ----------
    // The desktop's right-click menu (one per monitor, rebuilt when the wallpaper or the
    // monitors change) gets "Shell Color Manager…" below "Change Background…". The entry is
    // added when a menu opens, so every menu has it whenever it is shown.
    _syncBackgroundMenu(show = this._settings.get_boolean('background-menu-entry')) {
        if (show === !!this._bgMenuOpen)
            return;
        if (show) {
            const {open} = BackgroundMenu.prototype;
            const extension = this;
            this._bgMenuOpen = function (...args) {
                if (!this._lightModeItem) {
                    this._lightModeItem = this.addAction(MENU_TITLE, () => extension.openPreferences());
                    this.moveMenuItem(this._lightModeItem, 1);
                }
                return open.apply(this, args);
            };
            this._override(BackgroundMenu.prototype, 'open', this._bgMenuOpen);
        } else {
            this._restore(this._bgMenuOpen);
            this._bgMenuOpen = null;
            for (const manager of Main.layoutManager._bgManagers ?? []) {
                const menu = manager.backgroundActor?._backgroundMenu;
                menu?._lightModeItem?.destroy();
                if (menu)
                    delete menu._lightModeItem;
            }
        }
    }

    // Opacity on GNOME's own menu backgrounds, for "Menus background" on system default.
    _nativeOpacityCss() {
        const opacity = this._settings.get_int('general-opacity');
        if (opacity >= 100)
            return '';
        return NATIVE_GENERAL
            .map(([selector, color]) => rule(selector, 'background-color', withOpacity(color, opacity)))
            .join('') + noShadowCss;
    }

    // The colors of the given keys; empty means system default.
    _values(keys) {
        return keys.map(key => {
            const value = this._settings.get_string(key).trim();
            return COLOR_RE.test(value) ? value : '';
        });
    }

    // A color or option changed: applied shortly (a profile changes several keys at once),
    // remembering what changed to decide whether to fade.
    _colorChanged(key) {
        (this._changedKeys ??= new Set()).add(key.replace(/-dark$/, ''));
        this._scheduleApply();
    }

    // Whether the changes since the last apply show on screen now (see TOP_BAR_KEYS).
    _changeVisible() {
        const keys = [...this._changedKeys ?? []];
        this._changedKeys = null;
        const panelOpacity = this._settings.get_boolean('panel-opacity');
        return keys.some(key => {
            if (TOP_BAR_KEYS.includes(key) || (key === 'general-opacity' && panelOpacity))
                return true;
            if (OVERVIEW_KEYS.includes(key))
                return Main.overview.visible;
            return !!Main.panel.menuManager?.activeMenu;
        });
    }

    _wantsForcedDark() {
        return !this._isDark() && !this._lockedNative() && this._values(LIGHT_KEYS).every(v => !v);
    }

    // Vanilla GNOME keeps the shell dark in light mode. With every light color on system
    // default (the GNOME profile) the shell is forced to its dark style to match.
    // Main.sessionMode.colorScheme belongs to the current session mode: GNOME sets it again
    // from the mode's own definition on every session mode change (lock, unlock), which
    // drops the forced value. The session mode "updated" handler in enable() therefore
    // forgets the forced state and calls this again, so the lock screen and the unlocked
    // session both get the right style.
    _syncShellScheme() {
        const vanilla = this._wantsForcedDark();
        if (vanilla === this._forcedDark)
            return;
        if (vanilla) {
            this._modeScheme = Main.sessionMode.colorScheme;
            Main.sessionMode.colorScheme = 'force-dark';
        } else {
            Main.sessionMode.colorScheme = this._modeScheme;
        }
        this._forcedDark = vanilla;
        St.Settings.get().notify('color-scheme');
    }

    // ---------- Stylesheet ----------
    // With "Use GNOME colors on the lock screen", the lock screen gets no stylesheet: it
    // shows GNOME's own colors, and the user's colors come back on unlock.
    _lockedNative() {
        return Main.sessionMode.isLocked && this._settings.get_boolean('lock-screen-native');
    }

    // "Sliders" (the filled part of every slider: volume, brightness...) and "Today in the
    // calendar", in all its states. Empty: GNOME's accent color.
    _highlightCss(dark) {
        const [slider, today, todayFg] = this._values(dark
            ? ['color-highlight-dark', 'color-today-dark', 'color-today-fg-dark']
            : ['color-highlight', 'color-today', 'color-today-fg']);
        // The day number comes after textRolesCss, which sets it to the accent text color.
        return (slider ? rule('.slider', '-barlevel-active-background-color', slider) : '') +
            (today ? buttonCss(CALENDAR_TODAY, today, dark) : '') +
            (todayFg ? rule(CALENDAR_TODAY, 'color', todayFg) : '');
    }

    // "Top bar background": with "Enable panel opacity" it also gets the shell opacity.
    // `fallback` is the color used on system default.
    _panelCss(panel, fallback) {
        const opacity = this._settings.get_boolean('panel-opacity') ? this._settings.get_int('general-opacity') : 100;
        if (!panel && opacity >= 100 && fallback === NATIVE_PANEL)
            return '';
        // GNOME draws the top bar of the lock and login screens transparent, over the
        // wallpaper. Extension stylesheets outrank GNOME's whatever the specificity, so the
        // #panel rule above would make it solid there (seen after resuming from suspend,
        // which shows the lock screen); this rule gives those screens their transparent
        // top bar back. In light mode the template already has it; the rule is harmless.
        return rule('#panel', 'background-color', withOpacity(panel || fallback, opacity)) +
            rule(PANEL_LOCK_BAR_SEL, 'background-color', 'transparent');
    }

    // The menu border rule for the given border color setting (none for the system's).
    _borderCss(key) {
        const [color] = key ? this._values([key]) : [''];
        return color ? rule(BORDER_SEL, 'border-color', color) : '';
    }

    _darkCss() {
        const values = this._values(DARK_KEYS);
        const opacity = this._settings.get_int('general-opacity');
        const general = DARK_KEYS.indexOf('color-general-dark');
        const opaque = withOpacity(values[general], 100);
        values[general] = withOpacity(values[general], opacity);
        let css = '';
        DARK_RULES.forEach(([selector, prop], i) => {
            if (values[i])
                css += rule(selector, prop, values[i]);
        });
        if (!opaque)
            css += this._nativeOpacityCss();
        else if (opacity < 100)
            css += noShadowCss;
        // "Top bar background" and "Overview and dialogs background" (always opaque).
        const [panel, overview] = this._values(['color-panel-dark', 'color-overview-dark']);
        css += this._panelCss(panel, NATIVE_PANEL);
        const dash = values[DARK_KEYS.indexOf('color-dash-dark')];
        if (dash) {
            css += entriesCss(dash, true, values[DARK_KEYS.indexOf('color-fg-dark')],
                values[DARK_KEYS.indexOf('color-fg-muted-dark')]) + panelButtonsCss(dash);
        }
        if (overview)
            css += rule(DARK_OPAQUE_SEL, 'background-color', withOpacity(overview, 100));
        // The top bar: "Top bar text and icons".
        const [panelFg] = this._values(['color-panel-fg-dark']);
        if (panelFg)
            css += panelTextCss(panelFg);
        // Titles, subtitles and Quick Settings text: "Idle buttons and cards titles and icons", "...subtitles"
        // and "Active buttons text and icons".
        const fg = values[DARK_KEYS.indexOf('color-fg-dark')];
        const [active] = this._values(['color-qs-active-fg-dark']);
        if (fg)
            css += quickSettingsTextCss(fg);
        const muted = values[DARK_KEYS.indexOf('color-fg-muted-dark')];
        css += textRolesCss(fg, muted);
        // After the subtitles, so a toggle that is on keeps its own subtitle color.
        if (fg || muted || active)
            css += activeTextCss(active || '-st-accent-fg-color');
        css += this._darkCardsCss(values[DARK_KEYS.indexOf('color-card-dark')],
            ...this._values(['color-qs-button-dark', 'color-qs-active-dark']));
        return css + this._highlightCss(true) + this._borderCss('color-border-dark');
    }

    // Cards, inactive Quick Settings buttons and calendar background on GNOME's dark style;
    // an empty color is GNOME's own.
    _darkCardsCss(card, qsButtons, active = '') {
        const opacity = this._settings.get_int('card-opacity');
        const base = card || NATIVE_CARD;
        let css = card || opacity < 100
            ? buttonCss(DARK_CARD_BUTTONS, translucent(base, opacity), true) + menuCss(translucent(base, opacity), true)
            : '';
        // After the cards, so the Quick Settings menus take the inactive buttons color.
        css += this._quickSettingsCss(true, qsButtons, {
            toggle: toggleOff(true), arrow: arrowOff(true), arrowChecked: arrowChecked(true), menu: base,
        }, active);
        if (this._settings.get_boolean('calendar-background'))
            css += calendarCss(translucent(base, opacity), true);
        return css;
    }

    // Idle Quick Settings buttons, the menus they open and the arrow buttons. An empty
    // color uses `native`: GNOME's own toggle, arrow (off, checked) and menu colors.
    _quickSettingsCss(dark, color, native, active = '') {
        // "Active buttons background": toggles that are on, their arrows and the icon of the
        // menu they open. GNOME's own: the accent color.
        const accent = active || '-st-accent-color';
        const match = this._settings.get_boolean('match-arrow-buttons');
        const opacity = this._settings.get_int('card-opacity');
        const merged = this._settings.get_boolean('merge-arrow-buttons') ? rule(ARROW_GAP_SEL, 'width', '0') : '';
        let css;
        if (color || opacity < 100) {
            const amount = ARROW_SHADE[dark ? 'dark' : 'light'];
            let arrow = color ? `${shade(dark)}(${color}, ${amount}%)` : native.arrow;
            if (match)
                arrow = color || native.toggle;
            css = buttonCss(QS_BUTTONS, translucent(color || native.toggle, opacity), dark) +
                buttonCss(QS_CHECKED, accent, dark) +
                rule(QS_FLAT, 'background-color', 'transparent') +
                menuCss(translucent(color || native.menu, opacity), dark) +
                buttonCss(ARROW_SEL, translucent(arrow, opacity), dark);
        } else {
            css = (match ? buttonCss(ARROW_SEL, native.toggle, dark) : '') +
                (active ? buttonCss(QS_CHECKED, accent, dark) : '');
            if (!css)
                return merged;
        }
        // Set again after the off colors, which would otherwise also cover the checked arrow.
        const arrowOn = match ? accent : native.arrowChecked.replaceAll('-st-accent-color', accent);
        css = merged + css + buttonCss(`${ARROW_SEL}:checked`, arrowOn, dark);
        return active ? css + rule(QS_MENU_ICON_ON, 'background-color', active) : css;
    }

    // The template is only read when light mode first needs it.
    _template() {
        if (!this._templateHead) {
            const [, bytes] = this.dir.get_child('templates').get_child('light.css').load_contents(null);
            const template = new TextDecoder().decode(bytes);
            const idx = template.indexOf(MARKER);
            this._templateHead = idx >= 0 ? template.slice(0, idx) : template;
            this._templateTail = idx >= 0 ? template.slice(idx) : '';
            const rules = [...this._templateHead.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
            // The overview and dialog rules that use the general background, to repeat them opaque.
            this._templateOpaque = rules
                .filter(([, selector, body]) => LIGHT_OPAQUE_RE.test(selector) &&
                    TOKENS.some(([key, color]) => key === 'color-general' && body.toLowerCase().includes(color)))
                .map(([text]) => text.trim()).join('\n') + '\n';
            // The grid rules painted with the card color, reduced to their backgrounds.
            this._templateGrid = rules
                .filter(([, selector, body]) => selector.replace(/\/\*[^]*?\*\//g, '').split(',')
                    .every(part => GRID_RE.test(part)) &&
                    CARD_TOKENS.some(([, color, rgb]) => body.toLowerCase().includes(color) || body.includes(rgb)))
                .map(([, selector, body]) => [...body.matchAll(/(?:^|[^-])background-color:\s*([^;]+);/g)]
                    .map(([, value]) => rule(selector.trim(), 'background-color', value.trim())).join(''))
                .join('');
            // The app grid's text colors, as the template has them (not filled in).
            this._templateGridText = rules.map(([, selector, body]) => {
                const parts = selector.replace(/\/\*[^]*?\*\//g, '').split(',').map(part => part.trim())
                    .filter(part => APP_GRID_RE.test(part) && !part.startsWith('#dash'));
                const colors = [...body.matchAll(/(?:^|[;\s])color:\s*([^;]+);/g)].map(([, value]) => value.trim())
                    .filter(value => TEXT_TOKEN_RE.test(value));
                return parts.length && colors.length ? rule(parts.join(', '), 'color', colors.at(-1)) : '';
            }).join('');
        }
        return [this._templateHead, this._templateTail, this._templateOpaque, this._templateGrid,
            this._templateGridText];
    }

    _lightCss() {
        const values = this._values(LIGHT_KEYS);
        // Every color on system default (GNOME profile): the shell keeps its own dark style
        // (see _syncShellScheme), so only the Appearance tab options apply, on GNOME's colors.
        if (values.every(v => !v))
            return this._darkCardsCss('', '') + this._borderCss(null) + this._nativeOpacityCss() +
                this._panelCss('', NATIVE_PANEL);

        // An empty color keeps the template's original one.
        const byKey = Object.fromEntries(LIGHT_KEYS.map((key, i) => [key, values[i]]));
        const opacity = this._settings.get_int('general-opacity');
        // Each token as a solid color, and with the opacity on the general background.
        const solid = {};
        const faded = {};
        const byRgb = {};
        for (const [key, color, rgb] of TOKENS) {
            const value = byKey[key] || (color.startsWith('#') ? color : `rgb(${rgb})`);
            const general = key === 'color-general';
            solid[color] = general ? withOpacity(value, 100) : value;
            faded[color] = general ? withOpacity(value, opacity) : value;
            byRgb[rgb] = colorToRgb(value) ?? rgb;
        }
        // rgba() variants keep their own alpha. Text ("color:") is always solid: the opacity
        // is for backgrounds only.
        const fill = (text, colors, rgbs = byRgb) => text.replace(TOKEN_RE, (m, rgb, alpha, offset) => {
            if (rgb)
                return `rgba(${rgbs[rgb]}, ${alpha})`;
            return (propertyAt(text, offset) === 'color' ? solid : colors)[m.toLowerCase()];
        });

        const [head, tail, opaque, grid, gridText] = this._template();
        let css = fill(head, faded) + tail;
        // "Overview and dialogs background": the template's overview and dialog rules again,
        // opaque, with this color (the template's own when empty) instead of the menus one.
        const overview = byKey['color-overview'];
        if (overview || opacity < 100) {
            const colors = {...solid};
            const rgbs = {...byRgb};
            for (const [, color, rgb] of TOKENS.filter(([key]) => key === 'color-general')) {
                colors[color] = overview ? withOpacity(overview, 100) : color;
                rgbs[rgb] = (overview && colorToRgb(overview)) || rgb;
            }
            css += fill(opaque, colors, rgbs);
        }
        // Translucent menus: shadows are removed.
        if (opacity < 100)
            css += noShadowCss;

        // "Top bar background": the template's top bar color is not a token.
        css += this._panelCss(byKey['color-panel'], TEMPLATE_PANEL);
        // The top bar: "Top bar text and icons".
        if (byKey['color-panel-fg'])
            css += panelTextCss(byKey['color-panel-fg']);
        // Titles and subtitles (the template's own colors when empty), and active buttons.
        css += textRolesCss(fill('#222226', solid), fill('#767679', solid));
        // After the subtitles, so a toggle that is on keeps its own subtitle color.
        css += activeTextCss(byKey['color-qs-active-fg'] || '-st-accent-fg-color');
        // Cards (the template's own color when empty), inactive Quick Settings buttons and
        // calendar background. GNOME's light expressions get the template's tokens filled in;
        // the color settings are used as they are.
        const card = byKey['color-card'] || '#e8e8e8';
        const cardOpacity = this._settings.get_int('card-opacity');
        if (cardOpacity < 100)
            css += buttonCss(CARD_BUTTONS, translucent(card, cardOpacity), false);
        // The grid gets the template's own card colors back; other colors still filled in.
        const cardColors = new Set(CARD_TOKENS.flatMap(([, color, rgb]) => [color, rgb]));
        css += grid.replace(TOKEN_RE, (m, rgb, alpha) => {
            if (rgb)
                return `rgba(${cardColors.has(rgb) ? rgb : byRgb[rgb]}, ${alpha})`;
            return cardColors.has(m.toLowerCase()) ? m : solid[m.toLowerCase()];
        });
        // "App grid text": the template's app grid text rules, recolored.
        const gridFg = byKey['color-grid-fg'];
        const gridRgb = gridFg && colorToRgb(gridFg);
        css += gridFg ? gridText.replace(/#222226/g, gridFg).replace(/34, 34, 38/g, gridRgb ?? '34, 34, 38') : gridText;
        // "Overview and top bar highlights": dash, search and password entries and top bar
        // buttons, solid like the overview (the template's own colors when empty).
        if (byKey['color-dash']) {
            const dash = withOpacity(byKey['color-dash'], 100);
            css += rule('#dash .dash-background', 'background-color', dash) +
                entriesCss(dash, false, fill('#222226', solid), fill('#767679', solid)) + panelButtonsCss(dash);
        }
        const token = expression => fill(expression, faded);
        css += this._quickSettingsCss(false, byKey['color-qs-button'], {
            toggle: token(toggleOff(false)), arrow: token(arrowOff(false)),
            arrowChecked: token(arrowChecked(false)), menu: card,
        }, byKey['color-qs-active']);
        if (this._settings.get_boolean('calendar-background'))
            css += calendarCss(translucent(card, cardOpacity), false);
        return css + this._highlightCss(false) + this._borderCss('color-border');
    }

    // `fade`: fade from the old look to the new one, as when switching modes.
    _applyTheme(fade = false) {
        // A pending delayed apply would only repeat this one.
        this._clearSource('_applyId');
        this._applyStylesheet(fade);
    }

    _applyStylesheet(fade = false) {
        let file = null;
        let faded = false;
        try {
            // "Use GNOME colors on the lock screen": no stylesheet while locked.
            const css = this._lockedNative() ? '' : this._isDark() ? this._darkCss() : this._lightCss();
            // A visible color change: GNOME's screen transition snapshots the screen before
            // the change, then fades it out with the Transition duration.
            if (fade && this._settings.get_int('transition-duration') > 0 &&
                (css !== this._lastCss || this._wantsForcedDark() !== this._forcedDark)) {
                Main.layoutManager.screenTransition.run();
                faded = true;
            }
            this._syncShellScheme();
            // Nothing changed: skip writing and reloading the stylesheet.
            if (css === this._lastCss)
                return;

            // Nothing to override: St fails to load an empty stylesheet,
            // so just drop ours and keep the native look.
            if (!css) {
                this._unloadTheme();
                this._lastCss = css;
                return;
            }

            // St only reloads a stylesheet from a new file, hence the unique name.
            file = this._cacheDir.get_child(`theme-${Date.now()}-${++this._serial}.css`);
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);

            this._unloadTheme();
            this._themeFile = file;
            this._lastCss = css;
        } catch (e) {
            console.error(`[ShellColorManager] ${e.message}`);
            // Do not leave a file behind that never got loaded.
            if (file && file !== this._themeFile) {
                try {
                    file.delete(null);
                } catch {}
            }
        } finally {
            // The new look is in place: fade the snapshot out with the user's duration.
            if (faded)
                this._restartTransition();
        }
    }

    _unloadTheme() {
        if (!this._themeFile)
            return;
        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._themeFile);
            this._themeFile.delete(null);
        } catch {
            // The file may already be gone; nothing else to clean.
        }
        this._themeFile = null;
        this._lastCss = null;
    }

    // Removes theme files left behind by a session that ended without disable().
    _clearCache() {
        try {
            this._cacheDir.make_directory_with_parents(null);
            return;
        } catch {
            // Already exists: clean it below.
        }
        try {
            const files = this._cacheDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            for (let info; (info = files.next_file(null));) {
                const name = info.get_name();
                if (name.startsWith('theme-') && name.endsWith('.css'))
                    this._cacheDir.get_child(name).delete(null);
            }
            files.close(null);
        } catch (e) {
            console.error(`[ShellColorManager] ${e.message}`);
        }
    }

    // Removes the GLib source kept in this[name], if any.
    _clearSource(name) {
        if (this[name])
            GLib.Source.remove(this[name]);
        this[name] = 0;
    }

    _scheduleApply() {
        this._clearSource('_applyId');
        this._applyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._applyId = 0;
            this._applyTheme(this._changeVisible());
            return GLib.SOURCE_REMOVE;
        });
    }

    enable() {
        this._serial = 0;
        this._forcedDark = false;
        this._cacheDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'shell-color-manager']));
        this._clearCache();

        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'background-menu-entry')
                this._syncBackgroundMenu();
            else if (key === 'override-dtp-colors')
                this._syncDtp();
            else if (key === 'quick-settings-profiles')
                this._syncQuickSettings();
            else if (key === 'no-qs-dimming')
                this._syncQsDimming();
            else if (key === 'fix-qs-menu-height')
                this._syncQsMenuHeight();
            else if (AUTO_KEYS.includes(key))
                this._syncAutoSwitch(true);
            else if ((this._isDark() ? DARK_THEME_KEYS : LIGHT_THEME_KEYS).includes(key))
                this._colorChanged(key);
        });
        this._syncBackgroundMenu();
        // Dash to Panel may be enabled, disabled or reloaded after this extension.
        Main.extensionManager.connectObject('extension-state-changed', (_m, ext) => {
            if (ext.uuid === DTP_UUID)
                this._syncDtp();
        }, this);

        this._interface = Gio.Settings.new('org.gnome.desktop.interface');
        const current = this._getColorScheme();
        if (current === 'default')
            this._interface.set_string('color-scheme', 'prefer-light');
        this._setLegacyColorScheme(current);
        // Connected after the initial setup so it does not apply the theme twice.
        this._schemeId = this._interface.connect('changed::color-scheme', () => this._schemeChanged());

        // Lock and unlock change the session mode ("user" <-> "unlock-dialog"); see the
        // lock screen notes above the class.
        this._sessionId = Main.sessionMode.connect('updated', () => {
            this._forcedDark = false;
            this._syncShellScheme();
            this._syncQuickSettings();
            // Unloads the stylesheet on lock and loads it again on unlock.
            if (this._settings.get_boolean('lock-screen-native'))
                this._applyTheme();
        });
        this._syncQuickSettings();
        this._syncQsDimming();
        this._syncQsMenuHeight();

        this._syncAutoSwitch();
        this._applyTheme();
        this._syncDtp();
    }

    // Called when the extension is turned off, uninstalled or updated, or when the session
    // ends. Never on lock: with the "unlock-dialog" session mode the extension stays enabled
    // on the lock screen (see the lock screen notes above the class). Everything enable()
    // set up is undone here: stylesheet, GNOME method overrides, Quick Settings switcher,
    // desktop menu entry, Dash to Panel settings, timers and signal handlers, and the color
    // scheme goes back to GNOME's "default".
    disable() {
        this._clearSource('_applyId');
        this._clearSource('_autoId');
        Main.sessionMode.disconnect(this._sessionId);
        this._settings.disconnect(this._settingsId);
        this._interface.disconnect(this._schemeId);

        this._unloadTheme();
        this._syncBackgroundMenu(false);
        Main.extensionManager.disconnectObject(this);
        this._dtpToken = (this._dtpToken ?? 0) + 1;
        this._unhookDtp();
        this._indicator?.destroy();
        this._indicator = null;
        this._syncQsDimming(false);
        this._syncQsMenuHeight(false);
        if (this._forcedDark) {
            Main.sessionMode.colorScheme = this._modeScheme;
            St.Settings.get().notify('color-scheme');
        }
        if (this._getColorScheme() === 'prefer-light')
            this._interface.set_string('color-scheme', 'default');
        // Legacy GTK 3 apps stay on the scheme that remains.
        this._setLegacyColorScheme(this._getColorScheme());

        this._settings = this._interface = this._cacheDir = null;
        this._lastCss = this._modeScheme = this._overrides = this._changedKeys = null;
        this._templateHead = this._templateTail = this._templateOpaque = this._templateGrid = null;
        this._templateGridText = null;
    }
}
