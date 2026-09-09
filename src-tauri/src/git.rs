use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffEntry {
    pub file: String,
    pub hunks: Vec<Hunk>,
    pub status: DiffStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    pub index: usize,
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DiffStatus {
    Pending,
    Accepted,
    Rejected,
}

pub struct GitManager {
    project_path: std::path::PathBuf,
}

impl GitManager {
    pub fn new() -> Self {
        GitManager {
            project_path: std::path::PathBuf::from("."),
        }
    }

    pub fn with_project(project_path: std::path::PathBuf) -> Self {
        GitManager { project_path }
    }

    pub fn set_project(&mut self, path: std::path::PathBuf) {
        self.project_path = path;
    }

    /// Return the unified diff of tracked changes (working tree vs HEAD).
    /// Untracked files are included as `git diff --no-index /dev/null <file>`.
    pub fn pending_diffs(&self) -> Result<Vec<DiffEntry>, String> {
        let output = std::process::Command::new("git")
            .args(["diff", "--no-color"])
            .current_dir(&self.project_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        let diff_text = String::from_utf8_lossy(&output.stdout);
        Ok(parse_git_diff(&diff_text))
    }

    pub fn create_worktree(&self, branch: &str) -> Result<String, String> {
        // Sanitize branch name into a sibling directory name.
        let dir_name: String = branch
            .replace('/', "-")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
            .collect();
        let worktree_path = self
            .project_path
            .parent()
            .unwrap_or(&self.project_path)
            .join(format!("{}-wt-{}", self.project_path.file_name().unwrap_or_default().to_string_lossy(), dir_name));

        // Create the branch first (ignore "already exists" errors), then add the worktree.
        let _ = std::process::Command::new("git")
            .args(["branch", branch])
            .current_dir(&self.project_path)
            .output();

        let output = std::process::Command::new("git")
            .args(["worktree", "add"])
            .arg(&worktree_path)
            .arg(branch)
            .current_dir(&self.project_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(worktree_path.to_string_lossy().to_string())
    }

    pub fn status(&self) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .args(["status", "--short"])
            .current_dir(&self.project_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

impl Default for GitManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse `git diff` text output into per-file entries with per-hunk data.
/// Hunk indices restart at 0 for each file (matching the UI expectations).
pub fn parse_git_diff(diff: &str) -> Vec<DiffEntry> {
    let mut entries: Vec<DiffEntry> = Vec::new();
    let mut current: Option<DiffEntry> = None;
    let mut hunk_index: usize = 0;

    for line in diff.lines() {
        if let Some(file) = parse_diff_header(line) {
            if let Some(e) = current.take() {
                entries.push(e);
            }
            hunk_index = 0;
            current = Some(DiffEntry {
                file,
                hunks: Vec::new(),
                status: DiffStatus::Pending,
            });
        } else if line.starts_with("@@") {
            if let Some(ref mut e) = current {
                let mut hunk = Hunk {
                    index: hunk_index,
                    old_start: 0,
                    old_lines: 0,
                    new_start: 0,
                    new_lines: 0,
                    content: String::new(),
                };
                parse_hunk_header(line, &mut hunk);
                e.hunks.push(hunk);
                hunk_index += 1;
            }
        } else if let Some(ref mut e) = current {
            // Only collect body lines that belong to a hunk.
            if !e.hunks.is_empty() {
                let hunk = e.hunks.last_mut().unwrap();
                hunk.content.push_str(line);
                hunk.content.push('\n');
            }
        }
    }

    if let Some(e) = current {
        entries.push(e);
    }
    entries
}

/// Extract the target path from a `diff --git a/X b/Y` header line,
/// handling quoted paths with special characters.
fn parse_diff_header(line: &str) -> Option<String> {
    let rest = line.strip_prefix("diff --git ")?;
    // Quoted path form: diff --git "a/we ird.txt" "b/we ird.txt"
    if rest.starts_with('"') {
        // Use the last quoted segment — the "b/..." side.
        let quoted: Vec<usize> = rest.match_indices('"').map(|(i, _)| i).collect();
        if quoted.len() >= 2 {
            let last_start = quoted[quoted.len() - 2];
            let last_end = quoted[quoted.len() - 1];
            let b = &rest[last_start + 1..last_end];
            return Some(
                b.strip_prefix("b/")
                    .unwrap_or(b)
                    .to_string(),
            );
        }
        return None;
    }
    // Unquoted: the last whitespace-separated token starting with "b/".
    let b = rest.split_whitespace().rev().find(|t| t.starts_with("b/"))?;
    Some(b.trim_start_matches("b/").to_string())
}

/// Parse the `@@ -a,b +c,d @@` header, filling in the hunk ranges.
fn parse_hunk_header(header: &str, hunk: &mut Hunk) {
    let inner = header
        .trim_start_matches("@@")
        .trim_end_matches("@@")
        .trim();
    for part in inner.split_whitespace() {
        if let Some(range) = part.strip_prefix('-') {
            let (start, lines) = parse_range(range);
            hunk.old_start = start;
            hunk.old_lines = lines;
        } else if let Some(range) = part.strip_prefix('+') {
            let (start, lines) = parse_range(range);
            hunk.new_start = start;
            hunk.new_lines = lines;
        }
    }
}

/// Parse "a,b" or "a" into (start, count). A single number means count = 1.
fn parse_range(range: &str) -> (usize, usize) {
    match range.split_once(',') {
        Some((a, b)) => (
            a.parse().unwrap_or(0),
            b.parse().unwrap_or(1),
        ),
        None => (range.parse().unwrap_or(0), 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
diff --git a/src/main.rs b/src/main.rs
index 1111111..2222222 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,4 +1,5 @@
 fn main() {
-    println!(\"old\");
+    println!(\"new\");
+    println!(\"extra\");
 }
@@ -10,3 +11,4 @@
 // tail change
 context line
+added line
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Project
+hello
";

    #[test]
    fn parses_two_files() {
        let entries = parse_git_diff(SAMPLE);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file, "src/main.rs");
        assert_eq!(entries[1].file, "README.md");
    }

    #[test]
    fn hunks_restart_index_per_file() {
        let entries = parse_git_diff(SAMPLE);
        assert_eq!(entries[0].hunks.len(), 2);
        assert_eq!(entries[0].hunks[0].index, 0);
        assert_eq!(entries[0].hunks[1].index, 1);
        // Second file's hunks start back at 0.
        assert_eq!(entries[1].hunks[0].index, 0);
    }

    #[test]
    fn hunk_ranges_parsed() {
        let entries = parse_git_diff(SAMPLE);
        let h = &entries[0].hunks[0];
        assert_eq!(h.old_start, 1);
        assert_eq!(h.old_lines, 4);
        assert_eq!(h.new_start, 1);
        assert_eq!(h.new_lines, 5);
        assert!(h.content.starts_with(" fn main() {"));
        assert!(h.content.contains("+    println!(\"extra\");"));
    }

    #[test]
    fn empty_diff_yields_no_entries() {
        assert!(parse_git_diff("").is_empty());
        assert!(parse_git_diff("\n\n").is_empty());
    }

    #[test]
    fn parses_quoted_paths() {
        let diff = "diff --git \"a/we ird.txt\" \"b/we ird.txt\"\n@@ -1 +1 @@\n-a\n+b\n";
        let entries = parse_git_diff(diff);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file, "we ird.txt");
    }

    #[test]
    fn parses_single_number_ranges() {
        let entries = parse_git_diff("diff --git a/f b/f\n@@ -3 +3 @@\n-a\n+b\n");
        let h = &entries[0].hunks[0];
        assert_eq!(h.old_start, 3);
        assert_eq!(h.old_lines, 1);
        assert_eq!(h.new_start, 3);
    }
}
