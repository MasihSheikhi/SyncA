/*
 * GitHub Sync Plugin for Obsidian
 * Handles clean initialization of empty repositories and separate folder mapping.
 */

const { Plugin, PluginSettingTab, Setting, Notice, normalizePath, Platform, arrayBufferToBase64, base64ToArrayBuffer, requestUrl } = require("obsidian");

const DEFAULT_SETTINGS = {
  githubToken: "",
  githubOwner: "",
  githubRepo: "",
  githubBranch: "main",
  deviceRole: Platform.isMobile ? "Android" : "Desktop",
  localMainFolder: "main",
  peerFolderName: Platform.isMobile ? "Desktop" : "Android",
  lastSync: 0
};

class GitHubApiClient {
  constructor(settings) {
    this.settings = settings;
  }

  getHeaders() {
    return {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${this.settings.githubToken.trim()}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  // Used specifically to initialize empty repos or create the initial branch/commit
  async createInitialFile(filePath, contentBase64, message) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/contents/${filePath}`,
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: message || "Initial commit by Obsidian Sync",
        content: contentBase64,
        branch: this.settings.githubBranch
      }),
      throw: false
    });

    if (res.status === 401) throw new Error("Invalid GitHub Token (401 Unauthorized).");
    if (res.status === 403) throw new Error("Permission denied (403). Ensure token has 'repo' scope.");
    if (res.status === 404) throw new Error("Repository not found (404). Check owner and repo names.");
    if (res.status >= 400) throw new Error(`Failed to initialize repo (${res.status}): ${res.text}`);

    return res.json;
  }

  async getRef() {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/refs/heads/${this.settings.githubBranch}`,
      headers: this.getHeaders(),
      throw: false
    });

    if (res.status === 404 || res.status === 409) {
      return null; // Empty repo or branch doesn't exist yet
    }
    if (res.status === 401) throw new Error("Invalid GitHub Token (401 Unauthorized).");
    if (res.status === 403) throw new Error("Permission denied (403). Check token scopes.");
    if (res.status >= 400) throw new Error(`Failed to get branch ref (${res.status}): ${res.text}`);

    return res.json.object.sha;
  }

  async getCommit(commitSha) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/commits/${commitSha}`,
      headers: this.getHeaders(),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to fetch commit: ${res.status} ${res.text}`);
    return res.json;
  }

  async getTree(treeSha) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/trees/${treeSha}?recursive=1`,
      headers: this.getHeaders(),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to fetch tree: ${res.status} ${res.text}`);
    return res.json.tree || [];
  }

  async createBlob(contentBase64) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/blobs`,
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        content: contentBase64,
        encoding: "base64"
      }),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to create blob: ${res.status} ${res.text}`);
    return res.json.sha;
  }

  async getBlob(blobSha) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/blobs/${blobSha}`,
      headers: this.getHeaders(),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to fetch blob: ${res.status} ${res.text}`);
    return res.json;
  }

  async createTree(baseTreeSha, treeItems) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/trees`,
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        base_tree: baseTreeSha || undefined,
        tree: treeItems
      }),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to create tree: ${res.status} ${res.text}`);
    return res.json.sha;
  }

  async createCommit(message, treeSha, parentCommitSha) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/commits`,
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: parentCommitSha ? [parentCommitSha] : []
      }),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to create commit: ${res.status} ${res.text}`);
    return res.json.sha;
  }

  async updateRef(newCommitSha) {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/git/refs/heads/${this.settings.githubBranch}`,
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({
        sha: newCommitSha,
        force: false
      }),
      throw: false
    });
    if (res.status >= 400) throw new Error(`Failed to update branch ref: ${res.status} ${res.text}`);
  }
}

class AsymmetricSyncPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.client = new GitHubApiClient(this.settings);
    this.isSyncing = false;

    // Ribbon Icon for manual syncing
    this.ribbonIcon = this.addRibbonIcon("refresh-cw", "Sync with GitHub", async () => {
      await this.runSync();
    });

    // Command palette item
    this.addCommand({
      id: "run-github-sync",
      name: "Sync with GitHub",
      callback: async () => {
        await this.runSync();
      }
    });

    this.addSettingTab(new AsymmetricSyncSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.peerFolderName) {
      this.settings.peerFolderName = this.settings.deviceRole === "Desktop" ? "Android" : "Desktop";
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.client = new GitHubApiClient(this.settings);
  }

  async computeGitBlobSha(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    const header = new TextEncoder().encode(`blob ${uint8.length}\0`);
    const full = new Uint8Array(header.length + uint8.length);
    full.set(header, 0);
    full.set(uint8, header.length);
    const hashBuffer = await crypto.subtle.digest("SHA-1", full);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async runSync() {
    if (this.isSyncing) {
      new Notice("Sync is already in progress.");
      return;
    }

    if (!this.settings.githubToken || !this.settings.githubOwner || !this.settings.githubRepo) {
      new Notice("Please configure GitHub settings before syncing.");
      return;
    }

    this.isSyncing = true;
    if (this.ribbonIcon) {
      this.ribbonIcon.addClass("asymmetric-sync-spin");
    }
    const notice = new Notice("Starting sync...", 0);

    try {
      await this.performSync(notice);
      notice.setMessage("Sync completed successfully!");
      setTimeout(() => notice.hide(), 4000);
    } catch (err) {
      console.error("[Asymmetric Sync]", err);
      notice.setMessage(`Sync error: ${err.message}`);
      setTimeout(() => notice.hide(), 8000);
    } finally {
      this.isSyncing = false;
      if (this.ribbonIcon) {
        this.ribbonIcon.removeClass("asymmetric-sync-spin");
      }
    }
  }

  async performSync(notice) {
    const adapter = this.app.vault.adapter;
    const myRemotePrefix = this.settings.deviceRole; // "Desktop" or "Android"
    const peerRemotePrefix = this.settings.peerFolderName; // "Android" or "Desktop"
    const localMainDir = normalizePath(this.settings.localMainFolder); // "main"
    const localPeerDir = normalizePath(this.settings.peerFolderName); // "Android" or "Desktop"

    // 1. Ensure local folders exist
    if (!(await adapter.exists(localMainDir))) {
      await adapter.mkdir(localMainDir);
    }
    if (!(await adapter.exists(localPeerDir))) {
      await adapter.mkdir(localPeerDir);
    }

    // 2. Check repository state & initialize if completely empty
    let headCommitSha = await this.client.getRef();
    let currentTreeSha = null;

    if (!headCommitSha) {
      notice.setMessage("Initializing empty GitHub repository...");
      const initBase64 = arrayBufferToBase64(new TextEncoder().encode("# Obsidian Vault Sync\nInitial repository setup.\n"));
      await this.client.createInitialFile(".sync-init.md", initBase64, "Initial commit");
      
      // Wait a moment for GitHub to register the branch ref
      await new Promise(r => setTimeout(r, 1200));
      headCommitSha = await this.client.getRef();

      if (!headCommitSha) {
        throw new Error("Could not initialize repository. Please verify your token has write access.");
      }
    }

    const commitData = await this.client.getCommit(headCommitSha);
    currentTreeSha = commitData.tree.sha;
    let remoteTree = await this.client.getTree(currentTreeSha);

    // 3. Scan Local Main files and prepare uploads to remote `myRemotePrefix/`
    notice.setMessage(`Uploading ${localMainDir}/ to remote ${myRemotePrefix}/...`);
    const localMainFiles = await this.listAllFiles(localMainDir);
    const treeUpdates = [];

    // Map existing remote files under my folder
    const myRemoteFilesMap = new Map();
    for (const item of remoteTree) {
      if (item.type === "blob" && item.path.startsWith(`${myRemotePrefix}/`)) {
        myRemoteFilesMap.set(item.path, item.sha);
      }
    }

    const currentLocalPaths = new Set();

    for (const localPath of localMainFiles) {
      const relPath = localPath.substring(localMainDir.length + 1);
      const targetRemotePath = `${myRemotePrefix}/${relPath}`;
      currentLocalPaths.add(targetRemotePath);

      const buffer = await adapter.readBinary(localPath);
      const localSha = await this.computeGitBlobSha(buffer);
      const remoteSha = myRemoteFilesMap.get(targetRemotePath);

      if (localSha !== remoteSha) {
        const base64Content = arrayBufferToBase64(buffer);
        const newBlobSha = await this.client.createBlob(base64Content);
        treeUpdates.push({
          path: targetRemotePath,
          mode: "100644",
          type: "blob",
          sha: newBlobSha
        });
      }
    }

    // Detect deleted local files in main/ to remove from GitHub
    for (const [remotePath] of myRemoteFilesMap.entries()) {
      if (!currentLocalPaths.has(remotePath)) {
        treeUpdates.push({
          path: remotePath,
          mode: "100644",
          type: "blob",
          sha: null // null sha signals deletion in Git tree
        });
      }
    }

    // 4. Commit and Push Local Changes
    if (treeUpdates.length > 0) {
      const newTreeSha = await this.client.createTree(currentTreeSha, treeUpdates);
      const newCommitSha = await this.client.createCommit(
        `Sync from ${this.settings.deviceRole} (${new Date().toISOString()})`,
        newTreeSha,
        headCommitSha
      );
      await this.client.updateRef(newCommitSha);
      headCommitSha = newCommitSha;
      currentTreeSha = newTreeSha;
    }

    // 5. Download Peer Remote files into Local Peer Folder
    notice.setMessage(`Downloading peer updates (${peerRemotePrefix}/ -> ${localPeerDir}/)...`);
    const updatedRemoteTree = await this.client.getTree(currentTreeSha);
    const peerRemoteFiles = updatedRemoteTree.filter(
      (item) => item.type === "blob" && item.path.startsWith(`${peerRemotePrefix}/`)
    );

    const activePeerLocalPaths = new Set();

    for (const item of peerRemoteFiles) {
      const relPath = item.path.substring(peerRemotePrefix.length + 1);
      const destLocalPath = normalizePath(`${localPeerDir}/${relPath}`);
      activePeerLocalPaths.add(destLocalPath);

      let needsDownload = true;
      if (await adapter.exists(destLocalPath)) {
        const existingBuffer = await adapter.readBinary(destLocalPath);
        const existingSha = await this.computeGitBlobSha(existingBuffer);
        if (existingSha === item.sha) {
          needsDownload = false;
        }
      }

      if (needsDownload) {
        const blob = await this.client.getBlob(item.sha);
        const fileBytes = base64ToArrayBuffer(blob.content.replace(/\n/g, ""));
        
        const parentDir = destLocalPath.substring(0, destLocalPath.lastIndexOf("/"));
        if (parentDir && !(await adapter.exists(parentDir))) {
          await this.ensureDirectoryHierarchy(parentDir);
        }

        await adapter.writeBinary(destLocalPath, fileBytes);
      }
    }

    // Remove local peer files that were deleted on the peer's remote folder
    const localPeerFiles = await this.listAllFiles(localPeerDir);
    for (const localPath of localPeerFiles) {
      if (!activePeerLocalPaths.has(localPath)) {
        await adapter.remove(localPath);
      }
    }

    this.settings.lastSync = Date.now();
    await this.saveSettings();
  }

  async listAllFiles(dirPath) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(dirPath))) return [];
    
    const results = [];
    const queue = [dirPath];

    while (queue.length > 0) {
      const current = queue.shift();
      const listing = await adapter.list(current);
      results.push(...listing.files);
      queue.push(...listing.folders);
    }
    return results.map((p) => normalizePath(p));
  }

  async ensureDirectoryHierarchy(dirPath) {
    const adapter = this.app.vault.adapter;
    const parts = normalizePath(dirPath).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) {
        await adapter.mkdir(current);
      }
    }
  }
}

class AsymmetricSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("GitHub Configuration").setHeading();

    new Setting(containerEl)
      .setName("GitHub Personal Access Token")
      .setDesc("A Personal Access Token (Classic with 'repo' scope or Fine-grained with Read/Write to Contents).")
      .addText((text) => {
        text
          .setPlaceholder("ghp_...")
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Repository Owner")
      .setDesc("GitHub username or organization.")
      .addText((text) =>
        text
          .setPlaceholder("username")
          .setValue(this.plugin.settings.githubOwner)
          .onChange(async (value) => {
            this.plugin.settings.githubOwner = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Repository Name")
      .setDesc("GitHub repository name.")
      .addText((text) =>
        text
          .setPlaceholder("my-vault-repo")
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Branch")
      .setDesc("Branch to sync with.")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.githubBranch)
          .onChange(async (value) => {
            this.plugin.settings.githubBranch = value.trim() || "main";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Device Role & Folders").setHeading();

    new Setting(containerEl)
      .setName("This Device Role")
      .setDesc("Select whether this device is Desktop or Android.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Desktop", "Desktop")
          .addOption("Android", "Android")
          .setValue(this.plugin.settings.deviceRole)
          .onChange(async (value) => {
            this.plugin.settings.deviceRole = value;
            this.plugin.settings.peerFolderName = value === "Desktop" ? "Android" : "Desktop";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Local Workspace Folder")
      .setDesc("Local folder where your working files are stored.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.localMainFolder)
          .onChange(async (value) => {
            this.plugin.settings.localMainFolder = value.trim() || "main";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Local Peer Mirror Folder")
      .setDesc("Local folder where files from the other device are mirrored.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.peerFolderName)
          .onChange(async (value) => {
            this.plugin.settings.peerFolderName = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

module.exports = AsymmetricSyncPlugin;