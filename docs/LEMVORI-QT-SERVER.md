# Lemvori Care Qt Native — clean Linux HTTPS API

This deployment runs the **existing C++20 server** for Qt Native, not the old
SOLVIA Linux installation. Application/server source still names its CMake
target `SolviaServer` for compatibility. It does **not** create the old
`16/solvia` PostgreSQL cluster or alter any other database.

## Prerequisites

- Linux Mint / Ubuntu x86_64 with `apt-get` and systemd.
- Existing PostgreSQL instance listening locally at `127.0.0.1:5432`.
- Existing database `lemvori_core`, with owner and login role `lemvori_app`.
- This source checkout with `src/server/schema.sql`.
- Only development/demo data until medical privacy, retention and backup
  policies are assessed.

```bash
# Run inside the complete Git checkout of the current Qt Native branch.
sudo bash deploy/lemvori-care/install.sh
```

The installer builds `SolviaServer` as `/opt/lemvori-care/lemvori-care-api`,
checks database authentication using a protected PostgreSQL password file,
runs the C++ server's `--init` entry point, and starts HTTPS on TCP 8443.
It asks once for the PostgreSQL role password and, for a fresh database,
first administrator credentials. It does not delete data or change the
PostgreSQL cluster.

```bash
sudo lemvori-carectl status
sudo lemvori-carectl address
sudo lemvori-carectl health
sudo lemvori-carectl logs
sudo lemvori-carectl restart
sudo ss -lntp | grep ':8443'
```

## Automatic IP + TLS

`lemvori-care.service` starts at boot via systemd.
`lemvori-care-network.timer` checks active LAN IPv4 interfaces every ~45s,
prioritizing the default route and not selecting removed DHCP addresses.
Without a usable private LAN IPv4, it falls back to `127.0.0.1` (same-PC
Qt can still connect). After the network comes back, the timer selects
the newly assigned address.

`/etc/lemvori-care/address` records the live IP. The **same local root CA**
at `/etc/lemvori-care/ca/ca.crt` signs each TLS server certificate;
the certificate SAN includes localhost, 127.0.0.1, and the current LAN IPv4.
On IP change/expiry the server cert is renewed and the HTTPS service restarted.
The private `ca.key` must remain private and is not shared with clients.

The Qt Native client on this same Linux PC uses
`https://localhost:8443`; other center PCs may use
`https://<server-current-LAN-IP>:8443`.
The Linux installer trusts the new local CA for the local machine. Import
**only** `/etc/lemvori-care/ca/ca.crt` on other trusted client devices,
after verifying the fingerprint from `sudo lemvori-carectl certificate`.
Do not disable Qt certificate verification.

A new database means a new server identity. If an existing Qt client
previously pinned an identity for the same URL, it must be explicitly
re-enrolled. Do not silently bypass the identity mismatch.

The server listens on `0.0.0.0:8443` so both localhost and LAN clients
can connect. Restrict TCP 8443 in the host firewall to your trusted
center subnet. Do not publicly forward 8443 or expose PostgreSQL 5432.

## File structure

- API executable: `/opt/lemvori-care/lemvori-care-api`
- Runtime: `/var/lib/lemvori-care/`
- Network/TLS config: `/etc/lemvori-care/`
- PostgreSQL DB: `lemvori_core` (unchanged)
- PostgreSQL role: `lemvori_app`
- systemd: `lemvori-care.service`, `lemvori-care-network.service`,
  `lemvori-care-network-refresh.service`, `lemvori-care-network.timer`

### Verify IP without restarting the PC

```bash
sudo lemvori-carectl network
sudo lemvori-carectl address
sudo lemvori-carectl health
curl --cacert /etc/lemvori-care/ca/ca.crt https://127.0.0.1:8443/api/health
```

## Limitations

This is the new **server provisioning/auto-IP** path. Old
`/usr/local/sbin/solvia-admin` backup/restore actions in the native
Qt admin bridge are **not** part of this installer and need migration to
Lemvori Care before use. Configure automatic encrypted backups and
periodically test restore before storing real patient records.
