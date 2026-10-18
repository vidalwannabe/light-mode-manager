# Light Mode Manager

GNOME Shell extension (GNOME 48) that brings light mode to the parts of the shell GNOME keeps dark (top bar, menus, quick settings, notifications, overview, dash…), and lets you customize the shell colors in both light and dark mode.

It customizes **GNOME Shell only**. App colors are not changed.

## Features

### Light mode and Dark mode tabs

Each tab has five colors:

| Color | What it paints |
| --- | --- |
| General background | Top bar, menus and dialogs, OSD and window switcher, overview |
| Text and icons | Main text color, including the top bar |
| Secondary text | Dates, captions, subtitles |
| Cards, dash and search | Notifications, calendar, quick settings, dock, search results, app folders |
| Borders | Outline of Quick Settings, the calendar and other menus |

Hover, focus and active states follow these colors automatically. Every color has a button to restore its Default profile value.

### Profiles

Each tab has a profile selector to apply a set of colors in one click.

- **Built-in profiles**, which cannot be deleted or overwritten:
  - Light mode: **Default** and **GNOME**.
  - Dark mode: **Default**, **GNOME** and **Oled** (Default with a pure black background).
  - **GNOME** keeps the vanilla GNOME look, the same in light and dark mode.
- **Your own profiles**: the **+** button saves the current colors as a new profile, or into one of your existing profiles. Your profiles can be deleted from the selector.

### General tab

- **General profile**: pairs a light mode profile with a dark mode profile and applies both at once. Built-in **Default** and **GNOME** general profiles are included.
- **Transition**: duration of the fade when switching between light and dark mode, from 0 (instant) to 2000 ms. Default: 500 ms, like GNOME.
- **General background opacity**: transparency of the general background (top bar, menus and dialogs, OSD and switcher), from 0 to 100%, in both modes. The overview stays opaque, and below 100% menu shadows are removed so translucent menus match the top bar.
- **Border opacity**: transparency of the menu borders, from 0 to 100%, or **Follow background opacity** to use the general background opacity.
- **Matching arrow buttons**: the arrow (›) next to Quick Settings toggles such as Wi-Fi or Bluetooth uses the same color as its toggle, on and off, instead of GNOME's separate shade.
- **Automatic switch**: applies a chosen general profile at two times of day (for example, a light setup in the morning and an Oled one at night). A profile picked by hand in between is kept until the next switch time.
- **Panel menu entry**: adds a "Light Mode Manager" entry that opens these preferences to the right-click menu of the panel. Requires [Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel).
- **Quick Settings switcher**: adds a button to Quick Settings that shows the applied general profile and switches it from its menu. Hidden on the lock screen.
- **Backup**: exports all colors, profiles and options to a JSON file. When importing, you can either replace all current settings or only add the profiles from the file, without changing anything you have.

## Installation from source

```sh
git clone https://github.com/vidalwannabe/light-mode-manager.git
ln -s "$PWD/light-mode-manager" ~/.local/share/gnome-shell/extensions/light-mode-manager@vidalwannabe.github.io
glib-compile-schemas light-mode-manager/schemas
```

Log out and back in, then enable the extension in Extension Manager or with:

```sh
gnome-extensions enable light-mode-manager@vidalwannabe.github.io
```

Your colors and profiles are stored in dconf (`/org/gnome/shell/extensions/light-mode-manager/`), not in the extension folder.

## Related

Corner radius settings live in the companion extension [Border Radius Manager](https://github.com/vidalwannabe/border-radius-manager).

## Credits and license

Derived from [Luminus](https://gitlab.com/dikasetyaprayogi/luminus-project) by dikasp. Licensed under the GPL (see COPYING).
