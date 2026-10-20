// Profile logic shared by the preferences window and the Quick Settings switcher.
// Only uses Gio.Settings, so it runs in both the shell and the preferences process.

// The color rows of the Light mode and Dark mode tabs.
export const ROW_NAMES = ['panel-fg', 'general', 'dash', 'qs-fg', 'qs-button', 'qs-active-fg', 'qs-active', 'highlight',
    'fg', 'fg-muted', 'card', 'media'];

// Rows added later: a profile saved before them takes the value of the row they came
// from, so it keeps its look: the shell and idle button text used to follow the cards' text,
// and the dash the cards' background.
const LEGACY_ROWS = {'panel-fg': 'fg', 'dash': 'card', 'qs-fg': 'fg'};
const rowColor = (colors, n) => colors[n] ?? colors[LEGACY_ROWS[n]];

// The schema default of every row of a mode ('' for light, '-dark' for dark).
const defaults = (settings, suffix) => Object.fromEntries(
    ROW_NAMES.map(n => [n, settings.get_default_value(`color-${n}${suffix}`).unpack()]));

// Profiles saved as JSON in `listKey`, after the fixed `builtins`, remembering the
// applied one by name in `activeKey` (so two equal profiles are never both marked).
// isValid(p) checks the fields of a saved profile.
// Before "Light Default" and "Dark Default", each tab's own default was named "Default":
// that name stays reserved and still means the tab's own default (first built-in).
const LEGACY_DEFAULT = 'Default';

function profileStore(settings, listKey, activeKey, builtins, isValid) {
    const reserved = new Set([...builtins.map(p => p.name), LEGACY_DEFAULT]);
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
    const save = list => settings.set_string(listKey, JSON.stringify(list));
    const taken = name => reserved.has(name) || own().some(p => p.name === name);
    return {
        builtins, own, isValid, save, taken,
        // A profile by name, the legacy "Default" included.
        byName(name) {
            return this.all().find(p => p.name === name) ?? (name === LEGACY_DEFAULT ? builtins[0] : undefined);
        },
        // Built-ins first, then the user's own profiles in alphabetical order.
        all: () => [...builtins, ...own().sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}))],
        activeName: () => settings.get_string(activeKey),
        setActive: name => settings.set_string(activeKey, name),
        // Renames one of the user's profiles, keeping it the applied one if it was.
        rename(from, to) {
            save(own().map(p => p.name === from ? {...p, name: to} : p));
            if (settings.get_string(activeKey) === from)
                settings.set_string(activeKey, to);
        },
        // A name not in use: `name`, or "name (2)", "name (3)"...
        freeName(name) {
            let free = name;
            for (let i = 2; taken(free); i++)
                free = `${name} (${i})`;
            return free;
        },
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
        // The profile the current colors match, found in real time: the last applied one
        // first, otherwise any profile with exactly these colors; null when none does.
        applied(profiles = store.all()) {
            const active = store.byName(store.activeName());
            if (active && matches(active.colors))
                return active;
            return profiles.find(q => matches(q.colors)) ?? null;
        },
    };
}

// General profiles pair a light and a dark profile and apply both.
function generalProfiles(settings, light, dark) {
    const store = profileStore(settings, 'general-profiles', 'active-general-profile', [
        {name: 'Default', light: 'Light Default', dark: 'Dark Default'},
        {name: 'GNOME', light: 'GNOME', dark: 'GNOME'},
    ], p => typeof p.light === 'string' && typeof p.dark === 'string');
    return {
        ...store,
        keys: [...store.keys, ...light.keys, ...dark.keys],
        // Whether the mode profile a general profile points to still exists.
        exists: (mode, name) => !!mode.byName(name),
        // A side whose profile was deleted is left as it is.
        apply(profile) {
            store.setActive(profile.name);
            const [l, d] = [light.byName(profile.light), dark.byName(profile.dark)];
            if (l)
                light.apply(l);
            if (d)
                dark.apply(d);
        },
        // The general profile pairing the profiles the Light and Dark tabs show now: the last
        // applied one first, otherwise any saved pair. Recognizing a profile never applies it.
        applied(profiles = store.all()) {
            const [l, d] = [light.applied()?.name, dark.applied()?.name];
            if (!l || !d)
                return null;
            const pairs = p => light.byName(p.light)?.name === l && dark.byName(p.dark)?.name === d;
            const active = store.byName(store.activeName());
            return active && pairs(active) ? active : profiles.find(pairs) ?? null;
        },
    };
}

// All profile models. Both tabs offer the same built-ins, the tab's own default first:
// "Light Default" and "Dark Default" (each mode's schema defaults), "GNOME" (every row on
// system default) and "Oled" (Dark Default with a pure black shell background, idle
// buttons and cards). So a dark color set can be used,
// or started from, in light mode and the other way around.
export function createProfiles(settings) {
    const lightDefault = {name: 'Light Default', colors: defaults(settings, '')};
    const darkColors = defaults(settings, '-dark');
    const darkDefault = {name: 'Dark Default', colors: darkColors};
    const gnome = {name: 'GNOME', colors: Object.fromEntries(ROW_NAMES.map(n => [n, '']))};
    const oled = {name: 'Oled', colors: {
        ...darkColors, general: '#000000', 'qs-button': '#000000', card: '#000000',
    }};
    const light = modeProfiles(settings, '', [lightDefault, darkDefault, gnome, oled]);
    const dark = modeProfiles(settings, '-dark', [darkDefault, lightDefault, gnome, oled]);
    const general = generalProfiles(settings, light, dark);
    // Renaming a light or dark profile also renames it in the general profiles that use it.
    for (const [mode, side] of [[light, 'light'], [dark, 'dark']]) {
        const {rename} = mode;
        mode.rename = (from, to) => {
            rename(from, to);
            const own = general.own();
            if (own.some(p => p[side] === from))
                general.save(own.map(p => p[side] === from ? {...p, [side]: to} : p));
        };
    }
    return {light, dark, general};
}
