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

export default class LightModeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(680, 780);

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

        const colorRow = (group, key, title, subtitle, alpha = false, optional = false) => {
            const row = new Adw.ActionRow({title, subtitle});
            const btn = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: alpha}),
                valign: Gtk.Align.CENTER,
            });
            let busy = false;
            const load = () => {
                const c = new Gdk.RGBA();
                const v = s.get_string(key);
                if (optional)
                    row.set_subtitle(v === '' ? 'System default' : subtitle);
                if (v === '')
                    c.parse('#808080');
                if (v === '' || c.parse(v)) {
                    busy = true;
                    btn.set_rgba(c);
                    busy = false;
                }
            };
            load();
            btn.connect('notify::rgba', () => {
                if (!busy)
                    s.set_string(key, toCss(btn.get_rgba()));
            });
            s.connect(`changed::${key}`, load);
            row.add_suffix(btn);
            row.add_suffix(resetBtn(key));
            group.add(row);
        };

        const spinRow = (group, key, title, subtitle = null, min = 0) => {
            const props = {title, adjustment: new Gtk.Adjustment({lower: min, upper: 999, step_increment: 1, page_increment: 4})};
            if (subtitle)
                props.subtitle = subtitle;
            const row = new Adw.SpinRow(props);
            s.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            row.add_suffix(resetBtn(key));
            group.add(row);
        };

        // ----- Light mode -----
        const light = mkPage('Light mode', 'weather-clear-symbolic');
        let g = mkGroup(light, 'Colors', 'Hover, focus and active states are derived automatically from these colors.');
        colorRow(g, 'color-panel', 'Top bar', 'Top bar background (supports transparency)', true);
        colorRow(g, 'color-fg', 'Text and icons', 'Main text color');
        colorRow(g, 'color-fg-muted', 'Secondary text', 'Dates, captions, subtitles');
        colorRow(g, 'color-popup', 'Menus and dialogs', 'Panel menus, dialog boxes, flat buttons');
        colorRow(g, 'color-card', 'Cards', 'Notifications, calendar, quick settings');
        colorRow(g, 'color-surface', 'OSD and switcher', 'Alt+Tab, volume/brightness, screenshot UI');
        colorRow(g, 'color-dash', 'Dash, search and folders', 'Overview dock, search results, app folders');
        colorRow(g, 'color-overview', 'Overview and app grid', 'Overview and icon background');

        // ----- Dark mode -----
        const dark = mkPage('Dark mode', 'weather-clear-night-symbolic');
        g = mkGroup(dark, 'Colors', 'Empty = system default. Use the reset button to go back to the default.');
        colorRow(g, 'color-panel-dark', 'Top bar', 'Top bar background (supports transparency)', true, true);
        colorRow(g, 'color-panel-text-dark', 'Top bar text', 'Top bar text and icon color', false, true);
        colorRow(g, 'color-popup-dark', 'Menus and dialogs', 'Panel menus and dialog boxes', false, true);
        colorRow(g, 'color-card-dark', 'Cards', 'Notifications and quick settings', false, true);
        colorRow(g, 'color-surface-dark', 'OSD and switcher', 'Alt+Tab, volume/brightness', false, true);
        colorRow(g, 'color-dash-dark', 'Dash, search and folders', 'Overview dock, search, app folders', false, true);
        colorRow(g, 'color-overview-dark', 'Overview', 'Overview background', false, true);

        // ----- Border radius (both modes) -----
        const rad = mkPage('Border Radius', 'applications-graphics-symbolic');
        g = mkGroup(rad, 'Rounding', 'Corner radius in pixels. Applies to both light and dark modes.');
        spinRow(g, 'radius-popup', 'Menus');
        spinRow(g, 'radius-quick-settings', 'Quick settings');
        spinRow(g, 'radius-datemenu', 'Calendar / date');
        spinRow(g, 'radius-notification', 'Notifications');
        spinRow(g, 'radius-modal', 'Dialogs');
        spinRow(g, 'radius-dash', 'Dash');
        spinRow(g, 'radius-switcher', 'Alt+Tab');
        spinRow(g, 'radius-tile', 'App icons');
        spinRow(g, 'radius-search', 'Search results');
    }
}
