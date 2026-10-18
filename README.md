# Light Mode Manager

GNOME Shell extension (GNOME 48) that brings light mode to the parts of the shell GNOME keeps dark (top bar, menus, quick settings, notifications, overview, dash…), and lets you customize the shell colors in both light and dark mode.

It customizes **GNOME Shell only**. App colors are not changed; legacy GTK 3 apps only follow light and dark mode, when their theme has a dark variant installed (Adwaita / Adwaita-dark).

## Features

### Light mode and Dark mode tabs

Each tab has eight colors:

| Color | What it paints |
| --- | --- |
| General background | Top bar, menus and dialogs, OSD and window switcher, overview |
| Top bar content | Top bar text and icons: clock, indicators, the overview button and Dash to Panel's app grid button |
| Main text and icons | Titles and icons: notifications (app name and title), Today, World Clocks, Weather, the calendar, menus, dialogs, Quick Settings |
| Secondary text | Only the line under a title: a notification's text and time, event times, "No Events", the weather location and hours, the weekday, toggle subtitles |
| Cards, dash and search background | Notifications, calendar, dock, search results, and app folders (folder icons in the app grid and the dialog they open) |
| Active buttons text and icons | Quick Settings toggles that are on (Wi-Fi, Dark Style…), their arrows and subtitles. Empty: the accent's text color |
| Idle Quick Settings buttons | Quick Settings toggles that are off, their arrows, the round buttons at the top, the slider buttons (volume, "›", brightness) and the menus toggles open |
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
- **Shell opacity**: transparency of the general background (top bar, menus, OSD and switcher), from 0 to 100%, in both modes. The overview and dialogs (Power Off, passwords, "not responding"…) stay opaque so they are easy to read, and below 100% menu shadows are removed so they do not darken translucent menus. Also works with the GNOME profile, on GNOME's own colors.
- **Card opacity**: transparency of the notification cards (calendar, Today, World Clocks, Weather, notifications) and of the idle Quick Settings buttons with their menus and the slider buttons, from 0 to 100%, in both modes. Also works with the GNOME profile.
- **Enable panel opacity**: the panel stays solid by default; when on, it also gets the shell opacity.
- **Disable menu borders**: removes the outline of Quick Settings, the calendar and other menus, in both modes.
- **Disable Quick Settings dimming**: Quick Settings is no longer darkened while one of its menus (Wi-Fi, Power Off…) is open.
- **Uniform Quick Settings button colors**: the arrow (›) next to Quick Settings toggles such as Wi-Fi or Bluetooth uses the same color as its toggle, on and off, instead of GNOME's separate shade.
- **Calendar as card**: the month calendar gets the color of the cards below it (Today, World Clocks, Weather), without a pill behind each day. With the GNOME profile it follows GNOME's own card color.
- **Fix menu overlap** (on by default): GNOME sizes the menus Quick Settings toggles open without their width, so a menu with wrapped text (Bluetooth when off) covers the buttons below it ([GNOME issue 7622](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/7622)). This measures them at their real width, in any language.
- **Disable grid custom colors**: Cards, dash and search background only paints cards (notifications and calendar widgets); the dash, search results, app folder icons and the dialog a folder opens keep the system background.
- **Override Dash to Panel colors**: Dash to Panel's panels and window previews (shown when hovering an open app) always use this extension's panel color and opacity (or GNOME's own with the GNOME profile) instead of Dash to Panel's color and transparency settings, which are left unchanged. Window previews keep Dash to Panel's own opacity if it has a custom preview opacity set.
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
