import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

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

// Top bar text. The lock/login screen keeps its white text.
const PANEL_TEXT_SEL = '#panel .panel-button, #panel .panel-button.clock-display, ' +
    '#panel:overview .panel-button, #panel:overview .panel-button.clock-display';
const PANEL_LOCK_SEL = '#panel.unlock-screen .panel-button, #panel.login-screen .panel-button, ' +
    '#panel.unlock-screen .panel-button.clock-display, #panel.login-screen .panel-button.clock-display';

// Dark mode has no template: each setting overrides a list of elements.
// [selectors, property, setting key]
const DARK_RULES = [
    [[
        '#panel', '.popup-menu-content', '.candidate-popup-content', '.modal-dialog',
        '.switcher-list', '.osd-window', '.workspace-switcher', '.resize-popup',
    ], 'background-color', 'color-general-dark'],
    [[
        '.notification-banner', '#dash .dash-background', '.search-section-content', '.app-folder-dialog',
    ], 'background-color', 'color-card-dark'],
    [[
        'stage', '.popup-menu', '.popup-menu-item', '.popup-inactive-menu-item', '.message',
        '.quick-toggle-menu', '.events-button', '.world-clocks-button', '.weather-button',
        '.datemenu-today-button', '.calendar .calendar-day', '.calendar .calendar-month-header .calendar-month-label',
        '.modal-dialog', '.osd-window', '.switcher-list .item-box', '.overview-tile', '.grid-search-result',
        '.list-search-result', '.search-section-content', '.app-folder-dialog',
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
const DARK_CARD_BUTTONS = ['.quick-toggle-menu', '.message', '.events-button', '.world-clocks-button', '.weather-button'];

// Color settings of each mode.
const LIGHT_KEYS = [...new Set(TOKENS.map(([key]) => key)), 'color-border'];
const DARK_KEYS = DARK_RULES.map(([, , key]) => key);
// Settings that rebuild the theme of each mode (colors and General tab options);
// other keys (profiles...) never do.
const EFFECT_KEYS = ['general-opacity', 'panel-opacity', 'hide-borders', 'match-arrow-buttons', 'calendar-background'];
const LIGHT_THEME_KEYS = [...LIGHT_KEYS, ...EFFECT_KEYS];
const DARK_THEME_KEYS = [...DARK_KEYS, 'color-border-dark', ...EFFECT_KEYS];

// Accepted color values: #rgb, #rrggbb, rgb()/rgba() or a name. Anything else (edited in
// dconf or imported) counts as system default, so it can never break the stylesheet.
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([\d\s.,]+\)|[a-z]+)$/i;

// The template's own top bar color (templates/light.css), for a general background on
// system default.
const TEMPLATE_PANEL = '#f5f5f5';

// The menus' border: Quick Settings, the calendar and notifications, panel and context menus.
const BORDER_SEL = '.popup-menu-content, .candidate-popup-content';

// The overview keeps an opaque general background, whatever the general opacity.
const DARK_OVERVIEW_SEL = '#overviewGroup';
// Light template rules of the overview that use the general background.
const LIGHT_OVERVIEW_RE = /overview|app-folder|grid-search-result/;

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

// Quick Settings arrow buttons ("›") in the same color as their toggle, in every state.
// GNOME gives them a shade of their own; these are the expressions GNOME 48 uses for the
// toggle itself (.button when off, .quick-toggle:checked when on). Light mode uses the
// template's tokens, filled in like the rest of the template.
const ARROW_SEL = '.quick-toggle-has-menu .quick-toggle-menu-button';
function arrowCss(dark) {
    const off = dark ? 'st-mix(#ffffff, #36363a, 9%)' : 'st-mix(#222226, whitesmoke, 12%)';
    return buttonCss(ARROW_SEL, off, dark) + buttonCss(`${ARROW_SEL}:checked`, '-st-accent-color', dark);
}

// Calendar background: the month calendar gets the color of the cards below it (Today,
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
        rule(flat(''), 'background-color', 'transparent') +
        rule(flat(':hover'), 'background-color', `${adjust}(${card}, 7%)`) +
        rule(flat(':active', ':selected'), 'background-color', `${adjust}(${card}, 10%)`) +
        rule(flat(':active:hover', ':selected:hover'), 'background-color', `${adjust}(${card}, 14%)`) +
        rule(flat(':focus'), 'background-color', `st-mix(${focusTint(dark)}, ${card}, 5%)`) +
        buttonCss(CALENDAR_TODAY, '-st-accent-color', dark);
}

// GNOME 48's own (dark) backgrounds of the general background elements. With the general
// background on system default (GNOME profile) the shell uses this dark style in both
// modes, so the opacity is applied to these colors.
const NATIVE_GENERAL = [
    ['#panel', '#000000'],
    ['.popup-menu-content, .candidate-popup-content, .modal-dialog', '#36363a'],
    ['.switcher-list, .osd-window, .workspace-switcher, .resize-popup', '#2e2e33'],
];

// GNOME's own delay before fading out the snapshot of the old screen.
const TRANSITION_DELAY = 250;

// Dash to Panel offers its own settings for extra entries in its panel right-click menu.
const DTP_UUID = 'dash-to-panel@jderose9.github.com';
const DTP_SCHEMA = 'org.gnome.shell.extensions.dash-to-panel';
const MENU_TITLE = 'Light Mode Manager';

const rule = (selector, prop, value) => `${selector} {\n  ${prop}: ${value};\n}\n`;
const noShadowCss = rule(SHADOW_SEL, 'box-shadow', 'none');
const panelTextCss = color => rule(PANEL_TEXT_SEL, 'color', color) + rule(PANEL_LOCK_SEL, 'color', '#ffffff');

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

// The general background with the opacity from the General tab. Any alpha already in the
// color (older settings or profiles) is ignored: the General tab is the only source.
// A solid color without alpha is kept as written.
function withOpacity(value, opacity) {
    const rgb = value ? colorToRgb(value) : null;
    if (!rgb || (opacity >= 100 && !/^rgba/i.test(value)))
        return value;
    return `rgba(${rgb}, ${opacity / 100})`;
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

const PROFILE_ICON = 'preferences-desktop-appearance-symbolic';

const AUTO_KEYS = ['auto-switch', 'auto-switch-1-time', 'auto-switch-1-profile', 'auto-switch-2-time', 'auto-switch-2-profile'];
// How often the automatic switch checks the clock. A check is a few comparisons; checking
// often (instead of one long timer) also catches up right after a suspend.
const AUTO_CHECK_SECONDS = 30;

// Quick Settings button: shows the applied general profile and switches it from its menu.
const ProfileToggle = GObject.registerClass(
class ProfileToggle extends QuickMenuToggle {
    _init(settings) {
        super._init({title: 'Profile', iconName: PROFILE_ICON, toggleMode: false});
        this._profiles = createProfiles(settings).general;
        this.menu.setHeader(PROFILE_ICON, 'General profile');
        this._items = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._items);
        this.connect('clicked', () => this.menu.open());

        // Applying a profile changes several keys at once; rebuild only once.
        for (const key of this._profiles.keys)
            settings.connectObject(`changed::${key}`, () => this._queueSync(), this);
        this._sync();
    }

    _queueSync() {
        this._syncId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const profiles = this._profiles.all();
        const applied = this._profiles.applied(profiles);
        this.subtitle = applied?.name ?? 'Custom';
        this._items.removeAll();
        for (const profile of profiles) {
            const item = new PopupMenu.PopupMenuItem(profile.name);
            item.setOrnament(profile === applied ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._profiles.apply(profile));
            this._items.addMenuItem(item);
        }
    }

    destroy() {
        if (this._syncId)
            GLib.Source.remove(this._syncId);
        this._syncId = 0;
        super.destroy();
    }
});

const ProfileIndicator = GObject.registerClass(
class ProfileIndicator extends SystemIndicator {
    _init(settings) {
        super._init();
        this.quickSettingsItems.push(new ProfileToggle(settings));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

// Runs in the "user" and "unlock-dialog" session modes (metadata.json): staying enabled
// while locked keeps the theme on the lock screen and avoids a full stylesheet reload on
// every lock/unlock. Nothing interactive is shown while locked (see _syncQuickSettings);
// only colors are applied and the automatic switch keeps running.
export default class LightModeManagerExtension extends Extension {
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
    // Shown when enabled, but never on the lock screen.
    _syncQuickSettings() {
        const show = this._settings.get_boolean('quick-settings-profiles') && !Main.sessionMode.isLocked;
        if (show && !this._indicator) {
            this._indicator = new ProfileIndicator(this._settings);
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // ---------- Automatic switch ----------
    // The switch (1 or 2) whose time passed most recently at `minutes` past midnight,
    // or 0 if both times are equal.
    _currentSwitch(minutes) {
        const [t1, t2] = [1, 2].map(i => this._settings.get_int(`auto-switch-${i}-time`));
        if (t1 === t2)
            return 0;
        // Between the earlier and the later time, the earlier switch is the current one.
        const [first, second] = t1 < t2 ? [1, 2] : [2, 1];
        return minutes >= Math.min(t1, t2) && minutes < Math.max(t1, t2) ? first : second;
    }

    // Applies the current switch's general profile once each time a switch time passes,
    // so a profile chosen by hand in between is kept until the next switch.
    _checkAutoSwitch() {
        const now = GLib.DateTime.new_now_local();
        const current = this._currentSwitch(now.get_hour() * 60 + now.get_minute());
        if (!current || current === this._lastSwitch)
            return;
        this._lastSwitch = current;
        const name = this._settings.get_string(`auto-switch-${current}-profile`);
        const general = this._profiles.general;
        const profile = general.all().find(p => p.name === name);
        if (profile)
            general.apply(profile);
    }

    // Turning it on, or changing a time or profile, applies the current switch right away.
    _syncAutoSwitch() {
        if (this._autoId) {
            GLib.Source.remove(this._autoId);
            this._autoId = 0;
        }
        this._lastSwitch = 0;
        if (!this._settings.get_boolean('auto-switch'))
            return;
        this._checkAutoSwitch();
        this._autoId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_CHECK_SECONDS, () => {
            this._checkAutoSwitch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ---------- Dash to Panel colors ----------
    // Dash to Panel paints each of its panels with an inline style from its own color and
    // opacity settings, and St always ranks inline styles above stylesheets. With
    // override-dtp-colors, that inline background is replaced with the theme's panel color
    // each time Dash to Panel sets it, and restored when turned off. Dash to Panel's
    // settings and code are never changed.

    // The background the loaded stylesheets give #panel: this extension's color, opacity and
    // "Enable panel opacity", or GNOME's own with the GNOME profile. Read from a hidden probe,
    // as Dash to Panel does, so no inline style is involved.
    _themePanelColor() {
        const probe = new St.Bin({name: 'panel'});
        Main.uiGroup.add_child(probe);
        const c = probe.get_theme_node().get_background_color();
        probe.destroy();
        return `rgba(${c.red}, ${c.green}, ${c.blue}, ${+(c.alpha / 255).toFixed(3)})`;
    }

    _syncDtpPanels() {
        this._unhookDtpPanels();
        const dtp = global.dashToPanel;
        if (!dtp || !this._settings.get_boolean('override-dtp-colors'))
            return;
        // Dash to Panel recreates its panels on monitor or layout changes.
        this._dtp = dtp;
        this._dtpCreatedId = dtp.connect('panels-created', () => this._syncDtpPanels());
        this._dtpColor = this._themePanelColor();
        this._dtpPanels = new Map();
        for (const panel of dtp.panels ?? []) {
            this._dtpPanels.set(panel, {original: panel.get_style() ?? '', ours: null});
            panel.connectObject(
                'notify::style', () => this._overrideDtpPanel(panel),
                'destroy', () => this._dtpPanels?.delete(panel),
                this);
            this._overrideDtpPanel(panel);
        }
    }

    // Keeps Dash to Panel's own style (transition...) with the theme's background.
    _overrideDtpPanel(panel) {
        const state = this._dtpPanels?.get(panel);
        if (!state)
            return;
        const style = panel.get_style() ?? '';
        if (style !== state.ours)
            state.original = style;
        const next = `background-color: ${this._dtpColor}; ${state.original.replace(/background-color:[^;]*;?\s*/g, '')}`;
        state.ours = next;
        if (style !== next)
            panel.set_style(next);
    }

    _unhookDtpPanels() {
        for (const [panel, state] of this._dtpPanels ?? []) {
            panel.disconnectObject(this);
            if (panel.get_style() === state.ours)
                panel.set_style(state.original);
        }
        this._dtpPanels = null;
        if (this._dtpCreatedId)
            this._dtp?.disconnect(this._dtpCreatedId);
        this._dtp = null;
        this._dtpCreatedId = 0;
    }

    // ---------- Dash to Panel menu entry ----------
    _dtpSettings() {
        const dir = Main.extensionManager.lookup(DTP_UUID)?.dir.get_child('schemas');
        if (!dir?.query_exists(null))
            return null;
        const source = Gio.SettingsSchemaSource.new_from_directory(
            dir.get_path(), Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(DTP_SCHEMA, false);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    }

    // Adds or removes our entry in Dash to Panel's own list of extra menu entries
    // (panel-context-menu-commands/titles). Only our entry is ever added or removed; the
    // user's entries are left untouched. Removed again in disable().
    _syncPanelMenu(show) {
        try {
            const dtp = this._dtpSettings();
            if (!dtp)
                return;
            const commands = dtp.get_strv('panel-context-menu-commands');
            const titles = dtp.get_strv('panel-context-menu-titles');
            const command = `gnome-extensions prefs ${this.uuid}`;
            const i = commands.indexOf(command);
            if (show === (i >= 0) || commands.length !== titles.length)
                return;
            if (show) {
                commands.push(command);
                titles.push(MENU_TITLE);
            } else {
                commands.splice(i, 1);
                titles.splice(i, 1);
            }
            dtp.set_strv('panel-context-menu-commands', commands);
            dtp.set_strv('panel-context-menu-titles', titles);
        } catch (e) {
            console.error(`[LightModeManager] ${e.message}`);
        }
    }

    // Opacity on GNOME's own general backgrounds, for a general background on system
    // default. The panel only gets it with "Enable panel opacity".
    _nativeOpacityCss() {
        const opacity = this._settings.get_int('general-opacity');
        if (opacity >= 100)
            return '';
        const solid = !this._settings.get_boolean('panel-opacity');
        return NATIVE_GENERAL
            .filter(([selector]) => !(solid && selector === '#panel'))
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

    // Vanilla GNOME keeps the shell dark in light mode. With every light color on system
    // default (the GNOME profile) the shell is forced to its dark style to match.
    // GNOME resets this on every session mode change (lock/unlock), so it is re-synced then.
    _syncShellScheme() {
        const vanilla = !this._isDark() && this._values(LIGHT_KEYS).every(v => !v);
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
    // The menu border rule for the given border color setting (none for the system's).
    // Hidden borders stay 1px wide but transparent, so menus keep their size.
    _borderCss(key) {
        if (this._settings.get_boolean('hide-borders'))
            return rule(BORDER_SEL, 'border-color', 'transparent');
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
        // The overview stays opaque, and the panel too unless "Enable panel opacity".
        if (opaque) {
            css += rule(DARK_OVERVIEW_SEL, 'background-color', opaque);
            if (!this._settings.get_boolean('panel-opacity'))
                css += rule('#panel', 'background-color', opaque);
            if (opacity < 100)
                css += noShadowCss;
        } else {
            css += this._nativeOpacityCss();
        }
        // The top bar text follows "Text and icons".
        const fg = values[DARK_KEYS.indexOf('color-fg-dark')];
        if (fg)
            css += panelTextCss(fg);
        if (this._settings.get_boolean('match-arrow-buttons'))
            css += arrowCss(true);
        const card = values[DARK_KEYS.indexOf('color-card-dark')];
        if (card)
            css += buttonCss(DARK_CARD_BUTTONS, card, true);
        if (this._settings.get_boolean('calendar-background'))
            css += calendarCss(card || NATIVE_CARD, true);
        return css + this._borderCss('color-border-dark');
    }

    // The template is only read when light mode first needs it.
    _template() {
        if (!this._templateHead) {
            const [, bytes] = this.dir.get_child('templates').get_child('light.css').load_contents(null);
            const template = new TextDecoder().decode(bytes);
            const idx = template.indexOf(MARKER);
            this._templateHead = idx >= 0 ? template.slice(0, idx) : template;
            this._templateTail = idx >= 0 ? template.slice(idx) : '';
            // The overview rules that use the general background, to repeat them opaque.
            this._templateOverview = [...this._templateHead.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
                .filter(([, selector, body]) => LIGHT_OVERVIEW_RE.test(selector) &&
                    TOKENS.some(([key, color]) => key === 'color-general' && body.toLowerCase().includes(color)))
                .map(([text]) => text.trim()).join('\n') + '\n';
        }
        return [this._templateHead, this._templateTail, this._templateOverview];
    }

    _lightCss() {
        const values = this._values(LIGHT_KEYS);
        // Every color on system default (GNOME profile): the shell keeps its own dark style
        // (see _syncShellScheme), so only the General tab options apply, on GNOME's colors.
        if (values.every(v => !v))
            return (this._settings.get_boolean('match-arrow-buttons') ? arrowCss(true) : '') +
                (this._settings.get_boolean('calendar-background') ? calendarCss(NATIVE_CARD, true) : '') +
                this._borderCss(null) + this._nativeOpacityCss();

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
        const fill = (text, colors) => text.replace(TOKEN_RE, (m, rgb, alpha, offset) => {
            if (rgb)
                return `rgba(${byRgb[rgb]}, ${alpha})`;
            return (propertyAt(text, offset) === 'color' ? solid : colors)[m.toLowerCase()];
        });

        const [head, tail, overview] = this._template();
        let css = fill(head, faded) + tail;
        // Translucent general background: the overview stays opaque and shadows are removed.
        if (opacity < 100)
            css += fill(overview, solid) + noShadowCss;

        // The template's top bar color is not a token, so it gets its own rule.
        const panel = byKey['color-general'] || TEMPLATE_PANEL;
        css += rule('#panel', 'background-color',
            withOpacity(panel, this._settings.get_boolean('panel-opacity') ? opacity : 100));
        // The top bar text follows "Text and icons".
        if (byKey['color-fg'])
            css += panelTextCss(byKey['color-fg']);
        if (this._settings.get_boolean('match-arrow-buttons'))
            css += fill(arrowCss(false), faded);
        // The template's card color, filled in like the rest of the template.
        if (this._settings.get_boolean('calendar-background'))
            css += fill(calendarCss('#e8e8e8', false), faded);
        return css + this._borderCss('color-border');
    }

    // Loads the stylesheet, then keeps Dash to Panel's panels on this extension's color.
    _applyTheme() {
        // A pending delayed apply would only repeat this one.
        if (this._applyId) {
            GLib.Source.remove(this._applyId);
            this._applyId = 0;
        }
        try {
            this._applyStylesheet();
        } finally {
            if (this._dtpPanels) {
                this._dtpColor = this._themePanelColor();
                this._dtpPanels.forEach((_s, panel) => this._overrideDtpPanel(panel));
            }
        }
    }

    _applyStylesheet() {
        let file = null;
        try {
            this._syncShellScheme();
            const css = this._isDark() ? this._darkCss() : this._lightCss();
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
            console.error(`[LightModeManager] ${e.message}`);
            // Do not leave a file behind that never got loaded.
            if (file && file !== this._themeFile) {
                try {
                    file.delete(null);
                } catch {}
            }
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
            console.error(`[LightModeManager] ${e.message}`);
        }
    }

    _scheduleApply() {
        if (this._applyId)
            GLib.Source.remove(this._applyId);
        this._applyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._applyId = 0;
            this._applyTheme();
            return GLib.SOURCE_REMOVE;
        });
    }

    enable() {
        this._serial = 0;
        this._forcedDark = false;
        this._cacheDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'light-mode-manager']));
        this._clearCache();

        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'panel-menu-entry')
                this._syncPanelMenu(this._settings.get_boolean(key));
            else if (key === 'override-dtp-colors')
                this._syncDtpPanels();
            else if (key === 'quick-settings-profiles')
                this._syncQuickSettings();
            else if (AUTO_KEYS.includes(key))
                this._syncAutoSwitch();
            else if ((this._isDark() ? DARK_THEME_KEYS : LIGHT_THEME_KEYS).includes(key))
                this._scheduleApply();
        });
        this._syncPanelMenu(this._settings.get_boolean('panel-menu-entry'));
        // Dash to Panel may be enabled, disabled or reloaded after this extension.
        Main.extensionManager.connectObject('extension-state-changed', (_m, ext) => {
            if (ext.uuid === DTP_UUID)
                this._syncDtpPanels();
        }, this);

        this._interface = Gio.Settings.new('org.gnome.desktop.interface');
        const current = this._getColorScheme();
        if (current === 'default')
            this._interface.set_string('color-scheme', 'prefer-light');
        this._setLegacyColorScheme(current);
        // Connected after the initial setup so it does not apply the theme twice.
        this._schemeId = this._interface.connect('changed::color-scheme', () => this._schemeChanged());

        this._sessionId = Main.sessionMode.connect('updated', () => {
            this._forcedDark = false;
            this._syncShellScheme();
            this._syncQuickSettings();
        });
        this._syncQuickSettings();

        // Before the first theme, so a profile applied by the automatic switch is built once.
        this._profiles = createProfiles(this._settings);
        this._syncAutoSwitch();
        this._applyTheme();
        this._syncDtpPanels();
    }

    disable() {
        if (this._applyId) {
            GLib.Source.remove(this._applyId);
            this._applyId = 0;
        }
        Main.sessionMode.disconnect(this._sessionId);
        this._settings.disconnect(this._settingsId);
        this._interface.disconnect(this._schemeId);

        this._unloadTheme();
        this._syncPanelMenu(false);
        Main.extensionManager.disconnectObject(this);
        this._unhookDtpPanels();
        this._indicator?.destroy();
        this._indicator = null;
        if (this._autoId) {
            GLib.Source.remove(this._autoId);
            this._autoId = 0;
        }
        this._profiles = null;
        if (this._forcedDark) {
            Main.sessionMode.colorScheme = this._modeScheme;
            St.Settings.get().notify('color-scheme');
        }
        if (this._getColorScheme() === 'prefer-light')
            this._interface.set_string('color-scheme', 'default');
        // Legacy GTK 3 apps stay on the scheme that remains.
        this._setLegacyColorScheme(this._getColorScheme());

        this._settings = this._interface = this._cacheDir = null;
        this._lastCss = this._modeScheme = this._dtpColor = null;
        this._templateHead = this._templateTail = this._templateOverview = null;
    }
}
