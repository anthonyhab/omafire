#define _POSIX_C_SOURCE 200809L
#define _XOPEN_SOURCE 700

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/inotify.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define MAX_STATE_BYTES 65536U
#define RETRY_INTERVAL_MS 1000
#define EVENT_BUFFER_BYTES (16U * 1024U)
#define MAX_WALLPAPER_BYTES (32U * 1024U * 1024U)
#define WALLPAPER_CHUNK_BYTES (512U * 1024U)
#define WALLPAPER_ID_BYTES 128U
#define MAX_WALLPAPER_CANDIDATES 2U
#define WATCH_MASK (IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO | IN_CREATE \
                    | IN_DELETE | IN_ATTRIB | IN_DELETE_SELF | IN_MOVE_SELF)

struct watch_target {
  char path[PATH_MAX];
  char directory[PATH_MAX];
  const char *filename;
  int descriptor;
  int changed;
  int removed;
  int lost;
};

static int write_all(int descriptor, const void *buffer, size_t length) {
  const unsigned char *cursor = buffer;

  while (length > 0) {
    ssize_t written = write(descriptor, cursor, length);
    if (written > 0) {
      cursor += (size_t)written;
      length -= (size_t)written;
      continue;
    }
    if (written < 0 && errno == EINTR) {
      continue;
    }
    return -1;
  }

  return 0;
}

static int send_theme_message(const char *message, size_t message_length) {
  if (message_length > UINT32_MAX) {
    return -1;
  }

  uint32_t native_length = (uint32_t)message_length;
  if (write_all(STDOUT_FILENO, &native_length, sizeof(native_length)) < 0
      || write_all(STDOUT_FILENO, message, message_length) < 0) {
    return -1;
  }

  return 0;
}

static int read_theme_message(const char *path, char *message,
                              size_t *message_length) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) {
    return 0;
  }

  struct stat metadata;
  if (fstat(descriptor, &metadata) < 0 || !S_ISREG(metadata.st_mode)
      || metadata.st_size < 0
      || (uintmax_t)metadata.st_size > MAX_STATE_BYTES) {
    close(descriptor);
    return 0;
  }

  size_t total = 0;
  while (total < MAX_STATE_BYTES + 1U) {
    ssize_t amount = read(descriptor, message + total,
                          MAX_STATE_BYTES + 1U - total);
    if (amount > 0) {
      total += (size_t)amount;
      continue;
    }
    if (amount < 0 && errno == EINTR) {
      continue;
    }
    if (amount < 0) {
      close(descriptor);
      return 0;
    }
    break;
  }
  close(descriptor);

  if (total > MAX_STATE_BYTES) {
    return 0;
  }
  while (total > 0 && (message[total - 1U] == ' '
                       || message[total - 1U] == '\t'
                       || message[total - 1U] == '\r'
                       || message[total - 1U] == '\n')) {
    total--;
  }
  if (total < 2U || message[0] != '{'
      || message[total - 1U] != '}'
      || memchr(message, '\0', total) != NULL) {
    return 0;
  }

  message[total] = '\0';
  *message_length = total;
  return 1;
}

static int check_theme(const char *state_path, char *last_message,
                       size_t *last_length) {
  char message[MAX_STATE_BYTES + 1U];
  size_t message_length = 0;

  if (!read_theme_message(state_path, message, &message_length)) {
    return 0;
  }
  if (message_length == *last_length
      && memcmp(message, last_message, message_length) == 0) {
    return 0;
  }
  if (send_theme_message(message, message_length) < 0) {
    return -1;
  }

  memcpy(last_message, message, message_length + 1U);
  *last_length = message_length;
  return 0;
}

static int split_state_path(const char *state_path, char *directory,
                            size_t directory_size, const char **filename) {
  const char *separator = strrchr(state_path, '/');
  if (separator == NULL) {
    if (directory_size < 2U) {
      return -1;
    }
    memcpy(directory, ".", 2U);
    *filename = state_path;
    return 0;
  }

  size_t directory_length = separator == state_path
                          ? 1U
                          : (size_t)(separator - state_path);
  if (directory_length + 1U > directory_size || separator[1] == '\0') {
    return -1;
  }

  memcpy(directory, state_path, directory_length);
  directory[directory_length] = '\0';
  *filename = separator + 1;
  return 0;
}

static int resolve_state_path(char *state_path, size_t state_path_size) {
  const char *override = getenv("OMAFIRE_STATE_FILE");
  if (override != NULL && override[0] != '\0') {
    int length = snprintf(state_path, state_path_size, "%s", override);
    return length >= 0 && (size_t)length < state_path_size ? 0 : -1;
  }

  const char *home = getenv("HOME");
  if (home == NULL || home[0] == '\0') {
    return -1;
  }
  int length = snprintf(state_path, state_path_size,
                        "%s/.local/state/omafire/theme.json", home);
  return length >= 0 && (size_t)length < state_path_size ? 0 : -1;
}

static int set_target_path(struct watch_target *target, const char *path) {
  int length = snprintf(target->path, sizeof(target->path), "%s", path);
  if (length < 0 || (size_t)length >= sizeof(target->path)) {
    return -1;
  }
  target->descriptor = -1;
  target->changed = 0;
  target->removed = 0;
  target->lost = 0;
  return split_state_path(target->path, target->directory,
                          sizeof(target->directory), &target->filename);
}

/* Candidate "background" links, most preferred first. An override replaces
 * the Omarchy locations entirely (used by tests). */
static size_t resolve_wallpaper_targets(struct watch_target *targets) {
  const char *override = getenv("OMAFIRE_WALLPAPER_FILE");
  if (override != NULL && override[0] != '\0') {
    return set_target_path(&targets[0], override) == 0 ? 1U : 0U;
  }

  const char *home = getenv("HOME");
  if (home == NULL || home[0] == '\0') {
    return 0;
  }

  static const char *const suffixes[MAX_WALLPAPER_CANDIDATES] = {
      "/.local/state/omarchy/current/background",
      "/.config/omarchy/current/background",
  };
  size_t count = 0;
  for (size_t index = 0; index < MAX_WALLPAPER_CANDIDATES; index++) {
    char path[PATH_MAX];
    int length = snprintf(path, sizeof(path), "%s%s", home, suffixes[index]);
    if (length >= 0 && (size_t)length < sizeof(path)
        && set_target_path(&targets[count], path) == 0) {
      count++;
    }
  }
  return count;
}

static const char *wallpaper_mime(const char *path) {
  const char *slash = strrchr(path, '/');
  const char *dot = strrchr(slash != NULL ? slash : path, '.');
  if (dot == NULL) {
    return NULL;
  }
  dot++;
  if (strcasecmp(dot, "jpg") == 0 || strcasecmp(dot, "jpeg") == 0) {
    return "image/jpeg";
  }
  if (strcasecmp(dot, "png") == 0) {
    return "image/png";
  }
  if (strcasecmp(dot, "webp") == 0) {
    return "image/webp";
  }
  return NULL;
}

static uint64_t hash_string(const char *text) {
  uint64_t hash = UINT64_C(14695981039346656037);
  for (const unsigned char *cursor = (const unsigned char *)text;
       *cursor != '\0'; cursor++) {
    hash ^= *cursor;
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static size_t base64_encode(const unsigned char *input, size_t length,
                            char *output) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t written = 0;
  size_t index = 0;

  for (; index + 3U <= length; index += 3U) {
    uint32_t block = ((uint32_t)input[index] << 16)
                   | ((uint32_t)input[index + 1U] << 8)
                   | (uint32_t)input[index + 2U];
    output[written++] = alphabet[(block >> 18) & 0x3FU];
    output[written++] = alphabet[(block >> 12) & 0x3FU];
    output[written++] = alphabet[(block >> 6) & 0x3FU];
    output[written++] = alphabet[block & 0x3FU];
  }
  if (index < length) {
    uint32_t block = (uint32_t)input[index] << 16;
    if (index + 1U < length) {
      block |= (uint32_t)input[index + 1U] << 8;
    }
    output[written++] = alphabet[(block >> 18) & 0x3FU];
    output[written++] = alphabet[(block >> 12) & 0x3FU];
    output[written++] = index + 1U < length ? alphabet[(block >> 6) & 0x3FU]
                                            : '=';
    output[written++] = '=';
  }
  return written;
}

static int read_exact(int descriptor, unsigned char *buffer, size_t length) {
  size_t total = 0;
  while (total < length) {
    ssize_t amount = read(descriptor, buffer + total, length - total);
    if (amount > 0) {
      total += (size_t)amount;
      continue;
    }
    if (amount < 0 && errno == EINTR) {
      continue;
    }
    return -1;
  }
  return 0;
}

struct wallpaper {
  char id[WALLPAPER_ID_BYTES];
  const char *mime;
  unsigned char *data;
  size_t size;
};

/* Opens the first existing candidate (following its symlink) and fills in
 * its id and mime type. Returns the open descriptor, or -1 when there is no
 * usable wallpaper. The id changes with the resolved path, inode, size and
 * modification time. */
static int open_wallpaper(const struct watch_target *targets, size_t count,
                          struct wallpaper *wallpaper) {
  const char *path = NULL;
  struct stat metadata;

  for (size_t index = 0; index < count; index++) {
    if (stat(targets[index].path, &metadata) == 0) {
      path = targets[index].path;
      break;
    }
  }
  if (path == NULL) {
    return -1;
  }

  char resolved[PATH_MAX];
  if (realpath(path, resolved) == NULL) {
    return -1;
  }
  wallpaper->mime = wallpaper_mime(resolved);
  if (wallpaper->mime == NULL) {
    return -1;
  }

  int descriptor = open(resolved, O_RDONLY | O_CLOEXEC | O_NONBLOCK);
  if (descriptor < 0) {
    return -1;
  }
  if (fstat(descriptor, &metadata) < 0 || !S_ISREG(metadata.st_mode)
      || metadata.st_size <= 0
      || (uintmax_t)metadata.st_size > MAX_WALLPAPER_BYTES) {
    close(descriptor);
    return -1;
  }

  wallpaper->size = (size_t)metadata.st_size;
  int length = snprintf(
      wallpaper->id, sizeof(wallpaper->id), "%016jx-%jx-%jx-%zu-%jd%09ld",
      (uintmax_t)hash_string(resolved), (uintmax_t)metadata.st_dev,
      (uintmax_t)metadata.st_ino, wallpaper->size,
      (intmax_t)metadata.st_mtim.tv_sec, (long)metadata.st_mtim.tv_nsec);
  if (length < 0 || (size_t)length >= sizeof(wallpaper->id)) {
    close(descriptor);
    return -1;
  }
  return descriptor;
}

/* Streams the image as consecutive chunk messages, each well below the
 * 1 MB host-to-browser limit. Returns 1 when sent, 0 when out of memory,
 * and -1 when the browser side is gone. */
static int send_wallpaper(const struct wallpaper *wallpaper) {
  size_t count = (wallpaper->size + WALLPAPER_CHUNK_BYTES - 1U)
               / WALLPAPER_CHUNK_BYTES;
  size_t capacity = 256U + WALLPAPER_ID_BYTES
                  + 4U * ((WALLPAPER_CHUNK_BYTES + 2U) / 3U);
  char *message = malloc(capacity);
  if (message == NULL) {
    return 0;
  }

  for (size_t index = 0; index < count; index++) {
    size_t offset = index * WALLPAPER_CHUNK_BYTES;
    size_t chunk = wallpaper->size - offset < WALLPAPER_CHUNK_BYTES
                 ? wallpaper->size - offset
                 : WALLPAPER_CHUNK_BYTES;
    int header = snprintf(
        message, capacity,
        "{\"protocol\":\"omafox\",\"version\":1,\"action\":\"wallpaper\","
        "\"id\":\"%s\",\"mime\":\"%s\",\"size\":%zu,\"index\":%zu,"
        "\"count\":%zu,\"data\":\"",
        wallpaper->id, wallpaper->mime, wallpaper->size, index, count);
    if (header < 0 || (size_t)header >= capacity) {
      free(message);
      return -1;
    }
    size_t length = (size_t)header;
    length += base64_encode(wallpaper->data + offset, chunk, message + length);
    message[length++] = '"';
    message[length++] = '}';
    if (send_theme_message(message, length) < 0) {
      free(message);
      return -1;
    }
  }

  free(message);
  return 1;
}

/* Sends the current wallpaper when its id differs from the last one sent,
 * or a single empty message when none is usable. Returns -1 only when the
 * browser side is gone. */
static int check_wallpaper(const struct watch_target *targets, size_t count,
                           char *last_id, int *sent) {
  struct wallpaper wallpaper = {.id = "", .mime = NULL, .data = NULL,
                                .size = 0};
  int descriptor = open_wallpaper(targets, count, &wallpaper);

  if (descriptor >= 0 && *sent && strcmp(wallpaper.id, last_id) == 0) {
    close(descriptor);
    return 0;
  }
  if (descriptor >= 0) {
    wallpaper.data = malloc(wallpaper.size);
    int loaded = wallpaper.data != NULL
              && read_exact(descriptor, wallpaper.data, wallpaper.size) == 0;
    close(descriptor);
    if (loaded) {
      int result = send_wallpaper(&wallpaper);
      free(wallpaper.data);
      if (result > 0) {
        memcpy(last_id, wallpaper.id, sizeof(wallpaper.id));
        *sent = 1;
      }
      return result < 0 ? -1 : 0;
    }
    free(wallpaper.data);
  }

  if (*sent && last_id[0] == '\0') {
    return 0;
  }
  static const char empty[] =
      "{\"protocol\":\"omafox\",\"version\":1,\"action\":\"wallpaper\","
      "\"id\":\"\",\"count\":0}";
  if (send_theme_message(empty, sizeof(empty) - 1U) < 0) {
    return -1;
  }
  last_id[0] = '\0';
  *sent = 1;
  return 0;
}

static int consume_inotify_events(int descriptor, struct watch_target *targets,
                                  size_t count) {
  char buffer[EVENT_BUFFER_BYTES]
      __attribute__((aligned(__alignof__(struct inotify_event))));

  while (1) {
    ssize_t amount = read(descriptor, buffer, sizeof(buffer));
    if (amount < 0 && errno == EINTR) {
      continue;
    }
    if (amount < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      break;
    }
    if (amount <= 0) {
      return -1;
    }

    for (char *cursor = buffer; cursor < buffer + amount;) {
      const struct inotify_event *event = (const struct inotify_event *)cursor;
      for (size_t index = 0; index < count; index++) {
        struct watch_target *target = &targets[index];
        if ((event->mask & IN_Q_OVERFLOW) != 0) {
          target->changed = 1;
        }
        if (target->descriptor < 0 || event->wd != target->descriptor) {
          continue;
        }
        if ((event->mask
             & (IN_DELETE_SELF | IN_MOVE_SELF | IN_UNMOUNT | IN_IGNORED)) != 0) {
          target->lost = 1;
        }
        if (event->len > 0 && strcmp(event->name, target->filename) == 0) {
          target->changed = 1;
          if ((event->mask & (IN_DELETE | IN_MOVED_FROM)) != 0) {
            target->removed = 1;
          }
        }
      }
      cursor += sizeof(struct inotify_event) + event->len;
    }
  }

  return 0;
}

int main(void) {
  /* targets[0] is the theme state file; the rest are wallpaper candidates. */
  static struct watch_target targets[1U + MAX_WALLPAPER_CANDIDATES];
  static char last_message[MAX_STATE_BYTES + 1U];
  size_t last_length = 0;
  char state_path[PATH_MAX];
  char last_wallpaper_id[WALLPAPER_ID_BYTES] = "";
  int wallpaper_sent = 0;
  int wallpaper_pending = 1;

  if (resolve_state_path(state_path, sizeof(state_path)) < 0
      || set_target_path(&targets[0], state_path) < 0) {
    fprintf(stderr, "omafire native host: invalid state path\n");
    return 1;
  }
  size_t target_count = 1U + resolve_wallpaper_targets(&targets[1]);
  size_t wallpaper_count = target_count - 1U;
  struct watch_target *theme = &targets[0];

  signal(SIGPIPE, SIG_IGN);
  int inotify_descriptor = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
  if (inotify_descriptor < 0) {
    fprintf(stderr, "omafire native host: inotify initialization failed\n");
    return 1;
  }

  while (1) {
    int theme_watch_missing = 0;
    int wallpaper_watched = 0;
    for (size_t index = 0; index < target_count; index++) {
      struct watch_target *target = &targets[index];
      int added = 0;
      if (target->descriptor < 0) {
        /* Every watch uses the same mask: watches on one directory share a
         * descriptor, and a narrower mask would replace the wider one. */
        target->descriptor = inotify_add_watch(inotify_descriptor,
                                               target->directory, WATCH_MASK);
        added = target->descriptor >= 0;
      }
      if (target->descriptor < 0) {
        theme_watch_missing |= index == 0U;
        continue;
      }
      wallpaper_watched |= index > 0U;
      if (!added) {
        continue;
      }
      if (index == 0U
          && check_theme(theme->path, last_message, &last_length) < 0) {
        goto finish;
      }
      wallpaper_pending = 1;
    }
    if (wallpaper_pending) {
      wallpaper_pending = 0;
      if (check_wallpaper(&targets[1], wallpaper_count, last_wallpaper_id,
                          &wallpaper_sent) < 0) {
        goto finish;
      }
    }

    struct pollfd descriptors[2] = {
        {.fd = STDIN_FILENO, .events = POLLIN},
        {.fd = inotify_descriptor, .events = POLLIN},
    };
    /* Retry while the theme directory, or every wallpaper directory, is
     * missing. An absent fallback directory alone does not keep the host
     * awake; it is retried whenever the host wakes anyway. */
    int retry = theme_watch_missing
             || (wallpaper_count > 0U && !wallpaper_watched);
    int poll_result = poll(descriptors, 2, retry ? RETRY_INTERVAL_MS : -1);
    if (poll_result < 0 && errno == EINTR) {
      continue;
    }
    if (poll_result < 0) {
      break;
    }
    if ((descriptors[0].revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) {
      break;
    }
    if ((descriptors[0].revents & POLLIN) != 0) {
      char discard[4096];
      ssize_t amount;
      do {
        amount = read(STDIN_FILENO, discard, sizeof(discard));
      } while (amount < 0 && errno == EINTR);
      if (amount <= 0) {
        break;
      }
    }
    if ((descriptors[1].revents & POLLIN) != 0) {
      if (consume_inotify_events(inotify_descriptor, targets,
                                 target_count) < 0) {
        break;
      }
      int theme_changed = theme->changed;
      if (theme->removed) {
        last_length = 0;
      }
      for (size_t index = 0; index < target_count; index++) {
        struct watch_target *target = &targets[index];
        if (index > 0U && (target->changed || target->lost)) {
          wallpaper_pending = 1;
        }
        if (target->lost) {
          target->descriptor = -1;
          if (index == 0U) {
            last_length = 0;
          }
        }
        target->changed = 0;
        target->removed = 0;
        target->lost = 0;
      }
      if (theme_changed) {
        if (check_theme(theme->path, last_message, &last_length) < 0) {
          break;
        }
        wallpaper_pending = 1;
      }
    }
    if ((descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
      break;
    }
  }

finish:
  close(inotify_descriptor);
  return 0;
}
