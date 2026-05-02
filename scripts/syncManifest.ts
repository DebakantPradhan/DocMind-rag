import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const MANIFEST_FILE = "data/sync-manifest.json";

// ===== NEW TYPE DEFINITIONS =====
export interface FileTracking {
  contentHash: string;
  lastKnownPaths: {
    path: string;
    lastSeen: string;
  }[];
  documentIds: string[];
  isDeleted: boolean;
  deletedAt?: string;
}

export interface SyncManifest {
  [contentHash: string]: FileTracking;
}

export interface SyncStats {
  new: number;
  updated: number;
  skipped: number;
  renamed: number;  // ← NEW: Track renames
  deleted: number;
}

// Read manifest
export function getSyncManifest(): SyncManifest {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8"));
    }
  } catch (error) {
    console.warn("⚠️ Could not read manifest, starting fresh");
  }
  return {};
}

// Save manifest
export function saveSyncManifest(manifest: SyncManifest) {
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

// Generate SHA256 hash
export function hashFileContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ===== NEW CLEANUP FUNCTION =====
/**
 * Find files that were deleted (in manifest but not on disk)
 * Mark them as deleted in manifest
 */
export function findDeletedFiles(
  manifest: SyncManifest,
  currentFiles: Map<string, string> // path → hash mapping
): string[] {
  const deletedHashes: string[] = [];

  for (const [contentHash, tracking] of Object.entries(manifest)) {
    // Check if any known path still exists
    const hasExistingPath = tracking.lastKnownPaths.some((pathInfo) =>
      currentFiles.has(pathInfo.path)
    );

    // If no paths exist and not already marked deleted
    if (!hasExistingPath && !tracking.isDeleted) {
      deletedHashes.push(contentHash);
    }
  }

  return deletedHashes;
}

/**
 * Detect if file was renamed/moved (same content, different path)
 */
export function detectRename(
  contentHash: string,
  newPath: string,
  manifest: SyncManifest
): boolean {
  if (!manifest[contentHash]) return false;

  const tracking = manifest[contentHash];
  const oldPath = tracking.lastKnownPaths[tracking.lastKnownPaths.length - 1]?.path;

  return oldPath !== newPath && oldPath !== undefined;
}

/**
 * Update manifest with new file info
 */
export function updateManifestEntry(
  contentHash: string,
  filePath: string,
  manifest: SyncManifest,
  documentIds: string[]
) {
  if (!manifest[contentHash]) {
    // New file
    manifest[contentHash] = {
      contentHash,
      lastKnownPaths: [{ path: filePath, lastSeen: new Date().toISOString() }],
      documentIds,
      isDeleted: false,
    };
  } else {
    // Existing file - update path and restore if was deleted
    const tracking = manifest[contentHash];
    
    // Check if path changed
    const lastPath = tracking.lastKnownPaths[tracking.lastKnownPaths.length - 1]?.path;
    if (lastPath !== filePath) {
      tracking.lastKnownPaths.push({
        path: filePath,
        lastSeen: new Date().toISOString(),
      });
    } else {
      // Same path, just update lastSeen
      tracking.lastKnownPaths[tracking.lastKnownPaths.length - 1].lastSeen =
        new Date().toISOString();
    }

    // Restore if was marked deleted
    if (tracking.isDeleted) {
      tracking.isDeleted = false;
      delete tracking.deletedAt;
    }
  }
}

/**
 * Mark file as deleted
 */
export function markAsDeleted(
  contentHash: string,
  manifest: SyncManifest
) {
  if (manifest[contentHash]) {
    manifest[contentHash].isDeleted = true;
    manifest[contentHash].deletedAt = new Date().toISOString();
  }
}