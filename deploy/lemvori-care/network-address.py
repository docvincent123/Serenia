#!/usr/bin/env python3
"""Choose an IPv4 address that is *currently assigned* to this Linux host.

Prefer the interface with the default route; keep an existing address only while
it remains assigned on a usable interface. Work offline via IPv4 loopback.
"""
import ipaddress
import json
import subprocess
import sys

PRIVATE = tuple(map(ipaddress.ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")))
SKIP_PREFIXES = ("docker", "veth", "virbr", "br-", "tailscale", "tun", "wg", "podman")


def select(interfaces, routes, previous=""):
    defaults = {r.get("dev") for r in routes if r.get("dst") == "default" and r.get("dev")}
    candidates = []
    for iface in interfaces:
        name = str(iface.get("ifname", ""))
        if name == "lo" or name.startswith(SKIP_PREFIXES):
            continue
        if iface.get("operstate") not in ("UP", "UNKNOWN"):
            continue
        for entry in iface.get("addr_info", []):
            if entry.get("family") != "inet" or entry.get("scope") != "global":
                continue
            try:
                address = ipaddress.IPv4Address(entry.get("local", ""))
            except ipaddress.AddressValueError:
                continue
            if any(address in network for network in PRIVATE):
                candidates.append((name in defaults, name, address))
    if not candidates:
        return "127.0.0.1"
    preferred_candidates = [item for item in candidates if item[0]]
    available = preferred_candidates or candidates
    if previous in {str(item[2]) for item in available}:
        return previous
    return str(sorted(available, key=lambda item: (item[1], int(item[2])))[0][2])


def main():
    try:
        interfaces = json.loads(subprocess.check_output(
            ["ip", "-j", "-4", "addr", "show"], text=True))
        routes = json.loads(subprocess.check_output(
            ["ip", "-j", "-4", "route", "show", "default"], text=True))
        print(select(interfaces, routes, sys.argv[1] if len(sys.argv) > 1 else ""))
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise SystemExit("Неможливо визначити адресу Linux: " + str(exc))


if __name__ == "__main__":
    main()
