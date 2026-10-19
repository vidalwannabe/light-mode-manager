import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createProfiles} from './profiles.js';

// The Light mode and Dark mode tabs show exactly these rows.
// [key name, title, subtitle, label and swatch when empty]. Transparency is set only in the
// Appearance tab.
const ACCENT = 'Accent color set in GNOME Settings › Appearance';
const COLOR_GROUPS = [
    ['Top bar and overview', [
        ['panel', 'Top bar background', 'Panel color; solid unless "Enable panel opacity" is on'],
        ['panel-fg', 'Top bar text and icons', 'Clock, indicators, overview button and Dash to Panel app grid icon'],
        ['overview', 'Overview and dialogs background', 'Overview, Power Off and password dialogs; always solid'],
        ['dash', 'Overview and top bar highlights', 'Dash, search and password fields, and hovered or open top bar buttons'],
    ]],
    ['Menus', [
        ['general', 'Menus background', 'Quick Settings, calendar, right-click menus, OSD and window switcher'],
        ['border', 'Menu borders', 'Outline of Quick Settings, the calendar and other menus'],
    ]],
    ['Quick Settings and notification panel', [
        ['fg', 'Idle buttons and cards titles and icons', 'Notifications, widgets and Quick Settings; also menus and dialogs'],
        ['fg-muted', 'Idle buttons and cards subtitles', 'Text under titles: notification body, times, locations and subtitles'],
        ['qs-button', 'Idle buttons background', 'Toggles that are off, top round buttons, slider buttons and toggle menus'],
        ['card', 'Cards background', 'Notifications, banners and calendar widgets: Today, World Clocks and Weather'],
        ['qs-active-fg', 'Active buttons text and icons', 'Text, icons and arrows of Quick Settings toggles that are on', 'Accent text color', '#ffffff'],
        ['qs-active', 'Active buttons background', 'Quick Settings toggles that are on and their arrows', ACCENT, () => accentColor()],
        ['highlight', 'Sliders', 'Filled part of the volume, brightness and other sliders', ACCENT, () => accentColor()],
        ['today', 'Today in the calendar', 'Circle behind the current day', ACCENT, () => accentColor()],
    ]],
];

// The accent color chosen in GNOME Settings (libadwaita 1.6+), GNOME's blue otherwise.
const accentColor = () => {
    const rgba = Adw.StyleManager.get_default().get_accent_color_rgba?.();
    return rgba ? toHex(rgba) : '#3584e4';
};

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
        window.set_default_size(605, 855);
        // Narrower, the color and schedule rows squeeze their titles and controls.
        window.set_size_request(605, -1);
        window.set_search_enabled(false);
        // One-line profile rows in the selectors, instead of libadwaita's 50px rows.
        const css = new Gtk.CssProvider();
        css.load_from_string('list.lmm-profile-list > row, list.lmm-profile-list > row > box.header { min-height: 0; }' +
            'list.lmm-profile-list > row > box.header { padding-top: 2px; padding-bottom: 2px; }' +
            'list.lmm-profile-list button { min-height: 26px; min-width: 26px; padding: 0; }');
        Gtk.StyleContext.add_provider_for_display(window.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        // Settings handlers and pending idles are dropped when the window closes,
        // so they never run on dead widgets.
        let closed = false;
        const cleanups = [() => Gtk.StyleContext.remove_provider_for_display(window.get_display(), css)];
        const watch = (key, fn) => {
            const id = s.connect(`changed::${key}`, fn);
            cleanups.push(() => s.disconnect(id));
        };
        window.connect('close-request', () => {
            closed = true;
            cleanups.splice(0).forEach(fn => fn());
            return false;
        });

        const colorRow = (group, key, title, subtitle, emptyLabel = 'System default', emptyColor = '#808080') => {
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
                row.set_subtitle(valid ? subtitle : emptyLabel);
                if (!valid)
                    color.parse(typeof emptyColor === 'function' ? emptyColor() : emptyColor);
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
            list.add_css_class('lmm-profile-list');
            const popover = new Gtk.Popover({child: new Gtk.ScrolledWindow({
                child: list, propagate_natural_height: true, max_content_height: 360,
                hscrollbar_policy: Gtk.PolicyType.NEVER, width_request: 300,
            })});
            const selector = new Gtk.MenuButton({popover, valign: Gtk.Align.CENTER, tooltip_text: 'Saved profiles'});

            const profileRow = (profile, applied) => {
                const builtin = model.builtins.includes(profile);
                const row = new Adw.ActionRow({
                    title: profile.name, subtitle: describe(profile), activatable: true, tooltip_text: 'Apply',
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
                selector.set_label(applied?.name ?? 'Unsaved');
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
                confirm(`Update "${name}"?`, 'Its saved colors will be replaced with the current ones.', 'Update', () => {
                    model.save(model.own().map(p => p.name === name ? {name, colors: model.current()} : p));
                    model.setActive(name);
                });
            });
            [newAction, overwriteAction, new Gio.SimpleAction({name: 'none', enabled: false})]
                .forEach(a => actions.add_action(a));

            const addButton = new Gtk.MenuButton({
                icon_name: 'media-floppy-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Save current colors',
            });
            addButton.add_css_class('flat');
            addButton.insert_action_group('profile', actions);
            const buildAddMenu = () => {
                const own = model.own();
                const menu = new Gio.Menu();
                menu.append('Create new profile', 'profile.new');
                if (own.length === 0) {
                    menu.append('Update existing profile', 'profile.none');
                } else {
                    const sub = new Gio.Menu();
                    for (const p of own) {
                        const item = Gio.MenuItem.new(p.name, null);
                        item.set_action_and_target_value('profile.overwrite', new GLib.Variant('s', p.name));
                        sub.append_item(item);
                    }
                    menu.append_submenu('Update existing profile', sub);
                }
                addButton.set_menu_model(menu);
            };

            return selectorGroup({
                title: 'Profile', subtitle: 'Applies a built-in or saved color set to this mode', model, addButton,
                describe: () => '',
                onRefresh: buildAddMenu,
            });
        };

        // A general profile pairs a light and a dark profile and applies both.
        const generalProfilesGroup = (model, light, dark) => {
            const side = (mode, name) => model.exists(mode, name) ? name : `${name} (deleted)`;

            const addButton = flatButton({icon_name: 'media-floppy-symbolic', tooltip_text: 'New general profile'});
            addButton.connect('clicked', () => profileDialog(model.taken, (name, l, d) => {
                // Only saved: applying it here would overwrite unsaved colors.
                model.save([...model.own(), {name, light: l, dark: d}]);
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
            for (const [groupTitle, rows] of COLOR_GROUPS) {
                const group = new Adw.PreferencesGroup({title: groupTitle});
                for (const [name, label, subtitle, emptyLabel, emptyColor] of rows)
                    colorRow(group, `color-${name}${suffix}`, label, subtitle, emptyLabel, emptyColor);
                page.add(group);
            }
            window.add(page);
        };

        // A switch row bound to a boolean setting.
        const switchRow = (group, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            return row;
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
        // Minutes since midnight as "07:00".
        const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
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

            let loading = false;
            const load = () => {
                const value = s.get_int(key);
                button.set_label(clock(value));
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

        const MODES = [['light', 'Light mode'], ['dark', 'Dark mode']];
        // One row: the mode, and the two times it is on between; the opposite mode the rest of
        // the day. Equal times turn the switch off: both times are marked and the subtitle says so.
        const autoSwitchGroup = () => {
            const group = new Adw.PreferencesGroup({title: 'Automatic switch'});
            const enable = switchRow(group, 'auto-switch', 'Enable',
                'Uses one mode between two times of day and the other the rest of the day');

            const row = new Adw.ActionRow({title: 'Schedule'});
            const mode = new Gtk.DropDown({
                valign: Gtk.Align.CENTER,
                model: Gtk.StringList.new(MODES.map(([, label]) => label)),
            });
            mode.connect('notify::selected', () => {
                const id = MODES[mode.get_selected()]?.[0];
                if (id && id !== s.get_string('auto-switch-1-mode'))
                    s.set_string('auto-switch-1-mode', id);
            });
            const [start, end] = ['auto-switch-1-time', 'auto-switch-2-time'].map(timeInput);
            row.add_suffix(mode);
            row.add_suffix(start);
            row.add_suffix(new Gtk.Label({label: '–'}));
            row.add_suffix(end);

            const load = () => {
                const dark = s.get_string('auto-switch-1-mode') === 'dark';
                if (mode.get_selected() !== Number(dark))
                    mode.set_selected(Number(dark));
                const [t1, t2] = [s.get_int('auto-switch-1-time'), s.get_int('auto-switch-2-time')];
                for (const button of [start, end]) {
                    if (t1 === t2)
                        button.add_css_class('error');
                    else
                        button.remove_css_class('error');
                }
                row.set_subtitle(t1 === t2
                    ? 'Choose two different times, switching is off until then'
                    : `${MODES[Number(dark)][1]} from ${clock(t1)} to ${clock(t2)}, ` +
                      `${MODES[Number(!dark)][1].toLowerCase()} the rest of the day`);
            };
            load();
            for (const key of ['auto-switch-1-mode', 'auto-switch-1-time', 'auto-switch-2-time'])
                watch(key, load);

            enable.bind_property('active', row, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
            group.add(row);
            return group;
        };

        // ---------- Dash to Panel ----------
        // Whether Dash to Panel is installed, asked to GNOME Shell over D-Bus (any install
        // folder) and followed while the window is open. Not installed: its row is inactive.
        // The first time it is found, a dialog tells about the colors both extensions set.
        const DTP_UUID = 'dash-to-panel@jderose9.github.com';
        const DTP_SUBTITLE = "Prioritize this extension's color settings";
        let dtpRow = null;
        const dtpNotice = () => {
            s.set_boolean('dtp-notice-shown', true);
            if (s.get_boolean('override-dtp-colors'))
                return;
            const dialog = new Adw.AlertDialog({
                heading: 'Dash to Panel detected',
                body: 'Dash to Panel paints its panel and window previews with its own color and opacity ' +
                    'settings, so the two extensions can show mismatched colors. Turn on “Use this ' +
                    "extension's colors in Dash to Panel” (Appearance tab) to prioritize this extension's " +
                    'color settings.\n\n' +
                    "Dash to Panel's own color settings are left untouched and take effect again if this " +
                    'option is turned off.',
            });
            dialog.add_response('later', 'Not now');
            dialog.add_response('on', 'Turn on');
            dialog.set_response_appearance('on', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('on');
            dialog.set_close_response('later');
            dialog.connect('response', (_d, response) => {
                if (response === 'on')
                    s.set_boolean('override-dtp-colors', true);
            });
            dialog.present(window);
        };
        const showDtp = installed => {
            if (!dtpRow || closed)
                return;
            dtpRow.set_sensitive(installed);
            dtpRow.set_subtitle(installed ? DTP_SUBTITLE : 'Dash to Panel is not installed');
            if (installed && !s.get_boolean('dtp-notice-shown'))
                dtpNotice();
        };
        const SHELL_EXTENSIONS = ['org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions', 'org.gnome.Shell.Extensions'];
        const UNINSTALLED = 99;
        const watchDtp = () => {
            Gio.bus_get(Gio.BusType.SESSION, null, (_o, busRes) => {
                let bus;
                try {
                    bus = Gio.bus_get_finish(busRes);
                } catch {
                    showDtp(false);
                    return;
                }
                if (closed)
                    return;
                bus.call(...SHELL_EXTENSIONS, 'GetExtensionInfo', new GLib.Variant('(s)', [DTP_UUID]),
                    null, Gio.DBusCallFlags.NONE, -1, null, (_b, res) => {
                        try {
                            const [info] = bus.call_finish(res).recursiveUnpack();
                            showDtp(Object.keys(info).length > 0 && info.state !== UNINSTALLED);
                        } catch {
                            showDtp(false);
                        }
                    });
                const id = bus.signal_subscribe(SHELL_EXTENSIONS[0], SHELL_EXTENSIONS[2], 'ExtensionStateChanged',
                    SHELL_EXTENSIONS[1], null, Gio.DBusSignalFlags.NONE, (...args) => {
                        const [uuid, info] = args[5].recursiveUnpack();
                        if (uuid === DTP_UUID)
                            showDtp(info.state !== UNINSTALLED);
                    });
                cleanups.push(() => bus.signal_unsubscribe(id));
            });
        };

        // ---------- Backup ----------
        const SETTINGS_FILE = 'light-mode-manager-settings.json';
        // Internal state stays out of backups: an old switch time would switch the mode on import.
        const backupKeys = () => s.settings_schema.list_keys()
            .filter(k => !['auto-switch-applied', 'dtp-notice-shown'].includes(k));
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
                        backupKeys().map(k => [k, s.get_value(k).print(true)]));
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
        const PROFILE_KEYS = ['profiles', 'profiles-dark', 'general-profiles'];
        const readSettingsFile = file => {
            const [, bytes] = file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (data?.extension !== this.uuid || typeof data.settings !== 'object' || !data.settings)
                throw new Error('not a Light Mode Manager settings file');
            const schema = s.settings_schema;
            return new Map(backupKeys().map(k => {
                const text = data.settings[k];
                if (typeof text !== 'string')
                    return [k, null];
                const value = GLib.Variant.parse(schema.get_key(k).get_value_type(), text, null, null);
                if (!schema.get_key(k).range_check(value))
                    throw new Error(`invalid value for ${k}`);
                // Profile lists must be valid JSON arrays, or "Replace all" would wipe them.
                if (PROFILE_KEYS.includes(k)) {
                    let list;
                    try {
                        list = JSON.parse(value.unpack());
                    } catch {
                        list = null;
                    }
                    if (!Array.isArray(list))
                        throw new Error(`invalid profiles in ${k}`);
                }
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
            const row = new Adw.ActionRow({title: 'Settings', subtitle: 'Exports or imports colors, profiles and options as JSON'});
            const importButton = new Gtk.Button({label: 'Import', valign: Gtk.Align.CENTER});
            importButton.connect('clicked', importSettings);
            const exportButton = new Gtk.Button({label: 'Export', valign: Gtk.Align.CENTER});
            exportButton.connect('clicked', exportSettings);
            row.add_suffix(importButton);
            row.add_suffix(exportButton);
            group.add(row);
            return group;
        };

        // Appearance: general profiles and visual tweaks.
        const addAppearanceTab = ({general, light, dark}) => {
            const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'preferences-desktop-appearance-symbolic'});
            page.add(generalProfilesGroup(general, light, dark));

            const effects = new Adw.PreferencesGroup({title: 'Visual tweaks'});
            sliderRow(effects, 'transition-duration', 'Transition',
                'Fade duration when switching between light and dark mode', 2000, 100, ' ms');
            sliderRow(effects, 'general-opacity', 'Shell opacity',
                'Menus, OSD and switcher; dialogs and overview stay solid', 100, 1, '%', 5);
            sliderRow(effects, 'card-opacity', 'Card opacity',
                'Cards, slider buttons, idle Quick Settings buttons and their menus', 100, 1, '%', 5);
            switchRow(effects, 'panel-opacity', 'Enable panel opacity',
                'Applies shell opacity to the top bar; solid when off');
            switchRow(effects, 'no-qs-dimming', 'Disable Quick Settings dimming',
                'Keeps Quick Settings bright while a toggle menu is open');
            switchRow(effects, 'match-arrow-buttons', 'Match arrows to toggles',
                "The arrow (›) next to each Quick Settings toggle uses the toggle's color");
            switchRow(effects, 'merge-arrow-buttons', 'Merge arrows into toggles',
                'Removes the gap line between each Quick Settings toggle and its arrow (›)');
            switchRow(effects, 'calendar-background', 'Calendar as card',
                'Gives the calendar the card background and removes the circles behind days');
            switchRow(effects, 'fix-qs-menu-height', 'Fix menu overlap',
                'Stops wrapped-text menus (Bluetooth off) from covering buttons below');
            dtpRow = switchRow(effects, 'override-dtp-colors', "Use this extension's colors in Dash to Panel",
                DTP_SUBTITLE);
            dtpRow.set_sensitive(false);
            page.add(effects);
            window.add(page);
        };

        // General: easy access, automatic switch and backup.
        const addGeneralTab = () => {
            const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-other-symbolic'});
            const panel = new Adw.PreferencesGroup({title: 'Easy access'});
            switchRow(panel, 'background-menu-entry', 'Desktop menu entry',
                'Adds “Light Mode Manager…” to the desktop right-click menu, below Change Background');
            switchRow(panel, 'quick-settings-profiles', 'Quick Settings switcher',
                'Adds a Quick Settings toggle to switch general profiles');
            page.add(panel);

            page.add(autoSwitchGroup());

            const lock = new Adw.PreferencesGroup({title: 'Lock screen'});
            switchRow(lock, 'lock-screen-native', 'Use GNOME colors on the lock screen',
                'Shows GNOME\'s own colors while locked. On the lock screen this extension only applies colors ' +
                'through CSS, so nothing else changes; its stylesheet is unloaded on lock and loaded again on ' +
                'unlock, which can cause a short delay or flicker when unlocking on slower computers');
            page.add(lock);

            page.add(backupGroup());

            window.add(page);
        };

        const profiles = createProfiles(s);
        addAppearanceTab(profiles);
        addTab('Light mode', 'weather-clear-symbolic', '', profiles.light);
        addTab('Dark mode', 'weather-clear-night-symbolic', '-dark', profiles.dark);
        addGeneralTab();
        watchDtp();
    }
}
