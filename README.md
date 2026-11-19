# SyncA

A lightweight Obsidian plugin for asymmetric two-device sync through a private GitHub repository.

SyncA was built for a common two-device Obsidian workflow: keep each device’s working notes in its own remote folder, while still receiving the other device’s changes safely. It avoids risky whole-vault overwrites by mapping each device to a separate folder inside one private GitHub repository.

## Why SyncA?

Most Obsidian sync plugins are designed around one shared folder or full-vault synchronization. SyncA uses an **asymmetric folder model** instead:

- Each device uploads its local working folder to its own remote folder.
- Each device downloads the other device’s remote folder into a separate local mirror folder.
- Desktop and Android/other devices do not overwrite each other’s working folders.

This makes it possible to use two devices with one private GitHub repository without exposing your main notes to accidental deletion from the other device.

## Features

- Asymmetric two-device sync using a private GitHub repository.
- Separate remote folders for each device role: `Desktop/` and `Android/`.
- Local working folder is synced to the device’s own remote folder.
- Peer remote folder is mirrored into a separate local folder.
- File-level change detection using Git blob SHA calculation.
- Supports text and binary files through GitHub’s blob API.
- Automatically creates required local folders.
- Automatically initializes an empty GitHub repository with an initial commit.
- Propagates deletions within the relevant synced folder.
- Manual sync via ribbon icon or command palette.
- Desktop and mobile support (`isDesktopOnly: false`).
- No Git binary required; uses the GitHub REST API directly.

## Requirements

- Obsidian `1.4.0` or newer.
- A GitHub account.
- A **private** GitHub repository.
- A GitHub Personal Access Token with write access to repository contents:
  - Classic token: `repo` scope, or
  - Fine-grained token: **Contents: Read and write** permission for the target repository.
- The plugin files installed on both devices.

## Installation

SyncA is installed manually.

1. Create this folder inside your Obsidian vault:

   ```text
   .obsidian/plugins/asymmetric-github-sync/
   ```

2. Place these files inside that folder:

   ```text
   main.js
   manifest.json
   styles.css
   ```

3. Open Obsidian settings.
4. Go to **Community plugins**.
5. Disable **Restricted mode** if needed.
6. Reload the plugin list or restart Obsidian.
7. Enable **SyncA**.

Repeat these steps on both devices.

## Setup

1. Create a **private** GitHub repository for your vault sync.
2. Create a GitHub Personal Access Token with the required permissions.
3. Install and enable SyncA on both devices.
4. Open **Settings → SyncA** on each device.
5. Configure the GitHub token, repository owner, repository name, and branch.
6. Set **This Device Role** to either `Desktop` or `Android`.
   - Use different roles on the two devices.
7. Keep or change the local working folder. The default is `main`.
8. The peer mirror folder is set automatically based on the device role.
9. Reload Obsidian plugins once after initial installation if needed.
10. Run a sync using the ribbon icon or the command palette command **Sync with GitHub**.

## Folder Mapping

SyncA uses two local folders and two remote folders.

Example for a Desktop device:

| Local folder | Direction | Remote folder |
|---|---|---|
| `main/` | Uploaded to GitHub | `Desktop/` |
| `Android/` | Downloaded from GitHub | `Android/` |

Example for an Android device:

| Local folder | Direction | Remote folder |
|---|---|---|
| `main/` | Uploaded to GitHub | `Android/` |
| `Desktop/` | Downloaded from GitHub | `Desktop/` |

Remote repository structure example:

```text
Desktop/
  notes/
  attachments/
Android/
  notes/
  attachments/
```

The local working folder is the only folder that is uploaded. The peer mirror folder is only used for downloaded changes.

## Configuration

| Setting | Description |
|---|---|
| GitHub Personal Access Token | Token used to access the private repository. |
| Repository Owner | GitHub username or organization. |
| Repository Name | Name of the private repository. |
| Branch | Branch to sync with. Default: `main`. |
| This Device Role | `Desktop` or `Android`. Must differ between devices. |
| Local Workspace Folder | Local folder containing your working files. Default: `main`. |
| Local Peer Mirror Folder | Local folder where the other device’s files are mirrored. Set automatically from the device role. |

## How Sync Works

When you run a sync, SyncA performs these steps:

1. Ensures the local working folder and peer mirror folder exist.
2. Checks the configured GitHub branch.
3. If the repository is empty, creates an initial commit with `.sync-init.md`.
4. Scans all files in the local working folder.
5. Compares local file hashes with remote file hashes under the device’s remote folder.
6. Uploads new or changed files as Git blobs.
7. Removes remote files under the device’s remote folder if they were deleted locally.
8. Creates a new Git tree and commit if changes exist.
9. Downloads the peer device’s remote folder into the local peer mirror folder.
10. Removes local peer mirror files that no longer exist in the peer’s remote folder.

Sync is triggered manually from the ribbon icon or the command palette. There is no background sync timer.

## Usage

- Click the **Sync with GitHub** ribbon icon, or
- Open the command palette and run **Sync with GitHub**.

The plugin displays notices for progress, success, and errors.

## Security Notes

- Use a **private** GitHub repository.
- Use a token scoped only to the required repository and contents permissions.
- The token is stored in the plugin’s Obsidian settings data. Treat your vault configuration accordingly.
- SyncA does not force-push; branch updates use non-forced ref updates.

## Limitations

- SyncA is not a full Git client and does not provide merge conflict resolution.
- The peer mirror folder is effectively read-only for sync purposes. Edits made inside the peer mirror folder are not uploaded.
- Deletions in the local working folder are propagated to the device’s remote folder.
- Deletions in the peer remote folder are propagated to the local peer mirror folder.
- Large vaults may be slower because sync uses the GitHub REST API and uploads changed files as blobs.
- GitHub API rate limits and repository size limits apply.
- This plugin is designed for a simple two-device asymmetric workflow, not for many-device collaborative editing.

## Troubleshooting

| Error | Likely cause |
|---|---|
| `401 Unauthorized` | Invalid or expired GitHub token. |
| `403 Permission denied` | Token lacks required repository/content permissions. |
| `404 Repository not found` | Wrong owner, repository name, or token access. |
| `Could not initialize repository` | Token does not have write access. |
| Empty repository not syncing | Allow a moment after initialization, then retry. |

If settings were changed, SyncA reinitializes its API client automatically. Reloading plugins once after installation is recommended.
