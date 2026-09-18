## 🚗 QA Certification: FiveM (GTA V RP FXServer)

> 📖 **Full step-by-step testing guide**: See the [FiveM (GTA V RP FXServer) Testing Playbook](docs/qa/playbooks/en/01_fivem.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy & Boot FiveM Server** (Pass rule: `Status flips to "Online", displays public game IP and txAdmin access.`)
- [ ] **Step 2: Open txAdmin Web Interface** (Pass rule: `txAdmin loads over HTTPS without security warnings and allows admin login.`)
- [ ] **Step 3: In-Game Connection & Spawn** (Pass rule: `Both players load into Los Santos, see each other move, and proximity voice chat works.`)
- [ ] **Step 4: High-Speed 200 km/h Highway Test** (Pass rule: `Passenger remains smoothly seated inside car; road and buildings stream without pop-in.`)
- [ ] **Step 5: Test Blender WebTop 3D Editor** (Pass rule: `Blender 3D interface loads in browser, ready to edit .ydr/.yft vehicle models.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Port Offsets & OxideProxy L4 Routing** (`docker port <fivem-container>`)
- [ ] **TC-DEV-2: MariaDB Privilege Isolation** (`docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR '<db_user>'@'%';"`)
- [ ] **TC-DEV-3: Blender WebTop Heartbeat Auto-Shutdown** (`docker ps | grep blender`)
- [ ] **TC-DEV-4: Authoritative Hitreg under Simulated Latency** (`tc qdisc add dev docker0 root netem delay 120ms`)

/label ~"qa::in-progress" ~"game::fivem"
