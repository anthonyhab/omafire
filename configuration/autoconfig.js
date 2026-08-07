// Firefox autoconfig bootstrap for favicon-contrast.uc.js.
pref("general.config.filename", "mozilla.cfg");
pref("general.config.obscure_value", 0);
// The loader needs browser-window globals; it executes only the helper copied
// into the application-owned Omarchy directory by the installer.
pref("general.config.sandbox_enabled", false);
