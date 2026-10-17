#!/usr/bin/env python3
"""Run inside the extension folder: python3 update.py"""
import glob, subprocess, sys

# ---- schema: dark panel default = #36363a
sch = glob.glob('schemas/*.gschema.xml')
if not sch:
    sys.exit('Run this inside the extension folder (schemas/ not found).')
sch = sch[0]
t = open(sch).read()
old = '<key name="color-panel-dark" type="s"><default>\'\'</default>'
if old in t:
    t = t.replace(old, '<key name="color-panel-dark" type="s"><default>\'#36363a\'</default>', 1)
    open(sch, 'w').write(t)
    print('schema: dark panel default set to #36363a')
else:
    print('schema: already updated (or different), skipped')

# ---- prefs.js: per-tab restore buttons
p = open('prefs.js').read()
if 'addResetGroup' in p:
    print('prefs.js: already updated, skipped')
else:
    helper = """        const addResetGroup = (page, keys) => {
            const grp = new Adw.PreferencesGroup();
            const r = new Adw.ActionRow({title: 'Restore this tab to defaults'});
            const btn = new Gtk.Button({label: 'Restore defaults', valign: Gtk.Align.CENTER});
            btn.add_css_class('destructive-action');
            btn.connect('clicked', () => keys.forEach(k => s.reset(k)));
            r.add_suffix(btn);
            grp.add(r);
            page.add(grp);
        };

"""
    light = ['color-panel','color-fg','color-fg-muted','color-popup','color-card','color-surface','color-dash','color-overview']
    dark = ['color-panel-dark','color-panel-text-dark','color-popup-dark','color-card-dark','color-surface-dark','color-dash-dark','color-overview-dark']
    rad = ['popup','quick-settings','datemenu','notification','modal','dash','switcher','tile','search']
    fmt = lambda ks: '[' + ', '.join("'%s'" % k for k in ks) + ']'
    edits = [
        ("        // ----- Light mode -----", helper + "        // ----- Light mode -----"),
        ("        // ----- Dark mode -----", "        addResetGroup(light, %s);\n\n        // ----- Dark mode -----" % fmt(light)),
        ("        // ----- Border radius (both modes) -----", "        addResetGroup(dark, %s);\n\n        // ----- Border radius (both modes) -----" % fmt(dark)),
        ("        spinRow(g, 'radius-search', 'Search results');\n", "        spinRow(g, 'radius-search', 'Search results');\n        addResetGroup(rad, %s);\n" % fmt(['radius-' + r for r in rad])),
    ]
    for a, b in edits:
        if a not in p:
            sys.exit('Could not find expected text in prefs.js: ' + a.strip())
        p = p.replace(a, b, 1)
    open('prefs.js', 'w').write(p)
    print('prefs.js: restore buttons added')

subprocess.run(['glib-compile-schemas', 'schemas'], check=True)
print('schemas recompiled. Done.')
