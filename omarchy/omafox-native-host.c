#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/inotify.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define MAX_STATE_BYTES 65536U
#define RETRY_INTERVAL_MS 1000
#define EVENT_BUFFER_BYTES (16U * 1024U)
#define MAX_FEATURES 64U
#define MAX_FEATURE_KEY 48U

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
  const char *override = getenv("OMAFOX_STATE_FILE");
  if (override != NULL && override[0] != '\0') {
    int length = snprintf(state_path, state_path_size, "%s", override);
    return length >= 0 && (size_t)length < state_path_size ? 0 : -1;
  }

  const char *home = getenv("HOME");
  if (home == NULL || home[0] == '\0') {
    return -1;
  }
  int length = snprintf(state_path, state_path_size,
                        "%s/.local/state/omafox/theme.json", home);
  return length >= 0 && (size_t)length < state_path_size ? 0 : -1;
}

static int consume_inotify_events(int descriptor, int watch_descriptor,
                                  const char *filename, int *watch_lost,
                                  int *state_removed) {
  char buffer[EVENT_BUFFER_BYTES]
      __attribute__((aligned(__alignof__(struct inotify_event))));
  int should_check = 0;

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
      if ((event->mask & IN_Q_OVERFLOW) != 0) {
        should_check = 1;
      }
      if (event->wd == watch_descriptor) {
        if ((event->mask
             & (IN_DELETE_SELF | IN_MOVE_SELF | IN_UNMOUNT | IN_IGNORED)) != 0) {
          *watch_lost = 1;
        }
        if (event->len > 0 && strcmp(event->name, filename) == 0) {
          should_check = 1;
          if ((event->mask & (IN_DELETE | IN_MOVED_FROM)) != 0) {
            *state_removed = 1;
          }
        }
      }
      cursor += sizeof(struct inotify_event) + event->len;
    }
  }

  return should_check;
}

static int resolve_features_path(char *features_path, size_t size) {
  const char *override = getenv("OMAFOX_FEATURES_FILE");
  if (override != NULL && override[0] != '\0') {
    int length = snprintf(features_path, size, "%s", override);
    return length >= 0 && (size_t)length < size ? 0 : -1;
  }

  char state_path[PATH_MAX];
  if (resolve_state_path(state_path, sizeof(state_path)) < 0) {
    return -1;
  }
  char directory[PATH_MAX];
  const char *filename = NULL;
  if (split_state_path(state_path, directory, sizeof(directory), &filename)
      < 0) {
    return -1;
  }
  int length = snprintf(features_path, size, "%s/features.json", directory);
  return length >= 0 && (size_t)length < size ? 0 : -1;
}

static int json_space(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

static int feature_key_char(unsigned char c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
}

static void json_skip_space(const unsigned char *message, size_t length,
                            size_t *position) {
  while (*position < length && json_space(message[*position])) {
    (*position)++;
  }
}

/* Returns the offset just past the colon following "key", or -1. */
static long json_member(const unsigned char *message, size_t length,
                        const char *key) {
  char needle[MAX_FEATURE_KEY + 3U];
  int needle_length =
      snprintf(needle, sizeof(needle), "\"%s\"", key);
  if (needle_length <= 0 || (size_t)needle_length >= sizeof(needle)) {
    return -1;
  }

  for (size_t i = 0; i + (size_t)needle_length <= length; i++) {
    if (memcmp(message + i, needle, (size_t)needle_length) != 0) {
      continue;
    }
    size_t position = i + (size_t)needle_length;
    json_skip_space(message, length, &position);
    if (position < length && message[position] == ':') {
      position++;
      json_skip_space(message, length, &position);
      return (long)position;
    }
  }
  return -1;
}

static int json_expect_literal(const unsigned char *message, size_t length,
                               size_t *position, const char *literal) {
  size_t literal_length = strlen(literal);
  if (*position + literal_length > length
      || memcmp(message + *position, literal, literal_length) != 0) {
    return -1;
  }
  *position += literal_length;
  return 0;
}

/* Parses {"key": true|false|number, ...} starting at *position (which must
 * point at '{'). Numbers are bounded to a sane slider range and stored as
 * doubles with numeric[] marking them so they serialize back as numbers. */
static int json_parse_features(const unsigned char *message, size_t length,
                               size_t *position, char *keys, double *values,
                               unsigned char *numeric, size_t *count) {
  if (*position >= length || message[*position] != '{') {
    return -1;
  }
  (*position)++;
  *count = 0;

  while (1) {
    json_skip_space(message, length, position);
    if (*position >= length) {
      return -1;
    }
    if (message[*position] == '}') {
      (*position)++;
      return 0;
    }
    if (*count > 0) {
      if (message[*position] != ',') {
        return -1;
      }
      (*position)++;
      json_skip_space(message, length, position);
    }
    if (*count >= MAX_FEATURES || *position >= length
        || message[*position] != '"') {
      return -1;
    }
    (*position)++;
    size_t key_length = 0;
    while (*position < length && feature_key_char(message[*position])) {
      if (key_length >= MAX_FEATURE_KEY) {
        return -1;
      }
      keys[(*count) * (MAX_FEATURE_KEY + 1U) + key_length] =
          (char)message[*position];
      key_length++;
      (*position)++;
    }
    if (key_length == 0 || *position >= length
        || message[*position] != '"') {
      return -1;
    }
    keys[(*count) * (MAX_FEATURE_KEY + 1U) + key_length] = '\0';
    (*position)++;
    json_skip_space(message, length, position);
    if (*position >= length || message[*position] != ':') {
      return -1;
    }
    (*position)++;
    json_skip_space(message, length, position);
    if (json_expect_literal(message, length, position, "true") == 0) {
      values[*count] = 1;
      numeric[*count] = 0;
    } else if (json_expect_literal(message, length, position, "false") == 0) {
      values[*count] = 0;
      numeric[*count] = 0;
    } else {
      /* Number token: -?digits[.digits][eE+-digits], bounded. */
      size_t token_start = *position;
      size_t token_length = 0;
      while (*position < length
             && (message[*position] == '-' || message[*position] == '+'
                 || message[*position] == '.' || message[*position] == 'e'
                 || message[*position] == 'E'
                 || (message[*position] >= '0' && message[*position] <= '9'))) {
        if (token_length >= 31) {
          return -1;
        }
        token_length++;
        (*position)++;
      }
      if (token_length == 0) {
        return -1;
      }
      char token[32];
      memcpy(token, message + token_start, token_length);
      token[token_length] = '\0';
      char *end = NULL;
      double number = strtod(token, &end);
      if (end != token + token_length || !isfinite(number)
          || number < -1000000.0 || number > 1000000.0) {
        return -1;
      }
      values[*count] = number;
      numeric[*count] = 1;
    }
    (*count)++;
  }
}

static int write_features_file(const char *path, const char *keys,
                               const double *values,
                               const unsigned char *numeric, size_t count) {
  char temporary[PATH_MAX];
  int path_length = snprintf(temporary, sizeof(temporary), "%s.tmp", path);
  if (path_length < 0 || (size_t)path_length >= sizeof(temporary)) {
    return -1;
  }

  int descriptor =
      open(temporary, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW,
           0644);
  if (descriptor < 0) {
    return -1;
  }

  char line[MAX_FEATURE_KEY + 40U];
  int failed = write_all(descriptor, "{", 1) < 0;
  for (size_t i = 0; !failed && i < count; i++) {
    const char *key = keys + i * (MAX_FEATURE_KEY + 1U);
    char value_text[32];
    if (numeric[i]) {
      snprintf(value_text, sizeof(value_text), "%.6g", values[i]);
    } else {
      snprintf(value_text, sizeof(value_text), "%s",
               values[i] != 0.0 ? "true" : "false");
    }
    int line_length = snprintf(line, sizeof(line), "%s\"%s\":%s",
                               i > 0 ? "," : "", key, value_text);
    if (line_length < 0 || (size_t)line_length >= sizeof(line)
        || write_all(descriptor, line, (size_t)line_length) < 0) {
      failed = 1;
    }
  }
  if (!failed && write_all(descriptor, "}\n", 2) < 0) {
    failed = 1;
  }
  if (close(descriptor) < 0 || failed) {
    unlink(temporary);
    return -1;
  }
  return rename(temporary, path) < 0 ? -1 : 0;
}

static int send_features_reply(int ok, size_t applied) {
  char reply[96];
  int length = snprintf(reply, sizeof(reply),
                        "{\"type\":\"features-ack\",\"ok\":%s,\"applied\":%u}",
                        ok ? "true" : "false", (unsigned)applied);
  if (length < 0 || (size_t)length >= sizeof(reply)) {
    return -1;
  }
  return send_theme_message(reply, (size_t)length);
}

static int dispatch_message(const unsigned char *message, size_t length,
                            const char *features_path) {
  long action_position = json_member(message, length, "action");
  if (action_position < 0) {
    return 0;
  }
  size_t position = (size_t)action_position;
  if (position >= length || message[position] != '"') {
    return 0;
  }
  position++;
  size_t action_start = position;
  while (position < length && message[position] != '"') {
    position++;
  }
  if (position >= length
      || (size_t)(position - action_start) != strlen("features-set")
      || memcmp(message + action_start, "features-set",
                strlen("features-set")) != 0) {
    return 0;
  }

  long features_position = json_member(message, length, "features");
  char keys[MAX_FEATURES * (MAX_FEATURE_KEY + 1U)];
  double values[MAX_FEATURES];
  unsigned char numeric[MAX_FEATURES];
  size_t count = 0;
  int ok = 0;
  if (features_position >= 0) {
    size_t features_start = (size_t)features_position;
    if (json_parse_features(message, length, &features_start, keys, values,
                            numeric, &count)
            == 0
        && write_features_file(features_path, keys, values, numeric, count)
               == 0) {
      ok = 1;
    }
  }
  return send_features_reply(ok, ok ? count : 0);
}

int main(void) {
  char state_path[PATH_MAX];
  char features_path[PATH_MAX];
  char state_directory[PATH_MAX];
  char last_message[MAX_STATE_BYTES + 1U] = {0};
  size_t last_length = 0;
  const char *state_filename = NULL;
  unsigned char inbound[MAX_STATE_BYTES + 4U];
  size_t inbound_have = 0;

  if (resolve_state_path(state_path, sizeof(state_path)) < 0
      || split_state_path(state_path, state_directory,
                          sizeof(state_directory), &state_filename) < 0
      || resolve_features_path(features_path, sizeof(features_path)) < 0) {
    fprintf(stderr, "omafox native host: invalid state path\n");
    return 1;
  }

  signal(SIGPIPE, SIG_IGN);
  int inotify_descriptor = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
  if (inotify_descriptor < 0) {
    fprintf(stderr, "omafox native host: inotify initialization failed\n");
    return 1;
  }

  int watch_descriptor = -1;
  while (1) {
    if (watch_descriptor < 0) {
      watch_descriptor = inotify_add_watch(
          inotify_descriptor,
          state_directory,
          IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO | IN_CREATE | IN_DELETE
              | IN_ATTRIB | IN_DELETE_SELF | IN_MOVE_SELF);
      if (watch_descriptor >= 0
          && check_theme(state_path, last_message, &last_length) < 0) {
        break;
      }
    }

    struct pollfd descriptors[2] = {
        {.fd = STDIN_FILENO, .events = POLLIN},
        {.fd = inotify_descriptor, .events = POLLIN},
    };
    int poll_result = poll(descriptors, 2,
                           watch_descriptor >= 0 ? -1 : RETRY_INTERVAL_MS);
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
      ssize_t amount;
      do {
        amount = read(STDIN_FILENO, inbound + inbound_have,
                      sizeof(inbound) - inbound_have);
      } while (amount < 0 && errno == EINTR);
      if (amount <= 0) {
        break;
      }
      inbound_have += (size_t)amount;

      int protocol_error = 0;
      while (inbound_have >= 4U && !protocol_error) {
        uint32_t frame_length = (uint32_t)inbound[0]
                                | ((uint32_t)inbound[1] << 8U)
                                | ((uint32_t)inbound[2] << 16U)
                                | ((uint32_t)inbound[3] << 24U);
        if (frame_length > MAX_STATE_BYTES) {
          protocol_error = 1;
          break;
        }
        if (inbound_have < (size_t)frame_length + 4U) {
          break;
        }
        if (dispatch_message(inbound + 4U, (size_t)frame_length,
                             features_path)
            < 0) {
          protocol_error = 1;
          break;
        }
        memmove(inbound, inbound + 4U + frame_length,
                inbound_have - 4U - frame_length);
        inbound_have -= 4U + (size_t)frame_length;
      }
      if (protocol_error) {
        break;
      }
    }
    if ((descriptors[1].revents & POLLIN) != 0) {
      int watch_lost = 0;
      int state_removed = 0;
      int should_check = consume_inotify_events(
          inotify_descriptor, watch_descriptor, state_filename, &watch_lost,
          &state_removed);
      if (should_check < 0) {
        break;
      }
      if (state_removed) {
        last_length = 0;
      }
      if (watch_lost) {
        watch_descriptor = -1;
        last_length = 0;
      }
      if (should_check > 0
          && check_theme(state_path, last_message, &last_length) < 0) {
        break;
      }
    }
    if ((descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
      break;
    }
  }

  close(inotify_descriptor);
  return 0;
}
