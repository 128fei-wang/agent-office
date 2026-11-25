#!/usr/bin/env python3
"""Agent Office updater.

Checks the official GitHub release feed, downloads a release when needed,
backs up the current app, applies the update, and can roll back.

The bridge (bridge.py) exposes this as a localhost API; update.sh exposes it
to the terminal. No third-party dependency and no GitHub token is required.

Safety rules:
- only the official repository is used (override for tests is explicit);
- archives are extracted with path/symlink/size checks;
- the app is backed up outside the repository before it is modified;
- a dirty git checkout is never overwritten;
- state in ~/.agent-office is never part of the app backup or update.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
STATE_DIR = Path(
    os.environ.get("AGENT_OFFICE_HOME")
    or os.environ.get("BRIDGE_STATE_DIR")
    or (Path.home() / ".agent-office")
).expanduser()
BACKUP_DIR = STATE_DIR / "backups"
REPO = os.environ.get("AGENT_OFFICE_UPDATE_REPO", "128fei-wang/agent-office")
API_URL = os.environ.get(
    "AGENT_OFFICE_UPDATE_API",
    "https://api.github.com/repos/%s/releases/latest" % REPO,
)
USER_AGENT = "Agent-Office-Updater/1.0"
TIMEOUT = float(os.environ.get("AGENT_OFFICE_UPDATE_TIMEOUT") or 20)
MAX_ARCHIVE = int(os.environ.get("AGENT_OFFICE_UPDATE_MAX_BYTES") or 80 * 1024 * 1024)
MAX_UNPACKED = int(os.environ.get("AGENT_OFFICE_UPDATE_MAX_UNPACKED") or 240 * 1024 * 1024)
KEEP_BACKUPS = 5
CACHE_TTL = 600
REQUIRED = ["VERSION", "index.html", "bridge.py", "start.sh", "src/main.js"]
UPDATE_REQUIRED = REQUIRED + ["updater.py", "update.sh", "src/update.js", "update.css"]
VERSION_RE = re.compile(
    r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)

_CHECK_CACHE = {}
_CACHE_LOCK = threading.RLock()


class UpdateError(RuntimeError):
    def __init__(self, message, code="update_failed", status=500):
        super().__init__(message)
        self.code = code
        self.status = status


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_version(value):
    """Return a sortable tuple, or None when the version is not semver."""
    match = VERSION_RE.match(str(value or "").strip())
    if not match:
        return None
    major, minor, patch = (int(match.group(i)) for i in (1, 2, 3))
    prerelease = match.group(4)
    return (major, minor, patch, 0 if prerelease else 1, prerelease or "")


def compare_versions(left, right):
    a = parse_version(left)
    b = parse_version(right)
    if a is None or b is None:
        raise UpdateError("invalid version: %s / %s" % (left, right), "bad_version", 400)
    return (a > b) - (a < b)


def read_version(root=None):
    root = Path(root or APP_ROOT)
    try:
        return (root / "VERSION").read_text("utf-8").strip()
    except OSError:
        return ""


def _url_allowed(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme == "https":
        return True
    if parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"):
        return True
    return os.environ.get("AGENT_OFFICE_UPDATE_ALLOW_HTTP") == "1"


def _http_json(url):
    if not _url_allowed(url):
        raise UpdateError("update source must use HTTPS", "bad_source", 400)
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if response.status != 200:
                raise UpdateError("update server returned HTTP %s" % response.status,
                                  "network", 502)
            raw = response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        if exc.code == 403 and "rate limit" in detail.lower():
            raise UpdateError("GitHub API rate limit reached; try again later",
                              "rate_limit", 502)
        raise UpdateError("update check failed: HTTP %s %s" % (exc.code, detail),
                          "network", 502)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpdateError("update check failed: %s" % exc, "network", 502)
    if len(raw) > 2 * 1024 * 1024:
        raise UpdateError("update response is too large", "bad_source", 502)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise UpdateError("update response is not valid JSON: %s" % exc,
                          "bad_source", 502)
    if not isinstance(data, dict):
        raise UpdateError("update response has an unexpected shape", "bad_source", 502)
    return data


def fetch_latest_release():
    data = _http_json(API_URL)
    tag = str(data.get("tag_name") or "").strip()
    if not parse_version(tag):
        raise UpdateError("release tag is not a semantic version: %s" % tag,
                          "bad_release", 502)
    version = tag[1:] if tag.startswith("v") else tag
    tarball = str(data.get("tarball_url") or "").strip()
    if not tarball:
        tarball = "https://api.github.com/repos/%s/tarball/%s" % (REPO, tag)
    notes = str(data.get("body") or "")
    if len(notes) > 20000:
        notes = notes[:20000] + "\n…"
    return {
        "tag": tag,
        "version": version,
        "name": str(data.get("name") or tag),
        "notes": notes,
        "url": str(data.get("html_url") or ""),
        "tarballUrl": tarball,
        "publishedAt": str(data.get("published_at") or ""),
    }


def _git(root, *args, timeout=30):
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True, text=True, timeout=timeout, env=env,
        )
    except FileNotFoundError:
        raise UpdateError("git is not installed", "git_missing", 409)
    except subprocess.TimeoutExpired:
        raise UpdateError("git command timed out", "git_timeout", 502)


def _git_state(root):
    if not (root / ".git").exists():
        return {"isGit": False, "dirty": False, "branch": "", "error": ""}
    status = _git(root, "status", "--porcelain")
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    error = ""
    if status.returncode != 0:
        error = (status.stderr or "git status failed").strip()[:300]
    return {
        "isGit": True,
        "dirty": bool(status.stdout.strip()) if status.returncode == 0 else True,
        "branch": branch.stdout.strip() if branch.returncode == 0 else "",
        "error": error,
    }


def list_backups(backup_dir=None):
    folder = Path(backup_dir or BACKUP_DIR)
    rows = []
    if not folder.exists():
        return rows
    for item in folder.iterdir():
        if not item.is_dir():
            continue
        meta_path = item / "meta.json"
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(meta, dict) or not meta.get("version"):
            continue
        meta["id"] = item.name
        meta["path"] = str(item)
        try:
            meta["_sortTs"] = float(meta.get("createdAtTs") or item.stat().st_mtime)
        except (TypeError, ValueError, OSError):
            meta["_sortTs"] = 0
        rows.append(meta)
    rows.sort(key=lambda row: (row.get("_sortTs", 0), row.get("createdAt", "")),
              reverse=True)
    return rows


def rollback_candidate(backup_dir=None, current_version=None):
    """Newest backup whose version differs from the running app."""
    current = str(current_version if current_version is not None else read_version())
    for row in list_backups(backup_dir):
        if str(row.get("version") or "") != current:
            return row
    return None


def _deployment(app_root, forced_mode=None):
    mode = (forced_mode or os.environ.get("AGENT_OFFICE_UPDATE_MODE") or "auto").lower()
    is_git = (app_root / ".git").exists()
    if mode == "archive":
        chosen = "archive"
    elif mode == "git":
        chosen = "git" if is_git else "archive"
    else:
        chosen = "git" if is_git else "archive"
    info = {
        "mode": chosen,
        "isGit": is_git,
        "dirty": False,
        "branch": "",
        "canApply": True,
        "reason": "",
        "gitError": "",
    }
    if not os.access(app_root, os.W_OK):
        info["canApply"] = False
        info["reason"] = "read_only"
        return info
    if chosen == "archive":
        return info
    if not is_git:
        info["canApply"] = False
        info["reason"] = "git_missing"
        return info
    state = _git_state(app_root)
    info["dirty"] = state["dirty"]
    info["branch"] = state["branch"]
    info["gitError"] = state["error"]
    if state["error"]:
        info["canApply"] = False
        info["reason"] = "git_error"
    elif state["dirty"]:
        info["canApply"] = False
        info["reason"] = "git_dirty"
    elif not state["branch"] or state["branch"] == "HEAD":
        info["canApply"] = False
        info["reason"] = "git_detached"
    return info


def check_for_update(app_root=None, release=None, force=False, mode=None, backup_dir=None):
    root = Path(app_root or APP_ROOT)
    cache_key = str(root)
    if not release and not force:
        with _CACHE_LOCK:
            cached = _CHECK_CACHE.get(cache_key)
        if cached and time.time() - cached["at"] < CACHE_TTL:
            return json.loads(json.dumps(cached["data"]))

    latest = release or fetch_latest_release()
    current = read_version(root) or "0.0.0"
    available = compare_versions(latest["version"], current) > 0
    deployment = _deployment(root, mode)
    if not available:
        deployment["canApply"] = False
        deployment["reason"] = "no_update"
    backup = rollback_candidate(backup_dir, current)
    result = {
        "currentVersion": current,
        "latestVersion": latest["version"],
        "updateAvailable": available,
        "release": {
            "tag": latest.get("tag", "v" + latest["version"]),
            "version": latest["version"],
            "name": latest.get("name") or latest["version"],
            "notes": latest.get("notes") or "",
            "url": latest.get("url") or "",
            "tarballUrl": latest.get("tarballUrl") or "",
            "publishedAt": latest.get("publishedAt") or "",
        },
        "deployment": deployment,
        "backup": ({
            "id": backup.get("id"),
            "version": backup.get("version"),
            "createdAt": backup.get("createdAt"),
        } if backup else None),
        "checkedAt": now_iso(),
        "repo": REPO,
    }
    with _CACHE_LOCK:
        _CHECK_CACHE[cache_key] = {"at": time.time(), "data": json.loads(json.dumps(result))}
    return result


def _backup_ignore(_folder, names):
    ignored = set()
    for name in names:
        if name in (".git", "__pycache__", ".DS_Store", "bridge-state.json",
                    "providers.json", "providers.local.json", "build"):
            ignored.add(name)
        elif name.endswith(".pyc"):
            ignored.add(name)
    return ignored


def create_backup(root, backup_dir=None, version="", mode="auto",
                  git_commit="", target_version=""):
    folder = Path(backup_dir or BACKUP_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    backup_id = time.strftime("%Y%m%d-%H%M%S", time.gmtime()) + "-" + secrets.token_hex(2)
    dest = folder / backup_id
    app_dest = dest / "app"
    shutil.copytree(root, app_dest, ignore=_backup_ignore)
    meta = {
        "id": backup_id,
        "version": version or read_version(root),
        "createdAt": now_iso(),
        "createdAtTs": time.time(),
        "mode": mode,
        "gitCommit": git_commit,
        "targetVersion": target_version,
    }
    (dest / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    return {"id": backup_id, "path": str(dest), "version": meta["version"]}


def prune_backups(backup_dir=None, keep=KEEP_BACKUPS):
    rows = list_backups(backup_dir)
    for row in rows[keep:]:
        shutil.rmtree(row["path"], ignore_errors=True)


def _merge_copy(source, destination):
    source = Path(source)
    destination = Path(destination)
    for item in source.iterdir():
        if item.name in (".git", "__pycache__", ".DS_Store", "bridge-state.json",
                         "providers.json", "providers.local.json"):
            continue
        target = destination / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True, ignore=_backup_ignore)
        elif item.is_file():
            shutil.copy2(item, target)
    for name in ("start.sh", "update.sh"):
        path = destination / name
        if path.exists():
            try:
                path.chmod(path.stat().st_mode | 0o111)
            except OSError:
                pass


def _restore_backup(backup_path, root):
    source = Path(backup_path) / "app"
    if not source.exists():
        raise UpdateError("backup is incomplete: %s" % backup_path, "bad_backup", 500)
    _merge_copy(source, root)


def _py_compile(path, root):
    try:
        result = subprocess.run(
            [sys.executable, "-I", "-m", "py_compile", str(path)],
            cwd=str(root), capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise UpdateError("could not validate %s: %s" % (path.name, exc),
                          "verify_failed", 500)
    if result.returncode != 0:
        raise UpdateError(
            "updated %s does not compile: %s" % (path.name, (result.stderr or "").strip()[:300]),
            "verify_failed", 500,
        )


def verify_app(root, expected_version, require_updater=True):
    root = Path(root)
    version = read_version(root)
    if version != expected_version:
        raise UpdateError(
            "version mismatch after update: expected %s, got %s"
            % (expected_version, version or "missing"),
            "verify_failed", 500,
        )
    required = UPDATE_REQUIRED if require_updater else REQUIRED
    missing = [name for name in required if not (root / name).exists()]
    if missing:
        raise UpdateError("updated app is missing: " + ", ".join(missing),
                          "verify_failed", 500)
    for name in ("bridge.py", "updater.py"):
        if (root / name).exists():
            _py_compile(root / name, root)


def _safe_extract_tar(archive, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    members = []
    try:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar:
                name = member.name.replace("\\", "/")
                if not name or name in (".", "./"):
                    continue
                parts = [part for part in name.split("/") if part not in ("", ".")]
                if not parts or ".." in parts:
                    raise UpdateError("unsafe archive path: %s" % member.name,
                                      "bad_archive", 502)
                if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                    raise UpdateError("archive contains a link/device: %s" % member.name,
                                      "bad_archive", 502)
                if not (member.isfile() or member.isdir()):
                    continue
                if len(members) > 20000:
                    raise UpdateError("archive has too many entries", "bad_archive", 502)
                total += max(0, int(member.size or 0))
                if total > MAX_UNPACKED:
                    raise UpdateError("archive is too large when unpacked", "bad_archive", 502)
                target = (destination / name).resolve()
                try:
                    target.relative_to(destination.resolve())
                except ValueError:
                    raise UpdateError("unsafe archive path: %s" % member.name,
                                      "bad_archive", 502)
                members.append(member)
            tar.extractall(destination, members=members)
    except tarfile.TarError as exc:
        raise UpdateError("could not read update archive: %s" % exc, "bad_archive", 502)
    return destination


def _safe_extract_zip(archive, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    infos = []
    try:
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if not name or name in (".", "./"):
                    continue
                parts = [part for part in name.split("/") if part not in ("", ".")]
                if not parts or ".." in parts:
                    raise UpdateError("unsafe archive path: %s" % info.filename,
                                      "bad_archive", 502)
                mode = (info.external_attr >> 16) & 0o170000
                if mode == 0o120000:
                    raise UpdateError("archive contains a symlink: %s" % info.filename,
                                      "bad_archive", 502)
                if info.is_dir():
                    infos.append(info)
                    continue
                if info.flag_bits & 0x1:
                    raise UpdateError("encrypted archives are not supported",
                                      "bad_archive", 502)
                if len(infos) > 20000:
                    raise UpdateError("archive has too many entries", "bad_archive", 502)
                total += max(0, int(info.file_size or 0))
                if total > MAX_UNPACKED:
                    raise UpdateError("archive is too large when unpacked", "bad_archive", 502)
                target = (destination / name).resolve()
                try:
                    target.relative_to(destination.resolve())
                except ValueError:
                    raise UpdateError("unsafe archive path: %s" % info.filename,
                                      "bad_archive", 502)
                infos.append(info)
            zf.extractall(destination, members=infos)
    except zipfile.BadZipFile as exc:
        raise UpdateError("could not read update zip: %s" % exc, "bad_archive", 502)
    return destination


def _safe_extract(archive, destination):
    if str(archive).lower().endswith(".zip"):
        return _safe_extract_zip(archive, destination)
    return _safe_extract_tar(archive, destination)


def _archive_root(extracted):
    extracted = Path(extracted)
    children = [item for item in extracted.iterdir() if item.name != "__MACOSX"]
    roots = [item for item in children if item.is_dir() and (item / "VERSION").exists()]
    if len(roots) == 1:
        return roots[0]
    if (extracted / "VERSION").exists():
        return extracted
    raise UpdateError("archive does not contain an Agent Office app", "bad_archive", 502)


def _download(url, destination):
    if not _url_allowed(url):
        raise UpdateError("update download must use HTTPS", "bad_source", 400)
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if response.status != 200:
                raise UpdateError("download returned HTTP %s" % response.status,
                                  "network", 502)
            length = int(response.headers.get("Content-Length") or 0)
            if length > MAX_ARCHIVE:
                raise UpdateError("update archive is too large", "bad_archive", 502)
            written = 0
            with open(destination, "wb") as handle:
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_ARCHIVE:
                        raise UpdateError("update archive is too large", "bad_archive", 502)
                    handle.write(chunk)
    except urllib.error.HTTPError as exc:
        raise UpdateError("download failed: HTTP %s" % exc.code, "network", 502)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpdateError("download failed: %s" % exc, "network", 502)


@contextlib.contextmanager
def _update_lock(state_dir=None):
    folder = Path(state_dir or STATE_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    lock_path = folder / "update.lock"
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            age = time.time() - lock_path.stat().st_mtime
        except OSError:
            age = 0
        if age < 30 * 60:
            raise UpdateError("another update is already running", "update_busy", 409)
        try:
            lock_path.unlink()
        except OSError:
            pass
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise UpdateError("another update is already running", "update_busy", 409)
    try:
        os.write(fd, json.dumps({"pid": os.getpid(), "at": now_iso()}).encode("utf-8"))
        os.close(fd)
        yield
    finally:
        try:
            lock_path.unlink()
        except OSError:
            pass


def record_last_update(data, state_dir=None):
    folder = Path(state_dir or STATE_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    payload = dict(data)
    payload.setdefault("at", now_iso())
    path = folder / "last-update.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    tmp.replace(path)


def last_update(state_dir=None):
    path = Path(state_dir or STATE_DIR) / "last-update.json"
    try:
        data = json.loads(path.read_text("utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _progress(callback, stage, percent, message):
    if not callback:
        return
    try:
        callback(stage, percent, message)
    except Exception:
        pass


def _git_apply(root, target, backup, progress):
    state = _git_state(root)
    if state["dirty"]:
        raise UpdateError("git checkout has local changes; commit or stash them first",
                          "git_dirty", 409)
    if not state["branch"] or state["branch"] == "HEAD":
        raise UpdateError("git checkout is detached; check out a branch first",
                          "git_detached", 409)
    _progress(progress, "fetching", 35, "fetching origin")
    result = _git(root, "fetch", "--tags", "--prune", "origin", timeout=90)
    if result.returncode != 0:
        raise UpdateError("git fetch failed: %s" % (result.stderr or result.stdout).strip()[:400],
                          "git_failed", 502)
    _progress(progress, "writing", 70, "fast-forwarding %s" % state["branch"])
    result = _git(root, "pull", "--ff-only", "origin", state["branch"], timeout=90)
    if result.returncode != 0:
        raise UpdateError("git pull failed: %s" % (result.stderr or result.stdout).strip()[:400],
                          "git_failed", 502)
    _progress(progress, "verifying", 90, "verifying updated app")
    verify_app(root, target)


def _archive_apply(root, target, release, archive_path, progress):
    temp_dir = tempfile.mkdtemp(prefix="agent-office-update-")
    try:
        archive = Path(archive_path) if archive_path else Path(temp_dir) / "release.tar.gz"
        if not archive_path:
            _progress(progress, "fetching", 35, "downloading release")
            _download(release["tarballUrl"], archive)
        _progress(progress, "extracting", 55, "extracting release")
        stage = _safe_extract(archive, Path(temp_dir) / "extract")
        source = _archive_root(stage)
        _progress(progress, "verifying", 65, "validating release")
        verify_app(source, target)
        _progress(progress, "writing", 75, "writing application files")
        _merge_copy(source, root)
        _progress(progress, "verifying", 90, "verifying installed files")
        verify_app(root, target)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def apply_update(target_version=None, release=None, app_root=None, backup_dir=None,
                 archive_path=None, progress=None, mode=None, state_dir=None):
    root = Path(app_root or APP_ROOT)
    status = check_for_update(app_root=root, release=release, force=True,
                              mode=mode, backup_dir=backup_dir)
    if not status["updateAvailable"]:
        raise UpdateError("Agent Office is already up to date", "no_update", 409)
    target = str(target_version or status["latestVersion"]).lstrip("v")
    if target != status["latestVersion"]:
        raise UpdateError("requested version is not the latest release",
                          "bad_version", 409)
    deployment = status["deployment"]
    if not deployment["canApply"]:
        messages = {
            "git_dirty": "git checkout has local changes; commit or stash them first",
            "git_detached": "git checkout is detached; check out a branch first",
            "git_error": "git repository is not readable: " + (deployment.get("gitError") or ""),
            "read_only": "application directory is not writable",
        }
        raise UpdateError(messages.get(deployment["reason"], "update is not available"),
                          deployment["reason"] or "blocked", 409)

    current = status["currentVersion"]
    git_commit = ""
    if deployment["mode"] == "git":
        result = _git(root, "rev-parse", "HEAD")
        git_commit = result.stdout.strip() if result.returncode == 0 else ""

    with _update_lock(state_dir):
        _progress(progress, "backup", 10, "backing up %s" % current)
        backup = create_backup(
            root, backup_dir=backup_dir, version=current,
            mode=deployment["mode"], git_commit=git_commit,
            target_version=target,
        )
        modified = False
        try:
            if deployment["mode"] == "git":
                modified = True
                _git_apply(root, target, backup, progress)
            else:
                modified = True
                _archive_apply(root, target, status["release"], archive_path, progress)
            _progress(progress, "done", 100, "update installed")
            prune_backups(backup_dir)
            record_last_update({
                "status": "updated",
                "action": "update",
                "fromVersion": current,
                "toVersion": target,
                "mode": deployment["mode"],
                "backupId": backup["id"],
                "message": "updated %s → %s" % (current, target),
            }, state_dir=state_dir)
            return {
                "ok": True,
                "fromVersion": current,
                "toVersion": target,
                "mode": deployment["mode"],
                "backupId": backup["id"],
                "restartRequired": True,
            }
        except Exception:
            if modified:
                if git_commit and (root / ".git").exists():
                    _git(root, "reset", "--hard", git_commit, timeout=60)
                _restore_backup(backup["path"], root)
                _progress(progress, "rolled_back", 100, "update failed; rolled back")
            raise


def apply_archive(archive_path, app_root=None, backup_dir=None, progress=None,
                  state_dir=None, allow_same=False):
    """Install a user-supplied release archive without contacting GitHub."""
    root = Path(app_root or APP_ROOT)
    archive = Path(archive_path)
    if not archive.exists():
        raise UpdateError("update archive does not exist", "missing_archive", 404)
    if archive.stat().st_size > MAX_ARCHIVE:
        raise UpdateError("update archive is too large", "bad_archive", 413)
    current = read_version(root)
    temp_dir = tempfile.mkdtemp(prefix="agent-office-manual-")
    try:
        with _update_lock(state_dir):
            _progress(progress, "extracting", 15, "extracting manual archive")
            stage = _safe_extract(archive, Path(temp_dir) / "extract")
            source = _archive_root(stage)
            target = read_version(source)
            if not parse_version(target):
                raise UpdateError("archive has an invalid VERSION", "bad_release", 400)
            comparison = compare_versions(target, current)
            if comparison < 0 or (comparison == 0 and not allow_same):
                raise UpdateError(
                    "archive version %s is not newer than the running %s"
                    % (target, current), "not_newer", 409)
            _progress(progress, "verifying", 35, "validating archive files")
            verify_app(source, target)
            _progress(progress, "backup", 50, "backing up %s" % current)
            backup = create_backup(
                root, backup_dir=backup_dir, version=current,
                mode="manual", target_version=target,
            )
            modified = False
            try:
                modified = True
                _progress(progress, "writing", 70, "writing application files")
                _merge_copy(source, root)
                _progress(progress, "verifying", 90, "verifying installed files")
                verify_app(root, target)
                _progress(progress, "done", 100, "manual update installed")
                prune_backups(backup_dir)
                record_last_update({
                    "status": "updated",
                    "action": "manual",
                    "fromVersion": current,
                    "toVersion": target,
                    "mode": "manual",
                    "backupId": backup["id"],
                    "message": "manual update %s → %s" % (current, target),
                }, state_dir=state_dir)
                return {
                    "ok": True,
                    "fromVersion": current,
                    "toVersion": target,
                    "mode": "manual",
                    "backupId": backup["id"],
                    "restartRequired": True,
                }
            except Exception:
                if modified:
                    _restore_backup(backup["path"], root)
                    _progress(progress, "rolled_back", 100,
                              "manual update failed; rolled back")
                raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def rollback_last(app_root=None, backup_dir=None, progress=None, state_dir=None):
    root = Path(app_root or APP_ROOT)
    current = read_version(root)
    backup = rollback_candidate(backup_dir, current)
    if not backup:
        raise UpdateError("no previous-version backup is available", "no_backup", 404)
    with _update_lock(state_dir):
        _progress(progress, "rollback", 20, "restoring %s" % backup["version"])
        git_commit = str(backup.get("gitCommit") or "")
        if git_commit and (root / ".git").exists():
            result = _git(root, "reset", "--hard", git_commit, timeout=60)
            if result.returncode != 0:
                raise UpdateError("git rollback failed: %s" % (result.stderr or "").strip()[:300],
                                  "rollback_failed", 500)
        _restore_backup(backup["path"], root)
        verify_app(root, str(backup["version"]), require_updater=False)
        _progress(progress, "done", 100, "rollback installed")
        record_last_update({
            "status": "rolled_back",
            "action": "rollback",
            "fromVersion": current,
            "toVersion": str(backup["version"]),
            "backupId": backup["id"],
            "message": "rolled back %s → %s" % (current, backup["version"]),
        }, state_dir=state_dir)
        return {
            "ok": True,
            "fromVersion": current,
            "toVersion": str(backup["version"]),
            "backupId": backup["id"],
            "restartRequired": True,
        }


def _print_status(status):
    print("Agent Office updater")
    print("  current: %s" % status["currentVersion"])
    print("  latest:  %s" % status["latestVersion"])
    print("  update:  %s" % ("available" if status["updateAvailable"] else "not needed"))
    print("  mode:    %s" % status["deployment"]["mode"])
    if not status["deployment"]["canApply"]:
        print("  blocked: %s" % status["deployment"]["reason"])
    if status.get("backup"):
        print("  backup:  %s (%s)" % (status["backup"]["version"], status["backup"]["createdAt"]))
    if status.get("release", {}).get("url"):
        print("  release: %s" % status["release"]["url"])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Agent Office self-updater")
    parser.add_argument("--check", action="store_true", help="check for a new release")
    parser.add_argument("--apply", action="store_true", help="install the latest release")
    parser.add_argument("--manual", metavar="ARCHIVE",
                        help="install a local .tar.gz/.tgz/.zip release archive")
    parser.add_argument("--rollback", action="store_true", help="restore the latest backup")
    parser.add_argument("--status", action="store_true", help="show last update and backups")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    args = parser.parse_args(argv)

    try:
        if args.status:
            payload = {
                "last": last_update(),
                "backups": [{k: row.get(k) for k in ("id", "version", "createdAt", "targetVersion")}
                            for row in list_backups()],
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        if args.manual:
            if args.apply or args.rollback:
                print("Choose only one of --apply, --manual or --rollback.", file=sys.stderr)
                return 2
            archive = Path(args.manual).expanduser()
            if not archive.exists():
                print("Archive not found: %s" % archive, file=sys.stderr)
                return 2
            if not args.yes:
                answer = input("Install %s? [y/N] " % archive.name).strip().lower()
                if answer not in ("y", "yes"):
                    print("Cancelled.")
                    return 1
            result = apply_archive(archive)
            print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
                  "Installed %s → %s. Restart Agent Office to use it." % (
                      result["fromVersion"], result["toVersion"]))
            return 0
        if args.rollback:
            backup = rollback_candidate()
            if not backup:
                print("No previous-version backup is available.", file=sys.stderr)
                return 2
            if not args.yes:
                answer = input("Roll back to %s? [y/N] " % backup["version"]).strip().lower()
                if answer not in ("y", "yes"):
                    print("Cancelled.")
                    return 1
            result = rollback_last()
            print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
                  "Rolled back to %s. Restart Agent Office to use it." % result["toVersion"])
            return 0

        status = check_for_update(force=True)
        if not args.apply:
            if args.json:
                print(json.dumps(status, ensure_ascii=False, indent=2))
            else:
                _print_status(status)
            return 0
        if not status["updateAvailable"]:
            print("Already up to date (%s)." % status["currentVersion"])
            return 0
        if not status["deployment"]["canApply"]:
            print("Update blocked: %s" % status["deployment"]["reason"], file=sys.stderr)
            return 2
        if not args.yes:
            answer = input("Update %s → %s? [y/N] " % (
                status["currentVersion"], status["latestVersion"])).strip().lower()
            if answer not in ("y", "yes"):
                print("Cancelled.")
                return 1
        result = apply_update(target_version=status["latestVersion"])
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
              "Updated %s → %s. Restart Agent Office to use it." % (
                  result["fromVersion"], result["toVersion"]))
        return 0
    except UpdateError as exc:
        print("Update error [%s]: %s" % (exc.code, exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Cancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
