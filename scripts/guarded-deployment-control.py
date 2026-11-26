"""Owned-process deployment primitives. Importing this module performs no actions.

No service-manager operations, signals, SQLite, backup restore, automatic retry or
restart. A real deployment caller must separately establish fresh admission and
provide independently collected OS observations; this module never invents them.
"""
from __future__ import annotations
import dataclasses
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import selectors
import stat
import subprocess
import time
import datetime
import ctypes
import sys
import re
from typing import Callable


class ControlError(RuntimeError):
    pass


def require(value, code):
    if not value:
        raise ControlError(code)


def canonical_file(path):
    p = Path(path)
    require(p.is_absolute() and str(p.resolve(strict=True)) == str(p), 'canonical_file_required')
    s = p.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'regular_single_link_file_required')
    return p, s


def digest(path):
    with open(path, 'rb') as handle:
        value = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()


class Journal:
    """Private append-only records; never contains environment values or nonces."""
    def __init__(self, directory):
        self.directory = Path(directory)
        require(self.directory.is_absolute(), 'absolute_journal_required')
        self.directory.mkdir(mode=0o700, exist_ok=False)
        self.sequence = 0
        self.previous = None

    def append(self, event, **fields):
        self.sequence += 1
        value = {'event': event, 'sequence': self.sequence, 'observedAt': time.time(),
                 'previousSha256': self.previous, 'productionExecutable': False, **fields}
        p = self.directory / f'{self.sequence:06d}-{event}.json'
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, sort_keys=True, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        self.previous = digest(p)
        return {'path': str(p), 'sha256': self.previous}


class DeploymentLease:
    def __init__(self, database_path, journal):
        self.database, s = canonical_file(database_path)
        self.identity = (s.st_dev, s.st_ino)
        require(s.st_uid == os.getuid(), 'work_database_owner_mismatch')
        self.journal = journal
        directory = self.database.parent / '.landi-control'
        directory.mkdir(mode=0o700, exist_ok=True)
        ds = directory.lstat()
        require(stat.S_ISDIR(ds.st_mode) and directory.resolve() == directory and
                ds.st_uid == os.getuid() and ds.st_mode & 0o077 == 0, 'private_lock_directory_required')
        # Stable key for the admitted canonical path. Atomic file replacement must
        # not create a second lock name; inode identity is checked separately.
        key = hashlib.sha256(str(self.database).encode()).hexdigest()
        self.path = directory / (key + '.lock')
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        self.released = False
        try:
            ls = os.fstat(self.fd)
            require(stat.S_ISREG(ls.st_mode) and ls.st_nlink == 1 and ls.st_uid == os.getuid()
                    and ls.st_mode & 0o077 == 0, 'private_lock_file_required')
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assert_identity()
        except BaseException:
            os.close(self.fd)
            raise
        self.journal.append('lease-acquired', databasePath=str(self.database), device=s.st_dev,
                            inode=s.st_ino, lockPath=str(self.path), advisoryOnly=True)

    def assert_identity(self):
        _, s = canonical_file(self.database)
        require((s.st_dev, s.st_ino) == self.identity, 'work_database_identity_changed')
        ls, ps = os.fstat(self.fd), self.path.lstat()
        require((ls.st_dev, ls.st_ino) == (ps.st_dev, ps.st_ino), 'lock_file_replaced')

    def release_verified(self, *, child_exited, listener_absent, file_users_absent, closed_receipt):
        require(child_exited and listener_absent and file_users_absent and closed_receipt,
                'release_evidence_unverified')
        self.assert_identity()
        self.journal.append('lease-released', closureVerified=True)
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)
        self.released = True

    def close_descriptor_without_unlock(self):
        """Crash-equivalent FD close; any inherited child FD retains the lock."""
        if not self.released:
            os.close(self.fd)
            self.released = True


@dataclasses.dataclass(frozen=True)
class LaunchSpec:
    executable: str
    executable_sha256: str
    release_root: str
    entry_sha256: str
    manifest_path: str
    manifest_sha256: str
    admission_path: str
    admission_sha256: str
    origin: str
    fixture: bool = False


class OwnedProcess:
    """Observers supply independent facts; no PID-only signalling is supported."""
    def __init__(self, lease: DeploymentLease, journal: Journal, observe_process: Callable,
                 observe_listener: Callable, observe_file_users: Callable):
        self.lease, self.journal = lease, journal
        self.observe_process = observe_process
        self.observe_listener = observe_listener
        self.observe_file_users = observe_file_users
        self.child = None
        self.owner = None
        self.buffer = b''
        self.failed = False
        self.close_requested = False
        self.observer = None
        self.prepared = None
        self.deployment_id = secrets.token_hex(16)
        self.nonce = secrets.token_hex(32)

    def _event(self, timeout):
        deadline = time.monotonic() + timeout
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'event_timeout_unverified')
            selector = selectors.DefaultSelector()
            try:
                selector.register(self.event_fd, selectors.EVENT_READ)
                require(bool(selector.select(remaining)), 'event_timeout_unverified')
            finally:
                selector.close()
            chunk = os.read(self.event_fd, 4097)
            require(bool(chunk), 'event_pipe_closed_unverified')
            self.buffer += chunk
            require(len(self.buffer) <= 4096, 'event_frame_too_large')
        line, self.buffer = self.buffer.split(b'\n', 1)
        try:
            message = json.loads(line)
        except (ValueError, UnicodeError):
            raise ControlError('event_frame_invalid') from None
        require(isinstance(message, dict) and message.get('version') == 1 and
                message.get('deploymentId') == self.deployment_id and
                message.get('nonce') == self.nonce, 'event_identity_mismatch')
        require(message.get('pid') == self.child.pid and message.get('parentPid') == os.getpid()
                and message.get('manifestSha256') == self.spec.manifest_sha256 and
                message.get('databasePath') == str(self.lease.database) and
                message.get('origin') == self.spec.origin, 'event_subject_mismatch')
        safe = {k: message[k] for k in ['pid', 'parentPid', 'manifestSha256', 'databasePath', 'origin']}
        safe['protocolEvent'] = message.get('event')
        self.journal.append('child-event', deploymentId=self.deployment_id, **safe)
        return message

    def launch(self, spec: LaunchSpec, timeout=10):
        require(self.child is None and not self.failed, 'launch_once_only')
        if not spec.fixture:
            require(self.prepared is not None and self.observer is not None and not self.observer.fixture,
                    'live_prepared_admission_required')
            pin, observed, manifest, fixture = self.prepared
            age = time.time() - datetime.datetime.fromisoformat(observed).timestamp()
            require(not fixture and 0 <= age <= 60 and manifest == spec.manifest_sha256 and
                    pin == {'path': spec.admission_path, 'sha256': spec.admission_sha256},
                    'prepared_admission_stale_or_conflicting')
        self.spec = spec
        self.lease.assert_identity()
        executable, _ = canonical_file(spec.executable)
        root = Path(spec.release_root)
        require(root.is_absolute() and root.resolve() == root and root.is_dir(), 'release_root_invalid')
        entry, _ = canonical_file(root / 'apps/server/lib/index.js')
        require(digest(executable) == spec.executable_sha256 and digest(entry) == spec.entry_sha256,
                'launch_artifact_mismatch')
        for path, expected in [(spec.manifest_path, spec.manifest_sha256),
                               (spec.admission_path, spec.admission_sha256)]:
            canonical_file(path)
            require(digest(path) == expected, 'launch_pin_mismatch')
        manifest = json.loads(Path(spec.manifest_path).read_text())
        admission = json.loads(Path(spec.admission_path).read_text())
        require(manifest.get('mode') == 'guarded-workbench' and manifest.get('projectRoot') == str(root)
                and manifest.get('databasePath') == str(self.lease.database) and
                manifest.get('origin') == spec.origin, 'launch_manifest_mismatch')
        require(admission.get('purpose') == 'post_stop_guarded_workbench' and
                admission.get('productionExecutable') is False and
                admission.get('automaticResume') is False and admission.get('restoreDatabase') is False,
                'launch_admission_invalid')
        # Full admission is still validated by the real guarded entry. Fictional
        # children are explicitly labelled; these observations are never deployable.
        command_r, command_w = os.pipe()
        event_r, event_w = os.pipe()
        env = {'PATH': os.defpath, 'LANG': 'C', 'LANDI_SERVER_MODE': 'guarded-workbench',
               'LANDI_GUARDED_ADMISSION_KIND': 'post-stop-preserved-copy',
               'LANDI_GUARDED_APP_ROOT': str(root), 'LANDI_GUARDED_DATABASE_PATH': str(self.lease.database),
               'LANDI_GUARDED_ENV_PATH': manifest['envPath'], 'LANDI_GUARDED_PORT': spec.origin.rsplit(':', 1)[1],
               'LANDI_GUARDED_MANIFEST_PATH': spec.manifest_path,
               'LANDI_GUARDED_MANIFEST_SHA256': spec.manifest_sha256,
               'LANDI_GUARDED_POST_STOP_EVIDENCE_PATH': spec.admission_path,
               'LANDI_GUARDED_POST_STOP_EVIDENCE_SHA256': spec.admission_sha256,
               'LANDI_DEPLOY_COMMAND_FD': str(command_r), 'LANDI_DEPLOY_EVENT_FD': str(event_w),
               'LANDI_DEPLOY_LOCK_FD': str(self.lease.fd), 'LANDI_DEPLOY_LOCK_PATH': str(self.lease.path),
               'LANDI_DEPLOY_PARENT_PID': str(os.getpid()), 'LANDI_DEPLOY_ID': self.deployment_id,
               'LANDI_DEPLOY_NONCE': self.nonce}
        output = self.journal.directory / 'child-output.log'
        output_fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            self.child = subprocess.Popen([str(executable), str(entry)], cwd=root, env=env,
                                          stdin=subprocess.DEVNULL, stdout=output_fd,
                                          stderr=subprocess.STDOUT,
                                          pass_fds=(command_r, event_w, self.lease.fd), close_fds=True)
        except BaseException:
            for fd in [command_r, command_w, event_r, event_w]:
                os.close(fd)
            raise
        finally:
            os.close(output_fd)
        os.close(command_r)
        os.close(event_w)
        self.command_fd, self.event_fd = command_w, event_r
        self.journal.append('spawned', deploymentId=self.deployment_id, childPid=self.child.pid,
                            controllerPid=os.getpid(), fixture=spec.fixture,
                            manifestSha256=spec.manifest_sha256, admissionSha256=spec.admission_sha256, outputPath=str(output))
        try:
            event = self._event(timeout)
            require(event.get('event') == 'ready', 'ready_receipt_missing')
            observed = self.observe_process(self.child.pid)
            require(isinstance(observed, dict) and observed.get('pid') == self.child.pid
                    and observed.get('parentPid') == os.getpid() and observed.get('uid') == os.getuid()
                    and observed.get('executable') == str(executable) and observed.get('startedAt'),
                    'os_owner_unverified')
            require(self.observe_listener(self.child.pid, spec.origin) is True, 'listener_owner_unverified')
            self.owner = dict(observed)
            self.journal.append('owner-verified', deploymentId=self.deployment_id, owner=self.owner,
                                manifestSha256=spec.manifest_sha256, origin=spec.origin,
                                databasePath=str(self.lease.database), fixture=spec.fixture)
        except BaseException as error:
            self.failed = True
            self.journal.append('launch-failed', reason=str(error), shutdown='unverified', automaticRetry=False)
            raise
        return dict(self.owner)

    def request_shutdown(self, timeout=30):
        require(self.child is not None and self.owner is not None and not self.failed
                and not self.close_requested, 'shutdown_once_owned_only')
        self.close_requested = True
        try:
            # Compare stable OS identity, not observation timestamps or changing
            # raw-record references. Reject before writing to the private pipe.
            observation = self.observe_process(self.child.pid)
            keys = ['pid', 'parentPid', 'uid', 'executable', 'startedAt']
            require(self.child.poll() is None and isinstance(observation, dict)
                    and all(observation.get(k) == self.owner.get(k) for k in keys),
                    'shutdown_owner_mismatch')
            self.lease.assert_identity()
            payload = {'version': 1, 'deploymentId': self.deployment_id, 'nonce': self.nonce, 'op': 'shutdown'}
            os.write(self.command_fd, (json.dumps(payload)+'\n').encode())
            event = self._event(timeout)
            require(event.get('event') == 'closed', 'owned_close_receipt_unverified')
            # Complete the handshake before waiting: the child's pipe reader may
            # otherwise still have a blocking read pending during process exit.
            os.close(self.command_fd)
            self.command_fd = None
            self.journal.append('command-pipe-closed', deploymentId=self.deployment_id,
                                afterValidClosedReceipt=True)
            try:
                code = self.child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                raise ControlError('child_exit_timeout_unverified') from None
            require(code == 0, 'child_exit_failed')
            require(self.observe_process(self.child.pid) is None, 'child_exit_unverified')
            require(self.observe_listener(None, self.spec.origin) is False, 'listener_release_unverified')
            require(self.observe_file_users(str(self.lease.database)) is False, 'file_users_unverified')
            os.close(self.event_fd)
            self.event_fd = None
            self.journal.append('closed-verified', deploymentId=self.deployment_id, exitCode=code,
                                completePreStopDrain='unverified', fixture=self.spec.fixture)
            self.lease.release_verified(child_exited=True, listener_absent=True,
                                        file_users_absent=True, closed_receipt=True)
        except BaseException as error:
            self.failed = True
            self.journal.append('shutdown-unverified', reason=str(error), automaticRetry=False,
                                forcedKill=False, automaticRestart=False)
            raise


class LocalKinfoCompatibility:
    """Explicitly pinned local SPI profile; never a portable public API claim."""
    INTERFACE = 'kern.proc_SPI_local_compatibility_not_stable_public_API'
    LAYOUT = {'pointerSize': 8, 'timevalSize': 16, 'externProcSize': 296,
              'eprocSize': 352, 'kinfoSize': 648, 'alignment': 8,
              'offsets': {'pid': 40, 'parentPid': 560, 'uid': 420, 'realUid': 392,
                          'startSeconds': 0, 'startMicroseconds': 8}}
    HEADER_NAMES = ('sys/proc.h', 'sys/sysctl.h', 'sys/vm.h', 'sys/types.h',
                    'sys/param.h', 'sys/_types/_timeval.h', 'sys/_types.h', 'sys/proc_info.h')

    def __init__(self, profile_pin, journal, reader=None, short_reader=None, host_probe=None):
        require(isinstance(profile_pin, dict) and set(profile_pin) == {'path', 'sha256'},
                'local_kinfo_profile_pin_unverified')
        self.profile_pin = dict(profile_pin)
        self.profile = read_pin(profile_pin)
        self.journal = journal
        self.reader = reader or self._read_kinfo
        self.short_reader = short_reader or self._read_short
        self.host_probe = host_probe or self._host_probe
        self.fixture = any(x is not None for x in (reader, short_reader, host_probe))
        self._system = self._libproc = None
        self.validate_context()

    @staticmethod
    def _host_probe(profile):
        uname = os.uname()
        platform = {'system': uname.sysname, 'release': uname.release,
                    'machine': uname.machine, 'byteorder': sys.byteorder}
        for pin in [*profile['headers'], profile['layoutEvidence']]:
            require(digest(canonical_file(pin['path'])[0]) == pin['sha256'],
                    'local_kinfo_source_digest_unverified')
        evidence = read_pin(profile['layoutEvidence'])
        require(evidence.get('layout') == profile['layout'] and
                evidence.get('SDKRoot') == profile['sdkRoot'] and
                evidence.get('headers') == profile['headers'] and
                {k: evidence.get('platform', {}).get(k) for k in platform} == platform,
                'local_kinfo_layout_origin_conflict_unverified')
        return {'platform': platform, 'layout': LocalKinfoCompatibility.LAYOUT,
                'pointerSize': ctypes.sizeof(ctypes.c_void_p), 'sourcesVerified': True}

    def validate_context(self):
        p = self.profile
        require(read_pin(self.profile_pin) == p and type(p.get('schemaVersion')) is int and p['schemaVersion'] == 1 and
                p.get('interface') == self.INTERFACE and p.get('productionExecutable') is False and
                json.dumps(p.get('layout'), sort_keys=True) == json.dumps(self.LAYOUT, sort_keys=True) and
                p.get('platform') == {'system': 'Darwin', 'release': '25.5.0',
                                      'machine': 'arm64', 'byteorder': 'little'},
                'local_kinfo_profile_unverified')
        root = p.get('sdkRoot')
        require(isinstance(root, str) and Path(root).is_absolute() and
                isinstance(p.get('headers'), list) and
                all(isinstance(x, dict) and set(x) == {'path', 'sha256'} and
                    isinstance(x['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', x['sha256'])
                    for x in p['headers']) and
                [x.get('path') for x in p['headers']] ==
                [str(Path(root)/'usr/include'/name) for name in self.HEADER_NAMES] and
                isinstance(p.get('layoutEvidence'), dict) and
                p.get('sources') == [
                    'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c',
                    'https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/sysctl.h'],
                'local_kinfo_sources_unverified')
        host = self.host_probe(p)
        require(host == {'platform': p['platform'], 'layout': self.LAYOUT,
                         'pointerSize': 8, 'sourcesVerified': True},
                'local_kinfo_host_unverified')

    def _read_kinfo(self, pid):
        if self._system is None:
            self._system = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
            self._system.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
            self._system.sysctl.restype = ctypes.c_int
        mib = (ctypes.c_int * 4)(1, 14, 1, pid)
        buffer = ctypes.create_string_buffer(648); size = ctypes.c_size_t(648)
        ctypes.set_errno(0)
        rc = self._system.sysctl(mib, 4, buffer, ctypes.byref(size), None, 0)
        return {'returncode': rc, 'errno': ctypes.get_errno(), 'size': size.value,
                'data': buffer.raw}

    def _read_short(self, pid):
        if self._libproc is None:
            self._libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            self._libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                                  ctypes.c_void_p, ctypes.c_int]
            self._libproc.proc_pidinfo.restype = ctypes.c_int
        buffer = ctypes.create_string_buffer(64); ctypes.set_errno(0)
        count = self._libproc.proc_pidinfo(pid, 13, 0, buffer, 64)
        require(count == 64 and ctypes.get_errno() == 0,
                'local_kinfo_short_identity_unverified')
        import struct
        return dict(pid=struct.unpack_from('<I', buffer, 0)[0],
                    parentPid=struct.unpack_from('<I', buffer, 4)[0],
                    uid=struct.unpack_from('<I', buffer, 36)[0],
                    realUid=struct.unpack_from('<I', buffer, 44)[0])

    def identity(self, pid):
        self.validate_context()
        r = self.reader(pid)
        require(isinstance(r, dict) and set(r) == {'returncode', 'errno', 'size', 'data'} and
                type(r['returncode']) is int and r['returncode'] == 0 and
                type(r['errno']) is int and r['errno'] == 0 and
                type(r['size']) is int and r['size'] == 648 and
                isinstance(r['data'], bytes) and len(r['data']) == 648,
                'local_kinfo_record_unverified')
        import struct
        fields = {key: struct.unpack_from(fmt, r['data'], self.LAYOUT['offsets'][key])[0]
                  for key, fmt in [('pid', '<i'), ('parentPid', '<i'), ('uid', '<I'),
                                   ('realUid', '<I'), ('startSeconds', '<q'),
                                   ('startMicroseconds', '<i')]}
        require(fields['pid'] == pid and pid > 0 and fields['parentPid'] >= 0 and
                fields['startSeconds'] > 0 and 0 <= fields['startMicroseconds'] < 1_000_000,
                'local_kinfo_identity_unverified')
        short = self.short_reader(pid)
        require(isinstance(short, dict) and set(short) == {'pid', 'parentPid', 'uid', 'realUid'} and
                all(type(v) is int for v in short.values()) and
                all(fields[k] == short[k] for k in short), 'local_kinfo_identity_conflict_unverified')
        self.journal.append('local-kinfo-SPI-identity', pid=pid, profile=self.profile_pin,
                            identity=fields, interface=self.INTERFACE, fixture=self.fixture,
                            productionExecutable=False)
        return fields


class OSObserver:
    """Bounded read-only Darwin commands. Unknown is an exception, never absence.

    The process scan and lsof visibility are the current user's OS view; permission
    errors invalidate observation. This does not prove pre-stop drainage.
    """
    def __init__(self, journal, runner=None, clock=time.time, path_resolver=None, kernel_reader=None,
                 kinfo_profile=None, kinfo_factory=None):
        self.journal, self.clock = journal, clock
        self.runner = runner or self._run
        self.records = []
        self.fixture = runner is not None or path_resolver is not None or kernel_reader is not None or kinfo_factory is not None
        self.path_resolver = path_resolver or self._resolve_executable
        self.kernel_reader = kernel_reader or self._kernel_query
        self._process_lib = None
        self.kinfo_profile, self.kinfo_factory = kinfo_profile, kinfo_factory
        self._kinfo_compat = None

    @staticmethod
    def _run(argv):
        return subprocess.run(argv, capture_output=True, text=True, timeout=5,
                              env={'PATH': os.defpath, 'LC_ALL': 'C'}, check=False)

    @staticmethod
    def _resolve_executable(path):
        canonical = Path(path).resolve(strict=True)
        info = canonical.stat()
        require(stat.S_ISREG(info.st_mode), 'executable_not_regular_unverified')
        return {'path': str(canonical), 'device': info.st_dev, 'inode': info.st_ino}

    def executable_identity(self, path):
        require(isinstance(path, str) and Path(path).is_absolute() and '\x00' not in path,
                'executable_path_unverified')
        try:
            identity = self.path_resolver(path)
        except (OSError, RuntimeError, ValueError) as error:
            raise ControlError('executable_resolution_unverified') from error
        require(isinstance(identity, dict) and set(identity) == {'path', 'device', 'inode'} and
                isinstance(identity['path'], str) and Path(identity['path']).is_absolute() and
                type(identity['device']) is int and identity['device'] >= 0 and
                type(identity['inode']) is int and identity['inode'] > 0,
                'executable_identity_unverified')
        return dict(identity)

    @staticmethod
    def disabled_declaration(text, label):
        target = r'"'+re.escape(label)+r'"\s*=>'
        declarations = [line for line in text.splitlines() if re.search(target, line)]
        require(len(declarations) == 1, 'disabled_state_unverified')
        match = re.fullmatch(r'\s*"'+re.escape(label)+r'"\s*=>\s*'
                             r'(true|false|disabled|enabled)\s*', declarations[0])
        require(match is not None, 'disabled_state_unverified')
        return match.group(1) in ('true', 'disabled')

    def query(self, argv):
        try:
            result = self.runner(argv)
            require(len(result.stdout) + len(result.stderr) <= 4_000_000,
                    'os_output_too_large_unverified')
        except BaseException as error:
            self.journal.append('os-query-unverified', command=argv, reason=type(error).__name__)
            raise ControlError('os_query_failed_unverified') from error
        self.records.append(self.journal.append('os-readonly-query', command=argv,
                            returncode=result.returncode, stdout=result.stdout,
                            stderr=result.stderr, fixture=self.fixture))
        return result

    def _kernel_query(self, operation, pid):
        require(sys.platform == 'darwin' and ctypes.sizeof(_ProcBSDInfo) == 136,
                'process_kernel_abi_unverified')
        if self._process_lib is None:
            lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                         ctypes.c_void_p, ctypes.c_int]
            lib.proc_pidinfo.restype = ctypes.c_int
            lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
            lib.proc_pidpath.restype = ctypes.c_int
            self._process_lib = lib
        if operation == 'identity':
            info = _ProcBSDInfo()
            ctypes.set_errno(0)
            count = self._process_lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
            error = ctypes.get_errno()
            if count == 0 and error == 1 and self.kinfo_profile is not None:
                if self._kinfo_compat is None:
                    factory = self.kinfo_factory or LocalKinfoCompatibility
                    self._kinfo_compat = factory(self.kinfo_profile, self.journal)
                require(self.fixture or not self._kinfo_compat.fixture,
                        'local_kinfo_fixture_forbidden')
                return self._kinfo_compat.identity(pid)
            require(count == ctypes.sizeof(info), 'process_kernel_identity_unverified')
            return dict(pid=info.pid, parentPid=info.ppid, uid=info.uid, realUid=info.ruid,
                        startSeconds=info.startsec, startMicroseconds=info.startusec)
        require(operation == 'path', 'process_kernel_operation_unverified')
        buffer = ctypes.create_string_buffer(4096)
        count = self._process_lib.proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
        require(0 < count < ctypes.sizeof(buffer) and bool(buffer.value) and
                count == len(buffer.value), 'process_kernel_path_unverified')
        return buffer.value.decode('utf-8', errors='strict')

    def kernel_query(self, operation, pid):
        try:
            value = self.kernel_reader(operation, pid)
            if operation == 'identity':
                keys = {'pid', 'parentPid', 'uid', 'realUid', 'startSeconds', 'startMicroseconds'}
                require(isinstance(value, dict) and set(value) == keys and
                        all(type(value[k]) is int for k in keys) and value['pid'] == pid and
                        value['parentPid'] >= 0 and value['uid'] >= 0 and value['realUid'] >= 0 and
                        value['startSeconds'] > 0 and 0 <= value['startMicroseconds'] < 1_000_000,
                        'process_kernel_identity_unverified')
                value = dict(value)
            else:
                require(isinstance(value, str) and Path(value).is_absolute() and
                        '\x00' not in value, 'process_kernel_path_unverified')
            self.records.append(self.journal.append('process-kernel-readonly', operation=operation,
                                pid=pid, value=value, fixture=self.fixture))
            return value
        except (OSError, RuntimeError, ValueError, AttributeError) as error:
            self.journal.append('process-kernel-unverified', operation=operation, pid=pid,
                                reason=type(error).__name__, fixture=self.fixture)
            raise ControlError('process_kernel_evidence_unverified') from error

    def processes(self):
        r = self.query(['/bin/ps', '-axo', 'pid=,ppid=,uid=,lstart=,comm='])
        require(r.returncode == 0 and not r.stderr and bool(r.stdout.strip()),
                'process_inventory_unverified')
        display = []
        for line in r.stdout.splitlines():
            v = line.split(None, 8)
            require(len(v) == 9 and all(x.isdecimal() for x in v[:3]) and int(v[0]) > 0,
                    'process_parse_unverified')
            display.append(dict(pid=int(v[0]), parentPid=int(v[1]), uid=int(v[2]),
                                startedAt=' '.join(v[3:8]), reportedCommand=v[8]))
        require(len({x['pid'] for x in display}) == len(display), 'process_conflict_unverified')
        rows = []
        for row in display:
            pid = row['pid']; before = self.kernel_query('identity', pid)
            require(before['uid'] == row['uid'] and before['parentPid'] == row['parentPid'],
                    'process_inventory_identity_conflict_unverified')
            path = self.kernel_query('path', pid); executable = self.executable_identity(path)
            next_path = self.kernel_query('path', pid)
            require(path == next_path and executable == self.executable_identity(next_path),
                    'process_kernel_executable_changed_unverified')
            after = self.kernel_query('identity', pid)
            require(before == after, 'process_kernel_identity_changed_unverified')
            rows.append({**row, 'executable': executable['path'], 'kernelPath': path,
                         'kernelIdentity': before, 'executableIdentity': executable})
        return rows

    def observe_process(self, pid):
        matches = [x for x in self.processes() if x['pid'] == pid]
        return matches[0] if matches else None

    def lsof(self, args):
        r = self.query(['/usr/sbin/lsof', '-nP', '-Fpcftn', *args])
        require(not r.stderr, 'lsof_visibility_unverified')
        if r.returncode == 1 and not r.stdout.strip():
            return []
        require(r.returncode == 0 and bool(r.stdout.strip()), 'lsof_result_unverified')
        records, current, pid = [], None, None
        for line in r.stdout.splitlines():
            require(bool(line), 'lsof_parse_unverified')
            k, value = line[0], line[1:]
            if k == 'p':
                require(value.isdecimal(), 'lsof_pid_unverified')
                pid = int(value); current = None
            elif k == 'f':
                require(pid is not None and bool(value), 'lsof_fd_unverified')
                current = {'pid': pid, 'fd': value}; records.append(current)
            elif k in ('t', 'n'):
                require(current is not None and k not in current, 'lsof_field_unverified')
                current[k] = value
            elif k != 'c':
                raise ControlError('lsof_unknown_field_unverified')
        require(records and all('n' in x for x in records), 'lsof_records_unverified')
        return records

    def observe_listener(self, pid, origin):
        require(re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', origin), 'origin_invalid')
        port = int(origin.rsplit(':', 1)[1]); require(0 < port < 65536, 'port_invalid')
        rows = self.lsof(['-iTCP:'+str(port), '-sTCP:LISTEN'])
        if pid is None:
            return bool(rows)
        require(rows and all(x['pid'] == pid and x['n'] == '127.0.0.1:'+str(port) for x in rows),
                'listener_owner_conflict_unverified')
        return True

    def observe_file_users(self, database):
        canonical_file(database)
        paths = [database+s for s in ('', '-wal', '-shm', '-journal') if Path(database+s).exists()]
        return bool(self.lsof(['--', *paths]))

    def exclusive(self, database, origin, old_pid, label, replacement_executables):
        require(isinstance(old_pid, int) and old_pid > 0 and
                re.fullmatch(r'[A-Za-z0-9_.-]+', label) and replacement_executables,
                'observation_subject_missing')
        bound = [(exe, self.executable_identity(exe)) for exe in replacement_executables]
        keys = {(identity['device'], identity['inode']) for _, identity in bound}
        canonical_paths = {identity['path'] for _, identity in bound}
        require(len(keys) == len(bound), 'replacement_identity_duplicate_unverified')
        began = self.clock(); first = len(self.records)
        for _ in range(2):
            require(all(self.executable_identity(exe) == identity for exe, identity in bound),
                    'replacement_identity_changed_unverified')
            rows = self.processes()
            normalized = []
            for row in rows:
                require(row['pid'] != old_pid, 'old_or_replacement_process_present_unverified')
                identity = self.executable_identity(row['executable'])
                require(identity['path'] not in canonical_paths or
                        (identity['device'], identity['inode']) in keys,
                        'executable_identity_conflict_unverified')
                if (identity['device'], identity['inode']) in keys:
                    self.journal.append('replacement-process-blocked', pid=row['pid'],
                                        reportedExecutable=row['executable'], identity=identity,
                                        fixture=self.fixture)
                    raise ControlError('old_or_replacement_process_present_unverified')
                normalized.append({'pid': row['pid'], 'reportedExecutable': row['executable'],
                                   'identity': identity})
            require(all(self.executable_identity(x['reportedExecutable']) == x['identity']
                        for x in normalized) and
                    all(self.executable_identity(exe) == identity for exe, identity in bound),
                    'executable_identity_changed_unverified')
            self.records.append(self.journal.append('executable-identities', configured=bound,
                                                   observed=normalized, fixture=self.fixture))
            target = f'gui/{os.getuid()}/{label}'
            r = self.query(['/bin/launchctl', 'print', target])
            require(r.returncode != 0 and not r.stdout.strip() and
                    re.search(r'Could not find service "'+re.escape(label)+r'" in domain', r.stderr),
                    'manager_absence_unverified')
            r = self.query(['/bin/launchctl', 'print-disabled', f'gui/{os.getuid()}'])
            require(r.returncode == 0 and not r.stderr, 'disabled_query_unverified')
            require(self.disabled_declaration(r.stdout, label), 'disabled_state_unverified')
            require(not self.observe_listener(None, origin), 'port_occupied_unverified')
            require(not self.observe_file_users(database), 'database_in_use_unverified')
        now = self.clock()
        require(0 <= now-began <= 15, 'observation_window_unverified')
        return {'observedAt': datetime.datetime.fromtimestamp(began, datetime.timezone.utc).isoformat(),
                'databasePath': database, 'oldPidAbsent': True, 'managerDefinitionAbsent': True,
                'disabledConfirmed': True, 'portReleased': True, 'replacementAbsent': True,
                'fileUsersAbsent': True, 'fixture': self.fixture,
                'scope': 'current_OS_visibility_not_pre_stop_drain',
                'records': self.records[first:]}


def read_pin(pin):
    path, info = canonical_file(pin['path'])
    require(info.st_size <= 4_000_000 and digest(path) == pin['sha256'], 'evidence_pin_unverified')
    return json.loads(path.read_text())


def prepare_admission(controller, spec, template_pin, subject, validator, *, fixture=False):
    """Prepare only under the controller's still-held lease; no child is launched.

    validator must invoke the existing Storage filesystem-only loader. A generated
    record alone is not a launch authorization. An explicit later launch still
    rechecks freshness and invokes the child's full guarded policy.
    """
    require(controller.child is None and not controller.failed, 'prepare_state_invalid')
    require(controller.observer is not None and controller.observer.fixture == fixture,
            'observer_provenance_unverified')
    controller.lease.assert_identity()
    try:
        if not fixture:
            require(getattr(validator, 'storage_pins', None) is not None,
                    'full_validator_provenance_missing')
            node_pin, loader_pin = validator.storage_pins
            require(node_pin == {'path': spec.executable, 'sha256': spec.executable_sha256},
                    'validator_runtime_conflict')
            manifest = read_pin({'path': spec.manifest_path, 'sha256': spec.manifest_sha256})
            require(manifest.get('projectRoot') == spec.release_root and
                    manifest.get('databasePath') == str(controller.lease.database) and
                    manifest.get('origin') == spec.origin and
                    manifest.get('mode') == 'guarded-workbench', 'manifest_subject_conflict')
            loader_relative = 'packages/storage/lib/post-stop-admission.js'
            require(loader_pin['path'] == str(Path(spec.release_root)/loader_relative) and
                    any(x.get('path') == loader_relative and x.get('sha256') == loader_pin['sha256']
                        for x in manifest.get('files', [])), 'validator_release_binding_missing')
        record = read_pin(template_pin)
        require(record.get('productionExecutable') is False and
                record.get('automaticResume') is False and record.get('restoreDatabase') is False,
                'unsafe_admission_template')
        require(record.get('working', {}).get('path') == str(controller.lease.database), 'work_binding_mismatch')
        require(record['working']['sha256'] == digest(controller.lease.database), 'work_digest_changed')
        for key in ('preStopDrained', 'gracefulExit', 'externalOperationOutcomes'):
            require(record.get(key) == 'unverified', 'historical_unknown_overstated')
        role = [x for x in ('candidate', 'rollback')
                if record.get(x, {}).get('artifactSha256') == spec.manifest_sha256]
        require(len(role) == 1 and record[role[0]]['origin'] == spec.origin, 'release_binding_unverified')
        observation = controller.observer.exclusive(str(controller.lease.database), spec.origin, **subject)
        ref = controller.journal.append('exclusive-observation', **observation)
        record['evidence']['currentObservation'] = ref
        pin = controller.journal.append('prepared-admission', **record)
        validator(str(controller.lease.database), pin)
        controller.lease.assert_identity()
        require(digest(controller.lease.database) == record['working']['sha256'], 'work_changed_during_prepare')
        controller.prepared = (pin, observation['observedAt'], spec.manifest_sha256, fixture)
        controller.journal.append('admission-validated', admission=pin, fixture=fixture,
                                  scope='same_live_controller_lease_only', serviceStarted=False)
        return dataclasses.replace(spec, admission_path=pin['path'], admission_sha256=pin['sha256'])
    except BaseException as error:
        controller.failed = True
        controller.journal.append('admission-unverified', reason=str(error), automaticRetry=False)
        raise


def storage_validator(node_pin, loader_pin):
    """No SQLite construction: call only the existing filesystem admission loader."""
    for pin in (node_pin, loader_pin):
        canonical_file(pin['path']); require(digest(pin['path']) == pin['sha256'], 'validator_pin_mismatch')
    def validate(database, pin):
        for resource in (node_pin, loader_pin):
            require(digest(resource['path']) == resource['sha256'], 'validator_changed')
        code = ("const m=await import(process.argv[1]);"
                "m.loadPostStopAdmission(process.argv[2],JSON.parse(process.argv[3]));")
        r = subprocess.run([node_pin['path'], '--input-type=module', '-e', code,
                            Path(loader_pin['path']).as_uri(), database, json.dumps(pin)],
                           capture_output=True, text=True, timeout=30,
                           env={'PATH': os.defpath, 'LC_ALL': 'C'}, check=False)
        require(r.returncode == 0, 'full_storage_admission_unverified')
    validate.storage_pins = (node_pin, loader_pin)
    return validate


def _resolve_session_kinfo(plan, journal, *, request=None):
    """Static pin/role consensus only. No OS, SDK, database, lease or process IO."""
    require(plan.get('productionExecutable') is False, 'session_kinfo_production_closed_required')
    if request is not None:
        require(request.get('productionExecutable') is False and
                request.get('runtimeBinding') == plan.get('runtimeBinding') and
                request.get('localKinfoCompatibility') == plan.get('localKinfoCompatibility'),
                'parent_session_kinfo_conflict_unverified')
    config = plan.get('localKinfoCompatibility')
    runtime = read_pin(plan['runtimeBinding']) if plan.get('runtimeBinding') is not None else {}
    if config is None:
        policy = runtime.get('localKinfoCompatibility')
        require(policy is None or policy.get('enabled') is False,
                'missing_session_kinfo_config_unverified')
        result = {'enabled': False, 'profile': None, 'status': 'unconfigured_unverified'}
        journal.append('session-local-kinfo-config', **result, productionExecutable=False)
        return result
    require(isinstance(config, dict) and set(config) ==
            {'profile', 'enabled', 'interface', 'sessionPlanConsumption'} and
            type(config['enabled']) is bool and config['interface'] == LocalKinfoCompatibility.INTERFACE and
            isinstance(config['sessionPlanConsumption'], str), 'session_kinfo_config_unverified')
    require(runtime.get('productionExecutable') is False, 'session_kinfo_runtime_unverified')
    spec = plan['spec']; root = Path(spec['release_root'])
    require(root.is_absolute() and root.resolve(strict=True) == root and root.is_dir(),
            'session_kinfo_release_root_unverified')
    own = plan['controller']
    require(own.get('path') == str(root/'scripts/guarded-deployment-control.py') and
            read_pin_bytes_equal(own), 'session_kinfo_controller_unverified')
    controllers = runtime.get('controllerDigests', {})
    roles = [role for role in ('candidate', 'controlled-baseline') if controllers.get(role) == own]
    require(len(roles) == 1, 'session_kinfo_role_unverified')
    role = roles[0]
    manifest_pin = {'path': spec['manifest_path'], 'sha256': spec['manifest_sha256']}
    manifest = read_pin(manifest_pin)
    require(manifest.get('mode') == 'guarded-workbench' and
            manifest.get('projectRoot') == str(root) and
            manifest.get('databasePath') == plan['databasePath'] and
            manifest.get('origin') == spec['origin'], 'session_kinfo_manifest_unverified')
    controller_entries = [x for x in manifest.get('files', [])
                          if x.get('path') == 'scripts/guarded-deployment-control.py']
    require(len(controller_entries) == 1 and controller_entries[0].get('sha256') == own['sha256'],
            'session_kinfo_manifest_controller_unverified')
    policy = runtime.get('localKinfoCompatibility', {})
    require(type(policy.get('enabled')) is bool and policy['enabled'] == config['enabled'] and
            policy.get('interface') == config['interface'] and
            policy.get('profiles', {}).get(role) == config['profile'],
            'session_kinfo_runtime_consensus_unverified')
    profile_pin = config['profile']; relative = 'docs/contracts/local-kinfo-profile.json'
    require(isinstance(profile_pin, dict) and set(profile_pin) == {'path', 'sha256'} and
            profile_pin['path'] == str(root/relative), 'session_kinfo_profile_role_unverified')
    entries = [x for x in manifest.get('files', []) if x.get('path') == relative]
    require(len(entries) == 1 and entries[0].get('sha256') == profile_pin['sha256'],
            'session_kinfo_manifest_profile_unverified')
    profile = read_pin(profile_pin)
    require(profile.get('interface') == config['interface'] and
            profile.get('productionExecutable') is False and
            profile.get('layout') == LocalKinfoCompatibility.LAYOUT and
            profile.get('layoutEvidence') == policy.get('layoutOrigin'),
            'session_kinfo_profile_source_unverified')
    origin = read_pin(profile['layoutEvidence'])
    require(origin.get('layout') == profile['layout'] and origin.get('SDKRoot') == profile['sdkRoot'] and
            origin.get('headers') == profile['headers'] and
            all(origin.get('platform', {}).get(k) == v for k, v in profile['platform'].items()),
            'session_kinfo_origin_unverified')
    result = {'enabled': config['enabled'], 'profile': dict(profile_pin), 'role': role,
              'runtimeBinding': dict(plan['runtimeBinding']), 'manifest': manifest_pin,
              'layoutOrigin': dict(profile['layoutEvidence']), 'interface': config['interface'],
              'status': 'static_bound_host_unverified' if config['enabled'] else 'configured_disabled'}
    journal.append('session-local-kinfo-config', **result, productionExecutable=False)
    return result


def resolve_session_kinfo(plan, journal, *, request=None):
    try:
        return _resolve_session_kinfo(plan, journal, request=request)
    except (OSError, KeyError, TypeError, ValueError, AttributeError) as error:
        journal.append('session-local-kinfo-unverified', reason=type(error).__name__,
                       productionExecutable=False, automaticRetry=False)
        raise ControlError('session_kinfo_evidence_unverified') from error


def read_pin_bytes_equal(pin):
    path, _ = canonical_file(pin['path'])
    require(digest(path) == pin['sha256'], 'session_kinfo_file_digest_unverified')
    return True


def create_session_observer(plan, journal, resolution):
    current = resolve_session_kinfo(plan, journal)
    require(current == resolution, 'session_kinfo_changed_unverified')
    if not current['enabled']:
        return OSObserver(journal)
    # Validate native host/SDK/source binding while the caller still owns its lease.
    compat = LocalKinfoCompatibility(current['profile'], journal)
    require(not compat.fixture, 'session_kinfo_fixture_forbidden')
    observer = OSObserver(journal, kinfo_profile=current['profile'])
    observer._kinfo_compat = compat
    return observer


class ControlledSession:
    """One process owns admission, launch, operator control and verified shutdown.

    No implicit retry, detach, rollback, release-on-error or background supervisor.
    Keep this object and process alive on uncertainty; cached status is not OS proof.
    """
    def __init__(self, plan_pin, journal):
        self.journal = journal
        self.plan_pin = dict(plan_pin)
        self.plan = read_pin(plan_pin)
        require(self.plan.get('purpose') == 'guarded_control_session' and
                self.plan.get('explicitStart') is True and
                self.plan.get('productionExecutable') is False,
                'explicit_guarded_session_plan_required')
        own = self.plan.get('controller', {})
        require(own == {'path': str(Path(__file__).resolve()), 'sha256': digest(__file__)},
                'session_controller_pin_mismatch')
        self.spec = LaunchSpec(**self.plan['spec'])
        require(self.spec.fixture is False, 'session_fixture_launch_forbidden')
        require(self.plan['databasePath'] == read_pin(self.plan['template'])['working']['path'],
                'session_work_binding_mismatch')
        self.local_kinfo = resolve_session_kinfo(self.plan, self.journal)
        self.state = 'created'
        self.lease = None
        self.controller = None
        self.journal.append('session-created', plan=plan_pin, deploymentMode='guarded-workbench',
                            automaticRestart=False, automaticRollback=False)

    def start(self):
        require(self.state == 'created', 'session_start_once_only')
        self.state = 'preparing'
        try:
            require(read_pin(self.plan_pin) == self.plan, 'session_plan_changed_unverified')
            require(resolve_session_kinfo(self.plan, self.journal) == self.local_kinfo,
                    'session_kinfo_changed_unverified')
            self.lease = DeploymentLease(self.plan['databasePath'], self.journal)
            require(read_pin(self.plan_pin) == self.plan, 'session_plan_changed_unverified')
            observer = create_session_observer(self.plan, self.journal, self.local_kinfo)
            self.controller = OwnedProcess(self.lease, self.journal, observer.observe_process,
                                           observer.observe_listener, observer.observe_file_users)
            self.controller.observer = observer
            self.spec = prepare_admission(self.controller, self.spec, self.plan['template'],
                                          self.plan['subject'],
                                          storage_validator(self.plan['node'], self.plan['loader']))
            self.journal.append('session-launch-requested', deploymentId=self.controller.deployment_id,
                                continuousLease=True, fixture=False)
            owner = self.controller.launch(self.spec)
            self.state = 'running'
            self.journal.append('session-running', deploymentId=self.controller.deployment_id,
                                owner=owner, continuousLease=True)
            return self.status()
        except BaseException as error:
            self.mark_unverified(error)
            raise

    def mark_unverified(self, error):
        self.state = 'unverified'
        self.journal.append('session-unverified', reason=str(error), automaticRetry=False,
                            automaticRestart=False, forcedKill=False, automaticRollback=False,
                            leaseRetained=bool(self.lease and not self.lease.released))

    def status(self):
        return {'state': self.state, 'deploymentId': self.controller.deployment_id if self.controller else None,
                'leaseDescriptorRetained': bool(self.lease and not self.lease.released),
                'productionExecutable': False, 'cachedOnly': True,
                'preStopDrained': 'unverified', 'externalOperationOutcomes': 'unverified'}

    def command(self, value):
        require(isinstance(value, dict) and set(value) == {'op', 'deploymentId'} and
                self.controller is not None and value['deploymentId'] == self.controller.deployment_id,
                'session_command_identity_invalid')
        if value['op'] == 'status':
            return self.status()
        require(value['op'] == 'shutdown' and self.state == 'running',
                'session_command_not_allowed')
        self.state = 'closing'
        try:
            self.controller.request_shutdown()
            require(self.lease.released, 'session_close_without_release')
            self.state = 'closed'
            self.journal.append('session-closed', deploymentId=self.controller.deployment_id,
                                verifiedClose=True)
            return self.status()
        except BaseException as error:
            self.mark_unverified(error)
            raise


class _VinfoStat(ctypes.Structure):
    _fields_ = [('dev', ctypes.c_uint32), ('mode', ctypes.c_uint16), ('nlink', ctypes.c_uint16),
                ('ino', ctypes.c_uint64), ('uid', ctypes.c_uint32), ('gid', ctypes.c_uint32),
                *[(k, ctypes.c_int64) for k in ('atime', 'atimens', 'mtime', 'mtimens',
                                                'ctime', 'ctimens', 'birthtime', 'birthtimens',
                                                'size', 'blocks')],
                ('blksize', ctypes.c_int32),
                *[(k, ctypes.c_uint32) for k in ('flags', 'gen', 'rdev')],
                ('spare', ctypes.c_int64 * 2)]


class _ProcFileInfo(ctypes.Structure):
    _fields_ = [('openflags', ctypes.c_uint32), ('status', ctypes.c_uint32),
                ('offset', ctypes.c_int64), ('type', ctypes.c_int32), ('guardflags', ctypes.c_uint32)]


class _PipeInfo(ctypes.Structure):
    _fields_ = [('stat', _VinfoStat), ('handle', ctypes.c_uint64), ('peer', ctypes.c_uint64),
                ('status', ctypes.c_int32), ('reserved', ctypes.c_int32)]


class _PipeFDInfo(ctypes.Structure):
    _fields_ = [('file', _ProcFileInfo), ('pipe', _PipeInfo)]


class _ProcBSDInfo(ctypes.Structure):
    _fields_ = [*[(k, ctypes.c_uint32) for k in ('flags', 'status', 'xstatus', 'pid', 'ppid',
                      'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'reserved')],
                ('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32),
                *[(k, ctypes.c_uint32) for k in ('nfiles', 'pgid', 'pjobc', 'tdev', 'tpgid')],
                ('nice', ctypes.c_int32), ('startsec', ctypes.c_uint64), ('startusec', ctypes.c_uint64)]


class DarwinPipeInspector:
    """Read only the controller and its explicitly declared direct parent via libproc.

    ABI mirrors the SDK sys/proc_info.h. No architecture fallback or partial result.
    Anonymous endpoint handles are compared in memory, never written to journals.
    """
    def __init__(self):
        require(sys.platform == 'darwin' and ctypes.sizeof(ctypes.c_void_p) == 8,
                'operator_pipe_platform_unverified')
        require((ctypes.sizeof(_VinfoStat), ctypes.sizeof(_ProcFileInfo),
                 ctypes.sizeof(_PipeFDInfo), ctypes.sizeof(_ProcBSDInfo)) == (136, 24, 184, 136),
                'operator_pipe_abi_unverified')
        try:
            self.lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            self.lib.proc_pidfdinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                               ctypes.c_void_p, ctypes.c_int]
            self.lib.proc_pidfdinfo.restype = ctypes.c_int
            self.lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                             ctypes.c_void_p, ctypes.c_int]
            self.lib.proc_pidinfo.restype = ctypes.c_int
        except (OSError, AttributeError) as error:
            raise ControlError('operator_pipe_kernel_api_unverified') from error

    def identity(self, pid):
        info = _ProcBSDInfo()
        count = self.lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        require(count == ctypes.sizeof(info), 'operator_parent_identity_unverified')
        return dict(pid=info.pid, uid=info.uid, realUid=info.ruid,
                    startSeconds=info.startsec, startMicroseconds=info.startusec)

    def endpoint(self, pid, fd):
        info = _PipeFDInfo()
        count = self.lib.proc_pidfdinfo(pid, fd, 6, ctypes.byref(info), ctypes.sizeof(info))
        require(count == ctypes.sizeof(info), 'operator_anonymous_endpoint_unverified')
        require(stat.S_ISFIFO(info.pipe.stat.mode), 'operator_kernel_pipe_type_unverified')
        return dict(handle=info.pipe.handle, peer=info.pipe.peer, access=info.file.openflags & 3)


def validate_operator_pipe(fd, binding, *, inspector=None, expected=None):
    require(type(fd) is int and fd >= 3, 'operator_read_fd_invalid')
    require(isinstance(binding, dict) and binding.get('version') == 1 and
            binding.get('kind') == 'inherited_anonymous_pipe', 'operator_provenance_missing')
    parent = binding.get('parent')
    require(isinstance(parent, dict) and set(parent) == {'pid', 'uid', 'startSeconds', 'startMicroseconds'}
            and all(type(parent[k]) is int for k in parent), 'operator_parent_binding_invalid')
    require(parent['pid'] == os.getppid() and parent['pid'] > 1 and
            parent['uid'] == os.getuid() == os.geteuid() and parent['startSeconds'] > 0 and
            0 <= parent['startMicroseconds'] < 1_000_000, 'operator_parent_source_mismatch')
    writer = binding.get('writerFd')
    require(type(writer) is int and writer >= 3, 'operator_parent_writer_fd_invalid')
    try:
        info = os.fstat(fd)
        require(stat.S_ISFIFO(info.st_mode), 'operator_read_type_invalid')
        require(fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE == os.O_RDONLY,
                'operator_read_direction_invalid')
        native = inspector if inspector is not None else DarwinPipeInspector()
        snapshots = []
        for _ in range(2):
            identity = native.identity(parent['pid'])
            require(identity == {**parent, 'realUid': parent['uid']}, 'operator_parent_identity_mismatch')
            read = native.endpoint(os.getpid(), fd)
            write = native.endpoint(parent['pid'], writer)
            require(read.get('access') == 1 and write.get('access') == 2,
                    'operator_endpoint_direction_mismatch')
            require(all(type(x.get(k)) is int and x[k] > 0 for x in (read, write) for k in ('handle', 'peer'))
                    and read['handle'] != write['handle'] and read['peer'] == write['handle']
                    and write['peer'] == read['handle'], 'operator_endpoint_pair_mismatch')
            snapshots.append({'parent': identity, 'read': read, 'write': write, 'fd': fd, 'writerFd': writer})
        require(snapshots[0] == snapshots[1] and os.getppid() == parent['pid'],
                'operator_endpoint_changed_during_validation')
        require(expected is None or snapshots[1] == expected, 'operator_endpoint_identity_changed')
        return snapshots[1]
    except OSError as error:
        raise ControlError('operator_descriptor_observation_unverified') from error


def serve_control_session(session, command_fd):
    """Stay in foreground; failure/EOF keeps ownership instead of retrying or exiting.

    The caller supplies an already-open private read pipe. No filesystem command
    endpoint, detached process, service registration, signal, or network is created.
    """
    provenance = session.plan.get('operatorPipe')
    endpoint = validate_operator_pipe(command_fd, provenance)
    session.journal.append('operator-pipe-verified', anonymous=True, parentIdentityBound=True,
                           reciprocalEndpoints=True, readOnly=True)
    try:
        session.start()
    except BaseException:
        # start already journaled uncertainty. Never free its lease in a finally.
        pass
    buffer = b''
    input_unverified = False
    while session.state != 'closed':
        try:
            if input_unverified:
                time.sleep(1)
                continue
            with selectors.DefaultSelector() as selector:
                selector.register(command_fd, selectors.EVENT_READ)
                if not selector.select(1):
                    continue
            validate_operator_pipe(command_fd, provenance, expected=endpoint)
            data = os.read(command_fd, 4097)
            require(bool(data), 'operator_pipe_eof_unverified')
            buffer += data
            require(len(buffer) <= 4096, 'operator_frame_too_large')
            while b'\n' in buffer and session.state != 'closed':
                line, buffer = buffer.split(b'\n', 1)
                try:
                    validate_operator_pipe(command_fd, provenance, expected=endpoint)
                    result = session.command(json.loads(line))
                    session.journal.append('operator-command-result', status=result)
                except (ControlError, ValueError, UnicodeError) as error:
                    session.journal.append('operator-command-rejected', reason=str(error))
        except BaseException as error:
            session.mark_unverified(error)
            input_unverified = True
    return session.status()


class ParentOperation:
    """One parent/writer, one child controller, one explicit close. No business IO."""
    def __init__(self, request_pin, journal, *, inspector=None, popen=None):
        self.journal = journal
        self.request_pin = dict(request_pin)
        self.request = read_pin(request_pin)
        require(self.request.get('purpose') == 'guarded_parent_operation' and
                self.request.get('explicitStart') is True and
                self.request.get('productionExecutable') is False,
                'explicit_parent_operation_required')
        self.template = read_pin(self.request['sessionTemplate'])
        require(self.template.get('purpose') == 'guarded_control_session' and
                self.template.get('explicitStart') is False and
                self.template.get('productionExecutable') is False,
                'static_disabled_session_template_required')
        require(self.template.get('controller') == {'path': str(Path(__file__).resolve()),
                'sha256': digest(__file__)}, 'parent_controller_pin_mismatch')
        self.local_kinfo = resolve_session_kinfo(self.template, self.journal, request=self.request)
        self.runtime = read_pin(self.request['runtimeBinding'])['python']
        python, _ = canonical_file(self.runtime['path'])
        require(os.path.samefile(sys.executable, python) and digest(python) == self.runtime['sha256']
                and digest(sys.executable) == self.runtime['sha256'] and
                '.'.join(map(str, sys.version_info[:3])) == self.runtime['version'],
                'parent_python_runtime_mismatch')
        self.python = str(python)
        self.native = inspector if inspector is not None else DarwinPipeInspector()
        self.popen = popen if popen is not None else subprocess.Popen
        self.state, self.child, self.writer, self.reader = 'created', None, None, None
        self.child_identity = None
        self.deployment_id = None
        self.receipt_sequence, self.receipt_digest = 0, None
        self.receipts = []
        self.shutdown_requested = False
        self.child_journal = journal.directory / 'controller-journal'
        self.journal.append('parent-created', request=request_pin, automaticRestart=False,
                            automaticRollback=False, databaseOpened=False)

    def _uncertain(self, error):
        self.state = 'unverified'
        self.journal.append('parent-unverified', reason=str(error), automaticRetry=False,
                            forcedKill=False, automaticRollback=False,
                            writerRetained=self.writer is not None)

    def _endpoints(self):
        require(self.native.identity(os.getpid()) == self.parent_identity,
                'parent_own_identity_changed')
        require(self.native.identity(self.child.pid) == self.child_identity,
                'parent_controller_identity_changed')
        read = self.native.endpoint(self.child.pid, self.inherited_reader)
        write = self.native.endpoint(os.getpid(), self.writer)
        require((read, write) == self.pipe_identity, 'parent_pipe_identity_changed')
        require(read['access'] == 1 and write['access'] == 2 and
                read['peer'] == write['handle'] and write['peer'] == read['handle'],
                'parent_pipe_pair_unverified')

    def _read_receipts(self):
        if not self.child_journal.exists():
            return
        info = self.child_journal.lstat()
        require(stat.S_ISDIR(info.st_mode) and self.child_journal.resolve() == self.child_journal
                and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
                'parent_child_journal_private_required')
        entries = sorted(self.child_journal.glob('*.json'))
        require(len(entries) >= self.receipt_sequence, 'parent_journal_truncated')
        for index, path in enumerate(entries, 1):
            p, st = canonical_file(path)
            require(st.st_uid == os.getuid() and st.st_mode & 0o077 == 0 and st.st_size <= 4_000_000,
                    'parent_receipt_private_required')
            data = p.read_bytes()
            if not data.endswith(b'\n'):
                require(index == len(entries) and index > self.receipt_sequence,
                        'parent_prior_receipt_changed')
                break
            value = json.loads(data)
            checksum = hashlib.sha256(data).hexdigest()
            require(value.get('sequence') == index and
                    value.get('previousSha256') == (None if index == 1 else self.receipts[index-2]['sha256']),
                    'parent_receipt_chain_invalid')
            if index <= self.receipt_sequence:
                require(checksum == self.receipts[index-1]['sha256'], 'parent_receipt_changed')
                continue
            require(value.get('productionExecutable') is False, 'parent_receipt_gate_invalid')
            self.receipts.append({'sha256': checksum, 'value': value})
            self.receipt_sequence, self.receipt_digest = index, checksum
        values = [x['value'] for x in self.receipts]
        if any(x['event'] in ('session-unverified', 'launch-failed', 'shutdown-unverified') for x in values):
            raise ControlError('parent_child_reported_uncertainty')
        running = [x for x in values if x['event'] == 'session-running']
        if running:
            require(len(running) == 1, 'parent_duplicate_ready')
            ready = running[0]; identity = ready.get('deploymentId')
            require(isinstance(identity, str) and re.fullmatch(r'[a-f0-9]{32}', identity),
                    'parent_ready_identity_invalid')
            spec = self.template['spec']
            owners = [x for x in values if x['event'] == 'owner-verified' and
                      x.get('deploymentId') == identity and
                      x.get('manifestSha256') == spec['manifest_sha256'] and
                      x.get('origin') == spec['origin'] and
                      x.get('databasePath') == self.template['databasePath'] and
                      x['sequence'] < ready['sequence']]
            leases = [x for x in values if x['event'] == 'lease-acquired' and
                      x.get('databasePath') == self.template['databasePath'] and
                      x['sequence'] < ready['sequence']]
            require(len(owners) == 1 and len(leases) == 1 and ready.get('owner') == owners[0].get('owner'),
                    'parent_ready_without_bound_owner_or_lease')
            require(self.deployment_id is None or self.deployment_id == identity, 'parent_deployment_changed')
            self.deployment_id = identity

    def start(self, timeout=60):
        require(self.state == 'created', 'parent_start_once_only')
        self.state = 'starting'
        try:
            require(read_pin(self.request_pin) == self.request and
                    read_pin(self.request['sessionTemplate']) == self.template,
                    'parent_plan_changed_unverified')
            require(resolve_session_kinfo(self.template, self.journal, request=self.request) == self.local_kinfo,
                    'parent_session_kinfo_changed_unverified')
            self.parent_identity = self.native.identity(os.getpid())
            require(self.parent_identity.get('pid') == os.getpid() and
                    self.parent_identity.get('uid') == os.getuid() == os.geteuid() and
                    self.parent_identity.get('realUid') == os.getuid(), 'parent_own_identity_unverified')
            self.reader, self.writer = os.pipe()
            os.set_inheritable(self.writer, False)
            read = self.native.endpoint(os.getpid(), self.reader)
            write = self.native.endpoint(os.getpid(), self.writer)
            require(read['handle'] > 0 and write['handle'] > 0 and read['handle'] != write['handle']
                    and read['access'] == 1 and write['access'] == 2 and
                    read['peer'] == write['handle'] and write['peer'] == read['handle'],
                    'parent_created_pipe_unverified')
            self.pipe_identity = (read, write)
            self.inherited_reader = self.reader
            plan = json.loads(json.dumps(self.template))
            plan['explicitStart'] = True
            plan['status'] = 'live_parent_bound_not_production_readiness'
            plan['operatorPipe'] = {'version': 1, 'kind': 'inherited_anonymous_pipe',
                'parent': {k: self.parent_identity[k] for k in ('pid', 'uid', 'startSeconds', 'startMicroseconds')},
                'writerFd': self.writer}
            live = self.journal.append('live-session-plan', **plan)
            output = self.journal.directory / 'controller-output.log'
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                self.child = self.popen([self.python, self.template['controller']['path'],
                    '--session-plan', live['path'], '--plan-sha256', live['sha256'],
                    '--session-command-fd', str(self.reader), '--journal', str(self.child_journal)],
                    stdin=subprocess.DEVNULL, stdout=fd, stderr=subprocess.STDOUT,
                    pass_fds=(self.reader,), close_fds=True,
                    env={'PATH': os.defpath, 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1'})
            finally:
                os.close(fd)
            self.child_identity = self.native.identity(self.child.pid)
            require(self.child_identity.get('pid') == self.child.pid and
                    self.child_identity.get('uid') == os.getuid() and
                    self.child_identity.get('realUid') == os.getuid(), 'parent_child_identity_unverified')
            self._endpoints()
            os.close(self.reader); self.reader = None
            self.journal.append('parent-controller-spawned', childIdentity=self.child_identity,
                                writerInheritedByChild=False, livePlan=live)
            deadline = time.monotonic() + timeout
            while True:
                self._read_receipts()
                require(self.child.poll() is None, 'parent_controller_exited_before_ready')
                self._endpoints()
                if self.deployment_id:
                    self.state = 'running'
                    self.journal.append('parent-session-ready', deploymentId=self.deployment_id,
                                        databaseLockOwnedByChild=True)
                    return self.status()
                require(time.monotonic() < deadline, 'parent_ready_timeout_unverified')
                time.sleep(0.02)
        except BaseException as error:
            self._uncertain(error)
            raise

    def status(self):
        return {'state': self.state, 'deploymentId': self.deployment_id,
                'writerRetained': self.writer is not None, 'productionExecutable': False,
                'databaseLockOwner': 'child_controller', 'cachedOnly': True}

    def shutdown(self, timeout=30):
        require(self.state == 'running' and not self.shutdown_requested, 'parent_shutdown_once_ready_only')
        self.shutdown_requested = True
        self.state = 'closing'
        try:
            require(self.child.poll() is None, 'parent_child_exit_unverified')
            self._endpoints()
            self._read_receipts()
            frame = {'op': 'shutdown', 'deploymentId': self.deployment_id}
            payload = (json.dumps(frame)+'\n').encode()
            require(os.write(self.writer, payload) == len(payload), 'parent_partial_command_unverified')
            self.journal.append('parent-shutdown-sent', deploymentId=self.deployment_id)
            deadline = time.monotonic() + timeout
            while True:
                self._read_receipts()
                exited = self.child.poll() is not None
                if exited:
                    # The prior snapshot may precede the final append and exit.
                    # Revalidate the final chain once; never resend or reset time.
                    self._read_receipts()
                values = [x['value'] for x in self.receipts]
                close = [x for x in values if x['event'] == 'session-closed' and
                         x.get('deploymentId') == self.deployment_id and x.get('verifiedClose') is True]
                if close:
                    closed = [x for x in values if x['event'] == 'closed-verified' and x.get('deploymentId') == self.deployment_id]
                    released = [x for x in values if x['event'] == 'lease-released' and x.get('closureVerified') is True]
                    require(len(close) == len(closed) == len(released) == 1 and
                            closed[0]['sequence'] < released[0]['sequence'] < close[0]['sequence'],
                            'parent_close_chain_unverified')
                    remaining = deadline-time.monotonic()
                    require(remaining > 0 and self.child.wait(timeout=remaining) == 0,
                            'parent_controller_exit_failed')
                    os.close(self.writer); self.writer = None
                    self.state = 'closed'
                    self.journal.append('parent-closed', deploymentId=self.deployment_id,
                                        verifiedControllerExit=True, writerClosed=True)
                    return self.status()
                require(not exited, 'parent_controller_exit_without_close')
                require(time.monotonic() < deadline, 'parent_close_timeout_unverified')
                time.sleep(0.02)
        except BaseException as error:
            self._uncertain(error)
            raise


def serve_parent_operation(operation):
    """Interactive foreground only. EOF/interrupt never automatically closes a child."""
    require(sys.stdin.isatty(), 'parent_foreground_terminal_required')
    try:
        operation.start()
    except BaseException:
        pass
    while operation.state != 'closed':
        try:
            if operation.state == 'unverified':
                time.sleep(1)
                continue
            command = input().strip()
            if command == 'status':
                print(json.dumps(operation.status()), flush=True)
            elif command == 'shutdown':
                print(json.dumps(operation.shutdown()), flush=True)
            else:
                operation.journal.append('parent-command-rejected', automaticAction=False)
        except BaseException as error:
            operation._uncertain(error)
    return operation.status()


if __name__ == '__main__':
    # Explicit session mode is distinct from the prepare-only entry.
    import argparse
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--parent-plan')
    mode.add_argument('--prepare-plan')
    mode.add_argument('--session-plan')
    parser.add_argument('--session-command-fd', type=int)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--journal')
    args = parser.parse_args()
    if args.parent_plan:
        parent_journal = Journal(args.journal)
        try:
            operation = ParentOperation({'path': args.parent_plan, 'sha256': args.plan_sha256}, parent_journal)
            serve_parent_operation(operation)
        except BaseException as error:
            parent_journal.append('parent-entry-rejected', reason=str(error), automaticRetry=False)
            raise SystemExit(1)
    elif args.session_plan:
        session_journal = Journal(args.journal)
        try:
            session = ControlledSession({'path': args.session_plan, 'sha256': args.plan_sha256}, session_journal)
        except BaseException as error:
            session_journal.append('session-plan-rejected', reason=str(error), serviceStarted=False)
            raise SystemExit(1)
        try:
            serve_control_session(session, args.session_command_fd)
        except BaseException as error:
            session_journal.append('operator-pipe-rejected', reason=str(error), serviceStarted=False)
            raise SystemExit(1)
    elif not args.prepare_plan:
        print(json.dumps({'mode': 'library_only', 'productionExecutable': False}))
    else:
        journal = Journal(args.journal)
        lease = None
        try:
            plan = read_pin({'path': args.prepare_plan, 'sha256': args.plan_sha256})
            require(plan.get('productionExecutable') is False, 'production_must_remain_closed')
            resolution = resolve_session_kinfo(plan, journal)
            lease = DeploymentLease(plan['databasePath'], journal)
            observer = create_session_observer(plan, journal, resolution)
            controller = OwnedProcess(lease, journal, observer.observe_process,
                                      observer.observe_listener, observer.observe_file_users)
            controller.observer = observer
            spec = LaunchSpec(**plan['spec'])
            require(spec.fixture is False, 'fixture_plan_forbidden')
            result = prepare_admission(controller, spec, plan['template'], plan['subject'],
                                       storage_validator(plan['node'], plan['loader']))
            journal.append('prepare-only-completed', admissionPath=result.admission_path,
                           launchAuthorized=False, note='new_live_prepare_required_before_launch')
        except BaseException as error:
            journal.append('prepare-entry-unverified', reason=str(error), automaticRetry=False)
            raise SystemExit(1)
        finally:
            if lease is not None:
                lease.close_descriptor_without_unlock()
