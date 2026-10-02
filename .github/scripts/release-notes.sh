#!/usr/bin/env bash
# Writes the notes of a release to stdout: every change since the previous release of the same
# channel (one line per pull request, or per commit pushed without one), the issues closed in
# that time, then direct download links.
#   release-notes.sh <tag> <version> <target sha> <channel: nightly|stable>
# Runs in a full clone (fetch-depth 0) so the commit list can be read from git.
set -euo pipefail
tag="$1"; version="$2"; sha="$3"; channel="$4"
repo="${GITHUB_REPOSITORY:?}"
base="https://github.com/$repo/releases/download/$tag"
file() { echo "[\`$1\`]($base/$1)"; }
# Pull request, issue and commit references as explicit links, so they open on click.
pr() { echo "[#$1](https://github.com/$repo/pull/$1)"; }

# The previous release of this channel: nightlies compare with the last nightly, stable
# releases with the last stable release. Releases are listed newest first; when the notes of an
# existing release are rebuilt, the previous one is the release listed after it.
if [ "$channel" = "nightly" ]; then
  filter='select(.isPrerelease and (.tagName | test("-nightly\\.")))'
else
  filter='select(.isPrerelease | not)'
fi
previous=$(gh release list --repo "$repo" --limit 200 --json tagName,isPrerelease \
  --jq "[.[] | $filter | .tagName] as \$tags | (\$tags | index(\"$tag\")) as \$at | if \$at == null then \$tags[0] else \$tags[\$at + 1] end // \"\"")

# main's own history: a squash merge ends in "(#123)", a merge commit names the pull request
# and carries its title in the body. Commits pushed without a pull request are listed as they are.
# Without a previous release (the first of a channel) only the newest 100 commits are listed.
range=(-n 100 "$sha")
if [ -n "$previous" ]; then
  git rev-parse -q --verify "$previous^{commit}" >/dev/null || { echo "::error::Previous release $previous is not in this clone" >&2; exit 1; }
  range=("$previous..$sha")
fi
changes=""
while IFS=$'\t' read -r hash subject; do
  if [[ "$subject" =~ ^Merge\ pull\ request\ \#([0-9]+) ]]; then
    title=$(git log -1 --format=%b "$hash" | sed -n '/./{p;q;}')
    changes+="- ${title:-$subject} ($(pr "${BASH_REMATCH[1]}"))"$'\n'
  elif [[ "$subject" =~ ^(.*)\(\#([0-9]+)\)$ ]]; then
    changes+="- ${BASH_REMATCH[1]% } ($(pr "${BASH_REMATCH[2]}"))"$'\n'
  elif [[ "$subject" != Merge\ * ]]; then
    changes+="- $subject ([${hash:0:7}](https://github.com/$repo/commit/$hash))"$'\n'
  fi
done < <(git log --first-parent --format='%H%x09%s' "${range[@]}")
if [ -n "$changes" ]; then
  if [ -z "$previous" ] && [ -f .github/initial-release-notes.md ]; then
    cat .github/initial-release-notes.md
    printf '\n## Source changes\n\n%s' "$changes"
  else
    printf '## Changes\n\n%s' "$changes"
  fi
  [ -n "$previous" ] && printf '\n[Compare with %s](https://github.com/%s/compare/%s...%s)\n' "${previous#v}" "$repo" "$previous" "$tag"
fi

since=""
if [ -n "$previous" ]; then
  since=$(gh release view "$previous" --repo "$repo" --json publishedAt --jq .publishedAt)
fi
query="repo:$repo is:issue is:closed reason:completed"
[ -n "$since" ] && query="$query closed:>$since"
issues=$(gh api -X GET search/issues -f q="$query" -f per_page=100 --jq '.items[] | "- \(.title) ([#\(.number)](\(.html_url)))"')
if [ -n "$issues" ]; then
  printf '\n## Issues resolved\n\n%s\n' "$issues"
fi

# Downloads last, after what changed.
cat <<EOF

## Downloads

| Platform | Installer |
|---|---|
| Windows (x64 and Arm) | $(file "TenuVault-$version-win.exe") |
| Windows x64 | $(file "TenuVault-$version-win-x64.exe") |
| Windows Arm | $(file "TenuVault-$version-win-arm64.exe") |
| Windows MSI (Intune, Configuration Manager) | $(file "TenuVault-$version-win-x64.msi") |
| macOS Apple silicon | $(file "TenuVault-$version-mac-arm64.dmg") |
| macOS Intel | $(file "TenuVault-$version-mac-x64.dmg") |

Windows installers are signed with Azure Trusted Signing; macOS apps are signed with a Developer ID and notarized by Apple.
EOF
