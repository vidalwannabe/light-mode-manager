import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createProfiles} from './profiles.js';

const toHex = c => `#${[c.red, c.green, c.blue]
    .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

// The accent color chosen in GNOME Settings (libadwaita 1.6+), GNOME's blue otherwise.
const accentColor = () => {
    const rgba = Adw.StyleManager.get_default().get_accent_color_rgba?.();
    return rgba ? toHex(rgba) : '#3584e4';
};

// The swatch of a color on system default with no color of its own to show.
const PLACEHOLDER = '#808080';
const {SUGGESTED, DESTRUCTIVE} = Adw.ResponseAppearance;

// The Light mode and Dark mode tabs show exactly these rows.
// [key name, title, subtitle, swatch tooltip and color when empty]; a set color's tooltip is
// its code.
const ACCENT = 'Accent color set in\nGNOME Settings › Appearance';
const COLOR_GROUPS = [
    ['Shell', [
        ['panel-fg', 'Shell text and icons', 'App grid, menus, OSD, overview, password field, search, switchers and top bar'],
        ['general', 'Shell background', 'Dialogs, menus, OSD, overview, top bar and window switcher'],
        ['dash', 'Overview and top bar highlights',
            'Alt+Tab selection, app hover, dash, folders, password field, search and top bar buttons'],
    ]],
    ['Quick Settings and Notification Panel', [
        ['qs-active-fg', 'Active button text and icons', 'Active menus, media player, today in the calendar and toggles that are on',
            'Accent text color', '#ffffff'],
        ['qs-active', 'Active button background', 'Active menus, media player, today in the calendar and toggles that are on',
            ACCENT, accentColor],
        ['qs-fg', 'Idle button text and icons', 'Idle menus, round buttons, slider handles and toggles that are off'],
        ['qs-button', 'Idle button background', 'Idle menus, round buttons, slider buttons, slider tracks and toggles that are off'],
        ['highlight', 'Volume and brightness sliders', 'OSD and Quick Settings sliders'],
        ['fg', 'Card titles and icons', 'Calendar, Clear button, Do Not Disturb label, notifications and their buttons, Today, Weather and World Clocks'],
        ['fg-muted', 'Card subtitles', 'Locations, notification body, times and weekdays'],
        ['card-buttons', 'Card buttons', 'Close, collapse, expand and notification action buttons'],
        ['card', 'Card background', 'Banners, Calendar as card, Clear button, Do Not Disturb switch, notifications, Today, Weather and World Clocks'],
    ]],
];

const flatButton = props => {
    const button = new Gtk.Button({valign: Gtk.Align.CENTER, ...props});
    button.add_css_class('flat');
    return button;
};

// Selectors are as wide as their text, up to 190px (a longer text is ellipsized).
const SELECTOR_MAX_WIDTH = 190;
// Each class needs its own name: GJS names the GType after it.
const capMeasure = ([min, nat, minBaseline, natBaseline], orientation) => orientation === Gtk.Orientation.HORIZONTAL
    ? [Math.min(min, SELECTOR_MAX_WIDTH), Math.min(nat, SELECTOR_MAX_WIDTH), minBaseline, natBaseline]
    : [min, nat, minBaseline, natBaseline];
const CappedMenuButton = GObject.registerClass(class CappedMenuButton extends Gtk.MenuButton {
    vfunc_measure(orientation, forSize) {
        return capMeasure(super.vfunc_measure(orientation, forSize), orientation);
    }
});
const CappedDropDown = GObject.registerClass(class CappedDropDown extends Gtk.DropDown {
    vfunc_measure(orientation, forSize) {
        return capMeasure(super.vfunc_measure(orientation, forSize), orientation);
    }
});
// A selector menu button: showLabel(text) shows `text`.
const selectorButton = props => {
    const label = new Gtk.Label({ellipsize: Pango.EllipsizeMode.END});
    const button = new CappedMenuButton({child: label, always_show_arrow: true, valign: Gtk.Align.CENTER, ...props});
    button.showLabel = text => label.set_label(text);
    return button;
};

export default class ShellColorManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 790);
        // Narrower, the color and schedule rows squeeze their titles and controls.
        window.set_size_request(600, 185);
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

        // A color row of a mode tab (`suffix`: '' or '-dark').
        const colorRow = (group, name, suffix, restore, title, subtitle, emptyLabel = 'System default', emptyColor = PLACEHOLDER) => {
            const key = `color-${name}${suffix}`;
            const row = new Adw.ActionRow({title, subtitle});
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: false}),
                valign: Gtk.Align.CENTER,
            });
            // The code shown and copied: null for the gray placeholder of a color on system
            // default. The tooltip is centered, for the lines of colors on system default.
            let code = null;
            let tooltip = '';
            button.set_has_tooltip(true);
            button.connect('query-tooltip', (_b, _x, _y, _keyboard, tip) => {
                tip.set_custom(new Gtk.Label({label: tooltip, justify: Gtk.Justification.CENTER}));
                return true;
            });
            let loading = false;
            const load = () => {
                // Empty or unreadable: the shell uses the system default, named in the tooltip
                // under the code of the color it stands for (the accent...). "accent": the
                // accent color set in GNOME Settings (a default of some rows).
                const value = s.get_string(key).trim();
                const color = new Gdk.RGBA();
                const accent = value === 'accent';
                const valid = !accent && color.parse(value);
                if (!valid)
                    color.parse(accent ? accentColor() : typeof emptyColor === 'function' ? emptyColor(s, suffix) : emptyColor);
                const hex = toHex(color).toUpperCase();
                code = valid || hex !== PLACEHOLDER ? hex : null;
                tooltip = valid ? hex : [code, accent ? ACCENT : emptyLabel].filter(Boolean).join('\n');
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

            // Right-click copies the color code shown, if any.
            const copy = new Gtk.GestureClick({button: Gdk.BUTTON_SECONDARY});
            copy.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            copy.connect('pressed', () => {
                if (!code)
                    return;
                button.get_clipboard().set_content(Gdk.ContentProvider.new_for_bytes('text/plain;charset=utf-8',
                    new GLib.Bytes(new TextEncoder().encode(code))));
                window.add_toast(new Adw.Toast({title: `Color code copied (${code})`, timeout: 2}));
            });
            button.add_controller(copy);

            const reset = flatButton({icon_name: 'edit-undo-symbolic', tooltip_text: 'Restore from color set'});
            reset.connect('clicked', restore);
            row.add_suffix(button);
            row.add_suffix(reset);
            group.add(row);
        };

        // An alert dialog with `responses` ([id, label, appearance]): the first one closes it,
        // the last one is the default when suggested, and onResponse(id) gets the others.
        const alert = (props, responses, onResponse) => {
            const dialog = new Adw.AlertDialog(props);
            for (const [id, label, appearance] of responses) {
                dialog.add_response(id, label);
                if (appearance)
                    dialog.set_response_appearance(id, appearance);
            }
            const [[close], [last, , appearance]] = [responses[0], responses.at(-1)];
            dialog.set_close_response(close);
            if (appearance === SUGGESTED)
                dialog.set_default_response(last);
            dialog.connect('response', (_d, id) => {
                if (id !== close)
                    onResponse(id);
            });
            return dialog;
        };

        // Asks for a new profile name, plus one choice per entry of `combos`
        // ({title, names, selected}). taken(name) says whether the name is already used.
        // `initial` prefills the name (renaming: keeping it unchanged is allowed); `action` is
        // the confirm button's label.
        const profileDialog = (taken, onConfirm, combos = [], heading = 'New color set', initial = '', action = 'Save') => {
            const fields = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
            fields.add_css_class('boxed-list');
            const entry = new Adw.EntryRow({title: 'Color set name', text: initial});
            fields.append(entry);
            const choices = combos.map(({title, names, selected}) => {
                const row = new Adw.ComboRow({title, model: Gtk.StringList.new(names)});
                row.set_selected(Math.max(0, names.indexOf(selected)));
                fields.append(row);
                return () => names[row.get_selected()];
            });

            const name = () => entry.get_text().trim();
            const valid = () => name() !== '' && (name() === initial || !taken(name()));
            const done = () => onConfirm(name(), ...choices.map(get => get()));
            const dialog = alert({heading, extra_child: fields}, [['cancel', 'Cancel'], ['ok', action, SUGGESTED]], done);
            entry.connect('changed', () => dialog.set_response_enabled('ok', valid()));
            dialog.set_response_enabled('ok', valid());
            entry.connect('entry-activated', () => {
                if (valid()) {
                    done();
                    dialog.close();
                }
            });
            dialog.present(window);
            entry.grab_focus();
        };

        const confirm = (heading, body, label, onConfirm) =>
            alert({heading, body}, [['cancel', 'Cancel'], ['ok', label, DESTRUCTIVE]], onConfirm).present(window);

        // A "Color sets" group: one row with a selector (apply; send, edit and delete the user's
        // own) and the given add button. `sendTo`: {model, label} of the other mode, for the
        // Light and Dark tabs. editButton(profile, close) makes a row's edit button; close()
        // closes the selector.
        const selectorGroup = ({groupTitle = 'Color sets', title, subtitle, model, describe, addButton, sendTo, editButton}) => {
            const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
            list.add_css_class('boxed-list');
            list.add_css_class('lmm-profile-list');
            const popover = new Gtk.Popover({child: new Gtk.ScrolledWindow({
                child: list, propagate_natural_height: true, max_content_height: 360,
                hscrollbar_policy: Gtk.PolicyType.NEVER, width_request: 300,
            })});
            const selector = selectorButton({popover, tooltip_text: 'Saved color sets'});

            const profileRow = (profile, applied) => {
                const builtin = model.builtins.includes(profile);
                const row = new Adw.ActionRow({
                    title: profile.name, subtitle: describe(profile), activatable: true, tooltip_text: 'Apply',
                });
                // Every row gets the check icon so names stay aligned; only the applied one shows it.
                row.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic', opacity: profile.name === applied?.name ? 1 : 0}));
                row.connect('activated', () => {
                    popover.popdown();
                    model.apply(profile);
                });
                if (!builtin && sendTo) {
                    // A copy in the other mode's list, with the same colors (numbered if the
                    // name is in use there).
                    const send = flatButton({icon_name: 'document-send-symbolic', tooltip_text: `Send to ${sendTo.label}`});
                    send.connect('clicked', () => {
                        popover.popdown();
                        const name = sendTo.model.freeName(profile.name);
                        sendTo.model.save([...sendTo.model.own(), {name, colors: {...profile.colors}}]);
                        toast(`“${name}” sent to ${sendTo.label}`);
                    });
                    row.add_suffix(send);
                }
                if (!builtin) {
                    row.add_suffix(editButton(profile, () => popover.popdown()));
                    const del = flatButton({icon_name: 'user-trash-symbolic', tooltip_text: 'Delete'});
                    del.connect('clicked', () => {
                        popover.popdown();
                        confirm(`Delete "${profile.name}"?`, 'This color set will be removed.', 'Delete',
                            () => model.save(model.own().filter(p => p.name !== profile.name)));
                    });
                    row.add_suffix(del);
                }
                return row;
            };

            const refresh = () => {
                const profiles = model.all();
                const applied = model.applied(profiles);
                selector.showLabel(applied?.name ?? 'Unsaved');
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
            for (const key of model.keys)
                watch(key, queueRefresh);

            const row = new Adw.ActionRow({title, subtitle});
            row.add_suffix(selector);
            row.add_suffix(addButton);
            const group = new Adw.PreferencesGroup({title: groupTitle});
            group.add(row);
            return group;
        };

        // Light or Dark tab color sets: the save button asks a name for the current colors; each
        // saved color set's edit menu renames it or updates it with the current colors.
        const modeProfilesGroup = (model, sendTo) => {
            const addButton = flatButton({icon_name: 'media-floppy-symbolic', tooltip_text: 'Save current colors'});
            addButton.connect('clicked', () => profileDialog(model.taken, name => {
                model.save([...model.own(), {name, colors: model.current()}]);
                model.setActive(name);
            }));
            const editButton = (profile, close) => {
                const actions = new Gio.SimpleActionGroup();
                const action = (name, fn) => {
                    const a = new Gio.SimpleAction({name});
                    a.connect('activate', () => {
                        close();
                        fn();
                    });
                    actions.add_action(a);
                };
                action('rename', () => profileDialog(model.taken, name => {
                    if (name !== profile.name)
                        model.rename(profile.name, name);
                }, [], 'Rename color set', profile.name, 'Rename'));
                action('update', () => {
                    model.save(model.own().map(p => p.name === profile.name ? {name: p.name, colors: model.current()} : p));
                    model.setActive(profile.name);
                    toast(`“${profile.name}” updated`);
                });
                const menu = new Gio.Menu();
                menu.append('Rename color set', 'edit.rename');
                menu.append('Update with current colors', 'edit.update');
                const button = new Gtk.MenuButton({
                    icon_name: 'document-edit-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Edit', menu_model: menu,
                });
                button.add_css_class('flat');
                button.insert_action_group('edit', actions);
                return button;
            };

            return selectorGroup({
                title: 'Color set', subtitle: 'Create, update or load a color set', model, addButton, editButton,
                describe: () => '', sendTo,
            });
        };

        // A general profile pairs a light and a dark profile and applies both.
        const generalProfilesGroup = (model, light, dark) => {
            const side = (mode, name) => model.exists(mode, name) ? name : `${name} (deleted)`;

            // A name, and the light and dark color sets (the given ones selected).
            const sides = (l, d) => [
                {title: 'Light mode color set', names: light.all().map(p => p.name), selected: l},
                {title: 'Dark mode color set', names: dark.all().map(p => p.name), selected: d},
            ];
            // Saving asks a name and the color sets: the ones applied in each tab, or the tab's
            // default when its colors are unsaved. Only saved: applying it here would overwrite
            // unsaved colors.
            const addButton = flatButton({icon_name: 'media-floppy-symbolic', tooltip_text: 'New general color set'});
            addButton.connect('clicked', () => profileDialog(model.taken, (name, l, d) => {
                model.save([...model.own(), {name, light: l, dark: d}]);
            }, sides(light.applied()?.name ?? light.builtins[0].name, dark.applied()?.name ?? dark.builtins[0].name),
            'New general color set'));
            // Editing changes the name and the color sets of a general color set.
            const editButton = (profile, close) => {
                const button = flatButton({icon_name: 'document-edit-symbolic', tooltip_text: 'Edit'});
                button.connect('clicked', () => {
                    close();
                    profileDialog(model.taken, (name, l, d) => {
                        model.save(model.own().map(p => p.name === profile.name ? {name, light: l, dark: d} : p));
                        if (name !== profile.name && model.activeName() === profile.name)
                            model.setActive(name);
                    }, sides(profile.light, profile.dark), 'Edit general color set', profile.name, 'Save');
                });
                return button;
            };

            return selectorGroup({
                groupTitle: 'General color sets', title: 'Color set',
                subtitle: 'Create or load a light and a dark mode color set at once',
                model, addButton, editButton,
                describe: p => `Light: ${side(light, p.light)} · Dark: ${side(dark, p.dark)}`,
            });
        };

        // Ctrl+Z undoes the last color change of the open tab and Ctrl+Shift+Z redoes the last
        // undone one; each mode tab keeps its own history. Changes made in the same main loop
        // iteration (a whole color set being applied) are one step. Every change to the tab's
        // colors is recorded, whatever made it; a new change drops the steps left to redo.
        const histories = new Map();
        const trackHistory = (page, keys) => {
            const last = new Map(keys.map(key => [key, s.get_string(key)]));
            const undos = [];
            const redos = [];
            let step = null;
            for (const key of keys) {
                watch(key, () => {
                    const value = s.get_string(key);
                    if (value === last.get(key))
                        return;
                    if (!step) {
                        step = new Map();
                        undos.push(step);
                        if (undos.length > 100)
                            undos.shift();
                        redos.length = 0;
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            step = null;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    if (!step.has(key))
                        step.set(key, last.get(key));
                    last.set(key, value);
                });
            }
            // Applies a step (key -> value to set) and files its reverse in `into`. `last` is
            // updated first, so the handlers above do not record it as a new change.
            const travel = (from, into) => {
                const target = from.pop();
                if (!target)
                    return;
                if (step === target)
                    step = null;
                const reverse = new Map();
                target.forEach((value, key) => {
                    reverse.set(key, last.get(key));
                    last.set(key, value);
                    s.set_string(key, value);
                });
                into.push(reverse);
            };
            histories.set(page, {undo: () => travel(undos, redos), redo: () => travel(redos, undos)});
        };
        const shortcuts = new Gtk.ShortcutController({scope: Gtk.ShortcutScope.MANAGED});
        for (const [trigger, action] of [['<Control>z', 'undo'], ['<Control><Shift>z', 'redo']]) {
            shortcuts.add_shortcut(new Gtk.Shortcut({
                trigger: Gtk.ShortcutTrigger.parse_string(trigger),
                action: Gtk.CallbackAction.new(() => {
                    const history = histories.get(window.get_visible_page());
                    history?.[action]();
                    return !!history;
                }),
            }));
        }
        window.add_controller(shortcuts);

        const addTab = (title, icon, suffix, model, sendTo) => {
            const page = new Adw.PreferencesPage({title, icon_name: icon});
            page.add(modeProfilesGroup(model, sendTo));
            const keys = [];
            for (const [groupTitle, rows] of COLOR_GROUPS) {
                const group = new Adw.PreferencesGroup({title: groupTitle});
                for (const [name, ...row] of rows) {
                    keys.push(`color-${name}${suffix}`);
                    colorRow(group, name, suffix, () => model.restore(name), ...row);
                }
                page.add(group);
            }
            trackHistory(page, keys);
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
            const labels = MODES.map(([, label]) => label);
            const mode = new CappedDropDown({
                valign: Gtk.Align.CENTER, model: Gtk.StringList.new(labels),
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
            alert({
                heading: 'Dash to Panel detected',
                body: 'Dash to Panel paints its panel and window previews with its own color and opacity ' +
                    'settings, so the two extensions can show mismatched colors. Turn on “Use this ' +
                    "extension's colors in Dash to Panel” (General tab) to prioritize this extension's " +
                    'color settings.\n\n' +
                    "Dash to Panel's own color settings are left untouched and take effect again if this " +
                    'option is turned off.',
            }, [['later', 'Not now'], ['on', 'Turn on', SUGGESTED]], () => s.set_boolean('override-dtp-colors', true))
                .present(window);
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
        const SETTINGS_FILE = 'shell-color-manager-settings.json';
        // Internal state stays out of backups: an old switch time would switch the mode on import.
        const backupKeys = () => s.settings_schema.list_keys()
            .filter(k => !['auto-switch-applied', 'dtp-notice-shown', 'auto-switch-off-notice'].includes(k));
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
        const LEGACY_UUID = 'light-mode-manager@vidalwannabe.github.io';
        const readSettingsFile = file => {
            const [, bytes] = file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            // Backups made before the rename to Shell Color Manager carry the old UUID.
            if (![this.uuid, LEGACY_UUID].includes(data?.extension) || typeof data.settings !== 'object' || !data.settings)
                throw new Error('not a Shell Color Manager settings file');
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
                        throw new Error(`invalid color sets in ${k}`);
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
                alert({
                    heading: 'Import settings',
                    body: 'Add the color sets from this file to yours, or replace all current settings with it?',
                }, [['cancel', 'Cancel'], ['replace', 'Replace all', DESTRUCTIVE], ['add', 'Add color sets', SUGGESTED]],
                response => {
                    if (response === 'replace') {
                        replaceAll(values);
                        toast('Settings replaced');
                    } else {
                        const count = addProfiles(values);
                        toast(count ? `${count} color set${count > 1 ? 's' : ''} added` : 'No new color sets to add');
                    }
                }).present(window);
            });
        };

        const backupGroup = () => {
            const group = new Adw.PreferencesGroup({title: 'Backup'});
            const row = new Adw.ActionRow({title: 'Settings', subtitle: 'Exports or imports colors, color sets and options as JSON'});
            const importButton = new Gtk.Button({label: 'Import', valign: Gtk.Align.CENTER});
            importButton.connect('clicked', importSettings);
            const exportButton = new Gtk.Button({label: 'Export', valign: Gtk.Align.CENTER});
            exportButton.connect('clicked', exportSettings);
            row.add_suffix(importButton);
            row.add_suffix(exportButton);
            group.add(row);
            return group;
        };

        // General: general color sets, visual tweaks, easy access, automatic switch and backup.
        const addGeneralTab = ({general, light, dark}) => {
            const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-desktop-appearance-symbolic'});
            page.add(generalProfilesGroup(general, light, dark));

            const effects = new Adw.PreferencesGroup({title: 'Visual tweaks'});
            sliderRow(effects, 'transition-duration', 'Transition',
                'Fade duration when switching between light and dark mode', 2000, 100, ' ms');
            switchRow(effects, 'hide-borders', 'Disable borders',
                'Removes the borders of menus and cards');
            switchRow(effects, 'no-qs-dimming', 'Disable Quick Settings dimming',
                'Keeps Quick Settings bright while a toggle menu is open');
            switchRow(effects, 'merge-arrow-buttons', 'Merge arrows into toggles',
                "Each Quick Settings arrow (›) takes its toggle's color, without the gap line between them");
            switchRow(effects, 'calendar-background', 'Calendar as card',
                'Gives the calendar the card background and removes the circles behind days');
            dtpRow = switchRow(effects, 'override-dtp-colors', "Use this extension's colors in Dash to Panel",
                DTP_SUBTITLE);
            dtpRow.set_sensitive(false);
            page.add(effects);

            const panel = new Adw.PreferencesGroup({title: 'Easy access'});
            switchRow(panel, 'background-menu-entry', 'Desktop menu entry',
                'Adds “Shell Color Manager…” to the desktop right-click menu, below Change Background');
            switchRow(panel, 'quick-settings-profiles', 'Quick Settings color sets',
                'Adds a Quick Settings button to switch the color sets of the current mode');
            page.add(panel);

            page.add(autoSwitchGroup());

            page.add(backupGroup());

            window.add(page);
        };

        const profiles = createProfiles(s);
        addGeneralTab(profiles);
        addTab('Light mode', 'weather-clear-symbolic', '', profiles.light, {model: profiles.dark, label: 'Dark mode'});
        addTab('Dark mode', 'weather-clear-night-symbolic', '-dark', profiles.dark, {model: profiles.light, label: 'Light mode'});
        watchDtp();
        // The shell turned the automatic switch off because the mode was changed by hand.
        if (s.get_boolean('auto-switch-off-notice')) {
            s.set_boolean('auto-switch-off-notice', false);
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (!closed) {
                    alert({
                        heading: 'Automatic switch turned off',
                        body: 'The mode was changed manually while the automatic switch was on, so it was ' +
                            'turned off to keep your choice. You can turn it on again in the General tab.',
                    }, [['ok', 'Keep it off'], ['on', 'Turn on again', SUGGESTED]],
                    () => s.set_boolean('auto-switch', true)).present(window);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}
