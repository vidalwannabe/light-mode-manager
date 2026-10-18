import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
        '.switcher-list', '.osd-window', '.workspace-switcher', '.resize-popup', '#overviewGroup',
    ], 'background-color', 'color-general-dark'],
    [[
        '.message', '.notification-banner', '.quick-toggle-menu',
        '#dash .dash-background', '.search-section-content', '.app-folder-dialog',
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

// Color settings of each mode.
const LIGHT_KEYS = [...new Set(TOKENS.map(([key]) => key))];
const DARK_KEYS = DARK_RULES.map(([, , key]) => key);
// Settings that rebuild the theme of each mode; other keys (profiles...) never do.
const LIGHT_THEME_KEYS = [...LIGHT_KEYS, 'general-opacity'];
const DARK_THEME_KEYS = [...DARK_KEYS, 'general-opacity'];

// GNOME's own delay before fading out the snapshot of the old screen.
const TRANSITION_DELAY = 250;

// Dash to Panel offers its own settings for extra entries in its panel right-click menu.
const DTP_UUID = 'dash-to-panel@jderose9.github.com';
const DTP_SCHEMA = 'org.gnome.shell.extensions.dash-to-panel';
const MENU_TITLE = 'Light Mode Manager';

const rule = (selector, prop, value) => `${selector} {\n  ${prop}: ${value};\n}\n`;
const panelTextCss = color => rule(PANEL_TEXT_SEL, 'color', color) + rule(PANEL_LOCK_SEL, 'color', '#ffffff');

// "r, g, b" of a #rrggbb, rgb() or rgba() color, so hover/active variants follow it.
function colorToRgb(value) {
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (m)
        return m.slice(1).map(h => parseInt(h, 16)).join(', ');
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*[,)]/i.exec(value);
    return m ? m.slice(1).join(', ') : null;
}

// The color with the general opacity (percent) applied on top of its own alpha.
function withOpacity(value, opacity) {
    const rgb = value && opacity < 100 ? colorToRgb(value) : null;
    if (!rgb)
        return value;
    const alpha = /^rgba\(.*,\s*([\d.]+)\s*\)$/i.exec(value)?.[1] ?? 1;
    return `rgba(${rgb}, ${+(alpha * opacity / 100).toFixed(3)})`;
}

export default class LightModeManagerExtension extends Extension {
    // ---------- Color scheme ----------
    _getColorScheme() {
        return this._interface.get_string('color-scheme');
    }

    _isDark() {
        return this._getColorScheme() === 'prefer-dark';
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
    // once the new theme is in place, with the duration chosen in the Tuning tab.
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

    // Adds or removes our entry in Dash to Panel's own list of extra menu entries.
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

    // The value strings of the given keys; empty means system default.
    _values(keys) {
        return keys.map(key => this._settings.get_string(key).trim());
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
    _darkCss() {
        const values = this._values(DARK_KEYS);
        const general = DARK_KEYS.indexOf('color-general-dark');
        values[general] = withOpacity(values[general], this._settings.get_int('general-opacity'));
        let css = '';
        DARK_RULES.forEach(([selector, prop], i) => {
            if (values[i])
                css += rule(selector, prop, values[i]);
        });
        // The top bar text follows "Text and icons".
        const fg = values[DARK_KEYS.indexOf('color-fg-dark')];
        if (fg)
            css += panelTextCss(fg);
        return css;
    }

    // The template is only read when light mode first needs it.
    _template() {
        if (!this._templateHead) {
            const [, bytes] = this.dir.get_child('templates').get_child('light.css').load_contents(null);
            const template = new TextDecoder().decode(bytes);
            const idx = template.indexOf(MARKER);
            this._templateHead = idx >= 0 ? template.slice(0, idx) : template;
            this._templateTail = idx >= 0 ? template.slice(idx) : '';
        }
        return [this._templateHead, this._templateTail];
    }

    _lightCss() {
        const values = this._values(LIGHT_KEYS);
        // Every color on system default: no stylesheet (see _syncShellScheme).
        if (values.every(v => !v))
            return '';

        // An empty color keeps the template's original one.
        const byKey = Object.fromEntries(LIGHT_KEYS.map((key, i) => [key, values[i]]));
        byKey['color-general'] = withOpacity(byKey['color-general'], this._settings.get_int('general-opacity'));
        const byColor = {};
        const byRgb = {};
        for (const [key, color, rgb] of TOKENS) {
            byColor[color] = byKey[key] || color;
            byRgb[rgb] = colorToRgb(byKey[key]) ?? rgb;
        }

        const [head, tail] = this._template();
        let css = head.replace(TOKEN_RE, (m, rgb, alpha) =>
            rgb ? `rgba(${byRgb[rgb]}, ${alpha})` : byColor[m.toLowerCase()]) + tail;

        // The top bar has no template color of its own, so it gets its own rule.
        if (byKey['color-general'])
            css += rule('#panel', 'background-color', byKey['color-general']);
        // The top bar text follows "Text and icons".
        if (byKey['color-fg'])
            css += panelTextCss(byKey['color-fg']);
        return css;
    }

    _applyTheme() {
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
            else if ((this._isDark() ? DARK_THEME_KEYS : LIGHT_THEME_KEYS).includes(key))
                this._scheduleApply();
        });
        this._syncPanelMenu(this._settings.get_boolean('panel-menu-entry'));

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
        });

        this._applyTheme();
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
        if (this._forcedDark) {
            Main.sessionMode.colorScheme = this._modeScheme;
            St.Settings.get().notify('color-scheme');
        }
        if (this._getColorScheme() === 'prefer-light')
            this._interface.set_string('color-scheme', 'default');
        this._setLegacyColorScheme('default');

        this._settings = this._interface = this._cacheDir = this._templateHead = this._templateTail = null;
    }
}
