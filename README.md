<img src="icon.svg" alt="Omarchy Chrome" width="128" align="left"/>

# Omarchy Chrome

<br>

**A Firefox chrome theme for Omarchy**

Built on a Firefox-GNOME/Adwaita compatibility foundation (see
`theme/base-theme.css`), with a maintained Omarchy layer on top for Pywalfox
colors, Hyprland-owned window geometry, and Omarchy-specific chrome features.

> [!WARNING]
>
> ### Disclaimer
>
> Be aware that this theme might do things that are not supported by upstream Firefox. If you face an issue while using this theme, report it here first or test if it is reproducible in vanilla Firefox.
>
> If you are a software distribution maintainer, please do not ship these changes by default to your users unless you make it extremely clear that they are using a modified version of the Firefox UI.

![Screenshot of the theme](screenshot.png)

## Architecture

Firefox-GNOME/Adwaita is the audited compatibility foundation
(`theme/base-theme.css`); the maintained Omarchy layer on top
(`omarchy-chrome.css`, `omarchy-content.css`, `omarchy-features.css`) bridges
Pywalfox colors, compact Hyprland-owned window chrome, horizontal and vertical
tabs, tab groups, privileged Firefox pages, and optional state cues. The
overlay was validated against Firefox `153.0.3`; Firefox-internal selectors
can change between releases. See `docs/omarchy-firefox-design-map.md` for the
full layer breakdown and audit history.

A checkout already located directly at `<profile>/chrome` is the development
layout and does not need to be copied. Pywalfox supplies the live palette. The
optional [`scripts/generate-omarchy-radius.sh`](scripts/generate-omarchy-radius.sh)
bridges Omarchy/Noctalia geometry. It writes beside the active direct or
`omarchy-chrome/` nested entrypoint; `FIREFOX_PROFILE_DIR` selects a profile
and `FIREFOX_THEME_DIR` is an explicit destination override.
[`docs/favicon-contrast.md`](docs/favicon-contrast.md) documents the
separately installed JavaScript favicon helper.

### Firefox versions support

This repo tracks Firefox on its `main` branch only, most recently validated
against Firefox `153.0.3` (see `docs/omarchy-firefox-design-map.md` for the
full audit history). Firefox-internal selectors can change between releases,
so older Firefox versions aren't separately maintained.

# Installation

## Package managers

### Arch Linux

Not published to the AUR yet for this fork — the end goal is an AUR package
(a static payload staged under `/usr/share/<pkgname>/`, with profile wiring
left to the one-time manual steps below, since a packaging hook cannot safely
write into a user's home directory). Until that exists, use
[Manual installation](#manual-installation).

## Manual installation

<details>
    <summary>Expand</summary>

1. Go to `about:support` in Firefox.

2. Application Basics > Profile Directory > Open Directory.

3. Open directory in a terminal.

4. Create a `chrome` directory if it doesn't exist:

    ```sh
    mkdir -p chrome
    cd chrome
    ```

5. Get the theme files into an `omarchy-chrome` subdirectory here — clone
   this repo, or copy/symlink a packaged install once one exists:

    ```sh
    git clone --branch main <this-repo-url> omarchy-chrome
    ```

6. Create single-line user CSS files if non-existent or empty (at least one line is needed for `sed`):

    ```sh
    [[ -s userChrome.css ]] || echo >> userChrome.css
    [[ -s userContent.css ]] || echo >> userContent.css
    ```

7. Import this theme at the beginning of the CSS files (all `@import`s must come before any existing `@namespace` declarations):

    ```sh
    sed -i '1s/^/@import "omarchy-chrome\/userChrome.css";\n/' userChrome.css
    sed -i '1s/^/@import "omarchy-chrome\/userContent.css";\n/' userContent.css
    ```

8. Set the required preferences listed under
   [Required Firefox preferences](#required-firefox-preferences) below via
   `about:config`. (`configuration/user.js` also lists every optional
   preference this theme reads, if you'd rather set them by copying
   `user_pref(...)` lines into your own `user.js` than through the UI —
   don't symlink or overwrite your whole `user.js`, since that discards any
   preferences you already had.)

9. Restart Firefox.

10. Open Firefox customization panel and move the new tab button to headerbar.

11. Be happy with your new Firefox.

</details>

## Required Firefox preferences

We provide a **user.js** configuration file in `configuration/user.js` that enables some preferences required by this theme to work.

You should already have this file installed if you followed one of the installation methods, but in any case be sure this preferences are enabled under `about:config`:

- `toolkit.legacyUserProfileCustomizations.stylesheets`

 This preference is required to load the custom CSS in Firefox, otherwise the theme wouldn't work.

- `svg.context-properties.content.enabled`

 This preference is required to recolor the icons, otherwise you will get black icons everywhere.

> For other non essential preferences checkout `configuration/user.js`.

## Updating

Update the `omarchy-chrome` subdirectory in place (`git pull` for a
checkout, or replace it with a newer packaged install) and restart Firefox.
No other step needs to be repeated.

## Uninstalling

1. Open the profile directory from `about:support` → **Application Basics** →
   **Profile Directory**.
2. Remove only `chrome/omarchy-chrome`. Do **not** remove the whole
   `chrome` directory; it can contain unrelated user styles and scripts.
3. Remove the exact `@import "omarchy-chrome/userChrome.css";` and
   `@import "omarchy-chrome/userContent.css";` lines from the profile's
   `chrome/userChrome.css` and `chrome/userContent.css` files.
4. Remove only this theme's preference keys from the profile `user.js`; the
   owned key list is in `configuration/user.js`. Preserve every unrelated
   preference and any `user.js` backup.

A development checkout located directly at `<profile>/chrome` should be moved
or removed as a repository checkout, not by deleting unrelated profile files.
The optional favicon helper has its own safe disable/purge commands in
[`docs/favicon-contrast.md`](docs/favicon-contrast.md#uninstalling).

## Enabling optional features

Optional features can be enabled by creating new `boolean` preferences in `about:config`.

1. Go to the `about:config` page
2. Type the key of the feature you want to enable
3. Set it as a `boolean` and click on the add button
4. Restart Firefox

### Features

- **Hide single tab** `omarchyTheme.hideSingleTab`

 Hide the tab bar when only one tab is open.

 > **Note:** You should move the new tab button out of the tabbar or it will be hidden when there is only one tab. You can rearrange the toolbars doing a right-click on any toolbar and selecting "Customize Toolbar…".

- **Normal width tabs** `omarchyTheme.normalWidthTabs`

 Use normal width tabs as default Firefox.

- **Swap tab close button position** `omarchyTheme.swapTabClose`

 By default the tab close buttons follows the position of the window controls, this preference reverts that behavior.

- **Bookmarks toolbar under tabs** `omarchyTheme.bookmarksToolbarUnderTabs`

 Move Bookmarks toolbar under tabs.

- **Active tab contrast** `omarchyTheme.activeTabContrast`

 Add more contrast to the active tab.

- **Close only selected tabs** `omarchyTheme.closeOnlySelectedTabs`

 Show the close button on the selected tab only.

- **System icons** `omarchyTheme.systemIcons`

 Use system theme icons instead of Adwaita icons included by theme.

 > **Note:** This feature has a [known color bug](#icons-color-broken-with-system-icons).

- **No themed Icons** `omarchyTheme.noThemedIcons`

 Use default Firefox icons instead of the included icons.

- **Symbolic tab icons** `omarchyTheme.symbolicTabIcons`

 Make all tab icons look kinda like symbolic icons.

- **Hide WebRTC indicator** `omarchyTheme.hideWebrtcIndicator`

 Hide redundant WebRTC indicator since GNOME provides their own privacy icons in the top right.

- **Hide unified extensions button** `omarchyTheme.hideUnifiedExtensions`

 Hide unified extensions button from the navbar, you can also use `extensions.unifiedExtensions.enabled` instead, which is only going to work till Firefox 111.

- **Drag window from headerbar buttons** `omarchyTheme.dragWindowHeaderbarButtons`

 Allow dragging the window from headerbar buttons.

 > **Note:** This feature is BUGGED. It can activate the button with unpleasant behavior.

- **Tabs as headerbar** `omarchyTheme.tabsAsHeaderbar`

 Place the tabs on the top of the window, and use the tabs bar to hold the window controls, like Firefox's standard tab bar.

 > **Note:** Enabling with `omarchyTheme.hideSingleTab` will replace the single tab with a title bar.

- **OLED black theme** `omarchyTheme.oledBlack`

 Change the dark theme into the black variant.

- **Show "List All Tabs" button on overflow** `omarchyTheme.allTabsButtonOnOverflow`

 Show the `List All Tabs` button when the tabs bar is overflowing (when you have too many tabs that the width of the tabs no longer shrinks when new tabs are added).

- **Show "List All Tabs" button** `omarchyTheme.allTabsButton`

 Show the `List All Tabs` button all the time, like stock Firefox.

- **Align tab title and icon to left** `omarchyTheme.tabAlignLeft`

 Align the tab title and favicon to left of tab in place of center.

- **Bookmarks bar in fullscreen** `omarchyTheme.bookmarksOnFullscreen`

  Show the bookmarks bar while in fullscreen.

### Extensions support

We also have optional features to enable support for some Firefox extensions.

> [!WARNING]
> Note that extension support is maintained by the community, so requests to support new extensions are not allowed, and the included extensions may be broken until someone shows up to fix them.

- **Adaptive Tab Bar Colour support** `omarchyTheme.extensions.adaptiveTabBarColour`

 > **Note:** Adaptive Tab Bar Colour presently hard-codes the colours for the home page (both normal as well as private windows). When navigating from the home page to any other page, the colour of the UI might momentarily switch to the original firefox home page colour before switching back to the expected colour (this is especially noticeable in private windows). This only happens when navigating from the homepage to another page, subsequent navigations should be unaffected.

## Known bugs

### CSD have sharp corners

See upstream [bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1408360).

#### Wayland fix

1. Go to the `about:config` page
2. Search for the `layers.acceleration.force-enabled` preference and set it to true.
3. Now restart Firefox, and it should look good!

#### X11 fix

1. Go to the `about:config` page
2. Type `mozilla.widget.use-argb-visuals`
3. Set it as a `boolean` and click on the add button
4. Now restart Firefox, and it should look good!

### Icons color broken with System icons

Icons might appear black where they should be white on some systems. I have no idea why, but you can adjust them directly in the `system-icons.css` file, look for `--omarchy-base-icons-hack-filter` & `--omarchy-base-window-icons-hack-filter` vars and play with css filters.

## Development

If you wanna mess around the styles and change something, you might find these
things useful.

To use the Inspector to debug the UI, open the developer tools (F12) on any
page, go to options, check both of those:

- Enable browser chrome and add-on debugging toolboxes
- Enable remote debugging

Now you can close those tools and press Ctrl+Alt+Shift+I to Inspect the browser
UI.

Also you can inspect any GTK3 application, for example type this into a terminal
and it will run Epiphany with the GTK Inspector, so you can check the CSS styles
of its elements too.

```sh
GTK_DEBUG=interactive epiphany
```

Feel free to use any parts of my code to develop your own themes, I don't force
any specific license on your code.

## Credits

This fork is based on **[Rafael Mardojai CM](https://github.com/rafaelmardojai)**'s
[firefox-gnome-theme](https://github.com/rafaelmardojai/firefox-gnome-theme)
and [contributors](https://github.com/rafaelmardojai/firefox-gnome-theme/graphs/contributors),
itself based on **[Luna Kurame](https://github.com/lunakurame/firefox-gnome-theme)**'s
original work.

## Donate

This fork doesn't have its own donation link. Consider supporting the
upstream project it's based on via [PayPal](https://paypal.me/RafaelMardojaiCM)
or [Liberapay](https://liberapay.com/rafaelmardojai/donate), or
[Firefox](https://donate.mozilla.org/) directly.
