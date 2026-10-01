//! Git helpers for the diff view and worktree orchestration.
//!
//! The core exposes `GET /session/:id/diff` and `GET /file/status`, but both
//! returned empty in testing even with a dirty tracked file (see
//! `docs/core-api-notes.md`). Rather than ship a diff panel that is silently
//! blank, we read the working tree ourselves. This is read-only: all *writes*
//! still go through the core so they inherit its permission and diff flow.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// Path relative to the repository root.
    pub path: String,
    /// `modified`, `added`, `deleted`, `renamed` or `untracked`.
    pub status: String,
    pub added: usize,
    pub removed: usize,
    /// Unified diff for this file. `None` for binary files.
    pub patch: Option<String>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    /// True for the checkout the app was opened in.
    pub is_main: bool,
}

/// The platform's empty file, used as the "before" side for untracked files.
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, false)
}

/// `git diff` exits 1 when it finds differences, which for a diff invocation is
/// success, not failure. Callers that want a patch use this variant.
fn git_diff(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, true)
}

fn run_git(dir: &Path, args: &[&str], allow_diff_exit: bool) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        // Keep output stable regardless of the user's git config.
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| format!("git not available: {e}"))?;

    let differences = output.status.code() == Some(1);
    if !output.status.success() && !(allow_diff_exit && differences) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn is_repo(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--is-inside-work-tree"])
        .map(|out| out.trim() == "true")
        .unwrap_or(false)
}

/// Every uncommitted change in the working tree, including untracked files.
///
/// Untracked files are diffed against `/dev/null` so a newly written file shows
/// its full contents as additions — which is exactly what the agent just did.
pub fn working_changes(dir: &Path) -> Result<Vec<FileChange>, String> {
    if !is_repo(dir) {
        return Ok(Vec::new());
    }

    let mut changes = Vec::new();

    // Tracked changes: staged and unstaged, against HEAD when it exists.
    let has_head = git(dir, &["rev-parse", "--verify", "HEAD"]).is_ok();
    let name_status = if has_head {
        git(dir, &["diff", "HEAD", "--name-status", "--no-renames"])?
    } else {
        git(dir, &["diff", "--cached", "--name-status", "--no-renames"]).unwrap_or_default()
    };

    for line in name_status.lines() {
        let mut fields = line.split('\t');
        let code = fields.next().unwrap_or("").trim();
        let path = fields.next().unwrap_or("").trim();
        if code.is_empty() || path.is_empty() {
            continue;
        }
        let status = match code.chars().next() {
            Some('A') => "added",
            Some('D') => "deleted",
            Some('R') => "renamed",
            _ => "modified",
        };
        changes.push(build_change(dir, path, status, has_head));
    }

    // Untracked files, excluding anything ignored.
    let untracked = git(dir, &["ls-files", "--others", "--exclude-standard"])?;
    for path in untracked.lines().map(str::trim).filter(|p| !p.is_empty()) {
        changes.push(build_change(dir, path, "untracked", has_head));
    }

    changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(changes)
}

fn build_change(dir: &Path, path: &str, status: &str, has_head: bool) -> FileChange {
    let patch = if status == "untracked" {
        // `--no-index` against the null device shows the whole file as added.
        // It exits 1 because the files differ, which is expected here.
        git_diff(dir, &["diff", "--no-index", "--", NULL_DEVICE, path]).ok()
    } else if has_head {
        git_diff(dir, &["diff", "HEAD", "--", path]).ok()
    } else {
        git_diff(dir, &["diff", "--cached", "--", path]).ok()
    };

    let binary = patch
        .as_deref()
        .map(|p| p.contains("Binary files") || p.contains("GIT binary patch"))
        .unwrap_or(false);

    let (added, removed) = patch.as_deref().map(count_lines).unwrap_or((0, 0));

    FileChange {
        path: path.to_string(),
        status: status.to_string(),
        added,
        removed,
        patch: if binary { None } else { patch },
        binary,
    }
}

/// Count added/removed lines, ignoring the `+++`/`---` file headers.
fn count_lines(patch: &str) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

/// Restore one file to its committed state — the "reject this change" action.
///
/// Untracked files are deleted, since there is no committed state to restore.
pub fn revert_file(dir: &Path, path: &str, untracked: bool) -> Result<(), String> {
    let target = safe_join(dir, path)?;
    if untracked {
        std::fs::remove_file(&target).map_err(|e| format!("Cannot delete {path}: {e}"))
    } else {
        git(dir, &["checkout", "HEAD", "--", path]).map(|_| ())
    }
}

/// Resolve `path` inside `dir`, rejecting traversal and absolute paths.
fn safe_join(dir: &Path, path: &str) -> Result<std::path::PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("Absolute paths are not allowed".into());
    }
    for component in candidate.components() {
        match component {
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            _ => return Err("Path traversal is not allowed".into()),
        }
    }
    Ok(dir.join(candidate))
}

// ------------------------------------------------------------- worktrees

pub fn list_worktrees(dir: &Path) -> Result<Vec<WorktreeInfo>, String> {
    if !is_repo(dir) {
        return Ok(Vec::new());
    }
    let output = git(dir, &["worktree", "list", "--porcelain"])?;
    let main = git(dir, &["rev-parse", "--show-toplevel"])
        .map(|p| p.trim().to_string())
        .unwrap_or_default();

    let mut list = Vec::new();
    let mut current: Option<WorktreeInfo> = None;

    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(info) = current.take() {
                list.push(info);
            }
            current = Some(WorktreeInfo {
                is_main: path == main,
                path: path.to_string(),
                branch: None,
                head: None,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(info) = current.as_mut() {
                info.head = Some(head.to_string());
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(info) = current.as_mut() {
                info.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            }
        }
    }
    if let Some(info) = current {
        list.push(info);
    }
    Ok(list)
}

/// Create a sibling worktree on a new branch, for running an agent in isolation.
pub fn create_worktree(dir: &Path, branch: &str) -> Result<String, String> {
    if branch.trim().is_empty() {
        return Err("Branch name is required".into());
    }
    // Let git validate the ref name rather than reimplementing its rules.
    git(dir, &["check-ref-format", "--branch", branch])
        .map_err(|_| format!("'{branch}' is not a valid branch name"))?;

    let root = git(dir, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let root_path = Path::new(&root);
    let name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".into());

    let safe_branch: String = branch
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    let parent = root_path
        .parent()
        .ok_or("Repository has no parent directory")?;
    let mut target = parent.join(format!("{name}-{safe_branch}"));
    let mut suffix = 2;
    while target.exists() {
        target = parent.join(format!("{name}-{safe_branch}-{suffix}"));
        suffix += 1;
    }

    let target_str = target.to_string_lossy().to_string();
    // -B so an existing branch is reused rather than failing outright.
    git(dir, &["worktree", "add", "-B", branch, &target_str])?;
    Ok(target_str)
}

pub fn remove_worktree(dir: &Path, path: &str) -> Result<(), String> {
    git(dir, &["worktree", "remove", path]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repo(std::path::PathBuf);

    impl Repo {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("bz-git-{label}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            git(&dir, &["init", "-q"]).unwrap();
            git(&dir, &["config", "user.email", "t@example.com"]).unwrap();
            git(&dir, &["config", "user.name", "Test"]).unwrap();
            Repo(dir)
        }
        fn write(&self, name: &str, body: &str) {
            std::fs::write(self.0.join(name), body).unwrap();
        }
        fn commit(&self, message: &str) {
            git(&self.0, &["add", "-A"]).unwrap();
            git(&self.0, &["commit", "-q", "-m", message]).unwrap();
        }
    }

    impl Drop for Repo {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn detects_no_repo() {
        let dir = std::env::temp_dir().join(format!("bz-plain-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_repo(&dir));
        assert!(working_changes(&dir).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_modified_tracked_file() {
        let repo = Repo::new("mod");
        repo.write("a.txt", "one\n");
        repo.commit("init");
        repo.write("a.txt", "one\ntwo\n");

        let changes = working_changes(&repo.0).unwrap();
        let change = changes.iter().find(|c| c.path == "a.txt").unwrap();
        assert_eq!(change.status, "modified");
        assert_eq!(change.added, 1);
        assert!(change.patch.as_ref().unwrap().contains("+two"));
    }

    #[test]
    fn reports_untracked_file_as_all_additions() {
        let repo = Repo::new("untracked");
        repo.write("a.txt", "one\n");
        repo.commit("init");
        repo.write("new.txt", "fresh\nlines\n");

        let changes = working_changes(&repo.0).unwrap();
        let change = changes.iter().find(|c| c.path == "new.txt").unwrap();
        assert_eq!(change.status, "untracked");
        assert_eq!(change.added, 2);
        assert_eq!(change.removed, 0);
    }

    #[test]
    fn works_before_the_first_commit() {
        // A fresh project has no HEAD; the diff view must not error out.
        let repo = Repo::new("nohead");
        repo.write("a.txt", "hello\n");
        let changes = working_changes(&repo.0).unwrap();
        assert!(changes.iter().any(|c| c.path == "a.txt"));
    }

    #[test]
    fn revert_restores_tracked_and_deletes_untracked() {
        let repo = Repo::new("revert");
        repo.write("a.txt", "original\n");
        repo.commit("init");
        repo.write("a.txt", "changed\n");
        repo.write("junk.txt", "x\n");

        revert_file(&repo.0, "a.txt", false).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("a.txt")).unwrap(),
            "original\n"
        );

        revert_file(&repo.0, "junk.txt", true).unwrap();
        assert!(!repo.0.join("junk.txt").exists());
    }

    #[test]
    fn rejects_path_traversal() {
        let repo = Repo::new("traversal");
        assert!(safe_join(&repo.0, "../outside").is_err());
        assert!(safe_join(&repo.0, "/etc/passwd").is_err());
        assert!(safe_join(&repo.0, "src/ok.rs").is_ok());
    }

    #[test]
    fn counts_ignore_file_headers() {
        let patch = "--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n one\n+two\n-gone\n";
        assert_eq!(count_lines(patch), (1, 1));
    }

    #[test]
    fn lists_and_creates_worktrees() {
        let repo = Repo::new("wt");
        repo.write("a.txt", "one\n");
        repo.commit("init");

        let initial = list_worktrees(&repo.0).unwrap();
        assert_eq!(initial.len(), 1);
        assert!(initial[0].is_main);

        let created = create_worktree(&repo.0, "feature/x").unwrap();
        assert!(Path::new(&created).is_dir());

        let after = list_worktrees(&repo.0).unwrap();
        assert_eq!(after.len(), 2);
        assert!(after
            .iter()
            .any(|w| w.branch.as_deref() == Some("feature/x")));

        remove_worktree(&repo.0, &created).unwrap();
        assert_eq!(list_worktrees(&repo.0).unwrap().len(), 1);
    }

    #[test]
    fn rejects_invalid_branch_names() {
        let repo = Repo::new("badbranch");
        repo.write("a.txt", "one\n");
        repo.commit("init");
        assert!(create_worktree(&repo.0, "").is_err());
        assert!(create_worktree(&repo.0, "bad branch").is_err());
    }
}
