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
import {QuickMenuToggle, QuickSettingsItem, QuickSettingsMenu, SystemIndicator}
    from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {createProfiles, ROW_NAMES} from './profiles.js';

// In light mode ("prefer-light") GNOME loads its own light shell style, as it loads its dark
// one in dark mode: each is that mode's system default. Over either, each color row paints
// only its own list of elements, the same in both modes; an empty color writes nothing, so
// those elements keep GNOME's colors.

// `selectors` (one or a list) in each of `states`, as one comma-separated selector.
const inStates = (selectors, states) => states.flatMap(state => [selectors].flat().map(sel => sel + state)).join(', ');

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

// "Menu background": menus (Quick Settings, calendar, right-click menus), OSD and switchers.
const GENERAL_SEL = '.popup-menu-content, .candidate-popup-content, .switcher-list, .osd-window, ' +
    '.workspace-switcher, .resize-popup';
// "Menu text": menu items, OSD and switchers, in every state of a menu item.
const MENU_TEXT = inStates(['.popup-menu-item', '.popup-inactive-menu-item'],
    ['', ':hover', ':focus', ':active', ':selected', ':checked']) +
    ', .osd-window, .switcher-list, .switcher-list .item-box, .workspace-switcher, .resize-popup';
// "Overview text": search results (with their descriptions dimmed), the search status and
// window captions.
const OVERVIEW_TEXT = '.list-search-result, .list-search-result .list-search-result-title, .search-statustext, ' +
    '.list-search-provider-details, .window-caption';
const OVERVIEW_DIM_TEXT = '.list-search-result .list-search-result-description';
// "Overview and dialogs background": the overview and modal dialogs (Power Off, passwords,
// "not responding"...), always opaque: dialogs ask for attention, so they stay easy to read.
const OPAQUE_SEL = '#overviewGroup, .modal-dialog';
// "App grid text": app and folder names, search results, a folder's dialog and the page
// arrows, in every state (the light template colors several of them one by one).
const GRID_ITEMS = ['.overview-tile', '.grid-search-result', '.app-folder'];
const GRID_TEXT = inStates([...GRID_ITEMS, ...GRID_ITEMS.map(item => `.app-folder-dialog ${item}`)],
    ['', ':hover', ':focus', ':active', ':checked', ':selected', ':highlighted']) + ', ' +
    ['.app-folder-dialog', '.app-folder-dialog .folder-name-container .folder-name-label',
        '.app-folder-dialog .folder-name-container .folder-name-entry', '.page-navigation-arrow',
        '.page-navigation-arrow > StIcon', '.page-navigation-arrow:hover', '.page-navigation-arrow:active',
        // The edit button (pencil) of a folder's dialog.
        ...['', ':hover', ':focus', ':active'].map(state => `.app-folder-dialog .folder-name-container .icon-button${state}`)].join(', ');

// "Card background": notifications and banners, the cards below the calendar and the
// notification list's Clear button. They get every state, as GNOME draws them (buttonCss).
const CLEAR_BUTTON = '.message-list-controls .button';
// The notifications' buttons: actions ("Open File"...), close, expand and collapse.
const NOTIFICATION_BUTTONS = ['.notification-button', '.message .message-header .message-close-button',
    '.message .message-header .message-expand-button', '.message-notification-group .message-collapse-button'];
const CARD_BUTTONS = ['.message', '.notification-banner', '.events-button', '.world-clocks-button', '.weather-button',
    CLEAR_BUTTON, ...NOTIFICATION_BUTTONS];
// The Do Not Disturb switch of the notification list; on, it keeps the accent color.
const DND_SWITCH = '.message-list-controls .dnd-button .toggle-switch';
// The media player card; `.message.media-message` outranks the card and text rules.
const MEDIA_CARD = '.message.media-message';
const MEDIA_CONTROL = '.message-media-control';
const MEDIA_HEADER = [
    '.message.media-message .message-header .message-header-content .message-source-title',
    '.message.media-message .message-header .message-source-icon',
];
const MEDIA_BODY = [
    '.message.media-message .message-box .message-content .message-title',
    '.message.media-message .message-box .message-content .message-body',
];
const MEDIA_TEXT = [...MEDIA_HEADER, ...MEDIA_BODY];

// GNOME's own colors of each style, for "Calendar as card" on system default and for
// elements a row's color would otherwise reach (an empty active expanded menu, an empty
// media player): cards, media player card, text and card header text.
const NATIVE = {
    dark: {card: '#47474c', media: '#54545a', text: '#ffffff', header: '#9b9b9d'},
    light: {card: '#ffffff', media: '#ffffff', text: '#222226', header: '#78787b'},
};

// Settings that rebuild the theme of each mode: its colors (the rows of the Light mode and
// Dark mode tabs) and the General tab options. Other keys (profiles...) never do.
const EFFECT_KEYS = ['hide-borders', 'qs-borders', 'qs-active-borders', 'notification-borders', 'merge-arrow-buttons', 'calendar-background'];
const THEME_KEYS = [false, true].map(dark =>
    [...ROW_NAMES.map(n => `color-${n}${dark ? '-dark' : ''}`), ...EFFECT_KEYS]);

// Accepted color values: #rgb, #rrggbb, rgb()/rgba() or a name. Anything else (edited in
// dconf or imported) counts as system default, so it can never break the stylesheet.
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([\d\s.,]+\)|[a-z]+)$/i;

// The menus' border: Quick Settings, the calendar and notifications, panel and context menus.
const BORDER_SEL = '.popup-menu-content, .candidate-popup-content';
// The cards GNOME outlines in light mode, and the calendar with "Calendar as card".
const CARD_OUTLINE_SEL = '.message, .events-button, .world-clocks-button, .weather-button, .datemenu-today-button, ' +
    '.calendar';
// "Enable border on Quick Settings buttons": idle toggles (a toggle with an arrow outlined as
// one, around both) and the round buttons at the top, drawn as an outer shadow so nothing
// changes size; toggles that are on keep none.
const QS_OUTLINED = '.quick-toggle, .quick-toggle-has-menu, .quick-settings-system-item .icon-button';
const QS_NOT_OUTLINED = '.quick-toggle-has-menu .quick-toggle, .quick-toggle:checked, .quick-toggle-has-menu:checked';


// Hover/active shading (darker in light mode, lighter in dark mode) and focus tint of
// GNOME 48's buttons.
const shade = dark => dark ? 'st-lighten' : 'st-darken';
const focusTint = dark => dark ? 'st-mix(-st-accent-color, #ffffff, 60%)' : '-st-accent-color';

// Hover (`hover` states), click and click-hover backgrounds lit from `base`, by GNOME 48's
// button amounts.
function litCss(selectors, base, dark, hover = [':hover']) {
    const adjust = shade(dark);
    return rule(inStates(selectors, hover), 'background-color', `${adjust}(${base}, 4%)`) +
        rule(inStates(selectors, [':active']), 'background-color', `${adjust}(${base}, 9%)`) +
        rule(inStates(selectors, [':active:hover']), 'background-color', `${adjust}(${adjust}(${base}, 9%), 4%)`);
}

// The background of a button (one selector or a list) in every state, with the expressions
// GNOME 48 uses. Extension stylesheets rank above GNOME's whatever the specificity, so a
// plain rule would also replace GNOME's hover and active colors.
function buttonCss(selectors, base, dark) {
    const adjust = shade(dark);
    const focus = focusTint(dark);
    const paint = (state, color) => rule(inStates(selectors, [state]), 'background-color', color);
    return paint('', base) + litCss(selectors, base, dark) +
        paint(':focus', `st-mix(${focus}, ${base}, 5%)`) +
        paint(':focus:hover', `st-mix(${focus}, ${adjust}(${base}, 4%), 5%)`) +
        paint(':active:focus', `st-mix(${focus}, ${adjust}(${base}, 9%), 5%)`) +
        paint(':insensitive', `${shade(!dark)}(${base}, 3%)`);
}

// Idle Quick Settings buttons: toggles that are off and the round buttons at the top.
// The menus they expand (Wi-Fi, Power Off...) have their own colors (menuCss). Checked toggles get
// GNOME's accent states again after them, and the Background Apps item (also a toggle)
// its transparent background, which still gives way to the hover.
// The slider buttons (volume icon and "›", brightness icon) are flat buttons GNOME paints in
// the menu's own color: they join them.
const QS_BUTTONS = ['.quick-toggle', '.quick-settings-system-item .icon-button', '.quick-slider .icon-button'];
const QS_MENU = '.quick-toggle-menu';
// "Active expanded menu background": the menu of a toggle that is on. CSS cannot see the toggle's
// state from its menu, so _prepareMenu() gives the menu this class while it is on.
const ACTIVE_MENU_CLASS = 'scm-active';
const QS_ACTIVE_MENU = `${QS_MENU}.${ACTIVE_MENU_CLASS}`;
// The open menu is not reactive, so St gives it :insensitive, which GNOME (and buttonCss)
// draws a shade lighter: it keeps its own color instead. Its items (networks, devices...)
// are lit from the menu's own color by the same amounts as the buttons (see buttonCss),
// instead of GNOME's fixed gray; disabled items keep GNOME's transparent background.
const menuCss = (color, dark, selector = QS_MENU) => buttonCss(selector, color, dark) +
    rule(`${selector}:insensitive`, 'background-color', color) +
    litCss(`${selector} .popup-menu-item`, color, dark, [':hover', ':selected', ':checked']);
// "Idle expanded menu text and icons" (or "Active button text and icons" on an active menu):
// every text and icon of the menu: heading, items in every state (disabled ones at half
// strength) and device subtitles.
function menuTextCss(color, selector = QS_MENU) {
    const items = `${selector} .popup-menu-item`;
    return rule([selector, `${selector}:insensitive`, `${selector} .header .title`, `${selector} .header .subtitle`,
        `${selector} .header .icon`, `${selector} .device-subtitle`, `${selector} .popup-inactive-menu-item`,
        `${selector} .popup-separator-menu-item`, `${selector} .popup-separator-menu-item StLabel`,
        inStates(items, ['', ':hover', ':active', ':selected', ':checked'])].join(', '), 'color', color) +
        rule(`${items}:insensitive`, 'color', `st-transparentize(${color}, 0.5)`);
}
const QS_CHECKED = '.quick-toggle:checked';
const QS_MENU_ICON_ON = '.quick-toggle-menu .header .icon.active';
const QS_MENU_ICON = '.quick-toggle-menu .header .icon';
const QS_FLAT = '.background-apps-quick-toggle';
const BACKGROUND_APP_CLOSE = '.background-app-item .icon-button';

// Quick Settings arrow buttons ("›"). GNOME 48 draws them a shade apart from their toggle,
// off and on; "Match arrows to toggles" gives them the toggle's own color. Light mode
// expressions use the template's tokens, filled in like the rest of the template.
const ARROW_SEL = '.quick-toggle-has-menu .quick-toggle-menu-button';
// The 1px gap between a toggle and its arrow; "Merge arrows into toggles" closes it.
const ARROW_GAP_SEL = '.quick-toggle-has-menu .quick-toggle-separator';
// GNOME's toggle color when off, and its own arrow color off and on.
const toggleOff = dark => dark ? 'st-mix(#ffffff, #36363a, 9%)' : 'st-mix(#222226, #fafafb, 12%)';
const arrowOff = dark => dark ? 'st-mix(#ffffff, #4a4a4f, 9%)' : 'st-mix(#222226, #ececf0, 12%)';
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
function calendarCss(card, dark, today) {
    const adjust = shade(dark);
    const flat = (...states) => inStates(CALENDAR_FLAT, states);
    // The cards' own outline in GNOME's style (light: a faint border and shadow; dark: none).
    // GNOME removes the calendar's with !important, hence !important here too.
    return `.calendar {\n  background-color: ${card};\n  padding: 6px;\n}\n` +
        rule('.calendar', 'border-color', `${dark ? 'transparent' : 'rgba(0, 0, 0, 0.09)'} !important`) +
        rule('.calendar', 'box-shadow', dark ? 'none' : '0 1px 2px 0 rgba(0, 0, 0, 0.03)') +
        // The month name and weekday headings are not reactive, so St marks them
        // :insensitive, which GNOME paints with the menu color: transparent too.
        rule(flat('', ':insensitive'), 'background-color', 'transparent') +
        rule(flat(':hover'), 'background-color', `${adjust}(${card}, 7%)`) +
        rule(flat(':active', ':selected'), 'background-color', `${adjust}(${card}, 10%)`) +
        rule(flat(':active:hover', ':selected:hover'), 'background-color', `${adjust}(${card}, 14%)`) +
        rule(flat(':focus'), 'background-color', `st-mix(${focusTint(dark)}, ${card}, 5%)`) +
        buttonCss(CALENDAR_TODAY, today, dark);
}

// GNOME's own delay before fading out the snapshot of the old screen.
const TRANSITION_DELAY = 250;

const DTP_UUID = 'dash-to-panel@jderose9.github.com';
// Dash to Panel settings read through this extension: its custom panel color (always off)
// and its window preview title color.
const DTP_FORCED_OFF = ['trans-use-custom-bg'];
const DTP_TITLE_KEY = 'window-preview-title-font-color';
// The desktop right-click menu entry.
const MENU_TITLE = 'Shell Color Manager…';

const rule = (selector, prop, value) => `${selector} {\n  ${prop}: ${value};\n}\n`;
const insensitive = selectors => inStates(selectors, [':insensitive']);

// "Idle button text and icons": Quick Settings toggles (titles and subtitles) and their
// arrows, the round buttons at the top, the slider buttons and the sliders' handles.
// Toggles that are on get "Active button text and icons" afterwards (activeTextCss).
const QS_TEXT = ['.quick-settings .button', '.quick-settings .icon-button'];
// The sliders' handle is drawn in their text color, also when hovered; the arrows (›) are
// set in every state, which the light template colors one by one.
const QS_SLIDER = '.quick-slider .slider';
const QS_IDLE_TEXT = [...QS_TEXT, QS_SLIDER, `${QS_SLIDER}:hover`,
    '.quick-toggle-has-menu .quick-toggle-menu-button:hover', '.quick-toggle-has-menu .quick-toggle-menu-button:focus',
    '.quick-toggle-has-menu .quick-toggle-menu-button:active', '.quick-settings .quick-toggle .quick-toggle-subtitle'];
const quickSettingsTextCss = color => color ? rule(QS_IDLE_TEXT.join(', '), 'color', color) +
    rule(insensitive(QS_TEXT), 'color', `st-transparentize(${color}, 0.5)`) : '';

// "Active button text and icons": Quick Settings toggles that are on (and their arrows and
// subtitles), and the icon of the menu they open. GNOME's own: the accent's text color.
const QS_ACTIVE = ['.quick-settings .quick-toggle:checked',
    '.quick-settings .quick-toggle-has-menu .quick-toggle-menu-button:checked'];
const QS_ACTIVE_TEXT = [...QS_ACTIVE, '.quick-settings .quick-toggle:checked .quick-toggle-subtitle',
    '.quick-toggle-menu .header .icon.active'];
function activeTextCss(color) {
    return rule(QS_ACTIVE_TEXT.join(', '), 'color', color) +
        rule(insensitive(QS_ACTIVE), 'color', `st-transparentize(${color}, 0.5)`);
}

// Card text roles. "Card titles and icons" colors the cards (notifications, the calendar,
// Today, World Clocks, Weather) and their titles, icons and buttons, "Card subtitles" only
// the line that comes under a title (a notification's body and time, a location, "No
// Events"...). GNOME dims some titles too (a notification's app name, "Today", "Weather",
// weekends), so each role is set explicitly.
const MAIN_TEXT = [
    '.message', '.events-button', '.world-clocks-button', '.weather-button', '.datemenu-today-button',
    '.message-list-controls', CLEAR_BUTTON, '.notification-button',
    '.calendar .calendar-day',
    '.message .message-header .message-close-button', '.message .message-header .message-expand-button',
    '.message-notification-group .message-collapse-button',
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
    '.calendar .calendar-week-number',
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
// kept); "Search and password text" on their text, and dimmed on their hint.
const ENTRY_SEL = ['.search-entry', '.unlock-dialog .login-dialog-prompt-entry', '.login-dialog .login-dialog-prompt-entry'];
function entriesCss(color, dark) {
    const sel = (list, ...states) => list.flatMap(base => states.map(state => base + state)).join(', ');
    return rule(sel(ENTRY_SEL, '', ':insensitive'), 'background-color', color) +
        rule(sel(ENTRY_SEL, ':hover'), 'background-color', `${shade(dark)}(${color}, 4%)`) +
        rule(sel(ENTRY_SEL, ':focus'), 'background-color', `st-mix(-st-accent-color, ${color}, 5%)`);
}
// "Overview and top bar highlights" on app folders and the dialog a folder opens, search
// result sections, the highlight of a hovered or selected app or search result, and the
// selected app of the Alt+Tab switcher.
const SELECTED = [':selected', ':highlighted', ':checked'];
const FOLDER_APPS = ['.app-folder-dialog .overview-tile', '.app-folder-dialog .grid-search-result'];
const FOLDER_EDIT = '.app-folder-dialog .folder-name-container .icon-button';
const FOLDER_ENTRY = '.app-folder-dialog .folder-name-container .folder-name-entry';
function overviewBoxesCss(color, dark) {
    const adjust = shade(dark);
    const lit = (base, amount) => `${adjust}(${base}, ${amount}%)`;
    const selected = lit(color, 8);
    const hoverStates = SELECTED.map(state => `${state}:hover`);
    const apps = ['.grid-search-result', '.overview-tile'];
    // GNOME's own amounts: folders and the edit button +4% on hover, apps and list results
    // +7%; +9% on click; +8% when selected (then hovered on top). A selected app outside a
    // folder takes the color itself; inside a folder's dialog (painted the same color) +8%.
    return buttonCss(['.app-folder', '.list-search-result', FOLDER_EDIT], color, dark) +
        rule(inStates(['.app-folder', '.list-search-result', ...FOLDER_APPS], SELECTED), 'background-color', selected) +
        rule(inStates('.app-folder', hoverStates), 'background-color', lit(selected, 4)) +
        rule(inStates('.list-search-result', [':hover']), 'background-color', lit(color, 7)) +
        rule(inStates(['.list-search-result', ...FOLDER_APPS], hoverStates), 'background-color', lit(selected, 7)) +
        rule('.search-section-content', 'background-color', color) +
        rule('.app-folder-dialog', 'background-color', color) +
        // The name field of a folder's dialog, with GNOME's hover shade and focus tint.
        rule(inStates(FOLDER_ENTRY, ['', ':insensitive']), 'background-color', color) +
        rule(inStates(FOLDER_ENTRY, [':hover']), 'background-color', lit(color, 4)) +
        rule(inStates(FOLDER_ENTRY, [':focus']), 'background-color', `st-mix(-st-accent-color, ${color}, 5%)`) +
        // The selected app of the Alt+Tab switcher.
        rule('.switcher-list .item-box:selected', 'background-color', color) +
        rule(inStates(apps, [':focus', ...SELECTED]), 'background-color', color) +
        rule(inStates(FOLDER_APPS, [':focus', ...SELECTED]), 'background-color', selected) +
        rule(inStates(apps, [':hover']), 'background-color', lit(color, 7)) +
        rule(inStates(FOLDER_APPS, hoverStates), 'background-color', lit(selected, 7)) +
        rule(inStates(apps, [':active']), 'background-color', lit(color, 9));
}
const entryTextCss = color => rule(inStates(ENTRY_SEL, ['', ':hover', ':focus']), 'color', color) +
    rule(inStates(ENTRY_SEL, [' StLabel.hint-text']), 'color', `st-transparentize(${color}, 0.5)`);

// "Top bar text and icons". The lock and login screens keep GNOME's white text and icons,
// which sit on the wallpaper there.
const panelTextCss = color => rule(PANEL_TEXT_SEL, 'color', color) + rule(PANEL_LOCK_SEL, 'color', '#ffffff') +
    rule(PANEL_DOTS_SEL, 'background-color', color) + rule(PANEL_SHOW_APPS_SEL, 'color', color);

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
const TOP_BAR_KEYS = ['color-general', 'color-panel-fg'];
const OVERVIEW_KEYS = ['color-dash'];
const AUTO_KEYS = ['auto-switch', 'auto-switch-1-time', 'auto-switch-1-mode', 'auto-switch-2-time'];
// How often the automatic switch checks the clock. A check is a few comparisons; checking
// often (instead of one long timer) also catches up right after a suspend.
const AUTO_CHECK_SECONDS = 30;

// Quick Settings button: switches the color sets (profiles) of the current mode, light or
// dark; its menu also opens these preferences (on their first tab, General). The subtitle
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
        // Lit while the colors match a saved color set; off only when they are unsaved.
        this.checked = !!applied;
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
// While locked the extension only keeps its stylesheet loaded, so what
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
        // A mode picked by hand (not by the automatic switch) while the automatic switch is on
        // turns it off, so the choice stays; the preferences say so the next time they open.
        if (scheme === this._autoScheme) {
            this._autoScheme = null;
        } else if (this._autoSwitchOn()) {
            this._settings.set_boolean('auto-switch', false);
            this._settings.set_boolean('auto-switch-off-notice', true);
        }
        this._setLegacyColorScheme(scheme);
        this._applyTheme();
        this._restartTransition();
    }

    // When the style is toggled, GNOME fades out a snapshot of the old screen. Rebuilding the
    // theme blocks the shell long enough for that fade to be skipped, so it is restarted
    // once the new theme is in place, with the duration chosen in the General tab.
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

    // Quick Settings menus are prepared as a toggle opens one (_prepareMenu), in whatever
    // panel it is: GNOME's, a copy another extension makes, or a panel built with libpanel
    // (Quick Settings Audio Panel), which also rebuilds GNOME's own after this extension
    // starts. QuickToggleMenu.open() is wrapped for that while the extension is enabled
    // (QuickToggleMenu is not exported: its prototype comes from a throwaway item).
    //
    // no-qs-dimming: while one of its menus is open, a panel is darkened with a Clutter effect
    // (not CSS) from _setDimmed(). GNOME's QuickSettingsMenu (and its copies) gets a
    // _setDimmed() that does nothing; libpanel panels, which dim themselves with their own,
    // get an empty one as a menu of theirs opens.
    //
    // Menu heights (always fixed): GNOME measures an expanded menu, and the room the buttons
    // below make for it, with get_preferred_height(-1): at no particular width. Text that wraps
    // (Bluetooth off: "Turn on Bluetooth to connect to devices") then counts as one line and
    // the menu covers the buttons below (GNOME issue 7622). Both are measured at the width of
    // the menus' overlay instead, in any language: the menu as it opens, and the panel grid's
    // placeholder, whose height the Quick Settings layout reads as the room for an open menu
    // (bound to the overlay by a constraint that measures it in C, at -1, so the placeholder's
    // own get_preferred_height() is replaced).
    //
    // `enabled` false (disable()) undoes everything.
    _syncQsMenus(enabled = true) {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        const undim = enabled && this._settings.get_boolean('no-qs-dimming');
        this._fixMenuHeight = enabled;

        if (undim && !this._noDimming) {
            // Undo a dimming already in place (a menu open right now).
            if (menu instanceof QuickSettingsMenu)
                menu._setDimmed(false);
            this._noDimming = () => {};
            this._override(QuickSettingsMenu.prototype, '_setDimmed', this._noDimming);
        } else if (!undim && this._noDimming) {
            this._restore(this._noDimming);
            this._restoreAll(this._undimmed);
            this._noDimming = null;
            if (menu instanceof QuickSettingsMenu)
                menu._setDimmed(!!menu._activeMenu);
        }
        if (!this._fixMenuHeight)
            this._restoreAll(this._fixedPlaceholders);

        if (enabled && !this._menuOpen) {
            const item = new QuickSettingsItem({hasMenu: true});
            const proto = Object.getPrototypeOf(item.menu);
            item.menu.destroy();
            item.destroy();
            const open = proto.open;
            const extension = this;
            this._menuOpen = function (animate) {
                extension._prepareMenu(this);
                if (!extension._fixMenuHeight)
                    return open.call(this, animate);
                const {actor} = this;
                actor.get_preferred_height = heightAtWidth(actor, () => actor.get_parent()?.width ?? 0);
                try {
                    return open.call(this, animate);
                } finally {
                    delete actor.get_preferred_height;
                }
            };
            this._override(proto, 'open', this._menuOpen);
        } else if (!enabled && this._menuOpen) {
            this._restore(this._menuOpen);
            this._menuOpen = null;
            for (const [toggle, box] of this._activeMenus ?? []) {
                toggle.disconnectObject(this);
                box.remove_style_class_name(ACTIVE_MENU_CLASS);
            }
            this._activeMenus = null;
        }
    }

    // Puts back the methods replaced for each object of `map` (object -> replacement).
    _restoreAll(map) {
        for (const fn of map?.values() ?? [])
            this._restore(fn);
        map?.clear();
    }

    // A Quick Settings toggle opens `menu` (see _syncQsMenus).
    _prepareMenu(menu) {
        const toggle = menu.sourceActor;
        // "Active expanded menu background": the menu has ACTIVE_MENU_CLASS while its toggle is
        // on, so the stylesheet can tell it apart.
        this._activeMenus ??= new Map();
        if (toggle && menu.box && !this._activeMenus.has(toggle)) {
            const sync = () => menu.box[toggle.checked ? 'add_style_class_name' : 'remove_style_class_name'](
                ACTIVE_MENU_CLASS);
            this._activeMenus.set(toggle, menu.box);
            toggle.connectObject('notify::checked', sync, 'destroy', () => this._activeMenus?.delete(toggle), this);
            sync();
        }
        // The libpanel panels holding the menu get an empty _setDimmed().
        if (this._noDimming) {
            this._undimmed ??= new Map();
            for (let panel = menu.actor; panel; panel = panel.get_parent()) {
                if (panel._dimEffect && typeof panel._setDimmed === 'function' && !this._undimmed.has(panel)) {
                    const noop = () => {};
                    this._undimmed.set(panel, noop);
                    this._override(panel, '_setDimmed', noop);
                }
            }
        }
        // The placeholder of the grid holding the toggle is measured at the overlay's width.
        const overlay = menu.actor?.get_parent();
        const placeholder = toggle?.get_parent()?.layout_manager?._overlay;
        this._fixedPlaceholders ??= new Map();
        if (this._fixMenuHeight && overlay && placeholder && !this._fixedPlaceholders.has(placeholder)) {
            const height = heightAtWidth(overlay, () => overlay.width);
            this._fixedPlaceholders.set(placeholder, height);
            this._override(placeholder, 'get_preferred_height', height);
        }
    }

    // ---------- Automatic switch ----------
    // Two times of day: the first sets the chosen mode, the second the opposite one. The
    // most recent switch time that has passed is applied once (its moment is kept in dconf).
    // A mode picked by hand while it is on turns the automatic switch off (_schemeChanged).

    // Whether the automatic switch is on: enabled, with two different times.
    _autoSwitchOn() {
        const [t1, t2] = this._autoTimes();
        return this._settings.get_boolean('auto-switch') && t1 !== t2;
    }

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
        if (this._getColorScheme() !== latest.scheme) {
            // Remembered, so _schemeChanged() knows this change is not a manual one.
            this._autoScheme = latest.scheme;
            this._interface.set_string('color-scheme', latest.scheme);
        }
    }

    // Changing the schedule (on, times or mode) applies its current mode right away. At login
    // only a switch time newer than the last applied one does. Equal times count as off,
    // even with "Enable" on.
    _syncAutoSwitch(changed = false) {
        this._clearSource('_autoId');
        if (!this._autoSwitchOn())
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
    // With override-dtp-colors, Dash to Panel reads two of its own settings through this
    // extension: no custom panel color, so it takes the color from the loaded stylesheets
    // (its own default behavior), and window preview titles in black or white to match the
    // shell. Its settings are never written, and everything else it does (its opacity,
    // gradients, borders, preview opacity...) is left as it is.
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

    // The colors of a mode by row name ('fg', 'card'...): empty means system default, and
    // "accent" (the default of some rows) the accent color set in GNOME Settings.
    _colors(dark) {
        return Object.fromEntries(ROW_NAMES.map(n => {
            const value = this._settings.get_string(`color-${n}${dark ? '-dark' : ''}`).trim();
            return [n, value === 'accent' ? '-st-accent-color' : COLOR_RE.test(value) ? value : ''];
        }));
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
        return keys.some(key => {
            if (TOP_BAR_KEYS.includes(key))
                return true;
            if (OVERVIEW_KEYS.includes(key))
                return Main.overview.visible;
            return !!Main.panel.menuManager?.activeMenu;
        });
    }

    _wantsForcedDark() {
        return !this._isDark() && Object.values(this._colors(false)).every(v => !v);
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
    // "Volume and brightness sliders": the filled part of every slider and of the volume and
    // brightness popup (OSD). "Active button background" and "Active button text and icons"
    // also paint today in the calendar (in all its states), after textRolesCss.
    _highlightCss(c, dark) {
        return (c.highlight ? rule('.slider, .osd-window .level', '-barlevel-active-background-color', c.highlight) : '') +
            (c['qs-active'] ? buttonCss(CALENDAR_TODAY, c['qs-active'], dark) : '') +
            (c['qs-active-fg'] ? rule(CALENDAR_TODAY, 'color', c['qs-active-fg']) : '');
    }

    // The media player: the card of the music or video playing (a notification with the
    // media-message class) takes "Active button background", and its playback buttons light up
    // from it on hover and click by the same amounts as buttons; its text and icons take
    // "Active button text and icons". Empty, they keep GNOME's own colors, also when the
    // cards' colors are set.
    _mediaCss(c, dark, native) {
        const {'qs-active-fg': fg, 'qs-active': bg} = c;
        let css = '';
        if (bg) {
            // The pointer over a button is also over the card, which is lit 4% (buttonCss): the
            // button lights up from that.
            css += buttonCss(MEDIA_CARD, bg, dark) + litCss(MEDIA_CONTROL, `${shade(dark)}(${bg}, 4%)`, dark);
        } else if (c.card) {
            css += buttonCss(MEDIA_CARD, native.media, dark);
        }
        if (fg) {
            css += rule([...MEDIA_TEXT, MEDIA_CONTROL, `${MEDIA_CONTROL}:hover`, `${MEDIA_CONTROL}:active`].join(', '),
                'color', fg) +
                rule(`${MEDIA_CONTROL}:insensitive`, 'color', `st-transparentize(${fg}, 0.5)`);
        } else if (c.fg || c['fg-muted']) {
            css += rule(MEDIA_HEADER.join(', '), 'color', native.header) + rule(MEDIA_BODY.join(', '), 'color', native.text);
        }
        return css;
    }

    // The top bar's part of "Shell background"; nothing is written on system default, so the
    // top bar stays as GNOME or other extensions draw it.
    _panelCss(panel) {
        if (!panel)
            return '';
        // GNOME draws the top bar of the lock and login screens transparent, over the
        // wallpaper. Extension stylesheets outrank GNOME's whatever the specificity, so the
        // #panel rule above would make it solid there (seen after resuming from suspend,
        // which shows the lock screen); this rule gives those screens their transparent
        // top bar back.
        return rule('#panel', 'background-color', panel) +
            rule(PANEL_LOCK_BAR_SEL, 'background-color', 'transparent');
    }

    // "Menu borders": the border of menus and cards (GNOME's own on system default). Expanded
    // Quick Settings menus have none. The "Borders" choices of the General tab: "Disable menu
    // borders" hides them all, with the cards' faint shadow (hidden borders stay 1px wide but
    // transparent, so nothing changes size), and turns the others off. "Active Quick Settings
    // button" and "Idle Quick Settings button" outline those buttons and the menus they open,
    // and "Notification buttons" the notifications' buttons, the Clear button and the Do Not
    // Disturb switch, with the Menu borders color (GNOME's faint card border when empty).
    // Outlines are drawn as an outer shadow, so nothing changes size.
    _borderCss(color, dark) {
        if (this._settings.get_boolean('hide-borders')) {
            return rule(`${BORDER_SEL}, ${QS_MENU}`, 'border-color', 'transparent') +
                rule(CARD_OUTLINE_SEL, 'border-color', 'transparent !important') + rule(CARD_OUTLINE_SEL, 'box-shadow', 'none');
        }
        const css = color ? rule(BORDER_SEL, 'border-color', color) + rule(CARD_OUTLINE_SEL, 'border-color', `${color} !important`)
            : '';
        const outline = color || `st-transparentize(${NATIVE[dark ? 'dark' : 'light'].text}, 0.9)`;
        const notifications = this._settings.get_boolean('notification-borders')
            ? rule([...NOTIFICATION_BUTTONS, CLEAR_BUTTON, DND_SWITCH].join(', '), 'box-shadow', `0 0 0 1px ${outline}`) : '';
        // Idle and active Quick Settings buttons, each with the menus they open.
        const [idle, active] = [this._settings.get_boolean('qs-borders'), this._settings.get_boolean('qs-active-borders')];
        let qs = rule(QS_MENU, 'border-color', idle ? outline : 'transparent') +
            rule(QS_ACTIVE_MENU, 'border-color', active ? outline : 'transparent');
        if (idle)
            qs += rule(QS_OUTLINED, 'box-shadow', `0 0 0 1px ${outline}`) + rule(QS_NOT_OUTLINED, 'box-shadow', 'none');
        if (active) {
            qs += rule('.quick-toggle:checked, .quick-toggle-has-menu:checked', 'box-shadow', `0 0 0 1px ${outline}`) +
                rule('.quick-toggle-has-menu .quick-toggle', 'box-shadow', 'none');
        }
        return css + qs + notifications;
    }

    // The stylesheet of a mode, over GNOME's own style: the rules of every color row and
    // General tab option, the same in both modes. With every light color on system default
    // (GNOME color set) the shell keeps GNOME's dark style (see _syncShellScheme), and only
    // the General tab options apply.
    _themeCss(dark) {
        const c = this._colors(dark);
        const style = dark || Object.values(c).every(v => !v);
        const native = NATIVE[style ? 'dark' : 'light'];
        // Expanded Quick Settings menus 1px narrower on each side.
        let css = rule(QS_MENU, 'margin-left', '19px') + rule(QS_MENU, 'margin-right', '19px');
        // "Shell background": menus, OSD, switchers, the top bar, the overview and dialogs.
        if (c.general)
            css += rule(`${GENERAL_SEL}, ${OPAQUE_SEL}`, 'background-color', c.general) + this._panelCss(c.general);
        // "Shell text and icons": top bar, menus, OSD, switchers, app grid, overview, and the
        // search and password fields (their hint dimmed).
        const text = c['panel-fg'];
        if (text) {
            css += panelTextCss(text) + rule(MENU_TEXT, 'color', text) + rule(GRID_TEXT, 'color', text) +
                rule(OVERVIEW_TEXT, 'color', text) + rule(OVERVIEW_DIM_TEXT, 'color', `st-transparentize(${text}, 0.3)`) +
                entryTextCss(text);
        }
        if (c.dash) {
            const dash = c.dash;
            css += rule('#dash .dash-background', 'background-color', dash) +
                entriesCss(dash, style) + panelButtonsCss(dash) + overviewBoxesCss(dash, style);
        }
        // Card text, Quick Settings text and, after the subtitles so a toggle that is on keeps
        // its own, "Active button text and icons".
        css += textRolesCss(c.fg, c['fg-muted']) + quickSettingsTextCss(c['qs-fg']);
        if (c['qs-fg'] || c['qs-active-fg'])
            css += activeTextCss(c['qs-active-fg'] || '-st-accent-fg-color');
        // Cards, Quick Settings and "Calendar as card" (GNOME's own card color on system default).
        const card = c.card || native.card;
        if (c.card) {
            // Stacked notifications behind the first get GNOME's darker shades (1% and 4% in
            // dark style, 4% and 7% in light style).
            css += buttonCss(CARD_BUTTONS, card, style) +
                rule('.message:second-in-stack', 'background-color', `st-darken(${card}, ${style ? 1 : 4}%)`) +
                rule('.message:lower-in-stack', 'background-color', `st-darken(${card}, ${style ? 4 : 7}%)`) +
                rule(DND_SWITCH, 'background-color', card) +
                rule(`${DND_SWITCH}:hover`, 'background-color', `${shade(style)}(${card}, 4%)`) +
                rule(`${DND_SWITCH}:checked`, 'background-color', '-st-accent-color') +
                rule(`${DND_SWITCH}:checked:hover`, 'background-color', 'st-lighten(-st-accent-color, 5%)');
        }
        css += this._quickSettingsCss(style, c, {
            toggle: toggleOff(style), arrow: arrowOff(style), arrowChecked: arrowChecked(style), menu: toggleOff(style),
        });
        if (this._settings.get_boolean('calendar-background'))
            css += calendarCss(card, style, c['qs-active'] || '-st-accent-color');
        return css + this._highlightCss(c, style) + this._mediaCss(c, style, native) + this._borderCss(c.border, style);
    }

    // Idle Quick Settings buttons, the menus they open and the arrow buttons. An empty color
    // uses `native`: GNOME's own toggle, arrow (off, checked) and open menu colors.
    _quickSettingsCss(dark, c, native) {
        // "Idle button background" and "Active button background" also paint the menus the
        // toggles open, and "Idle button text and icons" their text.
        const {'qs-button': color, 'qs-active': active} = c;
        const [menu, activeMenu, menuText] = [color, active, c['qs-fg']];
        // "Active button background": toggles that are on and their arrows. GNOME's own: the
        // accent color.
        const accent = active || '-st-accent-color';
        // "Merge arrows into toggles": each arrow takes its toggle's color, without the gap line.
        const match = this._settings.get_boolean('merge-arrow-buttons');
        // The sliders' track (the part not filled) takes "Idle button background".
        const merged = (match ? rule(ARROW_GAP_SEL, 'width', '0') : '') +
            (color ? rule(QS_SLIDER, '-barlevel-background-color', color) : '');
        let css;
        if (color) {
            const amount = ARROW_SHADE[dark ? 'dark' : 'light'];
            let arrow = color ? `${shade(dark)}(${color}, ${amount}%)` : native.arrow;
            if (match)
                arrow = color || native.toggle;
            // With a color, the Background Apps toggle (flat in GNOME) and the close buttons of
            // its apps take it too.
            css = buttonCss(QS_BUTTONS, color, dark) +
                buttonCss(QS_CHECKED, accent, dark) +
                (color ? buttonCss([QS_FLAT, BACKGROUND_APP_CLOSE], color, dark)
                    : rule(QS_FLAT, 'background-color', 'transparent')) +
                buttonCss(ARROW_SEL, arrow, dark);
        } else {
            css = (match ? buttonCss(ARROW_SEL, native.toggle, dark) : '') +
                (active ? buttonCss(QS_CHECKED, accent, dark) : '');
        }
        // Idle menus: background, outline, the circle behind the heading icon, and text; the
        // active menus' likewise.
        let menus = (menu ? menuCss(menu, dark) + rule(QS_MENU_ICON, 'background-color', menu) : '') +
            (menuText ? menuTextCss(menuText) : '');
        if (activeMenu) {
            // Their heading and items take "Active button text and icons".
            menus += menuCss(activeMenu, dark, QS_ACTIVE_MENU) +
                rule(QS_MENU_ICON_ON, 'background-color', activeMenu) +
                menuTextCss(c['qs-active-fg'] || '-st-accent-fg-color', QS_ACTIVE_MENU);
        } else {
            // On system default, the idle menu's colors are taken off the active menu.
            menus += (menu ? menuCss(native.menu, dark, QS_ACTIVE_MENU) : '') +
                (menuText ? menuTextCss(NATIVE[dark ? 'dark' : 'light'].text, QS_ACTIVE_MENU) : '');
        }
        if (!css)
            return merged + menus;
        css += menus;
        // Set again after the off colors, which would otherwise also cover the checked arrow.
        const arrowOn = match ? accent : native.arrowChecked.replaceAll('-st-accent-color', accent);
        css = merged + css + buttonCss(`${ARROW_SEL}:checked`, arrowOn, dark);
        return css;
    }

    // `fade`: fade from the old look to the new one, as when switching modes.
    _applyTheme(fade = false) {
        // A pending delayed apply would only repeat this one.
        this._clearSource('_applyId');
        let file = null;
        let faded = false;
        try {
            // "Use GNOME colors on the lock screen": no stylesheet while locked.
            const css = this._themeCss(this._isDark());
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
        const syncs = {
            'background-menu-entry': () => this._syncBackgroundMenu(),
            'override-dtp-colors': () => this._syncDtp(),
            'quick-settings-profiles': () => this._syncQuickSettings(),
            'no-qs-dimming': () => this._syncQsMenus(),
        };
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (syncs[key])
                syncs[key]();
            else if (AUTO_KEYS.includes(key))
                this._syncAutoSwitch(true);
            else if (THEME_KEYS[Number(this._isDark())].includes(key))
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
        });
        this._syncQuickSettings();
        this._syncQsMenus();

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
        this._syncQsMenus(false);
        if (this._forcedDark) {
            Main.sessionMode.colorScheme = this._modeScheme;
            St.Settings.get().notify('color-scheme');
        }
        if (this._getColorScheme() === 'prefer-light')
            this._interface.set_string('color-scheme', 'default');
        // Legacy GTK 3 apps stay on the scheme that remains.
        this._setLegacyColorScheme(this._getColorScheme());

        this._settings = this._interface = this._cacheDir = null;
        this._lastCss = this._modeScheme = this._autoScheme = this._overrides = this._changedKeys = null;
    }
}
