## 🧟 QA Certification: 7 Days to Die (The Fun Pimps)

> 📖 **Full step-by-step testing guide**: See the [7 Days to Die (The Fun Pimps) Testing Playbook](docs/qa/playbooks/en/07_sdtd.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy 7 Days to Die Server** (Pass rule: `Turns online and exposes UDP 26900 and TCP 26902 ports.`)
- [ ] **Step 2: Join Game with Easy Anti-Cheat (EAC)** (Pass rule: `EAC handshake passes and player enters the voxel world.`)
- [ ] **Step 3: Structural Integrity & Voxel Collapse** (Pass rule: `Upper floors collapse into physical rubble in exact sync across clients.`)
- [ ] **Step 4: Blood Moon 64-Zombie Horde Night** (Pass rule: `Zombies pathfind dynamically toward defenses without freezing server tickrate.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Binary Installation Integrity Verification** (`docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"`)
- [ ] **TC-DEV-2: Administrative Telnet Port Security** (`docker port <sdtd-container> | grep 26902`)
- [ ] **TC-DEV-3: serverconfig.xml Formatting & Persistence** (`cat <dataPath>/serverconfig.xml`)

/label ~"qa::in-progress" ~"game::sdtd"
