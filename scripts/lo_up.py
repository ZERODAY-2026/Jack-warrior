"""Bring up the loopback interface inside a fresh network namespace (Linux), for
environments without the `ip` tool. Used by offline_check.sh."""
import fcntl
import socket
import struct

SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ifreq = struct.pack("16sH14s", b"lo", 0, b"\x00" * 14)
flags = struct.unpack("16sH14s", fcntl.ioctl(s, SIOCGIFFLAGS, ifreq))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sH14s", b"lo", flags | IFF_UP, b"\x00" * 14))
