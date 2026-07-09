---
title: 'Mac mini GitHub Actions — Ephemeral VM CI'
---

## Why I looked this up

I was thinking through how to run self-hosted GitHub Actions on Mac mini hardware while keeping builds reproducible and the setup scalable. I worked through the design in a conversation with AI.

---

## What stood out

Mostly architecture notes — organizing the pieces before building anything.

---

## What I learned

### The problem: configuration drift on the host

Running the runner directly on the host macOS does **not** guarantee the same environment every time. Over time the machine drifts:

- Homebrew updates
- Xcode changes
- Simulator runtimes added
- DerivedData pollution
- SwiftPM cache changes
- Keychain state changes

The same commit can produce different results across machines. This is **configuration drift**.

### The fix: ephemeral VMs

Spin up a fresh VM for every build:

```
Golden Image → VM create → Build → VM delete
```

Each job starts from the same initial state, which improves reproducibility.

**Ephemeral** in CI means a runner or VM that handles one job and is then destroyed — the opposite of a persistent runner.

### Multiple Xcode versions in one VM

A single VM can hold several Xcode installs:

```
/Applications/Xcode_15.4.app
/Applications/Xcode_16.4.app
/Applications/Xcode_26_beta.app
```

Pick the toolchain per build:

```bash
DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer
```

Same VM image; only the selected Xcode changes.

### Golden image design (four layers)

| Layer | Contents | Notes |
|-------|----------|-------|
| **1. Golden image** | macOS, Xcode, Simulator runtime, Rosetta | Slow-changing base only |
| **2. Bootstrap script** | `brew bundle`, `bundle install`, `defaults write`, keychain unlock | Version-controlled in Git |
| **3. Secrets** | Signing keys, tokens | Injected at job start — never baked into the image |
| **4. Cache** | SwiftPM, DerivedData, etc. | Host or external store — not in the image |

### Ephemeral runner flow

Register with `config.sh --ephemeral`:

```
Job queued → VM created → Runner registered → Job runs → Runner auto-removed → VM deleted
```

The runner processes exactly one job, then unregisters.

### Orchestrator (Runner Manager)

GitHub does **not** create or destroy VMs for self-hosted runners. An **orchestrator** handles:

```
Watch queue → Create VM → SSH in → Register runner → Build → Delete VM
```

Core responsibilities:

1. Poll the GitHub Actions queue
2. Create VMs (Tart)
3. Resolve VM IP
4. SSH for bootstrap
5. Register ephemeral runner
6. Tear down VM on completion or failure

Suggested layout:

```
runner-manager/
  github/
  tart/
  ssh/
  scheduler/
```

### Existing options

| Option | Pros | Cons |
|--------|------|------|
| **ARC** (Actions Runner Controller) | Standard on Kubernetes | Poor fit for macOS / Tart |
| **Tart Examples** | Official samples | Reference code, not a product |
| **Custom Runner Manager** | Fits Mac mini fleet | You own queue, slots, and failure recovery |

For roughly **10–20 Mac minis**, a small custom orchestrator in Go or Python is the most practical path.

### Recommended topology

```
GitHub Actions
       │
       ▼
Runner Manager
       │
   ┌───┴───┐
   ▼       ▼
Mac #1   Mac #2
   │       │
 Tart    Tart
   │       │
Golden  Golden
   │       │
Clone   Clone → VM → bootstrap.sh → config.sh --ephemeral → Build → cleanup
```

### Operating principles

1. **Keep the host minimal** — Tart plus light management tooling only.
2. **Golden image = OS + Xcode** — do not bake fast-moving tools into the image.
3. **Codify environment in bootstrap scripts** — Brewfile, Gemfile, `bootstrap.sh` in Git.
4. **Always build in ephemeral VMs** — one job = one VM = one runner.
5. **Runner Manager owns VM lifecycle** — create, register, destroy.

### Minimum Runner Manager features

Enough to run a small Mac mini fleet reliably:

- Watch the GitHub Actions queue
- Create and delete Tart VMs
- Initialize VMs over SSH
- Auto-register ephemeral runners
- Per-host VM slot limits
- Auto-cleanup on failure (stuck VMs, cancelled jobs)
