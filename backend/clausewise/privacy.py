"""Privacy controls: an in-process egress guard and content-free logging.

The egress guard patches the socket layer of this Python process so that any
attempt to resolve a non-local hostname or connect to a non-loopback address
raises ``EgressBlocked``. It is defence in depth, not proof: proof comes from
running the backend with networking disabled and monitoring connections (see
docs/privacy.md). Blocked attempts are counted by destination only; no payload
is ever inspected or recorded.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import threading
from collections import Counter

log = logging.getLogger("clausewise")


class EgressBlocked(ConnectionError):
    pass


_LOCAL_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}
_lock = threading.Lock()
_installed = False
_blocked: Counter[str] = Counter()
_orig_connect = socket.socket.connect
_orig_connect_ex = socket.socket.connect_ex
_orig_getaddrinfo = socket.getaddrinfo


def _is_local_host(host: object) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "ignore")
    host = str(host).strip("[]").lower()
    if host in _LOCAL_NAMES or host == "":
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def _check_address(sock: socket.socket, address: object) -> None:
    if sock.family == getattr(socket, "AF_UNIX", None):
        return
    host = address[0] if isinstance(address, tuple) and address else address
    if not _is_local_host(host):
        _record(str(host))
        raise EgressBlocked(f"Outbound connection to {host} blocked by ClauseWise egress guard")


def _record(dest: str) -> None:
    with _lock:
        _blocked[dest] += 1
    # Destination only. Never log payloads, document names or text.
    log.warning("egress guard blocked an outbound connection attempt to %s", dest)


def _guarded_connect(self: socket.socket, address):  # type: ignore[no-untyped-def]
    _check_address(self, address)
    return _orig_connect(self, address)


def _guarded_connect_ex(self: socket.socket, address):  # type: ignore[no-untyped-def]
    _check_address(self, address)
    return _orig_connect_ex(self, address)


def _guarded_getaddrinfo(host, *args, **kwargs):  # type: ignore[no-untyped-def]
    if not _is_local_host(host):
        _record(str(host))
        raise EgressBlocked(f"DNS lookup of {host} blocked by ClauseWise egress guard")
    return _orig_getaddrinfo(host, *args, **kwargs)


def install_egress_guard() -> None:
    global _installed
    with _lock:
        if _installed:
            return
        socket.socket.connect = _guarded_connect  # type: ignore[method-assign]
        socket.socket.connect_ex = _guarded_connect_ex  # type: ignore[method-assign]
        socket.getaddrinfo = _guarded_getaddrinfo  # type: ignore[assignment]
        _installed = True


def uninstall_egress_guard() -> None:
    global _installed
    with _lock:
        socket.socket.connect = _orig_connect  # type: ignore[method-assign]
        socket.socket.connect_ex = _orig_connect_ex  # type: ignore[method-assign]
        socket.getaddrinfo = _orig_getaddrinfo  # type: ignore[assignment]
        _installed = False


def egress_guard_active() -> bool:
    return _installed


def blocked_attempts() -> dict[str, int]:
    with _lock:
        return dict(_blocked)


def reset_blocked_attempts() -> None:
    with _lock:
        _blocked.clear()


def configure_logging(level: int = logging.INFO) -> None:
    """Log metadata only (sizes, durations, counts, error codes).

    Module code never passes document text, questions, answers or filenames to
    the logger. Uvicorn's access log records method, path and status, and paths
    contain only random document ids.
    """
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
