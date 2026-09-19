## 🌐 QA Certification: WordPress CMS & Web Hosting

> 📖 **Full step-by-step testing guide**: See the [WordPress CMS & Web Hosting Testing Playbook](docs/qa/playbooks/en/11_wordpress.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy WordPress Instance** (Pass rule: `Turns online and provides public HTTP web port URL.`)
- [ ] **Step 2: Complete 5-Minute Install Wizard** (Pass rule: `WordPress installs smoothly without prompting for DB credentials (auto-configured).`)
- [ ] **Step 3: Install Plugin & Upload Image** (Pass rule: `Media uploads cleanly and plugin activates without disk permission errors.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Dedicated Paired MariaDB Container** (`docker ps | grep wordpress`)
- [ ] **TC-DEV-2: Atomic Files + SQL Dump Backup** (`curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::wordpress"
