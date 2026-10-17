import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const toCss = (c) => {
    if (c.alpha < 0.999)
        return `rgba(${Math.round(c.red * 255)}, ${Math.round(c.green * 255)}, ${Math.round(c.blue * 255)}, ${c.alpha.toFixed(2)})`;
    return '#' + [c.red, c.green, c.blue]
        .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};

// The Light mode and Dark mode tabs show exactly these rows.
// [key name, title, subtitle, supports transparency]
const COLOR_ROWS = [
    ['panel', 'Top bar', 'Top bar background (supports transparency)', true],
    ['panel-text', 'Top bar text', 'Top bar text and icon color', false],
    ['fg', 'Text and icons', 'Main text color', false],
    ['fg-muted', 'Secondary text', 'Dates, captions, subtitles', false],
    ['popup', 'Menus and dialogs', 'Panel menus, dialog boxes, flat buttons', false],
    ['card', 'Cards', 'Notifications, calendar, quick settings', false],
    ['surface', 'OSD and switcher', 'Alt+Tab, volume/brightness, screenshot UI', false],
    ['dash', 'Dash, search and folders', 'Overview dock, search results, app folders', false],
    ['overview', 'Overview and app grid', 'Overview and icon background', false],
];

// [key, title, subtitle]
const GENERAL_RADII = [
    ['radius-popup', 'Menus'],
    ['radius-datemenu', 'Calendar / date', 'Date menu, events, world clocks, weather'],
    ['radius-notification', 'Notifications', 'Notification cards and Clear button'],
    ['radius-modal', 'Dialogs'],
    ['radius-dash', 'Dash'],
    ['radius-switcher', 'Alt+Tab'],
    ['radius-tile', 'App icons'],
    ['radius-search', 'Search results'],
    ['radius-search-entry', 'Search bar', 'Overview search field'],
];
const QUICK_SETTINGS_RADII = [
    ['radius-quick-settings', 'Panel', 'Background of the whole quick settings menu'],
    ['radius-quick-toggle', 'Toggle buttons', 'Wi-Fi, Bluetooth, Dark Style... (active or not)'],
    ['radius-quick-header', 'Header buttons', 'Battery, screenshot, settings, lock, power'],
    ['radius-quick-submenu', 'Submenu boxes', 'Boxes that open under toggles, like the Wi-Fi list'],
    ['radius-media', 'Media player', 'Player card'],
];

export default class LightModeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 740);

        const mkPage = (title, icon) => {
            const p = new Adw.PreferencesPage({title, icon_name: icon});
            window.add(p);
            return p;
        };
        const mkGroup = (page, title, desc = null) => {
            const g = new Adw.PreferencesGroup({title});
            if (desc)
                g.set_description(desc);
            page.add(g);
            return g;
        };
        const resetBtn = (key) => {
            const b = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER,
                tooltip_text: 'Restore default'});
            b.add_css_class('flat');
            b.connect('clicked', () => s.reset(key));
            return b;
        };

        // emptyLabel: subtitle shown while the value is empty.
        // fallbackKey: whose color the swatch shows while the value is empty.
        const colorRow = (group, key, title, subtitle, alpha, emptyLabel = null, fallbackKey = null) => {
            const row = new Adw.ActionRow({title, subtitle});
            const btn = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: alpha}),
                valign: Gtk.Align.CENTER,
            });
            let busy = false;
            const load = () => {
                const v = s.get_string(key);
                if (emptyLabel)
                    row.set_subtitle(v === '' ? emptyLabel : subtitle);
                const src = v !== '' ? v : (fallbackKey ? s.get_string(fallbackKey) : '#808080');
                const c = new Gdk.RGBA();
                if (!c.parse(src))
                    c.parse('#808080');
                busy = true;
                btn.set_rgba(c);
                busy = false;
            };
            load();
            btn.connect('notify::rgba', () => {
                if (!busy)
                    s.set_string(key, toCss(btn.get_rgba()));
            });
            s.connect(`changed::${key}`, load);
            if (fallbackKey)
                s.connect(`changed::${fallbackKey}`, load);
            row.add_suffix(btn);
            row.add_suffix(resetBtn(key));
            group.add(row);
        };

        // Radius rows: -1 = system default, 0 = square corners, up to 60.
        const spinRow = (group, key, title, subtitle = null) => {
            const props = {title, adjustment: new Gtk.Adjustment({lower: -1, upper: 60, step_increment: 1, page_increment: 4})};
            if (subtitle)
                props.subtitle = subtitle;
            const row = new Adw.SpinRow(props);
            s.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            // Typing -1 goes back to the system default (clears the saved value).
            row.connect('notify::value', () => {
                if (row.get_value() === -1 && s.get_user_value(key) !== null)
                    s.reset(key);
            });
            group.add(row);
        };

        const addResetGroup = (page, keys) => {
            const grp = new Adw.PreferencesGroup();
            const r = new Adw.ActionRow({title: 'Restore this tab to defaults'});
            const btn = new Gtk.Button({label: 'Restore defaults', valign: Gtk.Align.CENTER});
            btn.add_css_class('destructive-action');
            btn.connect('clicked', () => keys.forEach(k => s.reset(k)));
            r.add_suffix(btn);
            grp.add(r);
            page.add(grp);
        };

        // ----- Light mode / Dark mode (same rows in both) -----
        const addColorTab = (title, icon, desc, suffix, emptyFor) => {
            const page = mkPage(title, icon);
            const g = mkGroup(page, 'Colors', desc);
            const keys = [];
            for (const [name, label, sub, alpha] of COLOR_ROWS) {
                const key = `color-${name}${suffix}`;
                const [emptyLabel, fallbackKey] = emptyFor(name);
                colorRow(g, key, label, sub, alpha, emptyLabel, fallbackKey);
                keys.push(key);
            }
            addResetGroup(page, keys);
        };

        addColorTab('Light mode', 'weather-clear-symbolic',
            'Hover, focus and active states are derived automatically from these colors.', '',
            name => name === 'panel-text' ? ['Same as "Text and icons"', 'color-fg'] : [null, null]);
        addColorTab('Dark mode', 'weather-clear-night-symbolic',
            'Rows set to "System default" keep the native GNOME dark look.', '-dark',
            () => ['System default', null]);

        // ----- Border radius (both modes) -----
        const rad = mkPage('Border Radius', 'applications-graphics-symbolic');
        const radiusKeys = [];
        const addRadii = (group, rows) => {
            for (const [key, title, sub] of rows) {
                spinRow(group, key, title, sub);
                radiusKeys.push(key);
            }
        };
        addRadii(mkGroup(rad, 'Rounding', 'Corner radius in pixels, for both light and dark modes. -1 = system default, 0 = square corners.'), GENERAL_RADII);
        addRadii(mkGroup(rad, 'Quick settings', 'Panel, buttons, submenus and media player of the quick settings menu. -1 = system default, 0 = square corners.'), QUICK_SETTINGS_RADII);
        addResetGroup(rad, radiusKeys);
    }
}
