## 🗄️ QA Certification: Standalone Database (MariaDB / MySQL)

> 📖 **Full step-by-step testing guide**: See the [Standalone Database (MariaDB / MySQL) Testing Playbook](docs/qa/playbooks/en/12_database.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Database Instance** (Pass rule: `Status turns green and displays mapped MySQL port 3306.`)
- [ ] **Step 2: Open phpMyAdmin with 1-Click SSO** (Pass rule: `phpMyAdmin loads with session pre-authenticated into user database.`)
- [ ] **Step 3: Create Table & Run Query** (Pass rule: `Table creates and SELECT query displays record cleanly.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: External Remote Client Connection** (`mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p`)
- [ ] **TC-DEV-2: 100MB SQL Dump Import Stress Test** (`mysql -h localhost -P <port> -u root -p < big_dump.sql`)

/label ~"qa::in-progress" ~"game::database"
