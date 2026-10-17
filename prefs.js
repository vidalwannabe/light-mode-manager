import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const toCss = c => {
    const [r, g, b] = [c.red, c.green, c.blue].map(v => Math.round(v * 255));
    if (c.alpha < 0.999)
        return `rgba(${r}, ${g}, ${b}, ${c.alpha.toFixed(2)})`;
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
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

export default class LightModeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 740);

        const resetButton = key => {
            const b = new Gtk.Button({
                icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Restore default',
            });
            b.add_css_class('flat');
            b.connect('clicked', () => s.reset(key));
            return b;
        };

        // emptyLabel: subtitle shown while the value is empty.
        // fallbackKey: whose color the swatch shows while the value is empty.
        const colorRow = (group, key, title, subtitle, alpha, emptyLabel, fallbackKey) => {
            const row = new Adw.ActionRow({title, subtitle});
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: alpha}),
                valign: Gtk.Align.CENTER,
            });
            let loading = false;
            const load = () => {
                const value = s.get_string(key);
                if (emptyLabel)
                    row.set_subtitle(value === '' ? emptyLabel : subtitle);
                const color = new Gdk.RGBA();
                if (!color.parse(value || (fallbackKey ? s.get_string(fallbackKey) : '#808080')))
                    color.parse('#808080');
                loading = true;
                button.set_rgba(color);
                loading = false;
            };
            load();
            button.connect('notify::rgba', () => {
                if (!loading)
                    s.set_string(key, toCss(button.get_rgba()));
            });
            s.connect(`changed::${key}`, load);
            if (fallbackKey)
                s.connect(`changed::${fallbackKey}`, load);
            row.add_suffix(button);
            row.add_suffix(resetButton(key));
            group.add(row);
        };

        const addTab = (title, icon, description, suffix, emptyFor) => {
            const page = new Adw.PreferencesPage({title, icon_name: icon});
            const group = new Adw.PreferencesGroup({title: 'Colors', description});
            page.add(group);
            const keys = [];
            for (const [name, label, subtitle, alpha] of COLOR_ROWS) {
                const key = `color-${name}${suffix}`;
                colorRow(group, key, label, subtitle, alpha, ...emptyFor(name));
                keys.push(key);
            }

            const resetRow = new Adw.ActionRow({title: 'Restore this tab to defaults'});
            const resetAll = new Gtk.Button({label: 'Restore defaults', valign: Gtk.Align.CENTER});
            resetAll.add_css_class('destructive-action');
            resetAll.connect('clicked', () => keys.forEach(k => s.reset(k)));
            resetRow.add_suffix(resetAll);
            const resetGroup = new Adw.PreferencesGroup();
            resetGroup.add(resetRow);
            page.add(resetGroup);

            window.add(page);
        };

        addTab('Light mode', 'weather-clear-symbolic',
            'Hover, focus and active states are derived automatically from these colors.', '',
            name => name === 'panel-text' ? ['Same as "Text and icons"', 'color-fg'] : [null, null]);
        addTab('Dark mode', 'weather-clear-night-symbolic',
            'Rows set to "System default" keep the native GNOME dark look.', '-dark',
            () => ['System default', null]);
    }
}
