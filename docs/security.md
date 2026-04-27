# Remote Access & SSH Hardening

To securely access the inference stack from a remote machine, follow this guide to harden your SSH configuration and set up a restricted port-forwarding user.

## 1. Baseline SSH Hardening

Always validate your configuration with `sudo sshd -t` before applying changes with `sudo systemctl reload ssh`.

1. **Create a hardening config drop-in**:
   ```bash
   sudo nano /etc/ssh/sshd_config.d/10-hardening.conf
   ```
2. **Paste the following configuration**:
   ```ssh
   # --- SSHD hardening baseline ---
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PubkeyAuthentication yes
   AuthenticationMethods publickey
   PermitEmptyPasswords no
   MaxAuthTries 3
   LoginGraceTime 30
   X11Forwarding no
   AllowAgentForwarding no
   PermitTunnel no
   GatewayPorts no
   AllowTcpForwarding no
   AllowStreamLocalForwarding no
   ClientAliveInterval 300
   ClientAliveCountMax 2
   LogLevel VERBOSE
   ```
3. **Validate and apply**:
   ```bash
   sudo sshd -t
   sudo systemctl reload ssh
   ```

## 2. Restricted Port Forwarding User

Create a dedicated `pfwd` user that can **only** forward traffic to the gateway port (8009) — no shell, no password, no lateral movement.

### Protection layers

Two independent restriction layers are applied so that a misconfiguration in one does not expose the server:

| Layer | Mechanism | Where |
|---|---|---|
| 1st | Per-key options in `authorized_keys` | evaluates at key authentication time |
| 2nd | `sshd_config` `Match User pfwd` block | enforced by the daemon regardless of key options |

Both layers must individually pass. A friend's key that somehow lacks the `restrict` prefix is still blocked by the Match block, and vice-versa.

### What the account can and cannot do

- **Cannot** get an interactive shell (`/usr/sbin/nologin` shell + `ForceCommand`)
- **Cannot** authenticate with a password (locked + pubkey-only)
- **Cannot** forward to any port other than `127.0.0.1:8009`
- **Cannot** open agent/X11/tunnel channels
- **Can** hold a TCP local-forward to `127.0.0.1:8009` only

---

### Step 1 — Create the system user

```bash
sudo adduser --disabled-password --shell /usr/sbin/nologin pfwd
sudo passwd -l pfwd
```

Verify the account is locked and has no shell:

```bash
passwd -S pfwd          # must show "pfwd L ..." (L = locked)
getent passwd pfwd | cut -d: -f7   # must show /usr/sbin/nologin
```

---

### Step 2 — Obtain the friend's public key

The friend generates their own keypair on their own machine and sends you **only** the `.pub` file content (copy-paste is fine — the public key is not secret):

```bash
# Friend runs this on their machine:
ssh-keygen -t ed25519 -f ~/.ssh/pfwd_key -C "pfwd-tunnel"
cat ~/.ssh/pfwd_key.pub   # copy this line and send it
```

> The private key (`pfwd_key`) **never leaves the friend's machine**. You only ever receive and install the `.pub` content.

---

### Step 3 — Install the public key with per-key restrictions

On the **server**, set up the `.ssh` directory and add the key with `authorized_keys` option prefixes. The `restrict` keyword disables every optional channel (pty, X11, agent, forwarding); `port-forwarding` selectively re-enables TCP forwarding; `permitopen` caps it to exactly one destination.

```bash
sudo mkdir -p /home/pfwd/.ssh
sudo chown pfwd:pfwd /home/pfwd/.ssh
sudo chmod 700 /home/pfwd/.ssh

# Replace the placeholder below with the actual key content the friend sent
PUBKEY="restrict,port-forwarding,permitopen=\"127.0.0.1:8009\" ssh-ed25519 AAAA…friendskey pfwd-tunnel"
echo "$PUBKEY" | sudo tee /home/pfwd/.ssh/authorized_keys

sudo chown pfwd:pfwd /home/pfwd/.ssh/authorized_keys
sudo chmod 600 /home/pfwd/.ssh/authorized_keys
```

The installed line must look exactly like this (the prefix options come **before** the key type):

```
restrict,port-forwarding,permitopen="127.0.0.1:8009" ssh-ed25519 AAAA…key pfwd-tunnel
```

Do **not** paste the bare public key without the prefix — that would grant unrestricted forwarding to any port if the Match block were ever misconfigured.

---

### Step 4 — Add the sshd_config Match block (second layer)

```bash
sudo nano /etc/ssh/sshd_config.d/20-pfwd-only.conf
```

Paste:

```ssh
Match User pfwd
    # Second restriction layer — enforced by the daemon independently of key options.
    # ForceCommand is redundant with the nologin shell but provides belt-and-suspenders:
    # even if someone swaps the shell, the daemon still rejects interactive sessions.
    ForceCommand /usr/sbin/nologin
    PermitTTY no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:8009
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    AllowStreamLocalForwarding no
    GatewayPorts no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AuthenticationMethods publickey
Match all
```

---

### Step 5 — Validate and apply

```bash
sudo sshd -t                  # must print nothing (no errors)
sudo systemctl reload ssh
```

---

### Step 6 — Verify the hardening

Run all three checks before handing the key to the friend:

**Check A — Shell access is blocked**

```bash
ssh -i /path/to/pfwd_key pfwd@YOUR_SERVER_IP
# Expected: "This account is currently not available." then connection closes.
# A shell prompt here means the hardening failed — do not proceed.
```

**Check B — Port 8009 tunnel works**

```bash
ssh -i /path/to/pfwd_key -N -T \
    -o ExitOnForwardFailure=yes \
    -L 8009:127.0.0.1:8009 \
    pfwd@YOUR_SERVER_IP
# Expected: command hangs silently (tunnel is open). Ctrl-C to exit.
# An immediate error means the tunnel failed — check sshd -t and authorized_keys prefix.
```

**Check C — Any other port is rejected**

```bash
ssh -i /path/to/pfwd_key -N \
    -L 9999:127.0.0.1:9090 \
    pfwd@YOUR_SERVER_IP
# Expected: "open failed: administratively prohibited: open failed"
# If this succeeds, the PermitOpen restriction is not working — do not proceed.
```

All three checks must pass before sharing access.

---

### Adding more friends / revoking access

**Add another key:** append one more `restrict,…` line to `/home/pfwd/.ssh/authorized_keys` — one line per key. No `sshd` reload is needed.

```bash
# Append a second friend's key
echo 'restrict,port-forwarding,permitopen="127.0.0.1:8009" ssh-ed25519 AAAA…key2 friend2' \
    | sudo tee -a /home/pfwd/.ssh/authorized_keys
```

**Revoke a key:** delete the specific line for that key from `authorized_keys`. The change takes effect immediately for new connections; no reload needed.

```bash
sudo nano /home/pfwd/.ssh/authorized_keys   # delete the line for the revoked key
```

## 3. Client Usage

To connect from your local machine and expose the server's gateway locally:

```bash
ssh -i ~/.ssh/pfwd_ed25519 -N -T \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=2 \
    -L 8009:127.0.0.1:8009 \
    pfwd@YOUR_SERVER_IP
```

Now you can reach the API at `http://localhost:8009/v1`.
