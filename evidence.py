#!/usr/bin/env python3
"""Tamper-evident evidence receipts for task reports.

What this proves
----------------
* The local bridge observed a specific report and artifact hash set at a
  specific time.
* The receipt has not been silently changed since then: it is signed with an
  HMAC key that never leaves the local bridge state directory.
* Receipts form a hash chain, so deleting, reordering or truncating entries is
  detectable.

What this does not prove
------------------------
* That an external agent's identity is real. The MCP ``X-Agent-Id`` header is
  self-declared; receipts explicitly record that basis instead of pretending
  it is cryptographic identity.
* That the report's claims are true beyond the hashed files. A model can still
  write a plausible report about a file that does nothing.

The HMAC key is local-only. This is intentionally a local evidence layer, not
a certificate authority or a remote attestation service.
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import os
import secrets
import threading
from pathlib import Path

SCHEMA = "agent-office.evidence/1"
BUNDLE_SCHEMA = "agent-office.evidence.bundle/1"
VERIFY_SCHEMA = "agent-office.evidence.verify/1"
GENESIS = hashlib.sha256(b"agent-office.evidence.genesis.v1").hexdigest()
SIGNING_PREFIX = b"agent-office.evidence.v1:"
BODY_KEYS = (
    "schema", "receiptId", "seq", "missionId", "taskId", "taskTitle",
    "agentId", "agentName", "source", "status", "reportSummary",
    "reportHash", "evidence", "artifacts", "attestation", "issuedAt",
    "prevHash",
)


class EvidenceError(RuntimeError):
    pass


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))


def _sha256_text(text):
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write(path, text, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp-" + secrets.token_hex(4))
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(tmp, mode)
    except OSError as exc:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise EvidenceError("cannot set evidence file permissions: " + str(exc))
    os.replace(tmp, path)
    try:
        directory = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError:
        pass


def artifact_digest(artifact):
    """Return (source, size, sha256) for a stored artifact.

    Prefer the actual file bytes. Fall back to extracted text only when the
    file is missing, and mark that explicitly so verification can explain it.
    """
    if not isinstance(artifact, dict):
        return "missing", 0, ""
    raw_path = str(artifact.get("path") or "")
    if raw_path:
        path = Path(raw_path)
        try:
            if path.is_file():
                return "file", int(path.stat().st_size), _sha256_file(path)
        except OSError:
            pass
    text = str(artifact.get("extractedText") or "")
    if text:
        encoded = text.encode("utf-8")
        return "text", len(encoded), hashlib.sha256(encoded).hexdigest()
    return "missing", 0, ""


class EvidenceLog:
    def __init__(self, path, key_path=None, anchor_path=None):
        self.path = Path(path)
        self.key_path = Path(key_path) if key_path else self.path.with_name("evidence.key")
        self.anchor_path = (Path(anchor_path) if anchor_path
                            else self.path.with_name("evidence.anchor"))
        self.lock = threading.RLock()
        self.key = self._load_key()
        self.key_id = hashlib.sha256(self.key).hexdigest()[:16]
        self.data = self._load()

    def _load_key(self):
        if self.key_path.exists():
            try:
                raw = self.key_path.read_text("utf-8").strip()
                key = bytes.fromhex(raw)
            except (OSError, ValueError) as exc:
                raise EvidenceError("cannot read evidence key: " + str(exc))
            if len(key) != 32:
                raise EvidenceError("evidence key must be 32 bytes")
            try:
                mode = self.key_path.stat().st_mode & 0o777
                if mode & 0o077:
                    os.chmod(self.key_path, 0o600)
            except OSError as exc:
                raise EvidenceError("cannot secure evidence key: " + str(exc))
            return key
        key = secrets.token_bytes(32)
        _atomic_write(self.key_path, key.hex(), 0o600)
        return key

    def _load(self):
        if not self.path.exists():
            return {
                "schema": SCHEMA,
                "seq": 0,
                "head": GENESIS,
                "receipts": [],
            }
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError) as exc:
            raise EvidenceError("cannot read evidence log: " + str(exc))
        if not isinstance(data, dict):
            raise EvidenceError("evidence log must be a JSON object")
        if data.get("schema") != SCHEMA:
            raise EvidenceError("unsupported evidence schema")
        receipts = data.get("receipts")
        if not isinstance(receipts, list):
            raise EvidenceError("evidence receipts must be a list")
        data.setdefault("seq", len(receipts))
        data.setdefault("head", GENESIS)
        try:
            mode = self.path.stat().st_mode & 0o777
            if mode & 0o077:
                os.chmod(self.path, 0o600)
        except OSError:
            pass
        return data

    def _save(self):
        _atomic_write(self.path, json.dumps(self.data, ensure_ascii=False,
                                            indent=2, sort_keys=True), 0o600)
        _atomic_write(self.anchor_path, json.dumps({
            "schema": "agent-office.evidence.anchor/1",
            "seq": int(self.data.get("seq") or 0),
            "head": str(self.data.get("head") or GENESIS),
            "keyId": self.key_id,
            "updatedAt": _now(),
        }, ensure_ascii=False, sort_keys=True), 0o600)

    def _load_anchor(self):
        if not self.anchor_path.exists():
            return None
        try:
            data = json.loads(self.anchor_path.read_text("utf-8"))
        except (OSError, ValueError) as exc:
            raise EvidenceError("cannot read evidence anchor: " + str(exc))
        if not isinstance(data, dict):
            raise EvidenceError("evidence anchor must be an object")
        return data

    def _body(self, receipt):
        return {key: receipt.get(key) for key in BODY_KEYS}

    def _artifact_rows(self, artifacts):
        rows = []
        for artifact in artifacts or []:
            if not isinstance(artifact, dict):
                continue
            source, size, digest = artifact_digest(artifact)
            rows.append({
                "id": str(artifact.get("id") or ""),
                "name": str(artifact.get("name") or ""),
                "size": int(size or 0),
                "sha256": digest,
                "source": source,
            })
        rows.sort(key=lambda row: (row["id"], row["name"]))
        return rows

    def issue(self, mission_id, task_id, report, artifacts, agent_id="",
              agent_name="", source="unknown", status="review",
              identity_basis="unknown", identity_verified=False,
              task_title=""):
        with self.lock:
            self.data = self._load()
            seq = int(self.data.get("seq") or 0) + 1
            prev = str(self.data.get("head") or GENESIS)
            evidence = [str(item)[:2000] for item in (report or {}).get("evidence") or []
                        if str(item).strip()][:30]
            body = {
                "schema": SCHEMA,
                "receiptId": "ev-" + secrets.token_hex(8),
                "seq": seq,
                "missionId": str(mission_id or ""),
                "taskId": str(task_id or ""),
                "taskTitle": str(task_title or "")[:200],
                "agentId": str(agent_id or ""),
                "agentName": str(agent_name or "")[:200],
                "source": str(source or "unknown"),
                "status": str(status or "review"),
                "reportSummary": str((report or {}).get("summary") or "")[:2000],
                "reportHash": _sha256_text(canonical(report or {})),
                "evidence": evidence,
                "artifacts": self._artifact_rows(artifacts),
                "attestation": {
                    "signer": "bridge-local-hmac",
                    "identityBasis": str(identity_basis or "unknown"),
                    "identityVerified": bool(identity_verified),
                },
                "issuedAt": _now(),
                "prevHash": prev,
            }
            payload_hash = _sha256_text(canonical(body))
            signature = hmac.new(
                self.key, SIGNING_PREFIX + payload_hash.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            receipt = dict(body)
            receipt["payloadHash"] = payload_hash
            receipt["signature"] = signature
            receipt["keyId"] = self.key_id
            self.data.setdefault("receipts", []).append(receipt)
            self.data["seq"] = seq
            self.data["head"] = payload_hash
            self._save()
            return receipt

    def list(self, mission_id="", task_id="", limit=200):
        with self.lock:
            rows = [
                dict(receipt) for receipt in self.data.get("receipts", [])
                if (not mission_id or receipt.get("missionId") == mission_id)
                and (not task_id or receipt.get("taskId") == task_id)
            ]
        return rows[-max(1, int(limit or 200)):]

    def verify(self, mission_id="", tasks=None, artifacts_by_id=None):
        """Verify the signature chain and optionally current report/artifacts.

        ``tasks`` maps taskId -> task and ``artifacts_by_id`` maps artifact id
        -> artifact. When they are omitted only the local receipt chain is
        checked; the result is marked unverified for report/file freshness.
        """
        with self.lock:
            self.data = self._load()
            receipts = list(self.data.get("receipts", []))
        issues = []
        expected_prev = GENESIS
        expected_seq = 1
        chain_failed = False
        verified_receipts = []
        task_map = tasks if isinstance(tasks, dict) else None
        artifact_map = artifacts_by_id if isinstance(artifacts_by_id, dict) else None
        for receipt in receipts:
            checks = {
                "payload": "passed",
                "signature": "passed",
                "chain": "passed",
                "report": "unknown",
                "artifacts": "unknown",
            }
            body = self._body(receipt)
            computed = _sha256_text(canonical(body))
            if receipt.get("payloadHash") != computed:
                checks["payload"] = "failed"
                issues.append("receipt %s payload hash mismatch" % receipt.get("receiptId"))
            signature = hmac.new(
                self.key, SIGNING_PREFIX + computed.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(str(receipt.get("signature") or ""), signature):
                checks["signature"] = "failed"
                issues.append("receipt %s signature mismatch" % receipt.get("receiptId"))
            if int(receipt.get("seq") or 0) != expected_seq:
                checks["chain"] = "failed"
                chain_failed = True
                issues.append("receipt %s sequence mismatch" % receipt.get("receiptId"))
            if str(receipt.get("prevHash") or "") != expected_prev:
                checks["chain"] = "failed"
                chain_failed = True
                issues.append("receipt %s chain mismatch" % receipt.get("receiptId"))
            if receipt.get("keyId") != self.key_id:
                checks["signature"] = "failed"
                issues.append("receipt %s key id mismatch" % receipt.get("receiptId"))
            expected_prev = str(receipt.get("payloadHash") or computed)
            expected_seq += 1
            task_id = str(receipt.get("taskId") or "")
            if task_map is not None:
                task = task_map.get(task_id)
                if not task or not isinstance(task.get("report"), dict):
                    checks["report"] = "missing"
                else:
                    current_hash = _sha256_text(canonical(task.get("report") or {}))
                    checks["report"] = "passed" if current_hash == receipt.get("reportHash") else "changed"
            if artifact_map is not None:
                artifact_status = "passed"
                for artifact_row in receipt.get("artifacts") or []:
                    artifact_id = str(artifact_row.get("id") or "")
                    current = artifact_map.get(artifact_id)
                    if not current:
                        artifact_status = "missing"
                        break
                    source, size, digest = artifact_digest(current)
                    if (int(size or 0) != int(artifact_row.get("size") or 0) or
                            str(digest or "") != str(artifact_row.get("sha256") or "")):
                        artifact_status = "changed"
                        break
                checks["artifacts"] = artifact_status
            if (checks["payload"] == "failed" or checks["signature"] == "failed" or
                    checks["chain"] == "failed"):
                status = "tampered"
            elif checks["report"] in ("changed", "missing") or checks["artifacts"] in ("changed", "missing"):
                status = "changed"
            elif checks["report"] == "unknown" or checks["artifacts"] == "unknown":
                status = "unverified"
            else:
                status = "valid"
            row = dict(receipt)
            row["checks"] = checks
            row["verification"] = status
            if not mission_id or receipt.get("missionId") == mission_id:
                verified_receipts.append(row)
        head = str(self.data.get("head") or "")
        if head != expected_prev:
            chain_failed = True
            issues.append("evidence log head mismatch")
        anchor_status = "missing"
        try:
            anchor = self._load_anchor()
        except EvidenceError as exc:
            anchor = None
            anchor_status = "invalid"
            chain_failed = True
            issues.append(str(exc))
        if anchor:
            anchor_status = "passed"
            if str(anchor.get("keyId") or "") != self.key_id:
                anchor_status = "failed"
                chain_failed = True
                issues.append("evidence anchor key id mismatch")
            try:
                anchor_seq = int(anchor.get("seq") or 0)
            except (TypeError, ValueError):
                anchor_seq = -1
            log_seq = int(self.data.get("seq") or 0)
            if (anchor_seq != log_seq or
                    (anchor_seq == log_seq and str(anchor.get("head") or "") != head)):
                anchor_status = "failed"
                chain_failed = True
                issues.append("evidence anchor mismatch (possible rollback)")
        filtered = verified_receipts if mission_id else verified_receipts
        statuses = {row["verification"] for row in filtered}
        if chain_failed or "tampered" in statuses:
            overall = "tampered"
        elif "changed" in statuses:
            overall = "changed"
        elif statuses and all(status == "valid" for status in statuses):
            overall = "unverified" if anchor_status == "missing" else "valid"
        elif statuses:
            overall = "unverified"
        else:
            overall = "empty"
        return {
            "schema": VERIFY_SCHEMA,
            "valid": overall == "valid",
            "status": overall,
            "receiptCount": len(filtered),
            "checkedAt": _now(),
            "keyId": self.key_id,
            "head": head,
            "anchor": anchor_status,
            "receipts": filtered,
            "issues": issues[:50],
        }

    def bundle(self, mission_id="", verification=None):
        return {
            "schema": BUNDLE_SCHEMA,
            "exportedAt": _now(),
            "keyId": self.key_id,
            "receipts": self.list(mission_id, limit=10000),
            "verification": verification or self.verify(mission_id),
        }
