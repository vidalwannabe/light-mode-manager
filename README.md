# Shell Color Manager

GNOME Shell extension (GNOME 48) that customizes the shell's colors in light and dark mode. Each color paints only its own part of the shell, on top of GNOME's own light or dark style, with color sets, automatic light/dark switching and Dash to Panel support. Formerly Light Mode Manager.

It customizes **GNOME Shell only**. App colors are not changed; legacy GTK 3 apps only follow light and dark mode, when their theme has a dark variant installed (Adwaita / Adwaita-dark).

## Features

### Light mode and Dark mode tabs

Each tab has twelve colors in three groups. An empty color is the system default: GNOME's own color in that mode.

**Shell**

| Color | What it paints |
| --- | --- |
| Shell text and icons | Top bar text and icons (clock, indicators, overview button, Dash to Panel's app grid button), menu items, OSD and window switcher text, app and folder names, the folder edit button, page arrows, overview search results and window captions, and the text typed in the search and password fields (their hint dimmed). The lock and login screens keep their white top bar text |
| Shell background | The top bar, the dash, menus (Quick Settings, calendar, right-click menus), OSD, window switcher, the overview and dialogs (Power Off, passwords…). The lock and login screens keep their transparent top bar |
| Overview and top bar highlights | The square behind each app of the dash and its Show Apps button (with GNOME's own hover, click and checked shades; with Dash to Dock, the app of the focused window is marked with a mix of this color with white in dark mode or black in light mode, so it stands out in both), app folders and the dialog a folder opens (its name field included), the highlight of a hovered or selected app (not in the dash), the search bar and search result sections, the selected app of the Alt+Tab switcher, the password field of the lock and login screens, and hovered or open top bar buttons |

**Quick Settings**

| Color | What it paints |
| --- | --- |
| Active button text and icons | Toggles that are on (text, subtitles and arrows) and the menus they open, today in the calendar, and the media player's title, text and icons. Empty: the accent's text color |
| Active button background | Toggles that are on, their arrows and the menus they open (with their outline and the circle behind the heading icon), the circle behind today in the calendar, and the media player card, whose playback buttons light up from it on hover and click. Default: the accent color set in GNOME Settings › Appearance |
| Idle button text and icons | Toggles that are off (titles, subtitles and arrows), the menus they open (heading, items and icons), the round buttons at the top, the slider buttons and the sliders' handles |
| Idle button background | Toggles that are off and their arrows, the menus they open (with their outline and the circle behind the heading icon), the round buttons at the top, the slider buttons, the sliders' track, the Background Apps toggle and the close buttons of its apps |
| Volume and brightness sliders | The filled part of the volume, brightness and other sliders, and of the volume and brightness popup (OSD). Default: the accent color set in GNOME Settings › Appearance |

**Notification Panel**

| Color | What it paints |
| --- | --- |
| Card titles and icons | Titles and icons of notifications (app name and title) and their buttons, Today, World Clocks, Weather, the calendar, the Clear button and the Do Not Disturb label |
| Card subtitles | Only the line under a title: a notification's text and time, event times, "No Events", the weather location and hours, the weekday, week numbers |
| Card buttons | The notifications' buttons: actions ("Open File"...), close, expand and collapse, in every state. Empty: GNOME's own translucent buttons |
| Card background | Notifications, banners, the Clear button, the Do Not Disturb switch when off, and the cards below the calendar (Today, World Clocks, Weather) |

Color sets saved before a color existed take it from the color it came from (shell and idle button text from the card text, the dash from the card background), so they keep their look.

Hover, focus and active states follow these colors automatically. Every color has a button to restore its value in the color set last applied in that tab. Ctrl+Z undoes the last color change in the open tab and Ctrl+Shift+Z redoes it; the Light mode and Dark mode tabs each keep their own history, and applying a color set is undone in one step. Hovering over a color shows its code, and right-clicking it copies the code.

### Color sets

Each tab has a color set selector to apply a set of colors in one click. Built-in color sets come first, then your own in alphabetical order. It shows the color set the current colors match, in real time (editing a color back to its saved value shows the color set again), or **Unsaved** when they match none.

- **Built-in color sets**, which cannot be deleted or overwritten:
  - Both tabs offer the same four, the tab's own default first: **Light Default** and **Dark Default** (the default colors of each mode), **GNOME** and **Oled** (Dark Default with a pure black shell background, idle buttons and cards). A dark color set can be applied in light mode too (or the other way around), for example to keep two slightly different dark looks one mode switch apart.
  - **GNOME** keeps the vanilla GNOME look, the same in light and dark mode.
- **Your own color sets**: the save button asks a name and saves the current colors as a new color set. In the selector, each of your own color sets has three buttons: **Send to Dark mode** (or Light mode), which copies it with the same colors to the other tab's list (numbered if the name is in use there); **Edit**, a menu to **Rename** it (which also updates the general color sets that use it) or **Update** it with the current colors; and **Delete**.

### General tab

- **General color set**: pairs a light mode color set with a dark mode color set and applies both at once. Built-in **Default** (Light Default + Dark Default) and **GNOME** general color sets are included. The selector shows the general color set that pairs the color sets the Light and Dark tabs show, in real time, even right after saving it. Adding a color set (with the save button or by importing) only saves it; it is applied from the selector. The save button asks a name and the two color sets, preselecting the ones applied in each tab (the tab's default when its colors are unsaved). The **Edit** button of each of your general color sets changes its name and its color sets.

**Visual tweaks**

- **Transition**: duration of the fade when switching between light and dark mode, or when a color set or color change shows on screen (the top bar always; the overview and menus while open), from 0 (instant) to 2000 ms. Default: 500 ms, like GNOME.
- **Disable borders**: removes the outline of menus (Quick Settings, the calendar, right-click menus) and of the cards (notifications, Today, World Clocks, Weather, the calendar as card), with the cards' faint shadow. Nothing changes size. Expanded Quick Settings menus never have a border. Both modes.
- **Disable Quick Settings dimming**: Quick Settings is no longer darkened while one of its menus (Wi-Fi, Power Off…) is open. This also covers Quick Settings panels made by other extensions, such as the separate or independent panels of Quick Settings Audio Panel.
- **Merge arrows into toggles**: the arrow (›) next to Quick Settings toggles such as Wi-Fi or Bluetooth takes the same color as its toggle, on and off, instead of GNOME's separate shade, and the 1px gap line between them is removed, so both read as one button. Works with any color set.
- **Calendar as card** (on by default): the month calendar gets the color of the cards below it (Today, World Clocks, Weather), without a pill behind each day, and their outline (a faint border and shadow in light mode). With the GNOME color set it follows GNOME's own card color.
- **Menu overlap fix** (always on, no option): GNOME sizes the menus Quick Settings toggles open without their width, so a menu with wrapped text (Bluetooth when off) covers the buttons below it ([GNOME issue 7622](https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/7622)). This measures them at their real width, in any language.
- **Use this extension's colors in Dash to Panel**: Dash to Panel's panels and window previews take this extension's top bar color (or GNOME's own with the GNOME color set), and preview titles turn black in light mode and white in dark mode. Dash to Panel's settings are never changed and everything else it does is kept: its opacity (dynamic or custom), gradients, borders and preview opacity. Inactive when Dash to Panel is not installed; the first time it is found, the preferences explain the color conflict and offer to turn this on.

**Easy access**

- **Desktop menu entry**: adds "Shell Color Manager…", which opens these preferences, to the desktop right-click menu, below "Change Background…".
- **Quick Settings color sets**: adds a Color Set button to Quick Settings. Its menu lists the color sets of the current mode (light or dark) and has a Settings entry that opens these preferences; its subtitle shows the applied color set of the current mode. Hidden on the lock screen.

**Automatic switch**

- **Automatic switch**: one row sets a mode (light or dark) and two times of day: the mode is on between them and the opposite one the rest of the day, also across midnight (Dark mode from 19:00 to 07:00, light mode the rest of the day). Equal times turn the switch off, even with **Enable** on; both times are marked and the subtitle says so. Each mode keeps its own color set and colors. Turning it on or changing the schedule applies the current mode right away. Changing the mode by hand while it is on turns the automatic switch off, so your choice stays; the next time the preferences open, a dialog says so and offers to turn it on again.

**Backup**

- **Backup**: exports all colors, color sets and options to a JSON file. When importing, you can either replace all current settings or only add the color sets from the file, without changing anything you have. The whole file is validated first: if any part is invalid, nothing is changed.

## Installation from source

```sh
git clone https://github.com/vidalwannabe/shell-color-manager.git
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/shell-color-manager" ~/.local/share/gnome-shell/extensions/shell-color-manager@vidalwannabe.github.io
glib-compile-schemas shell-color-manager/schemas
```

Log out and back in, then enable the extension in Extension Manager or with:

```sh
gnome-extensions enable shell-color-manager@vidalwannabe.github.io
```

Your colors and color sets are stored in dconf (`/org/gnome/shell/extensions/shell-color-manager/`), not in the extension folder.

## Credits and license

Originally derived from [Luminus](https://gitlab.com/dikasetyaprayogi/luminus-project) by dikasp; light mode now uses GNOME's own light shell style. Licensed under the GPL (see COPYING).
