## 🪓 QA Certification: Valheim Dedicated Server

> 📖 **Full step-by-step testing guide**: See the [Valheim Dedicated Server Testing Playbook](docs/qa/playbooks/en/08_valheim.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Valheim Server with Valid Password** (Pass rule: `Boots online and initializes viking world on UDP port 2456.`)
- [ ] **Step 2: Join from PC and Console (Crossplay)** (Pass rule: `Both players spawn at the sacrificial stones.`)
- [ ] **Step 3: Massive Terrain Deformation Sync** (Pass rule: `Voxel terrain mesh deformation syncs in real time without visual glitching.`)
- [ ] **Step 4: Stormy Ocean Longship Sailing** (Pass rule: `Boat displacement and water physics sync smoothly; passengers remain firmly on board.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: -crossplay Startup Flag Verification** (`docker inspect <valheim-container> | grep -i "crossplay"`)
- [ ] **TC-DEV-2: UDP Port Triplet Forwarding** (`docker port <valheim-container>`)
- [ ] **TC-DEV-3: Access List Persistence (adminlist / bannedlist)** (`cat <dataPath>/adminlist.txt`)

/label ~"qa::in-progress" ~"game::valheim"
