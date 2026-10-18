import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The Light mode and Dark mode tabs show exactly these rows.
// [key name, title, subtitle]. Transparency is set only in the General tab.
const COLOR_ROWS = [
    ['general', 'General background', 'Top bar, menus and dialogs, OSD and switcher, overview'],
    ['fg', 'Text and icons', 'Main text color, including the top bar'],
    ['fg-muted', 'Secondary text', 'Dates, captions, subtitles'],
    ['card', 'Cards, dash and search', 'Notifications, calendar, quick settings, dock, search results, app folders'],
];

const toHex = c => `#${[c.red, c.green, c.blue]
    .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

const flatButton = props => {
    const button = new Gtk.Button({valign: Gtk.Align.CENTER, ...props});
    button.add_css_class('flat');
    return button;
};

export default class LightModeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 500);

        // Settings handlers and pending idles are dropped when the window closes,
        // so they never run on dead widgets.
        const cleanups = [];
        const watch = (key, fn) => {
            const id = s.connect(`changed::${key}`, fn);
            cleanups.push(() => s.disconnect(id));
        };
        window.connect('close-request', () => {
            cleanups.splice(0).forEach(fn => fn());
            return false;
        });

        const colorRow = (group, key, title, subtitle) => {
            const row = new Adw.ActionRow({title});
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: false}),
                valign: Gtk.Align.CENTER,
            });
            let loading = false;
            const load = () => {
                const value = s.get_string(key);
                row.set_subtitle(value ? subtitle : 'System default');
                const color = new Gdk.RGBA();
                if (!color.parse(value))
                    color.parse('#808080');
                loading = true;
                button.set_rgba(color);
                loading = false;
            };
            load();
            button.connect('notify::rgba', () => {
                if (!loading)
                    s.set_string(key, toHex(button.get_rgba()));
            });
            watch(key, load);

            const reset = flatButton({icon_name: 'edit-undo-symbolic', tooltip_text: 'Restore the Default profile color'});
            reset.connect('clicked', () => s.reset(key));
            row.add_suffix(button);
            row.add_suffix(reset);
            group.add(row);
        };

        // Asks for a new profile name. taken(name) says whether the name is already used.
        const nameDialog = (taken, onConfirm) => {
            const entry = new Gtk.Entry({placeholder_text: 'Profile name', activates_default: true});
            const dialog = new Adw.AlertDialog({heading: 'New profile', extra_child: entry});
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('ok', 'Save');
            dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('ok');
            dialog.set_close_response('cancel');
            const validate = () => {
                const name = entry.get_text().trim();
                dialog.set_response_enabled('ok', name !== '' && !taken(name));
            };
            entry.connect('changed', validate);
            validate();
            dialog.connect('response', (_d, response) => {
                if (response === 'ok')
                    onConfirm(entry.get_text().trim());
            });
            dialog.present(window);
            entry.grab_focus();
        };

        const confirm = (heading, body, label, onConfirm) => {
            const dialog = new Adw.AlertDialog({heading, body});
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('ok', label);
            dialog.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_close_response('cancel');
            dialog.connect('response', (_d, response) => {
                if (response === 'ok')
                    onConfirm();
            });
            dialog.present(window);
        };

        // The schema default of every row of a tab.
        const defaults = suffix => Object.fromEntries(
            COLOR_ROWS.map(([n]) => [n, s.get_default_value(`color-${n}${suffix}`).unpack()]));

        // Profile selector and "+" menu at the top of a tab.
        // builtins: fixed profiles listed first; they cannot be deleted or overwritten.
        const profilesGroup = (suffix, builtins) => {
            const listKey = `profiles${suffix}`;
            const activeKey = `active-profile${suffix}`;
            const colorKey = n => `color-${n}${suffix}`;
            const defaultColors = defaults(suffix);
            const reserved = new Set(builtins.map(p => p.name));

            // The user's own profiles (a saved one can never shadow a built-in name).
            const load = () => {
                try {
                    const list = JSON.parse(s.get_string(listKey));
                    return Array.isArray(list)
                        ? list.filter(p => typeof p?.name === 'string' && !reserved.has(p.name) &&
                            p.colors && typeof p.colors === 'object')
                        : [];
                } catch {
                    return [];
                }
            };
            const save = list => s.set_string(listKey, JSON.stringify(list));
            const current = () => Object.fromEntries(COLOR_ROWS.map(([n]) => [n, s.get_string(colorKey(n))]));
            // A row that is missing or equal to its default is reset, so dconf only keeps real changes.
            const apply = colors => {
                for (const [n] of COLOR_ROWS) {
                    const value = colors[n];
                    if (typeof value !== 'string' || value === defaultColors[n])
                        s.reset(colorKey(n));
                    else
                        s.set_string(colorKey(n), value);
                }
            };
            const matches = colors => COLOR_ROWS.every(([n]) => (colors[n] ?? defaultColors[n]) === s.get_string(colorKey(n)));
            // The applied profile is remembered by name, so two profiles with the same
            // colors are not both marked. It stops counting once a color is changed.
            const setActive = name => s.set_string(activeKey, name);
            const active = profiles => {
                const name = s.get_string(activeKey);
                const p = profiles.find(q => q.name === name);
                return p && matches(p.colors) ? p : null;
            };

            const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
            list.add_css_class('boxed-list');
            const popover = new Gtk.Popover({child: new Gtk.ScrolledWindow({
                child: list, propagate_natural_height: true, max_content_height: 360,
                hscrollbar_policy: Gtk.PolicyType.NEVER, width_request: 300,
            })});
            const selector = new Gtk.MenuButton({popover, valign: Gtk.Align.CENTER, tooltip_text: 'Saved profiles'});

            // "+" menu: save the current colors as a new profile or into an existing one.
            const actions = new Gio.SimpleActionGroup();
            const newAction = new Gio.SimpleAction({name: 'new'});
            newAction.connect('activate', () => nameDialog(
                name => reserved.has(name) || load().some(p => p.name === name),
                name => {
                    save([...load(), {name, colors: current()}]);
                    setActive(name);
                }));
            const overwriteAction = new Gio.SimpleAction({name: 'overwrite', parameter_type: new GLib.VariantType('s')});
            overwriteAction.connect('activate', (_a, param) => {
                const name = param.unpack();
                confirm(`Apply to "${name}"?`, 'Its saved colors will be replaced with the current ones.', 'Replace', () => {
                    save(load().map(p => p.name === name ? {name, colors: current()} : p));
                    setActive(name);
                });
            });
            [newAction, overwriteAction, new Gio.SimpleAction({name: 'none', enabled: false})]
                .forEach(a => actions.add_action(a));

            const addButton = new Gtk.MenuButton({
                icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Save current colors',
            });
            addButton.add_css_class('flat');
            addButton.insert_action_group('profile', actions);
            const buildAddMenu = own => {
                const menu = new Gio.Menu();
                menu.append('Create new profile', 'profile.new');
                if (own.length === 0) {
                    menu.append('Apply to existing profile', 'profile.none');
                } else {
                    const sub = new Gio.Menu();
                    for (const p of own) {
                        const item = Gio.MenuItem.new(p.name, null);
                        item.set_action_and_target_value('profile.overwrite', new GLib.Variant('s', p.name));
                        sub.append_item(item);
                    }
                    menu.append_submenu('Apply to existing profile', sub);
                }
                addButton.set_menu_model(menu);
            };

            const profileRow = (profile, applied) => {
                const builtin = builtins.includes(profile);
                const row = new Adw.ActionRow({
                    title: profile.name, subtitle: builtin ? 'Built-in' : '', activatable: true, tooltip_text: 'Apply',
                });
                // Every row gets the check icon so names stay aligned; only the applied one shows it.
                row.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic', opacity: profile === applied ? 1 : 0}));
                row.connect('activated', () => {
                    popover.popdown();
                    setActive(profile.name);
                    apply(profile.colors);
                });
                if (!builtin) {
                    const del = flatButton({icon_name: 'user-trash-symbolic', tooltip_text: 'Delete'});
                    del.connect('clicked', () => {
                        popover.popdown();
                        confirm(`Delete "${profile.name}"?`, 'This profile will be removed.', 'Delete',
                            () => save(load().filter(p => p.name !== profile.name)));
                    });
                    row.add_suffix(del);
                }
                return row;
            };

            const refresh = () => {
                const own = load();
                buildAddMenu(own);
                const profiles = [...builtins, ...own];
                const applied = active(profiles);
                selector.set_label(applied?.name ?? 'No profile');
                list.remove_all();
                for (const profile of profiles)
                    list.append(profileRow(profile, applied));
            };

            // Applying a profile changes several keys at once; rebuild only once.
            let refreshId = 0;
            const queueRefresh = () => {
                refreshId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    refreshId = 0;
                    refresh();
                    return GLib.SOURCE_REMOVE;
                });
            };
            cleanups.push(() => {
                if (refreshId)
                    GLib.Source.remove(refreshId);
                refreshId = 0;
            });

            refresh();
            for (const key of [listKey, activeKey, ...COLOR_ROWS.map(([n]) => colorKey(n))])
                watch(key, queueRefresh);

            const row = new Adw.ActionRow({title: 'Profile', subtitle: 'Apply a built-in or saved color set'});
            row.add_suffix(selector);
            row.add_suffix(addButton);
            const group = new Adw.PreferencesGroup({title: 'Profiles'});
            group.add(row);
            return group;
        };

        const addTab = (title, icon, suffix, builtins) => {
            const page = new Adw.PreferencesPage({title, icon_name: icon});
            page.add(profilesGroup(suffix, builtins));
            const group = new Adw.PreferencesGroup({title: 'Colors'});
            for (const [name, label, subtitle] of COLOR_ROWS)
                colorRow(group, `color-${name}${suffix}`, label, subtitle);
            page.add(group);
            window.add(page);
        };

        // A slider row bound to an integer setting, snapped to `step`.
        const sliderRow = (group, key, title, subtitle, max, step, unit) => {
            const row = new Adw.ActionRow({title, subtitle});
            const scale = new Gtk.Scale({
                adjustment: new Gtk.Adjustment({lower: 0, upper: max, step_increment: step, page_increment: step}),
                draw_value: false, width_request: 200, valign: Gtk.Align.CENTER,
            });
            for (let v = 0; v <= max; v += max / 4)
                scale.add_mark(v, Gtk.PositionType.BOTTOM, null);
            // Fixed-width value label, so the sliders of all rows line up.
            const label = new Gtk.Label({width_chars: 7, xalign: 1, valign: Gtk.Align.CENTER});
            label.add_css_class('numeric');
            let loading = false;
            const load = () => {
                const value = s.get_int(key);
                label.set_label(`${value}${unit}`);
                loading = true;
                scale.set_value(value);
                loading = false;
            };
            load();
            scale.connect('value-changed', () => {
                const value = Math.round(scale.get_value() / step) * step;
                label.set_label(`${value}${unit}`);
                if (!loading && value !== s.get_int(key))
                    s.set_int(key, value);
            });
            watch(key, load);

            const reset = flatButton({icon_name: 'edit-undo-symbolic', tooltip_text: 'Restore default'});
            reset.connect('clicked', () => s.reset(key));
            row.add_suffix(label);
            row.add_suffix(scale);
            row.add_suffix(reset);
            group.add(row);
        };

        const addGeneralTab = () => {
            const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-other-symbolic'});

            const effects = new Adw.PreferencesGroup({title: 'Visual effects'});
            sliderRow(effects, 'transition-duration', 'Transition',
                'Fade when switching between light and dark mode', 2000, 100, ' ms');
            sliderRow(effects, 'general-opacity', 'General background opacity',
                'Applies to light and dark mode', 100, 1, '%');
            page.add(effects);

            const panel = new Adw.PreferencesGroup({title: 'Panel'});
            const menuRow = new Adw.SwitchRow({
                title: 'Panel menu entry',
                subtitle: 'Adds "Light Mode Manager" to the Dash to Panel right-click menu',
            });
            s.bind('panel-menu-entry', menuRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            panel.add(menuRow);
            page.add(panel);

            window.add(page);
        };

        // "Default": the schema defaults. "GNOME": every row on system default.
        // "Oled": the dark Default with a pure black general background.
        const gnome = {name: 'GNOME', colors: Object.fromEntries(COLOR_ROWS.map(([n]) => [n, '']))};
        addTab('Light mode', 'weather-clear-symbolic', '',
            [{name: 'Default', colors: defaults('')}, gnome]);
        addTab('Dark mode', 'weather-clear-night-symbolic', '-dark', [
            {name: 'Default', colors: defaults('-dark')},
            gnome,
            {name: 'Oled', colors: {...defaults('-dark'), general: '#000000'}},
        ]);
        addGeneralTab();
    }
}
