#!/usr/bin/env python3
"""Select an assigned LAN IPv4; never reuse an address that left the host."""
import ipaddress
import json
import subprocess
import sys

NETWORKS = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))

def select(interfaces, routes, preferred=''):
    default = {r.get('dev') for r in routes if r.get('dst') == 'default'}
    candidates = []
    for iface in interfaces:
        if iface.get('operstate') not in ('UP', 'UNKNOWN') or iface.get('ifname') == 'lo':
            continue
        for item in iface.get('addr_info', []):
            if item.get('family') != 'inet' or item.get('scope') != 'global':
                continue
            try:
                addr = ipaddress.IPv4Address(item['local'])
            except (ValueError, KeyError):
                continue
            if any(addr in net for net in NETWORKS):
                candidates.append((iface.get('ifname') not in default, iface.get('ifname', ''), str(addr)))
    assigned = [item[2] for item in sorted(candidates)]
    if preferred in assigned:
        return preferred
    if not assigned:
        raise ValueError('Немає активної приватної IPv4-адреси LAN. Підключіть мережу центру.')
    return assigned[0]

if __name__ == '__main__':
    try:
        interfaces = json.loads(subprocess.check_output(['ip', '-j', '-4', 'addr', 'show'], text=True))
        routes = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'show', 'default'], text=True))
        print(select(interfaces, routes, sys.argv[1] if len(sys.argv) > 1 else ''))
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
