#!/usr/bin/env bash

THEMEDIRECTORY=$(cd "$(dirname "$0")" && cd .. && pwd -P)
FIREFOXFOLDER="${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/firefox"
PROFILENAME=""


# Get options.
while getopts 'f:p:h' flag; do
	case "${flag}" in
	f) FIREFOXFOLDER="${OPTARG}" ;;
	p) PROFILENAME="${OPTARG}" ;;
	h | *)
		echo "Gnome Theme Install Script:"
		echo "  -f <firefox_folder_path>. Set custom Firefox folder path."
		echo "  -p <profile_name>. Set custom profile name."
		echo "  -h to show this message."
		exit 0
		;;
	esac
done

# A wrapper around the `sed` command to handle platform-specific differences.
#
# sed in BSD platforms need this extra argument when using '-i' to specify no backup file.
function _sed(){
  if [[ "$OSTYPE" == *"linux"* ]] || [[ "$OSTYPE" == *msys* ]]; then
    sed "$@"
    return $?
  fi

  if [[ "$1" == "-i" ]]; then
    shift 1
    sed -i '' "$@"
    return $?
  fi

  sed "$@"
}

should_skip_payload_path() {
	case "$1" in
		.git|.git/*|.pi-subagents|.pi-subagents/*|\
		.omarchy-favicon-contrast-enabled|\
		customChrome.css|customContent.css|generated-gtk-colors.css|\
		omarchy-radius.css|PKGBUILD)
			return 0
			;;
	esac
	return 1
}

copy_payload_file() {
	local relative_path="$1"
	local target_root="$2"
	local source="$THEMEDIRECTORY/$relative_path"
	local target="$target_root/$relative_path"

	should_skip_payload_path "$relative_path" && return 0
	[ -e "$source" ] || [ -L "$source" ] || return 0
	mkdir -p "$(dirname "$target")"
	cp -fPp "$source" "$target"
}

copy_theme_payload() {
	local target_root="$1"
	local relative_path source target_root_physical
	target_root_physical=$(cd "$target_root" && pwd -P)

	# The installed copy may update preferences by invoking its own installer.
	# In that case source and destination are already the same payload.
	[[ $target_root_physical == "$THEMEDIRECTORY" ]] && return 0

	if git -C "$THEMEDIRECTORY" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		while IFS= read -r -d '' relative_path; do
			copy_payload_file "$relative_path" "$target_root"
		done < <(git -C "$THEMEDIRECTORY" ls-files -z)
		return
	fi

	while IFS= read -r -d '' source; do
		relative_path=${source#"$THEMEDIRECTORY"/}
		copy_payload_file "$relative_path" "$target_root"
	done < <(
		find "$THEMEDIRECTORY" \
			\( -path "$THEMEDIRECTORY/.git" -o -path "$THEMEDIRECTORY/.pi-subagents" \) -prune -o \
			\( -type f -o -type l \) -print0
	)
}

next_backup_path() {
	local base=$1
	local candidate=$base
	local index=1
	while [[ -e $candidate || -L $candidate ]]; do
		candidate=$base.$index
		((index++))
	done
	printf '%s\n' "$candidate"
}

escape_sed_bre() {
	printf '%s\n' "$1" | sed 's/[][\\.*^$\/]/\\&/g'
}

function saveProfile(){
	local PROFILE_PATH="$1"
	local backup_path escaped_key

	cd "$FIREFOXFOLDER/$PROFILE_PATH" || { echo "FAIL, Firefox profile path was not found."; exit 1; }
	# Create a chrome directory if it doesn't exist.
	mkdir -p chrome
	cd chrome || { echo "FAIL, couldn't create chrome dir in $PWD, please check if there's something else named 'chrome'."; exit 1; }

	# Copy only maintained payload files. User overrides, generated state,
	# profile markers, agent artifacts, and VCS metadata stay where they are.
	echo "Copying maintained theme files into $PWD" >&2
	[ -e ./firefox-gnome-theme ] || mkdir firefox-gnome-theme
	copy_theme_payload "$PWD/firefox-gnome-theme" || { echo "FAIL, couldn't copy the maintained theme payload into $PWD/chrome/firefox-gnome-theme."; exit 1; }

	# Create single-line user CSS files if non-existent or empty.
	if [ -s userChrome.css ]; then
		# Remove older theme imports
		_sed 's/@import "firefox-gnome-theme.*.//g' userChrome.css | _sed '/^\s*$/d' > tmpfile && mv tmpfile userChrome.css
		echo >> userChrome.css
	else
		echo >> userChrome.css
	fi

	# Import this theme at the beginning of the CSS files.
	_sed -i '1s/^/@import "firefox-gnome-theme\/userChrome.css";\n/' userChrome.css

	# Check if the import was set correctly
	if ! cat userChrome.css | grep "firefox-gnome-theme" > /dev/null; then
		echo "Unable to add the main import in 'userChrome.css', it needs to be set manually." >&2
	fi

	# Create single-line user content CSS files if non-existent or empty. (userContent)
	if [ -s userContent.css ]; then
		# Remove older theme imports
		_sed 's/@import "firefox-gnome-theme.*.//g' userContent.css | _sed '/^\s*$/d' > tmpfile1 && mv tmpfile1 userContent.css
		echo >> userContent.css
	else
		echo >> userContent.css
	fi

	# Import this theme at the beginning of the CSS files. (userContent)
	_sed -i '1s/^/@import "firefox-gnome-theme\/userContent.css";\n/' userContent.css

	# Check if the import was set correctly (userContent)
	if ! cat userContent.css | grep "firefox-gnome-theme" > /dev/null; then
		echo "Unable to add the main import in 'userContent.css', it needs to be set manually." >&2
	fi

	cd ..

	echo "Set configuration to user.js file" >&2

 	theme_prefs=()
	while IFS= read -r line; do
		theme_prefs+=("$line")
	done < <(grep "user_pref" chrome/firefox-gnome-theme/configuration/user.js)
  
	theme_prefs_unvalued=()
	while IFS= read -r line; do
		theme_prefs_unvalued+=("$line")
	done < <(grep "user_pref" chrome/firefox-gnome-theme/configuration/user.js | cut -d'"' -f 2)

	if [ ! -f "user.js" ]; then
		cp chrome/firefox-gnome-theme/configuration/user.js .
	else
		backup_path=$(next_backup_path user.js.bak)
		cp -p user.js "$backup_path"
		for t in "${theme_prefs_unvalued[@]}"; do
			escaped_key=$(escape_sed_bre "$t")
			_sed -i "/^[[:space:]]*user_pref(\"$escaped_key\"[[:space:]]*,/d" user.js
		done
		for f in "${theme_prefs[@]}"; do
			echo "$f" >> user.js
		done
	fi
	echo "Done." >&2
	cd ..
}

PROFILES_FILE="${FIREFOXFOLDER}/profiles.ini"
if [ ! -f "${PROFILES_FILE}" ]; then
	>&2 echo "FAIL, please check Firefox installation, unable to find 'profile.ini' at ${FIREFOXFOLDER}."
	exit 1
fi
echo "'profiles.ini' found in ${FIREFOXFOLDER}"

PROFILES_ARRAY=()
if [[ -n $PROFILENAME ]]; then
	echo "Using ${PROFILENAME} profile"
	PROFILES_ARRAY+=("$PROFILENAME")
else
	echo "Finding all available profiles"
	while IFS= read -r profile_path; do
		[[ -n $profile_path ]] && PROFILES_ARRAY+=("$profile_path")
	done < <(grep -E '^Path=' "$PROFILES_FILE" | cut -d= -f2-)
fi

if ((${#PROFILES_ARRAY[@]} == 0)); then
	echo "FAIL, no Firefox profile found in $PROFILES_FILE."
else
	for profile_path in "${PROFILES_ARRAY[@]}"; do
		if [[ -n $profile_path ]]; then
			echo "Installing theme for $profile_path profile."
			saveProfile "$profile_path"
		fi
	done
fi
