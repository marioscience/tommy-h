## 🚀 QA Certification: Platform Roadmap & Feature Testing Readiness

> 📖 **Full step-by-step testing guide**: See the [Platform Roadmap & Feature Testing Readiness Testing Playbook](docs/qa/playbooks/en/00_roadmap.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Verify Instant Deployment in Web Panel** (Pass rule: `Server creates, shows "Online" in under 2 minutes, and displays its public IP.`)
- [ ] **Step 2: Test Monaco Code Editor** (Pass rule: `Editor highlights syntax and saves cleanly without refreshing the browser.`)
- [ ] **Step 3: Test Marketplace Vault Protection** (Pass rule: `System denies action with "Vault Protection: Protected source file".`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: DDoS Mitigation with OxideProxy eBPF/XDP** (`docker logs ragenodes_oxideproxy | grep -i "ebpf"`)
- [ ] **TC-DEV-2: Rank-Based Backup Priority Queue** (`docker exec -it ragenodes_backend node -e "import('./src/services/backupQueue.js').then(m => console.log(m.backupQueue))"`)
- [ ] **TC-DEV-3: Multi-Node Hot Migration** (`curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"`)
- [ ] **TC-DEV-4: SSE LogHub Streaming & 15s Heartbeat** (`curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::roadmap"
