import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Everything from this marker on (login/lock screen) is kept as is.
const MARKER = '.login-dialog,\n.unlock-dialog {\n  color: #e1e1e1;';

// [setting key, color used in templates/light.css, same color as "r, g, b"]
const TOKENS = [
    ['color-fg', '#222226', '34, 34, 38'],
    ['color-fg-muted', '#767679', '118, 118, 121'],
    ['color-card', '#e8e8e8', '232, 232, 232'],
    ['color-surface', '#dcdcdc', '220, 220, 220'],
    ['color-dash', '#cecece', '206, 206, 206'],
    ['color-overview', '#e1e1e1', '225, 225, 225'],
    ['color-popup', 'whitesmoke', '245, 245, 245'],
];

// Matches the panel placeholder, every token color and its rgba() variants.
const TOKEN_RE = new RegExp(
    `##F5F5F5|${TOKENS.map(([, c]) => c.startsWith('#') ? `${c}\\b` : `\\b${c}\\b`).join('|')}|` +
    `rgba\\((${TOKENS.map(([, , rgb]) => rgb).join('|')}), ([\\d.]+)\\)`,
    'gi');

// Top bar text. The lock/login screen keeps its white text.
const PANEL_TEXT_SEL = '#panel .panel-button, #panel .panel-button.clock-display, #panel:overview .panel-button, #panel:overview .panel-button.clock-display';
const PANEL_LOCK_SEL = '#panel.unlock-screen .panel-button, #panel.login-screen .panel-button, #panel.unlock-screen .panel-button.clock-display, #panel.login-screen .panel-button.clock-display';

// Dark mode has no template: each setting overrides a list of elements.
// [selectors, property, setting key]
const DARK_RULES = [
    ['#panel', 'background-color', 'color-panel-dark'],
    ['.popup-menu-content, .candidate-popup-content, .modal-dialog', 'background-color', 'color-popup-dark'],
    ['.message, .notification-banner, .quick-toggle-menu', 'background-color', 'color-card-dark'],
    ['.switcher-list, .osd-window, .workspace-switcher, .resize-popup', 'background-color', 'color-surface-dark'],
    ['#dash .dash-background, .search-section-content, .app-folder-dialog', 'background-color', 'color-dash-dark'],
    ['#overviewGroup', 'background-color', 'color-overview-dark'],
    [[
        'stage', '.popup-menu', '.popup-menu-item', '.popup-inactive-menu-item', '.message',
        '.quick-toggle-menu', '.events-button', '.world-clocks-button', '.weather-button',
        '.datemenu-today-button', '.calendar .calendar-day', '.calendar .calendar-month-header .calendar-month-label',
        '.modal-dialog', '.osd-window', '.switcher-list .item-box', '.overview-tile', '.grid-search-result',
        '.list-search-result', '.search-section-content', '.app-folder-dialog',
    ].join(', '), 'color', 'color-fg-dark'],
    [[
        '.message .message-header', '.message .message-header .message-header-content .event-time',
        '.events-button .events-box .events-title', '.events-button .events-box .events-list .event-box .event-time',
        '.events-button .events-box .events-list .event-placeholder', '.world-clocks-button .world-clocks-header',
        '.world-clocks-button .world-clocks-grid .world-clocks-timezone',
        '.weather-button .weather-box .weather-header-box .weather-header',
        '.calendar .calendar-day.calendar-weekend', '.calendar .calendar-week-number',
        '.list-search-result .list-search-result-description', '.device-subtitle',
    ].join(', '), 'color', 'color-fg-muted-dark'],
];

const rule = (selector, prop, value) => `${selector} {\n  ${prop}: ${value};\n}\n`;
const panelTextCss = color => rule(PANEL_TEXT_SEL, 'color', color) + rule(PANEL_LOCK_SEL, 'color', '#ffffff');

function hexToRgb(value) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    return m ? m.slice(1).map(h => parseInt(h, 16)).join(', ') : null;
}

export default class LightModeManagerExtension extends Extension {
    // ---------- Color scheme logic (from Luminus) ----------
    _setDefaultColorScheme(scheme, notify = true) {
        Main.sessionMode.colorScheme = scheme;
        if (notify)
            St.Settings.get().notify('color-scheme');
    }

    _setColorScheme(scheme, notify = true) {
        this._interface.set_string('color-scheme', scheme);
        if (notify)
            St.Settings.get().notify('color-scheme');
    }

    _getColorScheme() {
        return this._interface.get_string('color-scheme');
    }

    // Legacy GTK3 apps: switches between "Theme" and "Theme-dark".
    _setLegacyColorScheme(scheme) {
        const theme = this._interface.get_string('gtk-theme');
        const isDark = theme.endsWith('-dark');
        if (scheme === 'prefer-dark' && !isDark)
            this._interface.set_string('gtk-theme', `${theme}-dark`);
        else if (scheme !== 'prefer-dark' && isDark)
            this._interface.set_string('gtk-theme', theme.slice(0, -5));
    }

    _schemeChanged() {
        const scheme = this._getColorScheme();
        this._setColorScheme(scheme === 'default' ? 'prefer-light' : scheme);
        this._setLegacyColorScheme(scheme);
        this._applyTheme();
    }

    // ---------- Stylesheet ----------
    _darkCss() {
        const s = this._settings;
        let css = '';
        for (const [selector, prop, key] of DARK_RULES) {
            const value = s.get_string(key).trim();
            if (value)
                css += rule(selector, prop, value);
        }
        const panelText = s.get_string('color-panel-text-dark').trim();
        if (panelText)
            css += panelTextCss(panelText);
        return css;
    }

    _lightCss() {
        const s = this._settings;
        const byColor = {};
        const byRgb = {};
        for (const [key, color, rgb] of TOKENS) {
            const value = s.get_string(key);
            byColor[color] = value;
            byRgb[rgb] = hexToRgb(value) ?? rgb;
        }

        let css = this._templateHead.replace(TOKEN_RE, (m, rgb, alpha) => {
            if (m === '##F5F5F5')
                return s.get_string('color-panel');
            if (rgb)
                return `rgba(${byRgb[rgb]}, ${alpha})`;
            return byColor[m.toLowerCase()] ?? m;
        }) + this._templateTail;

        const panelText = s.get_string('color-panel-text').trim();
        if (panelText)
            css += panelTextCss(panelText);
        return css;
    }

    _applyTheme() {
        try {
            const css = this._getColorScheme() === 'prefer-dark' ? this._darkCss() : this._lightCss();
            const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'light-mode-manager']);
            GLib.mkdir_with_parents(dir, 0o755);
            const file = Gio.File.new_for_path(GLib.build_filenamev([dir, `theme-${Date.now()}.css`]));
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
            this._unloadTheme();
            this._themeFile = file;
        } catch (e) {
            console.error(`[LightModeManager] ${e.message}`);
        }
    }

    _unloadTheme() {
        if (!this._themeFile)
            return;
        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._themeFile);
            this._themeFile.delete(null);
        } catch (e) {
            // The file may already be gone; nothing else to clean.
        }
        this._themeFile = null;
    }

    _scheduleApply() {
        if (this._applyId)
            GLib.Source.remove(this._applyId);
        this._applyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._applyId = null;
            this._applyTheme();
            return GLib.SOURCE_REMOVE;
        });
    }

    enable() {
        // The template is read once; only the color replacement runs on changes.
        const [, bytes] = Gio.File.new_for_path(`${this.path}/templates/light.css`).load_contents(null);
        const template = new TextDecoder().decode(bytes);
        const idx = template.indexOf(MARKER);
        this._templateHead = idx >= 0 ? template.slice(0, idx) : template;
        this._templateTail = idx >= 0 ? template.slice(idx) : '';

        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed', () => this._scheduleApply());

        this._interface = Gio.Settings.new('org.gnome.desktop.interface');
        this._schemeId = this._interface.connect('changed::color-scheme', () => this._schemeChanged());

        this._savedColorScheme = Main.sessionMode.colorScheme;
        const current = this._getColorScheme();
        if (current === 'default')
            this._setColorScheme('prefer-light', false);
        this._setDefaultColorScheme('prefer-light');
        this._setLegacyColorScheme(current);

        this._applyTheme();
    }

    disable() {
        if (this._applyId) {
            GLib.Source.remove(this._applyId);
            this._applyId = null;
        }
        this._settings.disconnect(this._settingsId);
        this._settings = null;
        this._unloadTheme();
        this._templateHead = this._templateTail = null;

        this._interface.disconnect(this._schemeId);
        if (this._getColorScheme() === 'prefer-light')
            this._setColorScheme('default', false);
        this._setDefaultColorScheme(this._savedColorScheme);
        this._setLegacyColorScheme('default');
        this._interface = null;
    }
}
