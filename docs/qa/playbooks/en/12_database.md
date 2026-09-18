# 🗄️ QA Testing Playbook: Standalone Database (MariaDB / MySQL)

> **Objective**: Dedicated MariaDB instance with phpMyAdmin SSO, remote connections, and 100MB SQL import stress test.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%97%84%EF%B8%8F+Standalone+Database+%28MariaDB+%2F+MySQL%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Adatabase&issue%5Bdescription%5D=%23%23+%F0%9F%97%84%EF%B8%8F+QA+Certification%3A+Standalone+Database+%28MariaDB+%2F+MySQL%29%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BStandalone+Database+%28MariaDB+%2F+MySQL%29+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F12_database.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Database+Instance**+%28Pass+rule%3A+%60Status+turns+green+and+displays+mapped+MySQL+port+3306.%60%29%0A-+%5B+%5D+**Step+2%3A+Open+phpMyAdmin+with+1-Click+SSO**+%28Pass+rule%3A+%60phpMyAdmin+loads+with+session+pre-authenticated+into+user+database.%60%29%0A-+%5B+%5D+**Step+3%3A+Create+Table+%26+Run+Query**+%28Pass+rule%3A+%60Table+creates+and+SELECT+query+displays+record+cleanly.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+External+Remote+Client+Connection**+%28%60mysql+-h+%3CnodeIp%3E+-P+%3CpublicPort%3E+-u+%3CdbUser%3E+-p%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+100MB+SQL+Dump+Import+Stress+Test**+%28%60mysql+-h+localhost+-P+%3Cport%3E+-u+root+-p+%3C+big_dump.sql%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Adatabase%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Database Instance 🎮
- **What to do**: Create database instance in panel and click Start.
- ✅ **PASSED IF**: Status turns green and displays mapped MySQL port 3306.
- ❌ **FAILED IF**: Container startup failure.

### Step 2: Open phpMyAdmin with 1-Click SSO 🎮
- **What to do**: Click "Open phpMyAdmin" button in panel.
- ✅ **PASSED IF**: phpMyAdmin loads with session pre-authenticated into user database.
- ❌ **FAILED IF**: Prompts for credentials or access denied.

### Step 3: Create Table & Run Query 🎮
- **What to do**: Inside phpMyAdmin, create test table with 2 columns and insert 1 row.
- ✅ **PASSED IF**: Table creates and SELECT query displays record cleanly.
- ❌ **FAILED IF**: Permission denied error.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: External Remote Client Connection ⚙️
- **Command / Action**: `mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p`
- **Pass Criteria**: Allows remote TCP connection from external tools (DBeaver, HeidiSQL) with TLS encryption.

### Tech Check 2: 100MB SQL Dump Import Stress Test ⚙️
- **Command / Action**: `mysql -h localhost -P <port> -u root -p < big_dump.sql`
- **Pass Criteria**: Bulk insertion executes without exhausting innodb_buffer_pool memory.

