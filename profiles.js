// Profile logic shared by the preferences window and the Quick Settings switcher.
// Only uses Gio.Settings, so it runs in both the shell and the preferences process.

// The color rows of the Light mode and Dark mode tabs.
export const ROW_NAMES = ['panel', 'panel-fg', 'overview', 'dash', 'general', 'border', 'fg', 'fg-muted', 'qs-button', 'card',
    'qs-active-fg', 'qs-active', 'highlight', 'today'];

// Rows added later: a profile saved before them takes the value of the row they came
// from, so it keeps its look: the top bar text used to follow "Text and icons", the top bar
// and overview backgrounds the general background, and today in the calendar the sliders.
// The dash takes the cards background, as in the Default profile.
const LEGACY_ROWS = {'panel-fg': 'fg', 'dash': 'card', 'panel': 'general', 'overview': 'general', 'today': 'highlight'};
const rowColor = (colors, n) => colors[n] ?? colors[LEGACY_ROWS[n]];

// The schema default of every row of a mode ('' for light, '-dark' for dark).
const defaults = (settings, suffix) => Object.fromEntries(
    ROW_NAMES.map(n => [n, settings.get_default_value(`color-${n}${suffix}`).unpack()]));

// Profiles saved as JSON in `listKey`, after the fixed `builtins`, remembering the
// applied one by name in `activeKey` (so two equal profiles are never both marked).
// isValid(p) checks the fields of a saved profile.
function profileStore(settings, listKey, activeKey, builtins, isValid) {
    const reserved = new Set(builtins.map(p => p.name));
    // The user's own profiles (a saved one can never shadow a built-in name).
    const own = () => {
        try {
            const list = JSON.parse(settings.get_string(listKey));
            return Array.isArray(list)
                ? list.filter(p => typeof p?.name === 'string' && !reserved.has(p.name) && isValid(p))
                : [];
        } catch {
            return [];
        }
    };
    return {
        builtins, own, isValid,
        // Built-ins first, then the user's own profiles in alphabetical order.
        all: () => [...builtins, ...own().sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}))],
        save: list => settings.set_string(listKey, JSON.stringify(list)),
        taken: name => reserved.has(name) || own().some(p => p.name === name),
        activeName: () => settings.get_string(activeKey),
        setActive: name => settings.set_string(activeKey, name),
        keys: [listKey, activeKey],
    };
}

// The profiles of the Light or Dark tab.
function modeProfiles(settings, suffix, builtins) {
    const store = profileStore(settings, `profiles${suffix}`, `active-profile${suffix}`, builtins,
        p => p.colors && typeof p.colors === 'object');
    const colorKey = n => `color-${n}${suffix}`;
    const defaultColors = defaults(settings, suffix);
    const matches = colors =>
        ROW_NAMES.every(n => (rowColor(colors, n) ?? defaultColors[n]) === settings.get_string(colorKey(n)));
    return {
        ...store,
        keys: [...store.keys, ...ROW_NAMES.map(colorKey)],
        current: () => Object.fromEntries(ROW_NAMES.map(n => [n, settings.get_string(colorKey(n))])),
        // A row that is missing or equal to its default is reset, so dconf only keeps real changes.
        apply(profile) {
            store.setActive(profile.name);
            for (const n of ROW_NAMES) {
                const value = rowColor(profile.colors, n);
                if (typeof value !== 'string' || value === defaultColors[n])
                    settings.reset(colorKey(n));
                else
                    settings.set_string(colorKey(n), value);
            }
        },
        // Restores one row to the last applied profile's color (the schema default when that
        // profile no longer exists), not always to the Default profile.
        restore(n) {
            const profile = store.all().find(p => p.name === store.activeName());
            const value = profile ? rowColor(profile.colors, n) : undefined;
            if (typeof value !== 'string' || value === defaultColors[n])
                settings.reset(colorKey(n));
            else
                settings.set_string(colorKey(n), value);
        },
        // The applied profile; it stops counting once a color is changed.
        applied(profiles = store.all()) {
            const p = profiles.find(q => q.name === store.activeName());
            return p && matches(p.colors) ? p : null;
        },
    };
}

// General profiles pair a light and a dark profile and apply both.
function generalProfiles(settings, light, dark) {
    const store = profileStore(settings, 'general-profiles', 'active-general-profile', [
        {name: 'Default', light: 'Default', dark: 'Default'},
        {name: 'GNOME', light: 'GNOME', dark: 'GNOME'},
    ], p => typeof p.light === 'string' && typeof p.dark === 'string');
    const find = (mode, name) => mode.all().find(p => p.name === name);
    return {
        ...store,
        keys: [...store.keys, ...light.keys, ...dark.keys],
        // Whether the mode profile a general profile points to still exists.
        exists: (mode, name) => !!find(mode, name),
        // A side whose profile was deleted is left as it is.
        apply(profile) {
            store.setActive(profile.name);
            const [l, d] = [find(light, profile.light), find(dark, profile.dark)];
            if (l)
                light.apply(l);
            if (d)
                dark.apply(d);
        },
        applied(profiles = store.all()) {
            const p = profiles.find(q => q.name === store.activeName());
            return p && light.applied()?.name === p.light && dark.applied()?.name === p.dark ? p : null;
        },
    };
}

// All profile models: built-in "Default" (the schema defaults), "GNOME" (every row on
// system default) and, in dark mode, "Oled" (Default with pure black top bar, overview,
// menus, menu borders, idle buttons and cards).
export function createProfiles(settings) {
    const gnome = {name: 'GNOME', colors: Object.fromEntries(ROW_NAMES.map(n => [n, '']))};
    const light = modeProfiles(settings, '', [{name: 'Default', colors: defaults(settings, '')}, gnome]);
    const darkDefaults = defaults(settings, '-dark');
    const dark = modeProfiles(settings, '-dark', [
        {name: 'Default', colors: darkDefaults},
        gnome,
        {name: 'Oled', colors: {
            ...darkDefaults, panel: '#000000', overview: '#000000', general: '#000000', border: '#000000',
            'qs-button': '#000000', card: '#000000',
        }},
    ]);
    return {light, dark, general: generalProfiles(settings, light, dark)};
}
