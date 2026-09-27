// Omafox: load omafox.cfg, the chrome script loader, from Firefox's install
// directory. Installed by the omarchy-firefox package to
// /usr/lib/firefox/defaults/pref/.
pref("general.config.filename", "omafox.cfg");
pref("general.config.obscure_value", 0);
// The loader adds scripts to browser windows, which needs their globals.
// It runs only the package's own files (root-owned, beside this one).
pref("general.config.sandbox_enabled", false);
