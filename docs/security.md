# Security

Model container hardening, the seccomp profile, and remote access over SSH.

## Model containers

Every model lane runs with:

| Setting | Effect |
|---|---|
| `cap_drop: [ALL]` | No Linux capabilities. |
| `no-new-privileges:true` | setuid binaries cannot gain privileges. |
| `networks: [vllm_internal]` | No egress. The network is `internal: true`; its other members are the gateway, validator and waker. |
| `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_HUB_CACHE=/models` | Nothing downloads at runtime. Weights come from `./models`, fetched with `bash tools/download-weights.sh <model-id>`. |
| `../models:/models:ro` | A lane cannot change any weights. Lanes run as root, so only the read-only mount stops them, and without capabilities they cannot remount it. |
| `../cache/<lane>/...` | Each lane has its own Hugging Face home and kernel, extension and compile caches. These hold code the lane runs, so one lane cannot plant code in another's. |

The settings come from the `x-model-common` and `x-env-common` anchors at the top of each
`compose/models-*.yml` (set per service in `models-liquid.yml`).
`tools/validate-stack.sh`, which CI runs, fails if a lane misses one or if two lanes share
a writable cache mount. Keep relaxations in an uncommitted override file
([below](#relaxing-a-lane-temporarily)).

Without capabilities, root in a lane cannot write to a host directory it does not own.
`./models` is only read, so it can belong to you. Docker creates the caches under
`./cache/<lane>/` as root. A cache directory owned by your user makes the lane fail with
`Permission denied`; fix it with `sudo chown -R root:root cache/<lane>`.

When you add a lane:

- Use the fragment anchors.
- Pin the revision. `download-weights.sh` fetches it, plus any draft model named in
  `--speculative-config`.
- Use `--distributed-executor-backend mp`, or set `VLLM_HOST_IP` if the lane uses Ray. Without a
  default route Ray cannot detect the node IP and never places the worker.

## Seccomp

Lanes run Docker's default seccomp profile. The exception is `qwen3.8-flash-next-nvfp4`,
whose disk reader uses io_uring, which the default profile blocks. That lane runs
[`seccomp-io-uring.json`](../custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json):
the moby default profile at commit `6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef`, plus
`io_uring_setup`, `io_uring_enter`, and `io_uring_register` for operations 0-3 only
(register and unregister buffers and files).

- `/proc/sys/kernel/io_uring_disabled` must be `0`. Check it after OS updates: `1` limits
  io_uring to `kernel.io_uring_group`, `2` disables it.
- Create the container from the repo root. Docker resolves the profile path against the
  working directory, not the compose file. `tools/run-model.sh` does this.
- Docker copies the profile into the container at creation. After editing the profile,
  recreate the container:

  ```bash
  docker compose --profile models up --no-start --force-recreate vllm-qwen3.8-flash-next-nvfp4
  ```

To regenerate the committed profile byte for byte, run the command below. Add new rules to
the `jq` array, and update the io_uring assertion in `tools/validate-stack.sh` with them.

```bash
curl -s -H 'Accept: application/vnd.github.raw' \
  'https://api.github.com/repos/moby/profiles/contents/seccomp/default.json?ref=6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef' |
jq '.syscalls += [
  {names: ["io_uring_setup", "io_uring_enter"], action: "SCMP_ACT_ALLOW", comment: "b12x PLE disk reader (liburing, no setup flags)"}
] + [range(0; 4) as $op | {names: ["io_uring_register"], action: "SCMP_ACT_ALLOW", args: [{index: 1, value: $op, valueTwo: 0, op: "SCMP_CMP_EQ"}], comment: "register/unregister buffers and files only"}]' \
  > custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json
```

### A lane fails with `Operation not permitted`

A syscall the profile denies fails with `EPERM`. To find and allow it:

1. Recreate the lane with `seccomp=unconfined` in an override ([below](#relaxing-a-lane-temporarily)).
   If it starts, the profile is the cause.
2. Copy the profile to `tmp/`, set `"defaultAction": "SCMP_ACT_LOG"`, point the override at
   the copy and start the lane. The kernel logs each call the profile would deny as
   `syscall=<number>` (`journalctl -k | grep -i seccomp`, or `/var/log/audit/audit.log`).
   On arm64 the numbers are in `/usr/include/asm-generic/unistd.h`.
3. Allow the narrowest rule: the syscall name, with `args` conditions when only some
   operations are needed. Add it to the command above, regenerate, update validate-stack,
   drop the override and recreate the container.

## Relaxing a lane temporarily

Use an override file under `tmp/`. Do not commit it.

```yaml
# tmp/lane-override.yml
services:
  vllm-gemma4-26b-a4b:
    security_opt: !override
      - no-new-privileges:true
      - seccomp=unconfined           # or seccomp=./tmp/profile.json
    cap_add: [SYS_PTRACE]            # only the capability you need
    networks: !override [vllm_internal, default]   # egress; also set HF_HUB_OFFLINE: "0"
```

```bash
# Apply, from the repo root
docker compose -f docker-compose.yml -f tmp/lane-override.yml --profile models \
  up -d --no-deps --force-recreate vllm-gemma4-26b-a4b
# Restore the committed shape
docker compose --profile models up --no-start --force-recreate vllm-gemma4-26b-a4b
```

## Remote access

The gateway binds to `127.0.0.1:8009`. Remote clients reach it through an SSH tunnel. The
gateway answers only `Host: localhost`, `127.0.0.1` or `host.docker.internal`, so clients
must use one of those names.

The steps below harden SSH and add a user `pfwd` that can only forward to port 8009. Two
layers enforce this, and each holds without the other: per-key options in
`authorized_keys`, and a `Match User pfwd` block in the SSH daemon config.

Check every config change with `sudo sshd -t` before `sudo systemctl reload ssh`.

### 1. Harden SSH

`/etc/ssh/sshd_config.d/10-hardening.conf`:

```ssh
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

### 2. Create the forwarding user

```bash
sudo adduser --disabled-password --shell /usr/sbin/nologin pfwd
sudo passwd -l pfwd
passwd -S pfwd                      # must show "pfwd L ..."
getent passwd pfwd | cut -d: -f7    # must show /usr/sbin/nologin
```

### 3. Install the client's key with restrictions

The client creates a key pair and sends you the public key only:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pfwd_key -C "pfwd-tunnel"
cat ~/.ssh/pfwd_key.pub
```

Install it with the restriction prefix. `restrict` disables every optional channel,
`port-forwarding` enables TCP forwarding again, and `permitopen` limits it to one target.

```bash
sudo install -d -m 700 -o pfwd -g pfwd /home/pfwd/.ssh
echo 'restrict,port-forwarding,permitopen="127.0.0.1:8009" ssh-ed25519 AAAA… pfwd-tunnel' \
  | sudo tee -a /home/pfwd/.ssh/authorized_keys
sudo chown pfwd:pfwd /home/pfwd/.ssh/authorized_keys
sudo chmod 600 /home/pfwd/.ssh/authorized_keys
```

Never install a key without the prefix. Add one line per key. To revoke a key, delete its
line; no reload is needed.

### 4. Restrict the user in the daemon

`/etc/ssh/sshd_config.d/20-pfwd-only.conf`:

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

```bash
sudo sshd -t
sudo systemctl reload ssh
```

### 5. Verify

All three must pass before you hand out access.

```bash
# A: no shell. Expect "This account is currently not available."
ssh -i /path/to/pfwd_key pfwd@SERVER

# B: the tunnel opens and stays silent. Ctrl-C to exit.
ssh -i /path/to/pfwd_key -N -T -o ExitOnForwardFailure=yes \
    -L 8009:127.0.0.1:8009 pfwd@SERVER

# C: any other target is refused. Expect "administratively prohibited".
ssh -i /path/to/pfwd_key -N -L 9999:127.0.0.1:9090 pfwd@SERVER
```

For C, the refusal appears when something connects to the local port, for example
`curl localhost:9999`.

### 6. Connect

On the client:

```bash
ssh -i ~/.ssh/pfwd_key -N -T \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=2 \
    -L 8009:127.0.0.1:8009 \
    pfwd@SERVER
```

The API is then at `http://localhost:8009/v1`.
