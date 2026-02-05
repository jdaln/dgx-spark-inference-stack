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

Create a dedicated user (`pfwd`) that can only forward traffic to the gateway port (`8009`) and cannot get a shell.

1. **Create the restricted user**:
   ```bash
   sudo adduser --disabled-password --shell /usr/sbin/nologin pfwd
   sudo passwd -l pfwd
   ```
2. **Install the SSH public key**:
   On your client machine, generate a key: `ssh-keygen -t ed25519 -f ~/.ssh/pfwd_ed25519`.
   Then, on the server:
   ```bash
   sudo mkdir -p /home/pfwd/.ssh
   sudo nano /home/pfwd/.ssh/authorized_keys # Paste the .pub key here
   sudo chown -R pfwd:pfwd /home/pfwd/.ssh
   sudo chmod 700 /home/pfwd/.ssh
   sudo chmod 600 /home/pfwd/.ssh/authorized_keys
   ```
3. **Configure restricted access**:
   ```bash
   sudo nano /etc/ssh/sshd_config.d/20-pfwd-only.conf
   ```
   Paste the following (tailored for port 8009):
   ```ssh
   Match User pfwd
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
4. **Apply changes**:
   ```bash
   sudo sshd -t
   sudo systemctl reload ssh
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
