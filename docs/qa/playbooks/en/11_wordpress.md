# 🌐 QA Testing Playbook: WordPress CMS & Web Hosting

> **Objective**: Apache + PHP with paired MariaDB, auto wp-config.php, and atomic backup of files + mysqldump.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%8C%90+WordPress+CMS+%26+Web+Hosting&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Awordpress&issue%5Bdescription%5D=%23%23+%F0%9F%8C%90+QA+Certification%3A+WordPress+CMS+%26+Web+Hosting%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BWordPress+CMS+%26+Web+Hosting+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F11_wordpress.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+WordPress+Instance**+%28Pass+rule%3A+%60Turns+online+and+provides+public+HTTP+web+port+URL.%60%29%0A-+%5B+%5D+**Step+2%3A+Complete+5-Minute+Install+Wizard**+%28Pass+rule%3A+%60WordPress+installs+smoothly+without+prompting+for+DB+credentials+%28auto-configured%29.%60%29%0A-+%5B+%5D+**Step+3%3A+Install+Plugin+%26+Upload+Image**+%28Pass+rule%3A+%60Media+uploads+cleanly+and+plugin+activates+without+disk+permission+errors.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Dedicated+Paired+MariaDB+Container**+%28%60docker+ps+%7C+grep+wordpress%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Atomic+Files+%2B+SQL+Dump+Backup**+%28%60curl+-X+POST+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fservers%2F%3Cid%3E%2Fbackup+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Awordpress%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy WordPress Instance 🎮
- **What to do**: Deploy WordPress in panel and click Start.
- ✅ **PASSED IF**: Turns online and provides public HTTP web port URL.
- ❌ **FAILED IF**: Database linkage failure.

### Step 2: Complete 5-Minute Install Wizard 🎮
- **What to do**: Open web URL in browser, set site title, and create admin user.
- ✅ **PASSED IF**: WordPress installs smoothly without prompting for DB credentials (auto-configured).
- ❌ **FAILED IF**: Error establishing a database connection error.

### Step 3: Install Plugin & Upload Image 🎮
- **What to do**: Log into /wp-admin, upload an image to media library, and install a plugin (e.g. WooCommerce).
- ✅ **PASSED IF**: Media uploads cleanly and plugin activates without disk permission errors.
- ❌ **FAILED IF**: Unable to create directory wp-content/uploads error.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Dedicated Paired MariaDB Container ⚙️
- **Command / Action**: `docker ps | grep wordpress`
- **Pass Criteria**: App container links to dedicated <name>-db instance over private isolated bridge network.

### Tech Check 2: Atomic Files + SQL Dump Backup ⚙️
- **Command / Action**: `curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"`
- **Pass Criteria**: Backup archive packages both /var/www/html files and synchronized mysqldump file.

