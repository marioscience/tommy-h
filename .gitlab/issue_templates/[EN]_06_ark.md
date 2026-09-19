## 🦖 QA Certification: ARK: Survival Ascended / Evolved

> 📖 **Full step-by-step testing guide**: See the [ARK: Survival Ascended / Evolved Testing Playbook](docs/qa/playbooks/en/06_ark.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy ARK Server** (Pass rule: `Boots cleanly and initializes TheIsland_WP.`)
- [ ] **Step 2: Join Server from In-Game Browser** (Pass rule: `Loads map data and prompts survivor spawn screen on beach.`)
- [ ] **Step 3: Ride Dinosaur & Tree Collision Sync** (Pass rule: `Creature moves smoothly; foliage destructions replicate in sync across players.`)
- [ ] **Step 4: Obelisk Clustered Transfer Test** (Pass rule: `Creature transfers with stats, level, and inventory intact.`)
- [ ] **Step 5: Force Engine Version Update** (Pass rule: `Server purges manifest and SteamCMD re-validates engine files upon restart.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Proton/Wine Elevated Capabilities** (`docker inspect <ark-container> | grep -A 10 "CapAdd"`)
- [ ] **TC-DEV-2: Cross-ARK Cluster Shared Volume Mount** (`docker inspect <ark-container> | grep -i "cluster"`)
- [ ] **TC-DEV-3: Atomic Removal of appmanifest_2430930.acf** (`ls -la <dataPath>/steamapps/`)

/label ~"qa::in-progress" ~"game::ark"
