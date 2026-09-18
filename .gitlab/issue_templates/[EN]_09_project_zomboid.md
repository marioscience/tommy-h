## 🧟‍♂️ QA Certification: Project Zomboid Dedicated Server

> 📖 **Full step-by-step testing guide**: See the [Project Zomboid Dedicated Server Testing Playbook](docs/qa/playbooks/en/09_project_zomboid.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Server & Boot** (Pass rule: `Status turns green ("Online") and displays ports 16261 and 16262.`)
- [ ] **Step 2: 1-Click Steam Workshop Mod Install** (Pass rule: `Panel confirms install and startup log verifies SteamCMD downloading mod files.`)
- [ ] **Step 3: Two-Player Co-op Join** (Pass rule: `Both spawn in starting house, see each other move, and local chat functions.`)
- [ ] **Step 4: Highway 70 MPH Road Trip (Vehicle Desync)** (Pass rule: `Passenger remains firmly seated; road tiles render ahead without void holes.`)
- [ ] **Step 5: Shotgun Horde Combat & Hitreg** (Pass rule: `Melee swings knock zombies back instantly; zero ghost bites from distance.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Safe JVM Headspace Calculation** (`docker inspect <pz-container> | grep MAX_RAM`)
- [ ] **TC-DEV-2: Dual UDP Port Routing (16261 & 16262)** (`docker port <pz-container>`)
- [ ] **TC-DEV-3: Abrupt Disconnect & Reconnect Recovery** (`tc qdisc add dev docker0 root netem loss 10%`)
- [ ] **TC-DEV-4: Clean Teardown & Volume Purge** (`docker ps -a | grep zomboid`)

/label ~"qa::in-progress" ~"game::zomboid"
