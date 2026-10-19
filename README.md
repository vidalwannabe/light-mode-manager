# Light Mode Manager

GNOME Shell extension (GNOME 48) that brings light mode to the parts of the shell GNOME keeps dark (top bar, menus, quick settings, notifications, overview, dash…), and lets you customize the shell colors in both light and dark mode.

It customizes **GNOME Shell only**. App colors are not changed; legacy GTK 3 apps only follow light and dark mode, when their theme has a dark variant installed (Adwaita / Adwaita-dark).

## Features

### Light mode and Dark mode tabs

Each tab has fifteen colors in three groups:

**Top bar and overview**

| Color | What it paints |
| --- | --- |
| Top bar background | The panel; solid unless **Enable panel opacity** is on |
| Top bar text and icons | Top bar text and icons: clock, indicators, the overview button and Dash to Panel's app grid button |
| Overview and dialogs background | The overview and dialogs (Power Off, passwords, "not responding"…), always solid |
| App grid text | App and folder names, folder titles and page arrows in the app grid. Default: black in light mode, white in dark mode |
| Overview and top bar highlights | The overview dock (dash) and search bar, the password field of the lock and login screens (its text in the titles color) and top bar buttons that are hovered or have their menu open (not on the lock screen). Default: the cards background |

**Menus**

| Color | What it paints |
| --- | --- |
| Menus background | Quick Settings, the calendar, right-click menus, OSD and window switcher |
| Menu borders | Outline of Quick Settings, the calendar and other menus |

**Quick Settings and notification panel**

| Color | What it paints |
| --- | --- |
| Idle buttons and cards titles and icons | Titles and icons: notifications (app name and title), Today, World Clocks, Weather, the calendar, menus, dialogs, Quick Settings (not the app grid, see App grid text) |
| Idle buttons and cards subtitles | Only the line under a title: a notification's text and time, event times, "No Events", the weather location and hours, the weekday, toggle subtitles |
| Idle buttons background | Quick Settings toggles that are off, their arrows, the round buttons at the top, the slider buttons (volume, "›", brightness) and the menus toggles open |
| Cards background | Notifications, banners and calendar widgets: Today, World Clocks and Weather. Search results and app folders keep the system background |
| Active buttons text and icons | Quick Settings toggles that are on (Wi-Fi, Dark Style…), their arrows and subtitles. Empty: the accent's text color, subtitles included |
| Active buttons background | Quick Settings toggles that are on, their arrows and the icon of the menu they open. Empty (default): the accent color set in GNOME Settings › Appearance |
| Sliders | The filled part of the volume, brightness and other sliders. Empty (default): the accent color set in GNOME Settings › Appearance |
| Today in the calendar | The circle behind the current day. Empty (default): the accent color |

Profiles saved before a color existed take it from the color it came from (top bar and overview from the menus background, today from the sliders), so they keep their look.

Hover, focus and active states follow these colors automatically. Every color has a button to restore its value in the applied profile (or the last one applied, after editing).

### Profiles

Each tab has a profile selector to apply a set of colors in one click. Built-in profiles come first, then your own in alphabetical order. It shows **Unsaved** when the current colors match no profile.

- **Built-in profiles**, which cannot be deleted or overwritten:
  - Light mode: **Default** and **GNOME**.
  - Dark mode: **Default**, **GNOME** and **Oled** (Default with pure black top bar, overview, menus, menu borders, idle buttons and cards).
  - **GNOME** keeps the vanilla GNOME look, the same in light and dark mode.
- **Your own profiles**: the save button saves the current colors as a new profile, or replaces the colors of one of yours with **Update existing profile**. Your profiles can be deleted from the selector.

### Appearance tab

- **General profile**: pairs a light mode profile with a dark mode profile and applies both at once. Built-in **Default** and **GNOME** general profiles are included. Adding a profile (with the save button or by importing) only saves it; it is applied from the selector. The save button preselects the profiles applied in each tab, and offers to save a tab with unsaved colors as a new profile first (skipping lets you choose another profile, Default preselected).

**Visual tweaks**

- **Transition**: duration of the fade when switching between light and dark mode, from 0 (instant) to 2000 ms. Default: 500 ms, like GNOME.
- **Shell opacity**: transparency of the menus background (Quick Settings, calendar, menus, OSD and switcher), from 0 to 100%, in both modes. The top bar only gets it with **Enable panel opacity**. The overview and dialogs (Power Off, passwords, "not responding"…) stay opaque so they are easy to read, and below 100% menu shadows are removed so they do not darken translucent menus. Also works with the GNOME profile, on GNOME's own colors.
- **Card opacity**: transparency of the notification cards (calendar, Today, World Clocks, Weather, notifications) and of the idle Quick Settings buttons with their menus and the slider buttons, from 0 to 100%, in both modes. Also works with the GNOME profile.
- **Enable panel opacity**: the panel stays solid by default; when on, it also gets the shell opacity.
- **Keep menu shadows**: below 100% shell opacity, menu shadows are removed because they show through translucent menus and darken them; this keeps them.
- **Disable Quick Settings dimming**: Quick Settings is no longer darkened while one of its menus (Wi-Fi, Power Off…) is open.
- **Match arrows to toggles**: the arrow (›) next to Quick Settings toggles such as Wi-Fi or Bluetooth uses the same color as its toggle, on and off, instead of GNOME's separate shade.
- **Merge arrows into toggles**: removes the 1px gap line between a Quick Settings toggle and its arrow (›), so both read as one button. Works with any profile.
- **Calendar as card**: the month calendar gets the color of the cards below it (Today, World Clocks, Weather), without a pill behind each day. With the GNOME profile it follows GNOME's own card color.
- **Fix menu overlap** (on by default): GNOME sizes the menus Quick Settings toggles open without their width, so a menu with wrapped text (Bluetooth when off) covers the buttons below it ([GNOME issue 7622](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/7622)). This measures them at their real width, in any language.
- **Use this extension's colors in Dash to Panel**: Dash to Panel's panels and window previews take this extension's top bar color and opacity (or GNOME's own with the GNOME profile), and preview titles turn black in light mode and white in dark mode. Dash to Panel's settings are never changed and everything else it does is kept: dynamic opacity when a window touches the panel, gradients, borders and preview opacity. Inactive when Dash to Panel is not installed; the first time it is found, the preferences explain the color conflict and offer to turn this on.

### General tab

**Easy access**

- **Desktop menu entry**: adds "Light Mode Manager…", which opens these preferences, to the desktop right-click menu, below "Change Background…".
- **Quick Settings switcher**: adds a Color Profile button to Quick Settings. Its menu lists the profiles of the current mode (light or dark) and, below a separator, the general profiles, and has a Settings entry that opens these preferences. Its subtitle shows the applied general profile, or the applied profile of the current mode. Hidden on the lock screen.

**Automatic switch**

- **Automatic switch**: one row sets a mode (light or dark) and two times of day: the mode is on between them and the opposite one the rest of the day, also across midnight (Dark mode from 19:00 to 07:00, light mode the rest of the day). Equal times turn the switch off, even with **Enable** on; both times are marked and the subtitle says so. Each mode keeps its own profile and colors. Turning it on or changing the schedule applies the current mode right away; a mode picked by hand in between is kept, even after logging in again, until the next switch time.

**Lock screen**

- **Use GNOME colors on the lock screen**: if turned on, the lock screen shows GNOME's own colors: the extension's stylesheet is unloaded on lock and loaded again on unlock, which can cause a short delay or flicker when unlocking on slower computers. When turned off (the default), the lock screen keeps your colors and unlocking is instant, with nothing to reload; on the lock screen the extension only touches colors, through its CSS stylesheet.

**Backup**

- **Backup**: exports all colors, profiles and options to a JSON file. When importing, you can either replace all current settings or only add the profiles from the file, without changing anything you have. The whole file is validated first: if any part is invalid, nothing is changed.

## Installation from source

```sh
git clone https://github.com/vidalwannabe/light-mode-manager.git
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/light-mode-manager" ~/.local/share/gnome-shell/extensions/light-mode-manager@vidalwannabe.github.io
glib-compile-schemas light-mode-manager/schemas
```

Log out and back in, then enable the extension in Extension Manager or with:

```sh
gnome-extensions enable light-mode-manager@vidalwannabe.github.io
```

Your colors and profiles are stored in dconf (`/org/gnome/shell/extensions/light-mode-manager/`), not in the extension folder.

## Credits and license

Derived from [Luminus](https://gitlab.com/dikasetyaprayogi/luminus-project) by dikasp. Licensed under the GPL (see COPYING).
