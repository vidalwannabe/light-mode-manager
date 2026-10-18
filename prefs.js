import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
    ['general', 'General background', 'Top bar, menus and dialogs, OSD and switcher, overview (supports transparency)', true],
    ['fg', 'Text and icons', 'Main text color, including the top bar', false],
    ['fg-muted', 'Secondary text', 'Dates, captions, subtitles', false],
    ['card', 'Cards, dash and search', 'Notifications, calendar, quick settings, dock, search results, app folders', false],
];

export default class LightModeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 500);

        // Settings handlers are dropped when the window closes, so they never run on dead widgets.
        const handlerIds = [];
        const watch = (key, fn) => handlerIds.push(s.connect(`changed::${key}`, fn));
        window.connect('close-request', () => {
            handlerIds.forEach(id => s.disconnect(id));
            handlerIds.length = 0;
            return false;
        });

        const resetButton = key => {
            const b = new Gtk.Button({
                icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Restore the Default profile color',
            });
            b.add_css_class('flat');
            b.connect('clicked', () => s.reset(key));
            return b;
        };

        // emptyLabel: subtitle shown while the value is empty (dark mode: system default).
        const colorRow = (group, key, title, subtitle, alpha, emptyLabel) => {
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
                if (!color.parse(value || '#808080'))
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
            watch(key, load);
            row.add_suffix(button);
            row.add_suffix(resetButton(key));
            group.add(row);
        };

        // Asks for a profile name. taken(name) says whether the name is already used.
        const nameDialog = ({heading, confirm, name = '', taken, onConfirm}) => {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
            const entry = new Gtk.Entry({text: name, placeholder_text: 'Profile name', activates_default: true});
            box.append(entry);
            const dialog = new Adw.AlertDialog({heading, extra_child: box});
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('ok', confirm);
            dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('ok');
            dialog.set_close_response('cancel');
            const validate = () => {
                const n = entry.get_text().trim();
                dialog.set_response_enabled('ok', n !== '' && !taken(n));
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

        // Profile selector and "+" button at the top of a tab.
        // builtins: fixed profiles listed first; they cannot be deleted or overwritten.
        const profilesGroup = (suffix, builtins) => {
            const listKey = `profiles${suffix}`;
            const activeKey = `active-profile${suffix}`;
            const colorKey = name => `color-${name}${suffix}`;

            const reserved = new Set(builtins.map(p => p.name));
            // The user's own profiles (a saved one can never shadow a built-in name).
            const load = () => {
                try {
                    const list = JSON.parse(s.get_string(listKey));
                    return Array.isArray(list)
                        ? list.filter(p => p && typeof p.name === 'string' && !reserved.has(p.name) &&
                            p.colors && typeof p.colors === 'object')
                        : [];
                } catch {
                    return [];
                }
            };
            const save = list => s.set_string(listKey, JSON.stringify(list));
            const current = () => Object.fromEntries(COLOR_ROWS.map(([n]) => [n, s.get_string(colorKey(n))]));
            // A profile without a value for a row resets that row to its default.
            const apply = colors => {
                for (const [n] of COLOR_ROWS) {
                    if (typeof colors[n] === 'string')
                        s.set_string(colorKey(n), colors[n]);
                    else
                        s.reset(colorKey(n));
                }
            };
            const matches = colors => COLOR_ROWS.every(([n]) => colors[n] === s.get_string(colorKey(n)));
            // The applied profile is remembered by name, so two profiles with the same
            // colors are not both marked. It stops counting once a color is changed.
            const setActive = name => s.set_string(activeKey, name);
            const active = profiles => {
                const p = profiles.find(q => q.name === s.get_string(activeKey));
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
            newAction.connect('activate', () => nameDialog({
                heading: 'New profile', confirm: 'Save',
                taken: n => reserved.has(n) || load().some(p => p.name === n),
                onConfirm: name => {
                    save([...load(), {name, colors: current()}]);
                    setActive(name);
                },
            }));
            const overwriteAction = new Gio.SimpleAction({name: 'overwrite', parameter_type: new GLib.VariantType('s')});
            overwriteAction.connect('activate', (_a, param) => {
                const name = param.unpack();
                confirm(`Apply to "${name}"?`, 'Its saved colors will be replaced with the current ones.', 'Replace',
                    () => {
                        save(load().map(p => p.name === name ? {name, colors: current()} : p));
                        setActive(name);
                    });
            });
            const noneAction = new Gio.SimpleAction({name: 'none', enabled: false});
            [newAction, overwriteAction, noneAction].forEach(a => actions.add_action(a));

            const addButton = new Gtk.MenuButton({
                icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Save current colors',
            });
            addButton.add_css_class('flat');
            addButton.insert_action_group('profile', actions);
            const buildAddMenu = profiles => {
                const menu = new Gio.Menu();
                menu.append('Create new profile', 'profile.new');
                if (profiles.length === 0) {
                    menu.append('Apply to existing profile', 'profile.none');
                } else {
                    const sub = new Gio.Menu();
                    for (const p of profiles) {
                        const item = Gio.MenuItem.new(p.name, null);
                        item.set_action_and_target_value('profile.overwrite', new GLib.Variant('s', p.name));
                        sub.append_item(item);
                    }
                    menu.append_submenu('Apply to existing profile', sub);
                }
                addButton.set_menu_model(menu);
            };

            // Applying a profile changes several keys at once; rebuild the list only once.
            let refreshId = 0;
            const queueRefresh = () => {
                if (!refreshId) {
                    refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        refreshId = 0;
                        refresh();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            window.connect('close-request', () => {
                if (refreshId)
                    GLib.Source.remove(refreshId);
                refreshId = 0;
                return false;
            });

            const refresh = () => {
                const own = load();
                buildAddMenu(own);
                const profiles = [...builtins, ...own];
                const applied = active(profiles);
                selector.set_label(applied?.name ?? 'No profile');
                list.remove_all();
                profiles.forEach(profile => {
                    const row = new Adw.ActionRow({
                        title: profile.name, subtitle: profile.builtin ? 'Built-in' : '',
                        activatable: true, tooltip_text: 'Apply',
                    });
                    // Every row gets the check icon so names stay aligned; only the applied one shows it.
                    row.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic', opacity: profile === applied ? 1 : 0}));
                    row.connect('activated', () => {
                        popover.popdown();
                        setActive(profile.name);
                        if (profile.reset)
                            apply({});
                        else
                            apply(profile.colors);
                    });
                    if (profile.builtin) {
                        list.append(row);
                        return;
                    }

                    const del = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Delete'});
                    del.add_css_class('flat');
                    del.connect('clicked', () => {
                        popover.popdown();
                        confirm(`Delete "${profile.name}"?`, 'This profile will be removed.', 'Delete',
                            () => save(load().filter(p => p.name !== profile.name)));
                    });

                    row.add_suffix(del);
                    list.append(row);
                });
            };
            refresh();
            watch(listKey, queueRefresh);
            watch(activeKey, queueRefresh);
            for (const [n] of COLOR_ROWS)
                watch(colorKey(n), queueRefresh);

            const row = new Adw.ActionRow({title: 'Profile', subtitle: 'Apply a built-in or saved color set'});
            row.add_suffix(selector);
            row.add_suffix(addButton);
            const group = new Adw.PreferencesGroup({title: 'Profiles'});
            group.add(row);
            return group;
        };

        // "Default": the schema defaults (rows are reset). "GNOME": every row on system default.
        const defaultProfile = suffix => ({
            name: 'Default', builtin: true,
            colors: Object.fromEntries(COLOR_ROWS.map(([n]) => {
                const key = `color-${n}${suffix}`;
                return [n, s.get_default_value(key).unpack()];
            })),
            reset: true,
        });
        const gnomeProfile = {name: 'GNOME', builtin: true, colors: Object.fromEntries(COLOR_ROWS.map(([n]) => [n, '']))};
        // "Oled": the dark Default with a pure black general background.
        const oledProfile = () => {
            const base = defaultProfile('-dark');
            return {name: 'Oled', builtin: true, colors: {...base.colors, general: '#000000'}};
        };

        const addTab = (title, icon, suffix, emptyLabel, builtins) => {
            const page = new Adw.PreferencesPage({title, icon_name: icon});
            page.add(profilesGroup(suffix, builtins));
            const group = new Adw.PreferencesGroup({title: 'Colors'});
            page.add(group);
            for (const [name, label, subtitle, alpha] of COLOR_ROWS)
                colorRow(group, `color-${name}${suffix}`, label, subtitle, alpha, emptyLabel);

            window.add(page);
        };

        addTab('Light mode', 'weather-clear-symbolic', '', 'System default', [defaultProfile(''), gnomeProfile]);
        addTab('Dark mode', 'weather-clear-night-symbolic', '-dark', 'System default',
            [defaultProfile('-dark'), gnomeProfile, oledProfile()]);
    }
}
