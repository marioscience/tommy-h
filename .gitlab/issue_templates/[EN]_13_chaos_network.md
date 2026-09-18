## ⚡ QA Certification: Adverse Network & Chaos Netcode Testing

> 📖 **Full step-by-step testing guide**: See the [Adverse Network & Chaos Netcode Testing Testing Playbook](docs/qa/playbooks/en/13_chaos_network.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Play under 150ms Latency (High Ping)** (Pass rule: `Gameplay remains smooth; client-side prediction masks delay without rubberbanding.`)
- [ ] **Step 2: Rapid Disconnect & Reconnect Recovery** (Pass rule: `Player reconnects into the active session at the exact same location with inventory intact.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: 200ms Latency Injection with tc-netem** (`tc qdisc add dev docker0 root netem delay 200ms 20ms`)
- [ ] **TC-DEV-2: Packet Loss Injection (5% & 20% bursts)** (`tc qdisc change dev docker0 root netem loss 5%`)
- [ ] **TC-DEV-3: Packet Reordering (Jitter & Out-of-Order)** (`tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%`)
- [ ] **TC-DEV-4: Bandwidth Throttling to 64 kbps** (`tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms`)
- [ ] **TC-DEV-5: Abrupt Container Termination (SIGKILL)** (`docker kill <container-name>`)

/label ~"qa::in-progress" ~"game::chaos"
