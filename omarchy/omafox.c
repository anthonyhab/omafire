/* omafox — Omarchy → Firefox/Zen theme sync command.
 *
 * C port of the original bash CLI. Speaks the omafox v1 protocol so both the
 * upstream-signed @omafox WebExtension and this fork's Omarchy FF Sync
 * extension work unmodified: `sync` normalizes the current Quattro palette
 * into ~/.local/state/omafox/theme.json and the native host pushes it to
 * connected browsers over inotify.
 *
 * Firefox support adds the same managed-block pattern used for Zen:
 *   chrome/userChrome.css  -> BEGIN/END OMAFOX FIREFOX BRIDGE import block
 *   user.js                -> managed prefs (stylesheet loading, dark canvas)
 *   chrome/omarchy-firefox/ -> packaged theme payload
 *   chrome/omafox-palette.css -> regenerated on every sync so the first
 *                                painted frame already uses the palette.
 */

#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define PROGRAM_NAME "omafox"
#define VERSION "1.2.0"
#define PROTOCOL "omafox"
#define PROTOCOL_VERSION 1
#define ACTION "theme-set"
#define MAX_THEME_NAME_LENGTH 100
#define MAX_FILE_BYTES (4U * 1024U * 1024U)
#define COLOR_LEN 8   /* normalized "#RRGGBB\0" */
#define RAW_LEN 64    /* raw colors.toml values (0x112233, junk, ...) */

#define ZEN_BRIDGE_MARKER "/* OMAFOX ZEN BRIDGE MANAGED FILE */"
#define ZEN_CSS_BEGIN "/* BEGIN OMAFOX ZEN BRIDGE */"
#define ZEN_CSS_END "/* END OMAFOX ZEN BRIDGE */"
#define ZEN_PREFS_BEGIN "// BEGIN OMAFOX ZEN BRIDGE"
#define ZEN_PREFS_END "// END OMAFOX ZEN BRIDGE"

#define FF_BRIDGE_MARKER "/* OMAFOX FIREFOX BRIDGE MANAGED FILE */"
#define FF_CSS_BEGIN "/* BEGIN OMAFOX FIREFOX BRIDGE */"
#define FF_CSS_END "/* END OMAFOX FIREFOX BRIDGE */"
#define FF_PREFS_BEGIN "// BEGIN OMAFOX FIREFOX BRIDGE"
#define FF_PREFS_END "// END OMAFOX FIREFOX BRIDGE"
#define FF_PALETTE_NAME "omafox-palette.css"
#define FF_CONTENT_PALETTE_NAME "omafox-content-palette.css"
#define FF_RADIUS_NAME "omarchy-radius.css"
#define FF_RADIUS_MARKER \
  "/* OMAFOX GENERATED GEOMETRY — written by omafox sync; do not edit. */"
#define FF_PAYLOAD_DIRNAME "omarchy-firefox"
#define FF_PAYLOAD_ENTRY "userChrome.css"

/* Palette key order is part of the JSON wire format. */
static const char *const PALETTE_KEYS[] = {
    "mode",
    "accent", "selection", "muted",
    "background", "dark_background", "darker_background",
    "lighter_background",
    "foreground", "dark_foreground", "light_foreground",
    "bright_foreground",
    "red", "yellow", "orange", "green", "cyan", "blue", "magenta",
    "brown",
    "bright_red", "bright_yellow", "bright_green", "bright_cyan",
    "bright_blue", "bright_magenta",
};
#define N_PALETTE_KEYS (sizeof(PALETTE_KEYS) / sizeof(PALETTE_KEYS[0]))
#define N_COLOR_KEYS (N_PALETTE_KEYS - 1) /* everything after "mode" */

static const char *const DARK_DEFAULTS[] = {
    "#1E1E2E", "#CDD6F4", "#89B4FA",
    "#F38BA8", "#F9E2AF", "#A6E3A1", "#94E2D5", "#89B4FA", "#CBA6F7",
};
static const char *const LIGHT_DEFAULTS[] = {
    "#FFFFFF", "#181818", "#1565C0",
    "#C62828", "#8A6D00", "#2E7D32", "#007C91", "#1565C0", "#8E24AA",
};
enum { D_BG, D_FG, D_ACCENT, D_RED, D_YELLOW, D_GREEN, D_CYAN, D_BLUE,
       D_MAGENTA, N_DEFAULTS };

typedef struct {
  char mode[6];          /* "dark" or "light" */
  char color[N_COLOR_KEYS][RAW_LEN];
  bool valid[N_COLOR_KEYS];
} palette_t;

/* ---------------------------------------------------------------- utils */

static void fail(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  fprintf(stderr, "%s: ", PROGRAM_NAME);
  vfprintf(stderr, fmt, args);
  fputc('\n', stderr);
  va_end(args);
  exit(1);
}

static void *xmalloc(size_t size) {
  void *ptr = malloc(size ? size : 1);
  if (!ptr)
    fail("out of memory");
  return ptr;
}

static char *xstrdup(const char *s) {
  char *copy = xmalloc(strlen(s) + 1);
  strcpy(copy, s);
  return copy;
}

static char *xasprintf(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  int length = vsnprintf(NULL, 0, fmt, args);
  va_end(args);
  if (length < 0)
    fail("formatting error");
  char *out = xmalloc((size_t)length + 1);
  va_start(args, fmt);
  vsnprintf(out, (size_t)length + 1, fmt, args);
  va_end(args);
  return out;
}

static char *trim(char *s) {
  while (isspace((unsigned char)*s))
    s++;
  char *end = s + strlen(s);
  while (end > s && isspace((unsigned char)end[-1]))
    *--end = '\0';
  return s;
}

static const char *env_or(const char *name, const char *fallback) {
  const char *value = getenv(name);
  return (value && value[0]) ? value : fallback;
}

static char *path_join(const char *a, const char *b) {
  return xasprintf("%s/%s", a, b);
}

static const char *home_dir(void) {
  const char *home = getenv("HOME");
  if (!home || !home[0])
    fail("HOME is not set");
  return home;
}

/* Resolved paths, initialized once in main. */
static char *g_theme_dir;
static char *g_theme_name_file;
static char *g_hook_path;
static char *g_state_dir;
static char *g_state_file;
static char *g_native_host_path;
static char *g_native_manifest_path;
static char *g_hook_source;
static char *g_zen_root;
static char *g_zen_profiles_file;
static char *g_zen_bridge_source;
static char *g_ff_root;
static char *g_ff_profiles_file;
static char *g_ff_payload_source;

static void init_paths(void) {
  const char *home = home_dir();
  g_theme_dir = xstrdup(env_or(
      "OMAFOX_THEME_DIR",
      xasprintf("%s/.local/state/omarchy/current/theme", home)));
  g_theme_name_file = xstrdup(env_or(
      "OMAFOX_THEME_NAME_FILE",
      xasprintf("%s/.local/state/omarchy/current/theme.name", home)));
  g_hook_path =
      xasprintf("%s/.config/omarchy/hooks/theme-set.d/omafox", home);
  g_state_dir = xasprintf("%s/.local/state/omafox", home);
  g_state_file = xasprintf("%s/theme.json", g_state_dir);
  g_native_host_path = xstrdup(env_or(
      "OMAFOX_NATIVE_HOST_PATH", "/usr/lib/omafox/omafox-native-host"));
  g_native_manifest_path = xstrdup(env_or(
      "OMAFOX_NATIVE_MANIFEST_PATH",
      "/usr/lib/mozilla/native-messaging-hosts/org.omarchy.omafox.json"));
  g_hook_source = xstrdup(
      env_or("OMAFOX_HOOK_SOURCE", "/usr/share/omafox/hooks/omafox"));
  g_zen_root = xstrdup(
      env_or("OMAFOX_ZEN_ROOT", xasprintf("%s/.config/zen", home)));
  g_zen_profiles_file = xstrdup(env_or(
      "OMAFOX_ZEN_PROFILES_FILE",
      xasprintf("%s/profiles.ini", g_zen_root)));
  g_zen_bridge_source = xstrdup(env_or(
      "OMAFOX_ZEN_BRIDGE_SOURCE", "/usr/share/omafox/zen/omafox.css"));
  g_ff_root = xstrdup(env_or(
      "OMAFOX_FIREFOX_ROOT", xasprintf("%s/.mozilla/firefox", home)));
  g_ff_profiles_file = xstrdup(env_or(
      "OMAFOX_FIREFOX_PROFILES_FILE",
      xasprintf("%s/profiles.ini", g_ff_root)));
  g_ff_payload_source = xstrdup(env_or(
      "OMAFOX_FIREFOX_PAYLOAD_SOURCE",
      "/usr/share/omafox/firefox/chrome"));
}

/* ------------------------------------------------------------ file I/O */

static bool is_regular_file(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISREG(st.st_mode);
}

static bool path_exists(const char *path) {
  struct stat st;
  return lstat(path, &st) == 0;
}

static bool path_is_symlink(const char *path) {
  struct stat st;
  return lstat(path, &st) == 0 && S_ISLNK(st.st_mode);
}

/* Read a small regular file into a NUL-terminated buffer. */
static char *read_file(const char *path, size_t *out_len) {
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    return NULL;
  struct stat st;
  if (fstat(fd, &st) < 0 || !S_ISREG(st.st_mode) || st.st_size < 0
      || (uintmax_t)st.st_size > MAX_FILE_BYTES) {
    close(fd);
    return NULL;
  }
  char *buffer = xmalloc((size_t)st.st_size + 1);
  size_t total = 0;
  while (total < (size_t)st.st_size) {
    ssize_t n = read(fd, buffer + total, (size_t)st.st_size - total);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0) {
      close(fd);
      free(buffer);
      return NULL;
    }
    total += (size_t)n;
  }
  close(fd);
  buffer[total] = '\0';
  if (out_len)
    *out_len = total;
  return buffer;
}

/* Write buffer to path via a same-directory temp file + rename.
 * preserve_mode keeps an existing file's permissions (managed user files);
 * otherwise the given mode is applied exactly (owned payload/state files). */
static void atomic_write(const char *path, const char *data, size_t len,
                         mode_t mode, bool preserve_mode) {
  /* Skip the write entirely when the target already holds this content —
   * theme hooks fire often enough that identical rewrites would just add
   * inotify noise and profile-sync churn. */
  size_t existing_len = 0;
  char *existing = read_file(path, &existing_len);
  if (existing && existing_len == len && memcmp(existing, data, len) == 0) {
    free(existing);
    return;
  }
  free(existing);

  char *tmp = xmalloc(strlen(path) + 32);
  strcpy(tmp, path);
  char *slash = strrchr(tmp, '/');
  if (slash)
    slash[1] = '\0';
  else
    strcpy(tmp, "./");
  strcat(tmp, ".omafox.XXXXXX");

  int fd = mkstemp(tmp);
  if (fd < 0) {
    free(tmp);
    fail("could not create temp file for %s", path);
  }

  struct stat st;
  if (preserve_mode && stat(path, &st) == 0)
    mode = st.st_mode & 0777;
  if (fchmod(fd, mode) < 0) {
    close(fd);
    unlink(tmp);
    free(tmp);
    fail("could not set mode on temp file for %s", path);
  }

  size_t written = 0;
  while (written < len) {
    ssize_t n = write(fd, data + written, len - written);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0) {
      close(fd);
      unlink(tmp);
      free(tmp);
      fail("could not write temp file for %s", path);
    }
    written += (size_t)n;
  }
  close(fd);
  if (rename(tmp, path) < 0) {
    unlink(tmp);
    free(tmp);
    fail("could not replace %s", path);
  }
  free(tmp);
}

/* mkdir -p with 0700 leaf mode, like `install -d -m 700`. */
static void mkdir_p700(const char *path) {
  char *copy = xstrdup(path);
  for (char *c = copy + 1; *c; c++) {
    if (*c == '/') {
      *c = '\0';
      if (mkdir(copy, 0700) < 0 && errno != EEXIST) {
        free(copy);
        fail("could not create directory: %s", path);
      }
      *c = '/';
    }
  }
  if (mkdir(copy, 0700) < 0 && errno != EEXIST) {
    free(copy);
    fail("could not create directory: %s", path);
  }
  free(copy);
}

static int run_command(char *const argv[], char *output, size_t output_size) {
  int pipefd[2] = {-1, -1};
  if (output && pipe(pipefd) < 0)
    return -1;

  pid_t pid = fork();
  if (pid < 0) {
    if (output) {
      close(pipefd[0]);
      close(pipefd[1]);
    }
    return -1;
  }
  if (pid == 0) {
    if (output) {
      dup2(pipefd[1], STDOUT_FILENO);
      close(pipefd[0]);
      close(pipefd[1]);
    }
    execvp(argv[0], argv);
    _exit(127);
  }

  size_t total = 0;
  if (output) {
    close(pipefd[1]);
    while (total + 1 < output_size) {
      ssize_t n = read(pipefd[0], output + total, output_size - 1 - total);
      if (n < 0 && errno == EINTR)
        continue;
      if (n <= 0)
        break;
      total += (size_t)n;
    }
    close(pipefd[0]);
    output[total] = '\0';
  }

  int status = 0;
  while (waitpid(pid, &status, 0) < 0 && errno == EINTR)
    ;
  if (!WIFEXITED(status))
    return -1;
  return WEXITSTATUS(status);
}

/* ------------------------------------------------------------- palette */

static int color_index(const char *key) {
  for (size_t i = 1; i < N_PALETTE_KEYS; i++)
    if (strcmp(key, PALETTE_KEYS[i]) == 0)
      return (int)i - 1;
  return -1;
}

static bool is_color(const char *s) {
  if (!s || s[0] != '#' || strlen(s) != 7)
    return false;
  for (int i = 1; i < 7; i++)
    if (!isxdigit((unsigned char)s[i]))
      return false;
  return true;
}

static void palette_set(palette_t *p, const char *key, const char *value) {
  int index = color_index(key);
  if (index < 0)
    return;
  strncpy(p->color[index], value, RAW_LEN - 1);
  p->color[index][RAW_LEN - 1] = '\0';
  p->valid[index] = true;
}

static const char *palette_get(const palette_t *p, const char *key) {
  int index = color_index(key);
  if (index < 0 || !p->valid[index])
    return NULL;
  return p->color[index];
}

/* Normalize #abc, 0xAABBCC → #AABBCC; returns false when malformed. */
static bool normalize_color(const char *in, char out[COLOR_LEN]) {
  if (!in)
    return false;
  size_t len = strlen(in);
  if (len == 7 && in[0] == '#') {
    if (!is_color(in))
      return false;
    memcpy(out, in, COLOR_LEN);
    return true;
  }
  if (len == 8 && in[0] == '0' && in[1] == 'x') {
    out[0] = '#';
    memcpy(out + 1, in + 2, 7);
    return is_color(out);
  }
  if (len == 4 && in[0] == '#') {
    out[0] = '#';
    for (int i = 0; i < 3; i++) {
      char c = in[i + 1];
      if (!isxdigit((unsigned char)c))
        return false;
      out[1 + i * 2] = c;
      out[2 + i * 2] = c;
    }
    out[7] = '\0';
    return true;
  }
  return false;
}

static void mix_colors(const char *first, const char *second, int pct_second,
                       char out[COLOR_LEN]) {
  int pct_first = 100 - pct_second;
  unsigned fr, fg, fb, sr, sg, sb;
  sscanf(first + 1, "%2x%2x%2x", &fr, &fg, &fb);
  sscanf(second + 1, "%2x%2x%2x", &sr, &sg, &sb);
  unsigned char r = (unsigned char)((fr * pct_first + sr * pct_second) / 100);
  unsigned char g = (unsigned char)((fg * pct_first + sg * pct_second) / 100);
  unsigned char b = (unsigned char)((fb * pct_first + sb * pct_second) / 100);
  sprintf(out, "#%02X%02X%02X", r, g, b);
}

static const char *infer_mode(const char *color) {
  unsigned r, g, b;
  sscanf(color + 1, "%2x%2x%2x", &r, &g, &b);
  return (299 * r + 587 * g + 114 * b >= 145000) ? "light" : "dark";
}

/* First candidate wins: literal #color or a palette key name. */
static bool set_color_from(palette_t *p, const char *target, int n, ...) {
  if (palette_get(p, target))
    return true;
  va_list args;
  va_start(args, n);
  for (int i = 0; i < n; i++) {
    const char *candidate = va_arg(args, const char *);
    if (is_color(candidate)) {
      palette_set(p, target, candidate);
      va_end(args);
      return true;
    }
    const char *value = palette_get(p, candidate);
    if (value) {
      palette_set(p, target, value);
      va_end(args);
      return true;
    }
  }
  va_end(args);
  return false;
}

static void derive_bright_color(palette_t *p, const char *target,
                                const char *source) {
  if (palette_get(p, target))
    return;
  char mixed[COLOR_LEN];
  if (strcmp(p->mode, "light") == 0)
    mix_colors(palette_get(p, source), "#000000", 8, mixed);
  else
    mix_colors(palette_get(p, source), "#FFFFFF", 18, mixed);
  palette_set(p, target, mixed);
}

static void fill_palette_fallbacks(palette_t *p) {
  /* Normalize common forms; malformed entries fall through to fallbacks. */
  char normalized[COLOR_LEN];
  for (size_t i = 0; i < N_COLOR_KEYS; i++) {
    if (p->valid[i] && !normalize_color(p->color[i], normalized))
      p->valid[i] = false;
    else if (p->valid[i])
      memcpy(p->color[i], normalized, COLOR_LEN);
  }

  if (strcmp(p->mode, "dark") != 0 && strcmp(p->mode, "light") != 0) {
    static const char *const samples[] = {
        "background", "dark_background", "darker_background",
        "lighter_background"};
    const char *sample = NULL;
    for (size_t i = 0; i < sizeof(samples) / sizeof(samples[0]); i++)
      if ((sample = palette_get(p, samples[i])))
        break;
    snprintf(p->mode, sizeof(p->mode), "%s",
             sample ? infer_mode(sample) : "dark");
  }

  const char *const *d = strcmp(p->mode, "light") == 0
                             ? LIGHT_DEFAULTS
                             : DARK_DEFAULTS;

  set_color_from(p, "background", 4, "dark_background", "darker_background",
                 "lighter_background", d[D_BG]);
  set_color_from(p, "foreground", 4, "light_foreground", "bright_foreground",
                 "dark_foreground", d[D_FG]);
  set_color_from(p, "accent", 7, "blue", "bright_blue", "cyan", "bright_cyan",
                 "magenta", "bright_magenta", d[D_ACCENT]);

  char mixed[COLOR_LEN];
  if (!palette_get(p, "selection")) {
    mix_colors(palette_get(p, "background"), palette_get(p, "accent"), 25,
               mixed);
    palette_set(p, "selection", mixed);
  }
  if (!palette_get(p, "muted")) {
    mix_colors(palette_get(p, "foreground"), palette_get(p, "background"), 55,
               mixed);
    palette_set(p, "muted", mixed);
  }
  if (!palette_get(p, "dark_background")) {
    mix_colors(palette_get(p, "background"), "#000000", 4, mixed);
    palette_set(p, "dark_background", mixed);
  }
  if (!palette_get(p, "darker_background")) {
    mix_colors(palette_get(p, "background"), "#000000", 10, mixed);
    palette_set(p, "darker_background", mixed);
  }
  if (!palette_get(p, "lighter_background")) {
    mix_colors(palette_get(p, "background"),
               strcmp(p->mode, "light") == 0 ? "#000000" : "#FFFFFF", 10,
               mixed);
    palette_set(p, "lighter_background", mixed);
  }

  set_color_from(p, "dark_foreground", 2, "muted", "foreground");
  set_color_from(p, "light_foreground", 1, "foreground");
  if (!palette_get(p, "bright_foreground")) {
    if (strcmp(p->mode, "light") == 0)
      palette_set(p, "bright_foreground", palette_get(p, "foreground"));
    else {
      mix_colors(palette_get(p, "foreground"), "#FFFFFF", 12, mixed);
      palette_set(p, "bright_foreground", mixed);
    }
  }

  set_color_from(p, "red", 2, "bright_red", d[D_RED]);
  set_color_from(p, "yellow", 2, "bright_yellow", d[D_YELLOW]);
  set_color_from(p, "green", 2, "bright_green", d[D_GREEN]);
  set_color_from(p, "cyan", 2, "bright_cyan", d[D_CYAN]);
  set_color_from(p, "blue", 3, "bright_blue", "accent", d[D_BLUE]);
  set_color_from(p, "magenta", 2, "bright_magenta", d[D_MAGENTA]);
  set_color_from(p, "orange", 3, "yellow", "accent", "#B56A32");
  set_color_from(p, "brown", 2, "muted", "#795548");

  derive_bright_color(p, "bright_red", "red");
  derive_bright_color(p, "bright_yellow", "yellow");
  derive_bright_color(p, "bright_green", "green");
  derive_bright_color(p, "bright_cyan", "cyan");
  derive_bright_color(p, "bright_blue", "blue");
  derive_bright_color(p, "bright_magenta", "magenta");
}

static void read_palette(palette_t *p) {
  memset(p, 0, sizeof(*p));

  char *contents = read_file(xasprintf("%s/colors.toml", g_theme_dir), NULL);
  if (!contents)
    fail("could not read Quattro palette: %s/colors.toml", g_theme_dir);

  for (char *line = contents; line && *line;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline++ = '\0';
    char *next = newline;

    char *eq = strchr(line, '=');
    if (eq) {
      *eq = '\0';
      char *key = trim(line);
      char *value = trim(eq + 1);
      bool key_ok = *key != '\0';
      for (char *c = key; *c && key_ok; c++)
        if (!(*c >= 'a' && *c <= 'z') && *c != '_')
          key_ok = false;
      if (key_ok) {
        char parsed[256];
        size_t vlen;
        if (value[0] == '"' || value[0] == '\'') {
          char quote = value[0];
          char *end = strchr(value + 1, quote);
          vlen = end ? (size_t)(end - (value + 1)) : strlen(value + 1);
          if (vlen >= sizeof(parsed))
            vlen = sizeof(parsed) - 1;
          memcpy(parsed, value + 1, vlen);
          parsed[vlen] = '\0';
        } else {
          size_t i = 0;
          while (value[i] && !isspace((unsigned char)value[i])
                 && value[i] != '#')
            i++;
          if (i >= sizeof(parsed))
            i = sizeof(parsed) - 1;
          memcpy(parsed, value, i);
          parsed[i] = '\0';
        }
        if (strcmp(key, "mode") == 0) {
          /* Keep the raw value; fill_palette_fallbacks validates and
           * infers from the palette when it is not dark/light. */
          strncpy(p->mode, parsed, sizeof(p->mode) - 1);
          p->mode[sizeof(p->mode) - 1] = '\0';
        } else if (color_index(key) >= 0) {
          palette_set(p, key, parsed);
        }
      }
    }
    line = next;
  }
  free(contents);

  fill_palette_fallbacks(p);
}

/* -------------------------------------------------------------- quattro */

static void require_quattro(void) {
  /* The theme-set hook proves Omarchy is installed by existing; skipping the
   * `omarchy version` subprocess there takes fork+exec off the sync path. */
  if (!getenv("OMAFOX_SKIP_VERSION_CHECK")) {
    char version[64] = {0};
    char *const argv[] = {"omarchy", "version", NULL};
    if (run_command(argv, version, sizeof(version)) != 0)
      fail("Omarchy is not installed");
    /* Development builds report "dev (<sha>)" and are newer than Quattro. */
    if (strncmp(version, "dev", 3) != 0) {
      long major = strtol(version, NULL, 10);
      if (major < 4)
        fail("Omarchy Quattro (version 4) or newer is required");
    }
  }
  if (!is_regular_file(xasprintf("%s/colors.toml", g_theme_dir)))
    fail("Quattro palette not found: %s/colors.toml", g_theme_dir);
}

/* -------------------------------------------------------------- payload */

static char *json_escape(const char *input) {
  size_t capacity = strlen(input) * 6 + 1;
  char *out = xmalloc(capacity), *o = out;
  for (const unsigned char *c = (const unsigned char *)input; *c; c++) {
    if (*c == '"')
      o += sprintf(o, "\\\"");
    else if (*c == '\\')
      o += sprintf(o, "\\\\");
    else if (*c < 0x20 || *c == 0x7f)
      o += sprintf(o, "\\u%04X", *c);
    else
      *o++ = (char)*c;
  }
  *o = '\0';
  return out;
}

static char *current_theme_name(void) {
  char *name = NULL;
  size_t len = 0;
  char *contents = read_file(g_theme_name_file, &len);
  if (contents) {
    char *newline = strchr(contents, '\n');
    if (newline)
      *newline = '\0';
    name = contents;
  }
  if (!name || !name[0])
    name = xstrdup("omarchy");
  else
    name = xstrdup(name);
  free(contents);
  if (strlen(name) > MAX_THEME_NAME_LENGTH)
    fail("theme name exceeds %d characters", MAX_THEME_NAME_LENGTH);
  return name;
}

static char *format_payload(const palette_t *palette,
                            const char *escaped_theme) {
  size_t capacity = 256 + N_COLOR_KEYS * 64 + strlen(escaped_theme);
  char *out = xmalloc(capacity), *o = out;
  o += sprintf(o, "{\"protocol\":\"%s\",\"version\":%d,\"action\":\"%s\","
                  "\"theme\":\"%s\",\"palette\":{\"mode\":\"%s\"",
               PROTOCOL, PROTOCOL_VERSION, ACTION, escaped_theme,
               palette->mode);
  for (size_t i = 1; i < N_PALETTE_KEYS; i++)
    o += sprintf(o, ",\"%s\":\"%s\"", PALETTE_KEYS[i],
                 palette->color[i - 1]);
  o += sprintf(o, "}}\n");
  return out;
}

static char *build_payload(void) {
  require_quattro();
  palette_t palette;
  read_palette(&palette);
  char *theme_name = current_theme_name();
  char *escaped = json_escape(theme_name);
  free(theme_name);
  char *out = format_payload(&palette, escaped);
  free(escaped);
  return out;
}

static void store_theme_payload(const char *payload) {
  mkdir_p700(g_state_dir);
  atomic_write(g_state_file, payload, strlen(payload), 0600, false);
}

/* -------------------------------------------------------- managed blocks */

/* Validate begin/end marker sanity in an existing file. */
static void validate_managed_block(const char *path, const char *begin,
                                   const char *end, const char *what) {
  if (path_is_symlink(path))
    fail("refusing to replace symlinked %s: %s", what, path);
  if (path_exists(path) && !is_regular_file(path))
    fail("%s path is not a regular file: %s", what, path);
  char *contents = read_file(path, NULL);
  if (!contents) {
    /* An existing file that can't be read (over MAX_FILE_BYTES, or an I/O
     * or permission error) must not be taken for an empty one: the managed
     * block would be written over the user's content. */
    if (path_exists(path))
      fail("could not read %s (unreadable, or larger than %u MB); "
           "refusing to rewrite it: %s",
           what, MAX_FILE_BYTES / (1024U * 1024U), path);
    return;
  }

  int begin_count = 0, end_count = 0;
  long begin_line = 0, end_line = 0, lineno = 0;
  for (char *line = contents; line && *line;) {
    lineno++;
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    if (strcmp(line, begin) == 0) {
      begin_count++;
      begin_line = lineno;
    }
    if (strcmp(line, end) == 0) {
      end_count++;
      end_line = lineno;
    }
    line = newline ? newline + 1 : NULL;
  }
  free(contents);
  if (begin_count != end_count || begin_count > 1)
    fail("malformed Omafox markers in %s: %s", what, path);
  if (begin_count == 1 && begin_line >= end_line)
    fail("malformed Omafox markers in %s: %s", what, path);
}

/* Return file contents minus the managed block (begin..end inclusive). */
static char *emit_without_managed_block(const char *path, const char *begin,
                                        const char *end, size_t *out_len) {
  char *contents = read_file(path, NULL);
  if (!contents)
    return NULL;

  /* Every kept line is written back with a newline, so a last line that
   * had none grows by one byte, and sprintf adds the NUL after it. */
  size_t capacity = strlen(contents) + 2;
  char *out = xmalloc(capacity), *o = out;
  bool managed = false;
  for (char *line = contents; line && *line;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    if (strcmp(line, begin) == 0) {
      managed = true;
    } else if (strcmp(line, end) == 0) {
      managed = false;
    } else if (!managed) {
      o += sprintf(o, "%s\n", line);
    }
    line = newline ? newline + 1 : NULL;
  }
  free(contents);
  *o = '\0';
  if (out_len)
    *out_len = (size_t)(o - out);
  return out;
}

static bool managed_block_present(const char *path, const char *begin,
                                  const char *end) {
  char *contents = read_file(path, NULL);
  if (!contents)
    return false;
  bool found_begin = false, found_end = false;
  for (char *line = contents; line && *line;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    if (strcmp(line, begin) == 0)
      found_begin = true;
    if (strcmp(line, end) == 0)
      found_end = true;
    line = newline ? newline + 1 : NULL;
  }
  free(contents);
  return found_begin && found_end;
}

static bool managed_marker_present(const char *path, const char *begin,
                                   const char *end) {
  char *contents = read_file(path, NULL);
  if (!contents)
    return false;
  bool found = false;
  for (char *line = contents; line && !found;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    if (strcmp(line, begin) == 0 || strcmp(line, end) == 0)
      found = true;
    line = newline ? newline + 1 : NULL;
  }
  free(contents);
  return found;
}

static bool first_line_is(const char *path, const char *expected) {
  char *contents = read_file(path, NULL);
  if (!contents)
    return false;
  char *newline = strchr(contents, '\n');
  if (newline)
    *newline = '\0';
  bool match = strcmp(contents, expected) == 0;
  free(contents);
  return match;
}

/* Splice new_block into path, replacing any existing managed block.
 * userChrome.css gets the block prepended (matching upstream behavior);
 * user.js gets it appended so user prefs keep their order. */
static void install_managed_block(const char *path, const char *begin,
                                  const char *end, const char *new_block,
                                  bool prepend, const char *what) {
  validate_managed_block(path, begin, end, what);
  size_t rest_len = 0;
  char *rest = emit_without_managed_block(path, begin, end, &rest_len);
  char *merged = prepend ? xasprintf("%s%s", new_block, rest ? rest : "")
                         : xasprintf("%s%s", rest ? rest : "", new_block);
  free(rest);
  atomic_write(path, merged, strlen(merged), 0600, true);
  free(merged);
}

/* Rewrite an existing managed block where it stands (no prepend), so a
 * tracked file keeps its import order. No-op when the block is absent. */
static void replace_managed_block_in_place(const char *path, const char *begin,
                                           const char *end,
                                           const char *new_block,
                                           const char *what) {
  if (!path_exists(path))
    return;
  validate_managed_block(path, begin, end, what);
  if (!managed_block_present(path, begin, end))
    return;
  char *contents = read_file(path, NULL);
  if (!contents)
    return;
  char *out = xmalloc(strlen(contents) + strlen(new_block) + 1), *o = out;
  bool managed = false;
  for (char *line = contents; line && *line;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    if (strcmp(line, begin) == 0) {
      managed = true;
      o += sprintf(o, "%s", new_block);
    } else if (strcmp(line, end) == 0) {
      managed = false;
    } else if (!managed) {
      o += sprintf(o, "%s\n", line);
    }
    line = newline ? newline + 1 : NULL;
  }
  free(contents);
  atomic_write(path, out, (size_t)(o - out), 0600, true);
  free(out);
}

/* Strip the managed block; delete the file if nothing remains. */
static void remove_managed_block(const char *path, const char *begin,
                                 const char *end, const char *what) {
  if (!path_exists(path))
    return;
  validate_managed_block(path, begin, end, what);
  if (!managed_block_present(path, begin, end))
    return;
  size_t rest_len = 0;
  char *rest = emit_without_managed_block(path, begin, end, &rest_len);
  if (rest && rest_len > 0) {
    atomic_write(path, rest, rest_len, 0600, true);
  } else {
    unlink(path);
  }
  free(rest);
}

/* ----------------------------------------------------------- profiles.ini */

typedef struct {
  char **items;
  size_t count;
} str_list_t;

static void list_push(str_list_t *list, char *item) {
  list->items = realloc(list->items, (list->count + 1) * sizeof(char *));
  if (!list->items)
    fail("out of memory");
  list->items[list->count++] = item;
}

static bool list_contains(const str_list_t *list, const char *item) {
  for (size_t i = 0; i < list->count; i++)
    if (strcmp(list->items[i], item) == 0)
      return true;
  return false;
}

/* Parse [ProfileN] sections, emitting root-relative or absolute Paths. */
static str_list_t list_profiles(const char *profiles_file, const char *root) {
  str_list_t profiles = {0}, seen = {0};
  char *contents = read_file(profiles_file, NULL);
  if (!contents)
    return profiles;

  bool in_profile = false;
  char path[PATH_MAX] = "";
  bool is_relative = true;

  for (char *line = contents; line && *line;) {
    char *newline = strchr(line, '\n');
    if (newline)
      *newline = '\0';
    char *next = newline ? newline + 1 : NULL;

    size_t len = strlen(line);
    if (len && line[len - 1] == '\r')
      line[--len] = '\0';

    if (len >= 2 && line[0] == '[' && line[len - 1] == ']') {
      if (in_profile && path[0]) {
        char *full = is_relative ? path_join(root, path) : xstrdup(path);
        if (!list_contains(&seen, full)) {
          list_push(&seen, xstrdup(full));
          list_push(&profiles, full);
        } else {
          free(full);
        }
      }
      in_profile = strncmp(line + 1, "Profile", 7) == 0;
      path[0] = '\0';
      is_relative = true;
    } else if (in_profile) {
      char *eq = strchr(line, '=');
      if (eq) {
        *eq = '\0';
        char *key = trim(line), *value = trim(eq + 1);
        if (strcmp(key, "Path") == 0)
          snprintf(path, sizeof(path), "%s", value);
        else if (strcmp(key, "IsRelative") == 0)
          is_relative = strcmp(value, "0") != 0;
      }
    }
    line = next;
  }
  if (in_profile && path[0]) {
    char *full = is_relative ? path_join(root, path) : xstrdup(path);
    if (!list_contains(&seen, full)) {
      list_push(&profiles, full);
    } else {
      free(full);
    }
  }
  free(contents);
  for (size_t i = 0; i < seen.count; i++)
    free(seen.items[i]);
  free(seen.items);
  return profiles;
}

/* --------------------------------------------------------------- zen */

static bool zen_bridge_owned(const char *target) {
  return is_regular_file(target) && !path_is_symlink(target)
         && first_line_is(target, ZEN_BRIDGE_MARKER);
}

static void validate_zen_bridge(const char *target) {
  if (path_is_symlink(target))
    fail("refusing to replace symlinked Zen bridge: %s", target);
  if (path_exists(target) && !is_regular_file(target))
    fail("Zen bridge path is not a regular file: %s", target);
  if (is_regular_file(target) && !zen_bridge_owned(target))
    fail("refusing to modify unmanaged Zen bridge: %s", target);
}

static void validate_zen_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *bridge = path_join(chrome_dir, "omafox.css");
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_prefs = path_join(profile, "user.js");

  if (path_exists(chrome_dir)) {
    struct stat st;
    if (stat(chrome_dir, &st) < 0 || !S_ISDIR(st.st_mode))
      fail("Zen chrome path is not a directory: %s", chrome_dir);
  }
  validate_zen_bridge(bridge);
  validate_managed_block(user_chrome, ZEN_CSS_BEGIN, ZEN_CSS_END,
                         "Zen profile file");
  validate_managed_block(user_prefs, ZEN_PREFS_BEGIN, ZEN_PREFS_END,
                         "Zen profile file");
  free(chrome_dir);
  free(bridge);
  free(user_chrome);
  free(user_prefs);
}

static int g_zen_configured = 0;
static int g_ff_configured = 0;

static void configure_zen_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *bridge = path_join(chrome_dir, "omafox.css");
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_prefs = path_join(profile, "user.js");

  if (path_exists(chrome_dir)) {
    struct stat st;
    if (stat(chrome_dir, &st) < 0 || !S_ISDIR(st.st_mode))
      fail("Zen chrome path is not a directory: %s", chrome_dir);
  } else {
    mkdir_p700(chrome_dir);
  }

  size_t len;
  char *bridge_data = read_file(g_zen_bridge_source, &len);
  if (!bridge_data)
    fail("packaged Zen bridge is missing or invalid: %s",
         g_zen_bridge_source);
  atomic_write(bridge, bridge_data, len, 0600, false);
  free(bridge_data);

  install_managed_block(user_chrome, ZEN_CSS_BEGIN, ZEN_CSS_END,
                        ZEN_CSS_BEGIN "\n@import url(\"omafox.css\");\n\n"
                        ZEN_CSS_END "\n",
                        true, "Zen profile file");
  install_managed_block(user_prefs, ZEN_PREFS_BEGIN, ZEN_PREFS_END,
                        ZEN_PREFS_BEGIN "\n"
                        "user_pref(\"toolkit.legacyUserProfileCustomizations."
                        "stylesheets\", true);\n"
                        "user_pref(\"zen.theme.disable-lightweight\", false);\n"
                        ZEN_PREFS_END "\n",
                        false, "Zen profile file");

  printf("Configured Zen profile: %s\n", profile);
  free(chrome_dir);
  free(bridge);
  free(user_chrome);
  free(user_prefs);
}

static void setup_zen_profiles(void) {
  g_zen_configured = 0;
  if (!is_regular_file(g_zen_profiles_file))
    return;
  str_list_t profiles = list_profiles(g_zen_profiles_file, g_zen_root);
  str_list_t existing = {0};
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      list_push(&existing, xstrdup(profiles.items[i]));
    else
      fprintf(stderr, "Skipped missing Zen profile: %s\n",
              profiles.items[i]);
  }
  if (existing.count == 0)
    return;
  if (!zen_bridge_owned(g_zen_bridge_source))
    fail("packaged Zen bridge is missing or invalid: %s",
         g_zen_bridge_source);
  for (size_t i = 0; i < existing.count; i++)
    validate_zen_profile(existing.items[i]);
  for (size_t i = 0; i < existing.count; i++) {
    configure_zen_profile(existing.items[i]);
    g_zen_configured++;
  }
}

static const char *zen_profile_status(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *bridge = path_join(chrome_dir, "omafox.css");
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_prefs = path_join(profile, "user.js");
  const char *status;

  if ((path_exists(bridge) || path_is_symlink(bridge))
      && !zen_bridge_owned(bridge)) {
    status = "conflict";
  } else if (zen_bridge_owned(bridge)
             && managed_block_present(user_chrome, ZEN_CSS_BEGIN,
                                      ZEN_CSS_END)
             && managed_block_present(user_prefs, ZEN_PREFS_BEGIN,
                                      ZEN_PREFS_END)) {
    size_t packaged_len = 0, installed_len = 0;
    char *packaged = read_file(g_zen_bridge_source, &packaged_len);
    char *installed = read_file(bridge, &installed_len);
    /* "outdated" only when the packaged bridge exists and differs;
     * a missing package file still reports configured (upstream parity). */
    status = (packaged && !(installed && installed_len == packaged_len
                            && memcmp(packaged, installed, packaged_len) == 0))
                 ? "outdated"
                 : "configured";
    free(packaged);
    free(installed);
  } else if (path_exists(bridge)
             || managed_marker_present(user_chrome, ZEN_CSS_BEGIN,
                                       ZEN_CSS_END)
             || managed_marker_present(user_prefs, ZEN_PREFS_BEGIN,
                                       ZEN_PREFS_END)) {
    status = "incomplete";
  } else {
    status = "not configured";
  }
  free(chrome_dir);
  free(bridge);
  free(user_chrome);
  free(user_prefs);
  return status;
}

static void remove_zen_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *bridge = path_join(chrome_dir, "omafox.css");
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_prefs = path_join(profile, "user.js");

  validate_zen_bridge(bridge);
  bool configured = path_exists(bridge)
      || managed_marker_present(user_chrome, ZEN_CSS_BEGIN, ZEN_CSS_END)
      || managed_marker_present(user_prefs, ZEN_PREFS_BEGIN, ZEN_PREFS_END);

  remove_managed_block(user_chrome, ZEN_CSS_BEGIN, ZEN_CSS_END,
                       "Zen profile file");
  remove_managed_block(user_prefs, ZEN_PREFS_BEGIN, ZEN_PREFS_END,
                       "Zen profile file");
  if (is_regular_file(bridge))
    unlink(bridge);
  if (configured)
    printf("Removed Zen profile bridge: %s\n", profile);

  free(chrome_dir);
  free(bridge);
  free(user_chrome);
  free(user_prefs);
}

static void remove_zen_profiles(void) {
  if (!is_regular_file(g_zen_profiles_file))
    return;
  str_list_t profiles = list_profiles(g_zen_profiles_file, g_zen_root);
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      validate_zen_profile(profiles.items[i]);
  }
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      remove_zen_profile(profiles.items[i]);
  }
}

/* ------------------------------------------------------- firefox bridge */

/* The packaged payload directory owns profile/chrome/omarchy-firefox/. */
static bool ff_payload_owned(const char *dir) {
  char *entry = xasprintf("%s/%s", dir, FF_PAYLOAD_ENTRY);
  bool owned = is_regular_file(entry) && !path_is_symlink(entry)
               && first_line_is(entry, FF_BRIDGE_MARKER);
  free(entry);
  return owned;
}

/* A profile whose chrome/ is itself an Omarchy Chrome checkout (the
 * development symlink) must not also get the packaged payload: both copies
 * would load and the older one would shadow the checkout. Such a profile
 * gets the prefs block and the generated files only, written beside the
 * checkout's entrypoints, which import them relatively. The first marker is
 * the Nova theme; the second is the pre-Nova layout, still recognised so a
 * checkout is never mistaken for an empty profile mid-migration.
 * Returns the checkout directory (caller frees), or NULL. */
static void remove_ff_payload_dir(const char *dir);

static char *ff_checkout_dir(const char *chrome_dir) {
  static const char *const MARKERS[] = {"src/tokens.css",
                                        "omarchy-chrome.css"};
  for (size_t i = 0; i < sizeof(MARKERS) / sizeof(MARKERS[0]); i++) {
    char *entry = path_join(chrome_dir, MARKERS[i]);
    bool found = is_regular_file(entry);
    free(entry);
    if (found)
      return xstrdup(chrome_dir);
  }
  return NULL;
}

static bool ff_chrome_is_checkout(const char *chrome_dir) {
  char *dir = ff_checkout_dir(chrome_dir);
  bool found = dir != NULL;
  free(dir);
  return found;
}

/* Where the generated palette files belong for this profile. */
static char *ff_palette_dir(const char *chrome_dir) {
  char *dir = ff_checkout_dir(chrome_dir);
  return dir ? dir : xstrdup(chrome_dir);
}

static void validate_ff_payload(const char *dir) {
  if (path_is_symlink(dir))
    fail("refusing to replace symlinked Firefox payload: %s", dir);
  if (path_exists(dir)) {
    struct stat st;
    if (stat(dir, &st) < 0 || !S_ISDIR(st.st_mode))
      fail("Firefox payload path is not a directory: %s", dir);
    if (!ff_payload_owned(dir))
      fail("refusing to modify unmanaged Firefox payload: %s", dir);
  }
}

static void validate_ff_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *payload_dir = path_join(chrome_dir, FF_PAYLOAD_DIRNAME);
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_content = path_join(chrome_dir, "userContent.css");
  char *user_prefs = path_join(profile, "user.js");

  if (path_exists(chrome_dir)) {
    struct stat st;
    if (stat(chrome_dir, &st) < 0 || !S_ISDIR(st.st_mode))
      fail("Firefox chrome path is not a directory: %s", chrome_dir);
  }
  validate_ff_payload(payload_dir);
  validate_managed_block(user_chrome, FF_CSS_BEGIN, FF_CSS_END,
                         "Firefox profile file");
  validate_managed_block(user_content, FF_CSS_BEGIN, FF_CSS_END,
                         "Firefox profile file");
  validate_managed_block(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END,
                         "Firefox profile file");
  free(chrome_dir);
  free(payload_dir);
  free(user_chrome);
  free(user_content);
  free(user_prefs);
}

static void copy_tree(const char *src, const char *dst) {
  DIR *dir = opendir(src);
  if (!dir)
    fail("could not read Firefox payload: %s", src);
  mkdir_p700(dst);
  struct dirent *ent;
  while ((ent = readdir(dir))) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0)
      continue;
    char *src_path = path_join(src, ent->d_name);
    char *dst_path = path_join(dst, ent->d_name);
    struct stat st;
    if (lstat(src_path, &st) < 0) {
      free(src_path);
      free(dst_path);
      continue;
    }
    if (S_ISDIR(st.st_mode)) {
      copy_tree(src_path, dst_path);
    } else if (S_ISREG(st.st_mode)) {
      size_t len;
      char *data = read_file(src_path, &len);
      if (data) {
        atomic_write(dst_path, data, len, 0600, false);
        free(data);
      }
    }
    free(src_path);
    free(dst_path);
  }
  closedir(dir);
}

static void configure_ff_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *payload_dir = path_join(chrome_dir, FF_PAYLOAD_DIRNAME);
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_content = path_join(chrome_dir, "userContent.css");
  char *user_prefs = path_join(profile, "user.js");

  if (!path_exists(chrome_dir))
    mkdir_p700(chrome_dir);
  char *checkout_dir = ff_checkout_dir(chrome_dir);
  bool checkout = checkout_dir != NULL;
  if (checkout) {
    /* Undo what earlier releases installed into the checkout. Its marker
     * pair is kept, narrowed to the palette import: omafox <= 1.1.0
     * refreshes the palette only while the markers exist. */
    char *palette_block = xasprintf("%s\n@import \"%s\";\n%s\n",
                                    FF_CSS_BEGIN, FF_PALETTE_NAME, FF_CSS_END);
    replace_managed_block_in_place(user_chrome, FF_CSS_BEGIN, FF_CSS_END,
                                   palette_block, "Firefox profile file");
    free(palette_block);
    remove_managed_block(user_content, FF_CSS_BEGIN, FF_CSS_END,
                         "Firefox profile file");
    if (ff_payload_owned(payload_dir))
      remove_ff_payload_dir(payload_dir);
    free(checkout_dir);
  } else {
    copy_tree(g_ff_payload_source, payload_dir);

    char *block = xasprintf(
        "%s\n@import url(\"%s/%s\");\n@import url(\"%s\");\n\n%s\n",
        FF_CSS_BEGIN, FF_PAYLOAD_DIRNAME, FF_PAYLOAD_ENTRY, FF_PALETTE_NAME,
        FF_CSS_END);
    install_managed_block(user_chrome, FF_CSS_BEGIN, FF_CSS_END, block,
                          true, "Firefox profile file");
    free(block);

    char *content_block = xasprintf(
        "%s\n@import url(\"%s/userContent.css\");\n\n%s\n",
        FF_CSS_BEGIN, FF_PAYLOAD_DIRNAME, FF_CSS_END);
    install_managed_block(user_content, FF_CSS_BEGIN, FF_CSS_END,
                          content_block, true, "Firefox profile file");
    free(content_block);
  }

  install_managed_block(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END,
                        FF_PREFS_BEGIN "\n"
                        "user_pref(\"toolkit.legacyUserProfileCustomizations."
                        "stylesheets\", true);\n"
                        "user_pref(\"svg.context-properties.content.enabled\""
                        ", true);\n"
                        "user_pref(\"browser.theme.dark-private-windows\""
                        ", false);\n"
                        "user_pref(\"browser.tabs.allow_transparent_browser\""
                        ", true);\n"
                        "user_pref(\"widget.wayland.opaque-region.enabled\""
                        ", false);\n"
                        FF_PREFS_END "\n",
                        false, "Firefox profile file");

  printf(checkout ? "Configured Firefox profile (theme checkout): %s\n"
                  : "Configured Firefox profile: %s\n",
         profile);
  free(chrome_dir);
  free(payload_dir);
  free(user_chrome);
  free(user_content);
  free(user_prefs);
}

static void setup_ff_profiles(void) {
  g_ff_configured = 0;
  if (!is_regular_file(g_ff_profiles_file))
    return;
  if (!ff_payload_owned(g_ff_payload_source))
    return; /* Firefox payload not packaged; palette sync still works. */
  str_list_t profiles = list_profiles(g_ff_profiles_file, g_ff_root);
  str_list_t existing = {0};
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      list_push(&existing, xstrdup(profiles.items[i]));
    else
      fprintf(stderr, "Skipped missing Firefox profile: %s\n",
              profiles.items[i]);
  }
  if (existing.count == 0)
    return;
  for (size_t i = 0; i < existing.count; i++)
    validate_ff_profile(existing.items[i]);
  for (size_t i = 0; i < existing.count; i++) {
    configure_ff_profile(existing.items[i]);
    g_ff_configured++;
  }
}

static const char *ff_profile_status(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *payload_dir = path_join(chrome_dir, FF_PAYLOAD_DIRNAME);
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_content = path_join(chrome_dir, "userContent.css");
  char *user_prefs = path_join(profile, "user.js");
  const char *status;

  if (path_exists(payload_dir) && !ff_payload_owned(payload_dir)) {
    status = "conflict";
  } else if (ff_chrome_is_checkout(chrome_dir)) {
    /* A leftover payload or import block would shadow the checkout. */
    char *uc = read_file(user_chrome, NULL);
    char *ucontent = read_file(user_content, NULL);
    bool stale = path_exists(payload_dir)
        || (uc && strstr(uc, FF_PAYLOAD_DIRNAME "/"))
        || (ucontent && strstr(ucontent, FF_PAYLOAD_DIRNAME "/"));
    free(uc);
    free(ucontent);
    if (stale)
      status = "theme checkout, outdated";
    else if (managed_block_present(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END))
      status = "theme checkout";
    else
      status = "theme checkout, not configured";
  } else if (ff_payload_owned(payload_dir)
             && managed_block_present(user_chrome, FF_CSS_BEGIN, FF_CSS_END)
             && managed_block_present(user_content, FF_CSS_BEGIN,
                                      FF_CSS_END)
             && managed_block_present(user_prefs, FF_PREFS_BEGIN,
                                      FF_PREFS_END)) {
    char *packaged_entry =
        xasprintf("%s/%s", g_ff_payload_source, FF_PAYLOAD_ENTRY);
    char *installed_entry =
        xasprintf("%s/%s", payload_dir, FF_PAYLOAD_ENTRY);
    size_t plen = 0, ilen = 0;
    char *packaged = read_file(packaged_entry, &plen);
    char *installed = read_file(installed_entry, &ilen);
    status = (packaged && !(installed && ilen == plen
                            && memcmp(packaged, installed, plen) == 0))
                 ? "outdated"
                 : "configured";
    free(packaged);
    free(installed);
    free(packaged_entry);
    free(installed_entry);
  } else if (path_exists(payload_dir)
             || managed_marker_present(user_chrome, FF_CSS_BEGIN, FF_CSS_END)
             || managed_marker_present(user_content, FF_CSS_BEGIN,
                                       FF_CSS_END)
             || managed_marker_present(user_prefs, FF_PREFS_BEGIN,
                                       FF_PREFS_END)) {
    status = "incomplete";
  } else {
    status = "not configured";
  }
  free(chrome_dir);
  free(payload_dir);
  free(user_chrome);
  free(user_content);
  free(user_prefs);
  return status;
}

static void remove_ff_payload_dir(const char *dir) {
  DIR *d = opendir(dir);
  if (!d)
    return;
  struct dirent *ent;
  while ((ent = readdir(d))) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0)
      continue;
    char *child = path_join(dir, ent->d_name);
    struct stat st;
    if (lstat(child, &st) == 0) {
      if (S_ISDIR(st.st_mode))
        remove_ff_payload_dir(child);
      else
        unlink(child);
    }
    free(child);
  }
  closedir(d);
  rmdir(dir);
}

static void remove_ff_profile(const char *profile) {
  char *chrome_dir = path_join(profile, "chrome");
  char *payload_dir = path_join(chrome_dir, FF_PAYLOAD_DIRNAME);
  char *palette_dir = ff_palette_dir(chrome_dir);
  char *palette_file = path_join(palette_dir, FF_PALETTE_NAME);
  char *content_palette_file = path_join(palette_dir, FF_CONTENT_PALETTE_NAME);
  char *radius_file = path_join(palette_dir, FF_RADIUS_NAME);
  free(palette_dir);
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_content = path_join(chrome_dir, "userContent.css");
  char *user_prefs = path_join(profile, "user.js");

  validate_ff_payload(payload_dir);
  bool configured = path_exists(payload_dir)
      || managed_marker_present(user_chrome, FF_CSS_BEGIN, FF_CSS_END)
      || managed_marker_present(user_content, FF_CSS_BEGIN, FF_CSS_END)
      || managed_marker_present(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END);

  remove_managed_block(user_chrome, FF_CSS_BEGIN, FF_CSS_END,
                       "Firefox profile file");
  remove_managed_block(user_content, FF_CSS_BEGIN, FF_CSS_END,
                       "Firefox profile file");
  remove_managed_block(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END,
                       "Firefox profile file");
  if (ff_payload_owned(payload_dir))
    remove_ff_payload_dir(payload_dir);
  if (is_regular_file(palette_file))
    unlink(palette_file);
  if (is_regular_file(content_palette_file))
    unlink(content_palette_file);
  /* The radius file is shared with the old per-user hook; only ours goes. */
  if (first_line_is(radius_file, FF_RADIUS_MARKER))
    unlink(radius_file);
  if (configured)
    printf("Removed Firefox profile bridge: %s\n", profile);

  free(chrome_dir);
  free(payload_dir);
  free(palette_file);
  free(content_palette_file);
  free(radius_file);
  free(user_chrome);
  free(user_content);
  free(user_prefs);
}

static void remove_ff_profiles(void) {
  if (!is_regular_file(g_ff_profiles_file))
    return;
  str_list_t profiles = list_profiles(g_ff_profiles_file, g_ff_root);
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      validate_ff_profile(profiles.items[i]);
  }
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      remove_ff_profile(profiles.items[i]);
  }
}

/* ------------------------------------------------------- palette refresh */

/* Render every palette color as --omarchy-<key> into buf. The theme reads
 * these only where the lightweight theme has no equivalent (tab-group
 * swatches, about: pages); live chrome colors come from the extension.
 * Returns buf. */
static char *raw_palette_vars(const palette_t *p, char *buf, size_t cap) {
  size_t off = (size_t)snprintf(buf, cap, ":root {\n");
  for (size_t i = 1; i < N_PALETTE_KEYS && off < cap; i++) {
    const char *v = palette_get(p, PALETTE_KEYS[i]);
    if (v)
      off += (size_t)snprintf(buf + off, cap - off, "  --omarchy-%s: %s;\n",
                              PALETTE_KEYS[i], v);
  }
  /* Truncated output would be invalid CSS; keep room for the closing brace. */
  if (off + 3 > cap)
    off = cap - 3;
  snprintf(buf + off, cap - off, "}\n");
  return buf;
}

/* Chrome palette. Besides the raw keys, it mirrors the Firefox theme
 * variables the extension's lightweight theme sets, under
 * :root:not([lwtheme]), so the first painted frame already uses the current
 * palette; the block goes inert the moment the extension's theme lands and
 * owns the same variables live. !important is required: userChrome is user
 * origin and Firefox's own defaults are author origin. */
static void write_palette_css(const palette_t *p, const char *path) {
  char raw[4096];
  char *css = xasprintf(
      "/* OMAFOX GENERATED PALETTE — written by omafox sync; do not edit. */\n"
      "%s\n"
      ":root:not([lwtheme]) {\n"
      "  color-scheme: %s !important;\n"
      "  --toolbar-background-color: %s !important;\n"
      "  --toolbar-text-color: %s !important;\n"
      "  --toolbar-field-background-color: %s !important;\n"
      "  --toolbar-field-text-color: %s !important;\n"
      "  --toolbar-field-border-color-focus: %s !important;\n"
      "  --lwt-tab-line-color: %s !important;\n"
      "  --tabpanel-background-color: %s !important;\n"
      "}\n",
      raw_palette_vars(p, raw, sizeof(raw)), p->mode,
      palette_get(p, "dark_background"), palette_get(p, "foreground"),
      palette_get(p, "darker_background"), palette_get(p, "light_foreground"),
      palette_get(p, "bright_blue"), palette_get(p, "accent"),
      palette_get(p, "background"));
  atomic_write(path, css, strlen(css), 0600, false);
  free(css);
}

/* Content palette for userContent.css: the raw keys and the palette mode,
 * never a color-scheme property, so importing it cannot restyle websites. */
static void write_content_palette_css(const palette_t *p, const char *path) {
  char raw[4096];
  char *css = xasprintf(
      "/* OMAFOX GENERATED CONTENT PALETTE — written by omafox sync; do not"
      " edit. */\n"
      ":root {\n  --omarchy-color-scheme: %s;\n}\n\n%s",
      p->mode, raw_palette_vars(p, raw, sizeof(raw)));
  atomic_write(path, css, strlen(css), 0600, false);
  free(css);
}

/* Hyprland geometry: the chrome rounds its cards like the desktop rounds
 * windows. Left untouched when hyprctl is unavailable (no Hyprland session,
 * e.g. a TTY or a test sandbox) so the last good value survives. */
static bool hypr_option(const char *option, char *out, size_t size) {
  char *argv[] = {"hyprctl", "getoption", (char *)option, "-j", NULL};
  return run_command(argv, out, size) == 0;
}

/* Integer field of a `hyprctl getoption -j` reply, within [0, max]. */
static bool hypr_int(const char *option, long max, long *value) {
  char out[512];
  if (!hypr_option(option, out, sizeof(out)))
    return false;
  const char *field = strstr(out, "\"int\"");
  if (!field || !(field = strchr(field, ':')))
    return false;
  char *end;
  long v = strtol(field + 1, &end, 10);
  if (end == field + 1 || v < 0 || v > max)
    return false;
  *value = v;
  return true;
}

/* First color of a border option as CSS #RRGGBBAA. Hyprland serialises
 * gradients as "AARRGGBB AARRGGBB ... <angle>deg" under "gradient" (older
 * releases: "str"). */
static bool hypr_border_color(const char *option, char css[10]) {
  char out[512];
  if (!hypr_option(option, out, sizeof(out)))
    return false;
  const char *field = strstr(out, "\"gradient\"");
  if (!field)
    field = strstr(out, "\"str\"");
  if (!field || !(field = strchr(field, ':')) || !(field = strchr(field, '"')))
    return false;
  field++;
  if (field[0] == '0' && (field[1] == 'x' || field[1] == 'X'))
    field += 2;
  for (int i = 0; i < 8; i++)
    if (!isxdigit((unsigned char)field[i]))
      return false;
  if (isxdigit((unsigned char)field[8]))
    return false;
  snprintf(css, 10, "#%.6s%.2s", field + 2, field);
  return true;
}

/* The accent native widgets (checkboxes, `outline: auto` focus rings) paint
 * with: Hyprland's active border, like the theme's focus color, else the
 * palette accent. `out` gets #RRGGBB. */
static void native_accent(const palette_t *p, char out[8]) {
  char border[10];
  if (hypr_border_color("general:col.active_border", border))
    snprintf(out, 8, "%.7s", border);
  else
    snprintf(out, 8, "%.7s", palette_get(p, "accent"));
}

/* Readable text on `hex` (#RRGGBB): the darker or lighter palette end. */
static const char *text_on(const palette_t *p, const char *hex) {
  unsigned r, g, b;
  if (sscanf(hex, "#%2x%2x%2x", &r, &g, &b) != 3)
    return palette_get(p, "foreground");
  double luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
  bool dark_mode = strcmp(p->mode, "dark") == 0;
  const char *darkest = palette_get(p, dark_mode ? "darker_background" : "foreground");
  const char *lightest = palette_get(p, dark_mode ? "bright_foreground" : "background");
  return luma > 0.5 ? darkest : lightest;
}

/* Hyprland window geometry for the theme. Left untouched when hyprctl is
 * unavailable, so a sync outside Hyprland keeps the last good values. */
static void write_radius_css(const char *path) {
  long rounding;
  if (!hypr_int("decoration:rounding", 64, &rounding))
    return;
  char *borders = xstrdup("");
  long border_size;
  char active[10], inactive[10];
  if (hypr_int("general:border_size", 32, &border_size)
      && hypr_border_color("general:col.active_border", active)
      && hypr_border_color("general:col.inactive_border", inactive)) {
    free(borders);
    borders = xasprintf("  --omarchy-border-width: %ldpx;\n"
                        "  --omarchy-border-active-color: %s;\n"
                        "  --omarchy-border-inactive-color: %s;\n",
                        border_size, active, inactive);
  }
  char *css = xasprintf(
      "%s\n:root {\n  --omarchy-radius-container: %ldpx;\n%s}\n",
      FF_RADIUS_MARKER, rounding, borders);
  atomic_write(path, css, strlen(css), 0600, false);
  free(borders);
  free(css);
}

/* Update the dynamic prefs inside the Firefox managed block so pages
 * report the palette mode and the pre-CSS canvas starts dark/light. */
static void refresh_ff_profile_colors(const char *profile,
                                      const palette_t *p) {
  char *chrome_dir = path_join(profile, "chrome");
  char *user_chrome = path_join(chrome_dir, "userChrome.css");
  char *user_prefs = path_join(profile, "user.js");
  char *palette_dir = ff_palette_dir(chrome_dir);
  char *palette_file = path_join(palette_dir, FF_PALETTE_NAME);
  char *content_palette_file = path_join(palette_dir, FF_CONTENT_PALETTE_NAME);
  char *radius_file = path_join(palette_dir, FF_RADIUS_NAME);
  free(palette_dir);

  bool bridged = ff_chrome_is_checkout(chrome_dir)
      ? managed_block_present(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END)
            || managed_block_present(user_chrome, FF_CSS_BEGIN, FF_CSS_END)
      : managed_block_present(user_chrome, FF_CSS_BEGIN, FF_CSS_END);
  if (!bridged) {
    free(chrome_dir);
    free(user_chrome);
    free(user_prefs);
    free(palette_file);
    free(content_palette_file);
    free(radius_file);
    return;
  }

  /* content-override: 0=dark, 1=light — pages with native dark CSS render
   * correctly before any content-script theme engine wakes up. */
  int override = strcmp(p->mode, "light") == 0 ? 1 : 0;
  char accent[8];
  native_accent(p, accent);
  char *block = xasprintf(
      "%s\n"
      "user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\""
      ", true);\n"
      "user_pref(\"svg.context-properties.content.enabled\", true);\n"
      "user_pref(\"browser.theme.dark-private-windows\", false);\n"
      /* Lets the new tab's Desktop background show the window surface;
       * pages that paint no background fall back to the theme's canvas,
       * which matches browser.display.background_color below. */
      "user_pref(\"browser.tabs.allow_transparent_browser\", true);\n"
      /* Hyprland skips its blur wherever the window claims to be opaque,
       * and Firefox only refreshes that claim on some repaints: chrome
       * that moves the page (the theme's zen row slides it down) leaves
       * the glass above it unblurred until the next tab switch. Never
       * claim opacity; the whole window is glass under omarchy anyway. */
      "user_pref(\"widget.wayland.opaque-region.enabled\", false);\n"
      "user_pref(\"browser.nova.enabled\", true);\n"
      "user_pref(\"browser.newtabpage.activity-stream.nova.enabled\""
      ", true);\n"
      "user_pref(\"widget.gtk.rounded-bottom-corners.enabled\", true);\n"
      "user_pref(\"layout.css.prefers-color-scheme.content-override\""
      ", %d);\n"
      "user_pref(\"browser.display.background_color\", \"%s\");\n"
      "user_pref(\"browser.display.foreground_color\", \"%s\");\n"
      "user_pref(\"ui.accentcolor\", \"%s\");\n"
      "user_pref(\"ui.accentcolortext\", \"%s\");\n"
      "%s\n",
      FF_PREFS_BEGIN, override, palette_get(p, "background"),
      palette_get(p, "foreground"), accent, text_on(p, accent), FF_PREFS_END);
  install_managed_block(user_prefs, FF_PREFS_BEGIN, FF_PREFS_END, block,
                        false, "Firefox profile file");
  free(block);

  write_palette_css(p, palette_file);
  write_content_palette_css(p, content_palette_file);
  write_radius_css(radius_file);
  free(radius_file);
  free(chrome_dir);
  free(user_chrome);
  free(user_prefs);
  free(palette_file);
  free(content_palette_file);
}

static void refresh_ff_profiles_colors(const palette_t *p) {
  if (!is_regular_file(g_ff_profiles_file))
    return;
  str_list_t profiles = list_profiles(g_ff_profiles_file, g_ff_root);
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      refresh_ff_profile_colors(profiles.items[i], p);
  }
}

/* --------------------------------------------------------------- status */

static void show_profile_status(const char *label, const char *profiles_file,
                                const char *root,
                                const char *(*status_fn)(const char *)) {
  if (!is_regular_file(profiles_file)) {
    printf("%s profiles: not detected (%s)\n", label, profiles_file);
    return;
  }
  str_list_t profiles = list_profiles(profiles_file, root);
  if (profiles.count == 0) {
    printf("%s profiles: none listed in %s\n", label, profiles_file);
    return;
  }
  for (size_t i = 0; i < profiles.count; i++) {
    struct stat st;
    if (stat(profiles.items[i], &st) == 0 && S_ISDIR(st.st_mode))
      printf("%s profile: %s (%s)\n", label, profiles.items[i],
             status_fn(profiles.items[i]));
    else
      printf("%s profile: %s (missing)\n", label, profiles.items[i]);
  }
}

static void show_status(void) {
  char *name = NULL;
  char *contents = read_file(g_theme_name_file, NULL);
  if (contents) {
    char *newline = strchr(contents, '\n');
    if (newline)
      *newline = '\0';
    name = contents;
  }

  printf("Omafox version: %s\n", VERSION);
  printf("Theme: %s\n", name ? name : "unknown");
  printf("Palette: %s/colors.toml\n", g_theme_dir);
  printf("Hook: %s\n", g_hook_path);
  printf("Theme state: %s (%s)\n", g_state_file,
         is_regular_file(g_state_file) ? "ready" : "missing");
  printf("Native host: %s (%s)\n", g_native_host_path,
         access(g_native_host_path, X_OK) == 0 ? "installed" : "missing");
  printf("Native manifest: %s (%s)\n", g_native_manifest_path,
         is_regular_file(g_native_manifest_path) ? "installed" : "missing");
  show_profile_status("Zen", g_zen_profiles_file, g_zen_root,
                      zen_profile_status);
  show_profile_status("Firefox", g_ff_profiles_file, g_ff_root,
                      ff_profile_status);
  free(contents);
}

/* --------------------------------------------------------------- setup */

static void cmd_sync(void) {
  require_quattro();
  palette_t palette;
  read_palette(&palette);
  char *theme_name = current_theme_name();
  char *escaped = json_escape(theme_name);
  free(theme_name);
  char *payload = format_payload(&palette, escaped);
  free(escaped);
  store_theme_payload(payload);

  /* Push the same palette into configured Firefox profiles so the first
   * painted frame already matches — no waiting on extension startup. */
  refresh_ff_profiles_colors(&palette);
  free(payload);
}

static void cmd_setup(void) {
  require_quattro();
  if (access(g_native_host_path, X_OK) != 0)
    fail("packaged native host not found: %s", g_native_host_path);
  if (!is_regular_file(g_native_manifest_path))
    fail("packaged native manifest not found: %s", g_native_manifest_path);
  if (access(g_hook_source, X_OK) != 0)
    fail("packaged Omarchy hook not found: %s", g_hook_source);

  char *const argv[] = {"omarchy", "hook", "install", "theme-set",
                        (char *)g_hook_source, NULL};
  if (run_command(argv, NULL, 0) != 0)
    fail("omarchy hook install failed");
  printf("Enabled user hook: %s\n", g_hook_path);
  printf("Using packaged native host: %s\n", g_native_host_path);

  setup_zen_profiles();
  setup_ff_profiles();
  cmd_sync();
  printf("Queued the current Omarchy palette for connected browsers.\n");
  if (g_zen_configured > 0)
    printf("Restart Zen Browser once to load the Omafox bridge.\n");
  if (g_ff_configured > 0)
    printf("Restart Firefox once to load the Omafox bridge.\n");
}

static void cmd_remove(void) {
  remove_zen_profiles();
  remove_ff_profiles();

  if (path_exists(g_hook_path) || path_is_symlink(g_hook_path)) {
    unlink(g_hook_path);
    printf("Removed hook: %s\n", g_hook_path);
  }
  if (path_exists(g_state_file) || path_is_symlink(g_state_file)) {
    unlink(g_state_file);
    printf("Removed theme state: %s\n", g_state_file);
  }
  rmdir(g_state_dir);
  printf("System files are managed by pacman; remove them with:"
         " sudo pacman -Rns omafox\n");
}

/* ----------------------------------------------------------------- main */

static void usage(void) {
  printf(
      "Usage: omafox <command>\n"
      "\n"
      "Keep Firefox and Zen Browser in sync with the current Omarchy Quattro"
      " palette.\n"
      "\n"
      "Commands:\n"
      "  sync     Queue the current palette for connected browsers\n"
      "  payload  Print the current JSON protocol message\n"
      "  status   Show the current theme and integration state\n"
      "  setup    Enable the packaged Omafox integration for this user\n"
      "  remove   Remove this user's Omafox hook and theme state\n"
      "  version  Print the Omafox version\n"
      "  help     Show this help\n");
}

int main(int argc, char **argv) {
  init_paths();

  const char *command = argc > 1 ? argv[1] : "help";
  static const char *const known_commands[] = {
      "sync", "payload", "status", "setup", "remove",
      "version", "-V", "--version", "help", "-h", "--help"};
  bool known = false;
  for (size_t i = 0; i < sizeof(known_commands) / sizeof(known_commands[0]);
       i++)
    if (strcmp(command, known_commands[i]) == 0) {
      known = true;
      break;
    }
  if (known && argc > 2)
    fail("command '%s' does not accept arguments", command);

  if (strcmp(command, "sync") == 0)
    cmd_sync();
  else if (strcmp(command, "payload") == 0) {
    char *payload = build_payload();
    fputs(payload, stdout);
    free(payload);
  } else if (strcmp(command, "status") == 0)
    show_status();
  else if (strcmp(command, "setup") == 0)
    cmd_setup();
  else if (strcmp(command, "remove") == 0)
    cmd_remove();
  else if (strcmp(command, "version") == 0 || strcmp(command, "-V") == 0
           || strcmp(command, "--version") == 0)
    printf("%s\n", VERSION);
  else if (strcmp(command, "help") == 0 || strcmp(command, "-h") == 0
           || strcmp(command, "--help") == 0)
    usage();
  else if (command[0] == '-')
    fail("unknown option: %s", command);
  else
    fail("unknown command: %s", command);
  return 0;
}
