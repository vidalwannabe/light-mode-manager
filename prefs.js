import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createProfiles} from './profiles.js';

// The Light mode and Dark mode tabs show exactly these rows.
// [key name, title, subtitle]. Transparency is set only in the General tab.
const COLOR_ROWS = [
    ['general', 'General background', 'Top bar, menus, dialogs, OSD and switcher, overview'],
    ['fg', 'Text and icons', 'Main text and icons, including the top bar'],
    ['fg-muted', 'Secondary text', 'Dates, captions and subtitles'],
    ['card', 'Cards, dash and search', 'Notifications, calendar, slider buttons, dock, search, app folders'],
    ['qs-button', 'Inactive Quick Settings buttons', 'Toggles that are off, round buttons at the top, and their menus'],
    ['border', 'Borders', 'Outline of Quick Settings, the calendar and other menus'],
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
        window.set_default_size(600, 855);
        window.set_search_enabled(false);

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
                // Empty or unreadable: the shell uses the system default.
                const color = new Gdk.RGBA();
                const valid = color.parse(s.get_string(key).trim());
                row.set_subtitle(valid ? subtitle : 'System default');
                if (!valid)
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

        // Asks for a new profile name, plus one choice per entry of `combos`
        // ({title, names, selected}). taken(name) says whether the name is already used.
        const profileDialog = (taken, onConfirm, combos = [], heading = 'New profile') => {
            const fields = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
            fields.add_css_class('boxed-list');
            const entry = new Adw.EntryRow({title: 'Profile name'});
            fields.append(entry);
            const choices = combos.map(({title, names, selected}) => {
                const row = new Adw.ComboRow({title, model: Gtk.StringList.new(names)});
                row.set_selected(Math.max(0, names.indexOf(selected)));
                fields.append(row);
                return () => names[row.get_selected()];
            });

            const dialog = new Adw.AlertDialog({heading, extra_child: fields});
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('ok', 'Save');
            dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('ok');
            dialog.set_close_response('cancel');
            const name = () => entry.get_text().trim();
            const valid = () => name() !== '' && !taken(name());
            entry.connect('changed', () => dialog.set_response_enabled('ok', valid()));
            dialog.set_response_enabled('ok', false);
            const done = () => onConfirm(name(), ...choices.map(get => get()));
            dialog.connect('response', (_d, response) => {
                if (response === 'ok')
                    done();
            });
            entry.connect('entry-activated', () => {
                if (valid()) {
                    done();
                    dialog.close();
                }
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

        // A "Profiles" group: one row with a selector (apply, delete) and the given add button.
        const selectorGroup = ({groupTitle = 'Profiles', title, subtitle, model, describe, addButton, onRefresh}) => {
            const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
            list.add_css_class('boxed-list');
            const popover = new Gtk.Popover({child: new Gtk.ScrolledWindow({
                child: list, propagate_natural_height: true, max_content_height: 360,
                hscrollbar_policy: Gtk.PolicyType.NEVER, width_request: 300,
            })});
            const selector = new Gtk.MenuButton({popover, valign: Gtk.Align.CENTER, tooltip_text: 'Saved profiles'});

            const profileRow = (profile, applied) => {
                const builtin = model.builtins.includes(profile);
                const row = new Adw.ActionRow({
                    title: profile.name, subtitle: describe(profile, builtin), activatable: true, tooltip_text: 'Apply',
                });
                // Every row gets the check icon so names stay aligned; only the applied one shows it.
                row.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic', opacity: profile === applied ? 1 : 0}));
                row.connect('activated', () => {
                    popover.popdown();
                    model.apply(profile);
                });
                if (!builtin) {
                    const del = flatButton({icon_name: 'user-trash-symbolic', tooltip_text: 'Delete'});
                    del.connect('clicked', () => {
                        popover.popdown();
                        confirm(`Delete "${profile.name}"?`, 'This profile will be removed.', 'Delete',
                            () => model.save(model.own().filter(p => p.name !== profile.name)));
                    });
                    row.add_suffix(del);
                }
                return row;
            };

            const refresh = () => {
                const profiles = model.all();
                const applied = model.applied(profiles);
                selector.set_label(applied?.name ?? 'No profile');
                list.remove_all();
                for (const profile of profiles)
                    list.append(profileRow(profile, applied));
                onRefresh?.();
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
            for (const key of model.keys)
                watch(key, queueRefresh);

            const row = new Adw.ActionRow({title, subtitle});
            row.add_suffix(selector);
            row.add_suffix(addButton);
            const group = new Adw.PreferencesGroup({title: groupTitle});
            group.add(row);
            return group;
        };

        // Light or Dark tab profiles, with a "+" menu to save the current colors
        // as a new profile or into an existing one.
        const modeProfilesGroup = model => {
            const actions = new Gio.SimpleActionGroup();
            const newAction = new Gio.SimpleAction({name: 'new'});
            newAction.connect('activate', () => profileDialog(model.taken, name => {
                model.save([...model.own(), {name, colors: model.current()}]);
                model.setActive(name);
            }));
            const overwriteAction = new Gio.SimpleAction({name: 'overwrite', parameter_type: new GLib.VariantType('s')});
            overwriteAction.connect('activate', (_a, param) => {
                const name = param.unpack();
                confirm(`Apply to "${name}"?`, 'Its saved colors will be replaced with the current ones.', 'Replace', () => {
                    model.save(model.own().map(p => p.name === name ? {name, colors: model.current()} : p));
                    model.setActive(name);
                });
            });
            [newAction, overwriteAction, new Gio.SimpleAction({name: 'none', enabled: false})]
                .forEach(a => actions.add_action(a));

            const addButton = new Gtk.MenuButton({
                icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Save current colors',
            });
            addButton.add_css_class('flat');
            addButton.insert_action_group('profile', actions);
            const buildAddMenu = () => {
                const own = model.own();
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

            return selectorGroup({
                title: 'Profile', subtitle: 'Apply a built-in or saved color set', model, addButton,
                describe: (_p, builtin) => builtin ? 'Built-in' : '',
                onRefresh: buildAddMenu,
            });
        };

        // A general profile pairs a light and a dark profile and applies both.
        const generalProfilesGroup = (model, light, dark) => {
            const side = (mode, name) => model.exists(mode, name) ? name : `${name} (deleted)`;

            const addButton = flatButton({icon_name: 'list-add-symbolic', tooltip_text: 'New general profile'});
            addButton.connect('clicked', () => profileDialog(model.taken, (name, l, d) => {
                model.save([...model.own(), {name, light: l, dark: d}]);
                model.apply({name, light: l, dark: d});
            }, [
                {title: 'Light mode profile', names: light.all().map(p => p.name), selected: 'Default'},
                {title: 'Dark mode profile', names: dark.all().map(p => p.name), selected: 'Default'},
            ], 'New general profile'));

            return selectorGroup({
                groupTitle: 'General profiles', title: 'Profile',
                subtitle: 'Applies a light and a dark mode profile at once',
                model, addButton,
                describe: p => `Light: ${side(light, p.light)} · Dark: ${side(dark, p.dark)}`,
            });
        };

        const addTab = (title, icon, suffix, model) => {
            const page = new Adw.PreferencesPage({title, icon_name: icon});
            page.add(modeProfilesGroup(model));
            const group = new Adw.PreferencesGroup({title: 'Colors'});
            for (const [name, label, subtitle] of COLOR_ROWS)
                colorRow(group, `color-${name}${suffix}`, label, subtitle);
            page.add(group);
            window.add(page);
        };

        // A slider row bound to an integer setting, snapped to `step`. Each mouse wheel
        // notch moves it by `wheelStep`.
        const sliderRow = (group, key, title, subtitle, max, step, unit, wheelStep = step) => {
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

            // Handled before GTK's own scrolling, which moves by an uneven amount.
            const wheel = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE,
                propagation_phase: Gtk.PropagationPhase.CAPTURE,
            });
            // Goes to the next multiple of wheelStep: 43 becomes 45 up, 40 down.
            wheel.connect('scroll', (_c, _dx, dy) => {
                const steps = scale.get_value() / wheelStep;
                const value = (dy < 0 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1) * wheelStep;
                scale.set_value(Math.min(max, Math.max(0, value)));
                return true;
            });
            scale.add_controller(wheel);

            const reset = flatButton({icon_name: 'edit-undo-symbolic', tooltip_text: 'Restore default'});
            reset.connect('clicked', () => s.reset(key));
            row.add_suffix(label);
            row.add_suffix(scale);
            row.add_suffix(reset);
            group.add(row);
        };

        // ---------- Automatic switch ----------
        // A time button ("07:00") bound to an integer setting in minutes since midnight;
        // it opens hour and minute spin buttons in a popover.
        const timeInput = key => {
            const spin = max => {
                const button = new Gtk.SpinButton({
                    adjustment: new Gtk.Adjustment({lower: 0, upper: max, step_increment: 1, page_increment: 10}),
                    wrap: true, numeric: true, width_chars: 2, orientation: Gtk.Orientation.VERTICAL,
                });
                // Always two digits: 07, not 7.
                button.connect('output', () => {
                    button.set_text(String(button.get_value_as_int()).padStart(2, '0'));
                    return true;
                });
                return button;
            };
            const [hours, minutes] = [spin(23), spin(59)];
            const picker = new Gtk.Box({spacing: 6, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
            picker.append(hours);
            picker.append(new Gtk.Label({label: ':'}));
            picker.append(minutes);
            const button = new Gtk.MenuButton({popover: new Gtk.Popover({child: picker}), valign: Gtk.Align.CENTER});
            button.add_css_class('numeric');

            const text = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
            let loading = false;
            const load = () => {
                const value = s.get_int(key);
                button.set_label(text(value));
                loading = true;
                hours.set_value(Math.floor(value / 60));
                minutes.set_value(value % 60);
                loading = false;
            };
            load();
            const save = () => {
                const value = hours.get_value_as_int() * 60 + minutes.get_value_as_int();
                if (!loading && value !== s.get_int(key))
                    s.set_int(key, value);
            };
            hours.connect('value-changed', save);
            minutes.connect('value-changed', save);
            watch(key, load);
            return button;
        };

        // A drop-down of the general profiles bound to a string setting. A saved profile
        // that was deleted stays listed, marked as deleted, until another one is chosen.
        const profileDropDown = (key, general) => {
            const dropDown = new Gtk.DropDown({valign: Gtk.Align.CENTER});
            let names = [];
            let labels = '';
            let loading = false;
            const load = () => {
                const saved = s.get_string(key);
                const next = general.all().map(p => p.name);
                const nextLabels = [...next];
                if (!next.includes(saved)) {
                    next.push(saved);
                    nextLabels.push(`${saved} (deleted)`);
                }
                names = next;
                loading = true;
                // The list is only replaced when the names change: replacing it while GTK
                // handles a click on one of its items crashes the preferences window.
                if (nextLabels.join('\n') !== labels) {
                    labels = nextLabels.join('\n');
                    dropDown.set_model(Gtk.StringList.new(nextLabels));
                }
                if (dropDown.get_selected() !== names.indexOf(saved))
                    dropDown.set_selected(names.indexOf(saved));
                loading = false;
            };
            load();
            dropDown.connect('notify::selected', () => {
                const name = names[dropDown.get_selected()];
                if (!loading && name !== undefined && name !== s.get_string(key))
                    s.set_string(key, name);
            });

            // Reload once the current click is fully handled, never during it.
            let loadId = 0;
            const queueLoad = () => {
                loadId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    loadId = 0;
                    load();
                    return GLib.SOURCE_REMOVE;
                });
            };
            cleanups.push(() => {
                if (loadId)
                    GLib.Source.remove(loadId);
                loadId = 0;
            });
            watch(key, queueLoad);
            watch('general-profiles', queueLoad);
            return dropDown;
        };

        const autoSwitchGroup = general => {
            const group = new Adw.PreferencesGroup({title: 'Automatic switch'});
            const enable = new Adw.SwitchRow({title: 'Enable', subtitle: 'Applies a general profile at set times of day'});
            s.bind('auto-switch', enable, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(enable);
            for (const [i, title] of [[1, 'First switch'], [2, 'Second switch']]) {
                const row = new Adw.ActionRow({title, subtitle: 'Time and general profile to apply'});
                row.add_suffix(timeInput(`auto-switch-${i}-time`));
                row.add_suffix(profileDropDown(`auto-switch-${i}-profile`, general));
                enable.bind_property('active', row, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
                group.add(row);
            }
            return group;
        };

        // ---------- Backup ----------
        const SETTINGS_FILE = 'light-mode-manager-settings.json';
        const toast = title => window.add_toast(new Adw.Toast({title}));
        const jsonFilter = () => {
            const filter = new Gtk.FileFilter({name: 'JSON files'});
            filter.add_pattern('*.json');
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            return filters;
        };
        // Cancelling a file dialog is not an error worth reporting.
        const dismissed = e => e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED);

        // Every setting as GVariant text, so types survive the round trip.
        const exportSettings = () => {
            const dialog = new Gtk.FileDialog({title: 'Export settings', initial_name: SETTINGS_FILE, filters: jsonFilter()});
            dialog.save(window, null, (_d, res) => {
                try {
                    const file = dialog.save_finish(res);
                    const settings = Object.fromEntries(
                        s.settings_schema.list_keys().map(k => [k, s.get_value(k).print(true)]));
                    const json = JSON.stringify({extension: this.uuid, version: 1, settings}, null, 2);
                    file.replace_contents(new TextEncoder().encode(json), null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                    toast('Settings exported');
                } catch (e) {
                    if (!dismissed(e))
                        toast(`Export failed: ${e.message}`);
                }
            });
        };

        // Reads and validates a settings file: every key of the schema as a GVariant,
        // or null when the file lacks it. Throws on anything invalid, before any change.
        const readSettingsFile = file => {
            const [, bytes] = file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (data?.extension !== this.uuid || typeof data.settings !== 'object' || !data.settings)
                throw new Error('not a Light Mode Manager settings file');
            const schema = s.settings_schema;
            return new Map(schema.list_keys().map(k => {
                const text = data.settings[k];
                if (typeof text !== 'string')
                    return [k, null];
                const value = GLib.Variant.parse(schema.get_key(k).get_value_type(), text, null, null);
                if (!schema.get_key(k).range_check(value))
                    throw new Error(`invalid value for ${k}`);
                return [k, value];
            }));
        };

        // Replaces every setting; keys missing from the file go back to their default.
        const replaceAll = values => {
            s.delay();
            for (const [k, value] of values) {
                if (value)
                    s.set_value(k, value);
                else
                    s.reset(k);
            }
            s.apply();
        };

        // Adds the file's own profiles without removing or overwriting anything. A profile
        // already saved with the same name and content is skipped; a different one with a name
        // in use gets a number, and general profiles follow those renamed light/dark profiles.
        // Returns how many profiles were added.
        const addProfiles = values => {
            const listIn = key => {
                try {
                    const list = JSON.parse(values.get(key)?.unpack() ?? '[]');
                    return Array.isArray(list) ? list : [];
                } catch {
                    return [];
                }
            };
            const numbered = (name, base) => name.startsWith(`${base} (`) && /\(\d+\)$/.test(name);
            const merge = (model, key, content) => {
                const own = model.own();
                const added = [];
                const names = new Map();
                for (const p of listIn(key)) {
                    if (typeof p?.name !== 'string' || !p.name.trim() || !model.isValid(p))
                        continue;
                    const entry = {name: p.name.trim(), ...content(p)};
                    // Already there, under its name or a numbered copy of it ("Name (2)").
                    const signature = JSON.stringify(content(entry));
                    const same = own.find(q => (q.name === entry.name || numbered(q.name, entry.name)) &&
                        JSON.stringify(content(q)) === signature);
                    if (same) {
                        names.set(p.name, same.name);
                        continue;
                    }
                    let name = entry.name;
                    for (let i = 2; model.taken(name) || added.some(q => q.name === name); i++)
                        name = `${entry.name} (${i})`;
                    names.set(p.name, name);
                    added.push({...entry, name});
                }
                if (added.length)
                    model.save([...own, ...added]);
                return {count: added.length, names};
            };
            const light = merge(profiles.light, 'profiles', p => ({colors: p.colors}));
            const dark = merge(profiles.dark, 'profiles-dark', p => ({colors: p.colors}));
            const general = merge(profiles.general, 'general-profiles', p => ({
                light: light.names.get(p.light) ?? p.light,
                dark: dark.names.get(p.dark) ?? p.dark,
            }));
            return light.count + dark.count + general.count;
        };

        const importSettings = () => {
            const dialog = new Gtk.FileDialog({title: 'Import settings', filters: jsonFilter()});
            dialog.open(window, null, (_d, res) => {
                let values;
                try {
                    values = readSettingsFile(dialog.open_finish(res));
                } catch (e) {
                    if (!dismissed(e))
                        toast(`Import failed: ${e.message}`);
                    return;
                }
                const choice = new Adw.AlertDialog({
                    heading: 'Import settings',
                    body: 'Add the profiles from this file to yours, or replace all current settings with it?',
                });
                choice.add_response('cancel', 'Cancel');
                choice.add_response('replace', 'Replace all');
                choice.add_response('add', 'Add profiles');
                choice.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
                choice.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
                choice.set_default_response('add');
                choice.set_close_response('cancel');
                choice.connect('response', (_c, response) => {
                    if (response === 'replace') {
                        replaceAll(values);
                        toast('Settings replaced');
                    } else if (response === 'add') {
                        const count = addProfiles(values);
                        toast(count ? `${count} profile${count > 1 ? 's' : ''} added` : 'No new profiles to add');
                    }
                });
                choice.present(window);
            });
        };

        const backupGroup = () => {
            const group = new Adw.PreferencesGroup({title: 'Backup'});
            const row = new Adw.ActionRow({title: 'Settings', subtitle: 'Colors, profiles and options in a JSON file'});
            const importButton = new Gtk.Button({label: 'Import', valign: Gtk.Align.CENTER});
            importButton.connect('clicked', importSettings);
            const exportButton = new Gtk.Button({label: 'Export', valign: Gtk.Align.CENTER});
            exportButton.connect('clicked', exportSettings);
            row.add_suffix(importButton);
            row.add_suffix(exportButton);
            group.add(row);
            return group;
        };

        const addGeneralTab = ({general, light, dark}) => {
            const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-other-symbolic'});
            page.add(generalProfilesGroup(general, light, dark));

            const effects = new Adw.PreferencesGroup({title: 'Visual tweaks'});
            sliderRow(effects, 'transition-duration', 'Transition',
                'Fade between light and dark mode', 2000, 100, ' ms');
            sliderRow(effects, 'general-opacity', 'Shell opacity',
                'Top bar, menus, OSD and switcher; dialogs stay solid', 100, 1, '%', 5);
            sliderRow(effects, 'card-opacity', 'Card opacity',
                'Notification cards, inactive Quick Settings buttons', 100, 1, '%', 5);
            const panelOpacityRow = new Adw.SwitchRow({
                title: 'Enable panel opacity',
                subtitle: 'Top bar also gets the shell opacity; solid otherwise',
            });
            s.bind('panel-opacity', panelOpacityRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(panelOpacityRow);
            const bordersRow = new Adw.SwitchRow({
                title: 'Disable menu borders',
                subtitle: 'No outline around Quick Settings, the calendar and menus',
            });
            s.bind('hide-borders', bordersRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(bordersRow);
            const dimRow = new Adw.SwitchRow({
                title: 'Disable Quick Settings dimming',
                subtitle: 'Quick Settings stays bright while one of its menus is open',
            });
            s.bind('no-qs-dimming', dimRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(dimRow);
            const arrowRow = new Adw.SwitchRow({
                title: 'Uniform Quick Settings button colors',
                subtitle: 'Arrows (›) next to toggles use the toggle color, on and off',
            });
            s.bind('match-arrow-buttons', arrowRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(arrowRow);
            const calendarRow = new Adw.SwitchRow({
                title: 'Calendar as card',
                subtitle: 'Calendar gets the card color, without a circle behind each day',
            });
            s.bind('calendar-background', calendarRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(calendarRow);
            const menuHeightRow = new Adw.SwitchRow({
                title: 'Fix menu overlap',
                subtitle: 'Menus with wrapped text (like Bluetooth off) no longer cover the buttons below',
            });
            s.bind('fix-qs-menu-height', menuHeightRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(menuHeightRow);
            const dtpRow = new Adw.SwitchRow({
                title: 'Override Dash to Panel colors',
                subtitle: "Dash to Panel uses this extension's panel color and opacity, not its own",
            });
            s.bind('override-dtp-colors', dtpRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            effects.add(dtpRow);
            page.add(effects);

            const panel = new Adw.PreferencesGroup({title: 'Panel'});
            const menuRow = new Adw.SwitchRow({
                title: 'Panel menu entry',
                subtitle: "Adds “Light Mode Manager” to Dash to Panel's right-click menu",
            });
            s.bind('panel-menu-entry', menuRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            panel.add(menuRow);
            const quickRow = new Adw.SwitchRow({
                title: 'Quick Settings switcher',
                subtitle: 'Adds a button to Quick Settings to switch general profiles',
            });
            s.bind('quick-settings-profiles', quickRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            panel.add(quickRow);
            page.add(panel);

            page.add(autoSwitchGroup(general));

            page.add(backupGroup());

            window.add(page);
        };

        const profiles = createProfiles(s);
        addGeneralTab(profiles);
        addTab('Light mode', 'weather-clear-symbolic', '', profiles.light);
        addTab('Dark mode', 'weather-clear-night-symbolic', '-dark', profiles.dark);
    }
}
