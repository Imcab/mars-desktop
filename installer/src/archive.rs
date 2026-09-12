//! Opening the downloaded archive: `.zip` on Windows, `.tar.gz` everywhere
//! else.
//!
//! Returns the list of files it left behind, as paths relative to the
//! destination. That list is what lets uninstalling delete EXACTLY what was
//! installed, instead of flattening the folder the user picked — which may not
//! be ours.

use anyhow::{bail, Context, Result};
use std::path::{Component, Path, PathBuf};

/// Extracts `archive` into `dest` and returns the relative paths it created.
pub fn extract(archive: &Path, dest: &Path) -> Result<Vec<String>> {
    std::fs::create_dir_all(dest).with_context(|| format!("could not create {}", dest.display()))?;

    #[cfg(windows)]
    {
        extract_zip(archive, dest)
    }
    #[cfg(not(windows))]
    {
        extract_targz(archive, dest)
    }
}

/// Rejects paths that escape the destination (`../..`, absolute paths).
///
/// An archive can contain anything, including `../../.bashrc`. This is not
/// theoretical paranoia: it is a bug with a name of its own (Zip Slip) and it
/// costs four lines.
fn safe_path(dest: &Path, inner: &Path) -> Result<PathBuf> {
    let mut out = dest.to_path_buf();
    for part in inner.components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => bail!(
                "the archive contains a path that escapes the install folder: {}",
                inner.display()
            ),
        }
    }
    Ok(out)
}

#[cfg(windows)]
fn extract_zip(archive: &Path, dest: &Path) -> Result<Vec<String>> {
    let file =
        std::fs::File::open(archive).with_context(|| format!("could not open {}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).context("the archive is not a valid zip")?;

    let mut created = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let Some(inner) = entry.enclosed_name() else {
            bail!("the archive contains an invalid file name");
        };
        let path = safe_path(dest, &inner)?;

        if entry.is_dir() {
            std::fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&path)
            .with_context(|| format!("could not write {}", path.display()))?;
        std::io::copy(&mut entry, &mut out)?;
        created.push(inner.to_string_lossy().replace('\\', "/"));
    }
    Ok(created)
}

#[cfg(not(windows))]
fn extract_targz(archive: &Path, dest: &Path) -> Result<Vec<String>> {
    use std::os::unix::fs::PermissionsExt;

    let file =
        std::fs::File::open(archive).with_context(|| format!("could not open {}", archive.display()))?;
    let decoded = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoded);
    // Permissions come from the tar and have to be honoured: that is what keeps
    // the binary's execute bit. Without it you get a file that will not start.
    tar.set_preserve_permissions(true);

    let mut created = Vec::new();
    for entry in tar.entries().context("the archive is not a valid tar.gz")? {
        let mut entry = entry?;
        let inner = entry.path()?.to_path_buf();
        let path = safe_path(dest, &inner)?;

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry
            .unpack(&path)
            .with_context(|| format!("could not write {}", path.display()))?;

        // Belt and braces: a tar built without the execute bit would leave the
        // app installed and dead, with an error that says nothing.
        if path.extension().is_none() || path.extension().is_some_and(|e| e == "sh") {
            if let Ok(meta) = std::fs::metadata(&path) {
                let mut perms = meta.permissions();
                perms.set_mode(perms.mode() | 0o755);
                let _ = std::fs::set_permissions(&path, perms);
            }
        }
        created.push(inner.to_string_lossy().to_string());
    }
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_escape_the_destination() {
        let dest = Path::new("/tmp/mars");
        assert!(safe_path(dest, Path::new("bin/app")).is_ok());
        assert!(safe_path(dest, Path::new("../outside")).is_err());
        assert!(safe_path(dest, Path::new("a/../../outside")).is_err());
    }

    #[test]
    fn accepts_normal_paths_and_keeps_them_under_the_destination() {
        let dest = Path::new("/tmp/mars");
        let r = safe_path(dest, Path::new("./sub/app.exe")).unwrap();
        assert!(r.starts_with(dest));
        assert!(r.ends_with("sub/app.exe"));
    }
}
