import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Everything after this marker (login/lock screen) is left untouched.
const MARKER = '.login-dialog,\n.unlock-dialog {\n  color: #e1e1e1;';

// [setting key, original hex, original "r, g, b"]
const TOKENS = [
    ['color-fg',       '222226', '34, 34, 38'],
    ['color-fg-muted', '767679', '118, 118, 121'],
    ['color-card',     'e8e8e8', '232, 232, 232'],
    ['color-surface',  'dcdcdc', '220, 220, 220'],
    ['color-dash',     'cecece', '206, 206, 206'],
    ['color-overview', 'e1e1e1', '225, 225, 225'],
    ['color-popup',    'whitesmoke', '245, 245, 245'],
];

const RADII = [
    ['radius-popup', '.popup-menu-content, .candidate-popup-content'],
    ['radius-quick-settings', '.quick-settings'],
    ['radius-dash', '#dash .dash-background'],
    ['radius-notification', '.message, .notification-banner, .message-list-clear-button'],
    ['radius-modal', '.modal-dialog'],
    ['radius-switcher', '.switcher-list'],
    ['radius-tile', '.overview-tile, .grid-search-result'],
    ['radius-search', '.search-section-content'],
    ['radius-media', '.message.media-message, .media-message, .quick-settings .message, .quick-settings .media-message', true],
    ['radius-quick-header', '.quick-settings-system-item StButton, .quick-settings-system-item .button, .quick-settings-system-item .icon-button, .quick-settings-system-item .power-item', true],
    ['radius-quick-submenu', '.quick-toggle-menu'],
    ['radius-datemenu', '.datemenu-popover, .calendar, .datemenu-today-button, .events-button, .world-clocks-button, .weather-button'],
    ['radius-search-entry', '.search-entry'],
];

// Top bar text color. The lock/login screen keeps its white text.
const PANEL_TEXT_SEL = '#panel .panel-button, #panel .panel-button.clock-display, #panel:overview .panel-button, #panel:overview .panel-button.clock-display';
const PANEL_LOCK_SEL = '#panel.unlock-screen .panel-button, #panel.login-screen .panel-button, #panel.unlock-screen .panel-button.clock-display, #panel.login-screen .panel-button.clock-display';
const panelTextCss = color =>
    `${PANEL_TEXT_SEL} {\n  color: ${color};\n}\n${PANEL_LOCK_SEL} {\n  color: #ffffff;\n}\n`;

// Dark mode has no template: these lists approximate "text" and "secondary text".
const DARK_FG_SEL = [
    'stage', '.popup-menu', '.popup-menu-item', '.popup-inactive-menu-item', '.message',
    '.quick-toggle-menu', '.events-button', '.world-clocks-button', '.weather-button',
    '.datemenu-today-button', '.calendar .calendar-day', '.calendar .calendar-month-header .calendar-month-label',
    '.modal-dialog', '.osd-window', '.switcher-list .item-box', '.overview-tile', '.grid-search-result',
    '.list-search-result', '.search-section-content', '.app-folder-dialog',
].join(', ');
const DARK_MUTED_SEL = [
    '.message .message-header', '.message .message-header .message-header-content .event-time',
    '.events-button .events-box .events-title', '.events-button .events-box .events-list .event-box .event-time',
    '.events-button .events-box .events-list .event-placeholder', '.world-clocks-button .world-clocks-header',
    '.world-clocks-button .world-clocks-grid .world-clocks-timezone',
    '.weather-button .weather-box .weather-header-box .weather-header',
    '.calendar .calendar-day.calendar-weekend', '.calendar .calendar-week-number',
    '.list-search-result .list-search-result-description', '.device-subtitle',
].join(', ');

function hexToRgb(v) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}

export default class LightModeManagerExtension extends Extension {
    // ---------- Luminus color scheme logic (unchanged) ----------
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

    _setLegacyColorScheme(scheme) {
        const isDark = this._getLegacyColorScheme().endsWith('-dark');
        switch (scheme) {
            case 'default':
            case 'prefer-light':
                if (isDark) {
                    this._interface.set_string(
                        'gtk-theme', this._getLegacyColorScheme().slice(0, -5));
                }
                break;
            case 'prefer-dark':
                if (!isDark) {
                    this._interface.set_string(
                        'gtk-theme', this._getLegacyColorScheme() + '-dark');
                }
                break;
            default:
                break;
        }
    }

    _getLegacyColorScheme() {
        return this._interface.get_string('gtk-theme');
    }

    _schemeChangeHook() {
        let scheme = this._getColorScheme();
        this._setColorScheme(scheme === 'default' ? 'prefer-light' : scheme);
        this._setLegacyColorScheme(scheme);
        this._applyTheme();
    }

    // ---------- Stylesheet generation ----------
    _buildCss(dark) {
        const s = this._settings;
        if (dark) {
            let o = '/* Light Mode Manager (dark) */\n';
            const rule = (sel, prop, key) => {
                const v = s.get_string(key).trim();
                if (v)
                    o += `${sel} {\n  ${prop}: ${v};\n}\n`;
            };
            rule('#panel', 'background-color', 'color-panel-dark');
            const panelText = s.get_string('color-panel-text-dark').trim();
            if (panelText)
                o += panelTextCss(panelText);
            rule('.popup-menu-content, .candidate-popup-content, .modal-dialog', 'background-color', 'color-popup-dark');
            rule('.message, .notification-banner, .quick-toggle-menu', 'background-color', 'color-card-dark');
            rule('.switcher-list, .osd-window, .workspace-switcher, .resize-popup', 'background-color', 'color-surface-dark');
            rule('#dash .dash-background, .search-section-content, .app-folder-dialog', 'background-color', 'color-dash-dark');
            rule('#overviewGroup', 'background-color', 'color-overview-dark');
            rule(DARK_FG_SEL, 'color', 'color-fg-dark');
            rule(DARK_MUTED_SEL, 'color', 'color-fg-muted-dark');
            return o + this._radiiCss();
        }

        const file = Gio.File.new_for_path(`${this.path}/templates/light.css`);
        const [, bytes] = file.load_contents(null);
        const css = new TextDecoder().decode(bytes);
        const idx = css.indexOf(MARKER);
        const head = idx >= 0 ? css.slice(0, idx) : css;
        const tail = idx >= 0 ? css.slice(idx) : '';

        const byHex = {};
        const byRgb = {};
        for (const [key, hex, rgb] of TOKENS) {
            const val = s.get_string(key);
            const newRgb = hexToRgb(val) ?? (/^#/.test(val) ? null : null);
            byHex[hex] = val;
            byRgb[rgb] = newRgb ?? rgb;
        }
        const panel = s.get_string('color-panel');

        const re = new RegExp(
            '##F5F5F5|#(222226|767679|e8e8e8|dcdcdc|cecece|e1e1e1)\\b|\\bwhitesmoke\\b|' +
            'rgba\\((34, 34, 38|118, 118, 121|245, 245, 245|232, 232, 232|220, 220, 220|206, 206, 206|225, 225, 225), ([\\d.]+)\\)',
            'gi');

        let out = head.replace(re, (m, hex, rgb, alpha) => {
            if (m === '##F5F5F5')
                return panel;
            if (hex)
                return byHex[hex.toLowerCase()] ?? m;
            if (m.toLowerCase() === 'whitesmoke')
                return byHex['whitesmoke'];
            if (rgb)
                return `rgba(${byRgb[rgb]}, ${alpha})`;
            return m;
        });

        out += tail + '\n/* Light Mode Manager overrides */\n';
        const panelText = s.get_string('color-panel-text').trim();
        if (panelText)
            out += panelTextCss(panelText);
        return out + this._radiiCss();
    }

    // Border radius applies to both light and dark modes.
    // -1 means "system default": nothing is written and the theme's own radius applies.
    // 0 means square corners.
    _radiiCss() {
        const isSet = key => this._settings.get_int(key) >= 0;
        let o = '';
        for (const [key, selector, important] of RADII) {
            if (!isSet(key))
                continue;
            const imp = important ? ' !important' : '';
            o += `${selector} {\n  border-radius: ${this._settings.get_int(key)}px${imp};\n}\n`;
        }
        if (!isSet('radius-quick-toggle'))
            return o;
        const r = this._settings.get_int('radius-quick-toggle');
        o += `.quick-toggle, .quick-toggle-has-menu {\n  border-radius: ${r}px;\n}\n` +
            `.quick-toggle-has-menu .quick-toggle:ltr {\n  border-radius: ${r}px 0 0 ${r}px;\n}\n` +
            `.quick-toggle-has-menu .quick-toggle:rtl {\n  border-radius: 0 ${r}px ${r}px 0;\n}\n` +
            `.quick-toggle-has-menu .quick-toggle-menu-button:ltr {\n  border-radius: 0 ${r}px ${r}px 0;\n}\n` +
            `.quick-toggle-has-menu .quick-toggle-menu-button:rtl {\n  border-radius: ${r}px 0 0 ${r}px;\n}\n` +
            `.quick-toggle-has-menu .quick-toggle:ltr:last-child, .quick-toggle-has-menu .quick-toggle:rtl:last-child {\n  border-radius: ${r}px;\n}\n`;
        return o;
    }

    _applyTheme() {
        try {
            const css = this._buildCss(this._getColorScheme() === 'prefer-dark');
            const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'light-mode-manager']);
            GLib.mkdir_with_parents(dir, 0o755);
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([dir, `theme-${Date.now()}.css`]));
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.load_stylesheet(file);
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
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.unload_stylesheet(this._themeFile);
            this._themeFile.delete(null);
        } catch (e) {
            // ignore
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
        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed', () => this._scheduleApply());

        this._interface = Gio.Settings.new('org.gnome.desktop.interface');
        this._hookID = this._interface.connect('changed::color-scheme', () => {
            this._schemeChangeHook();
        });

        this._savedColorScheme = Main.sessionMode.colorScheme;

        let currentColorScheme = this._getColorScheme();
        if (currentColorScheme === 'default')
            this._setColorScheme('prefer-light', false);
        this._setDefaultColorScheme('prefer-light');
        this._setLegacyColorScheme(currentColorScheme);

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

        this._interface.disconnect(this._hookID);
        this._hookID = null;

        if (this._getColorScheme() === 'prefer-light')
            this._setColorScheme('default', false);
        this._setDefaultColorScheme(this._savedColorScheme);
        this._setLegacyColorScheme('default');

        this._interface = null;
    }
}
