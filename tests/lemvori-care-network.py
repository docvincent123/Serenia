#!/usr/bin/env python3
"""Offline tests for DHCP IP selection, no root or network required."""
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "deploy" / "lemvori-care" / "network-address.py"
spec = importlib.util.spec_from_file_location("lemvori_network_address", path)
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)


def interface(name, ip, state="UP"):
    return {"ifname": name, "operstate": state, "addr_info": [
        {"family": "inet", "scope": "global", "local": ip}]}


def run():
    assert network.select([], [], "") == "127.0.0.1"
    assert network.select([interface("lo", "127.0.0.1")], [], "") == "127.0.0.1"
    interfaces = [interface("docker0", "172.17.0.1"), interface("enp2s0", "192.168.1.20"),
                  interface("wlp1s0", "192.168.50.10")]
    routes = [{"dst": "default", "dev": "wlp1s0"}]
    assert network.select(interfaces, routes, "") == "192.168.50.10"
    assert network.select(interfaces, routes, "192.168.1.20") == "192.168.50.10"
    assert network.select(interfaces, routes, "192.168.50.10") == "192.168.50.10"
    assert network.select([interface("enp2s0", "10.9.1.3")], [], "192.168.50.10") == "10.9.1.3"
    assert network.select([interface("enp2s0", "8.8.8.8")], [], "") == "127.0.0.1"
    assert network.select([interface("enp2s0", "192.168.1.20", "DOWN")], [], "") == "127.0.0.1"
    print("Lemvori Care IP selection: 7 checks passed")


if __name__ == "__main__":
    run()
