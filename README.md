<div align="center">
  <img src="frontend/public/assets/icon.png" alt="RageNodes Logo" width="150" />
  <h1>🎮 RageNodes Ultimate</h1>
  <p><strong>The Most Advanced, Self-Hosted Web Panel for Game Servers & Discord Bots</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" />
  </p>
</div>

<br/>

## 🚀 Overview
**RageNodes Ultimate** is an all-in-one, ultra-fast hosting control panel designed to deploy and manage isolated containers with a single click. Built with a beautiful modern glassmorphism UI, a robust Node.js backend, and a blazing-fast Rust reverse proxy.

Whether you're running a massive FiveM roleplay community or a private Rust server, RageNodes gives you complete control over your hardware without the monthly fees of commercial panels.

## 🌟 Key Features
- **🕹️ 1-Click Game Servers:** Deploy and manage FiveM, Rust, Minecraft, Palworld, 7 Days to Die, Ark: Survival Ascended, Project Zomboid, and more.
- **🤖 Discord Bot Hosting:** Secure, isolated containers for Node.js and Python Discord bots.
- **⚡ OxideProxy (Rust):** Custom, hyper-optimized Layer 4/Layer 7 reverse proxy written in Rust to handle high-traffic game networking, DDoS mitigation, and SSL termination.
- **🐳 Docker-Native:** Every server runs inside strict, secure, resource-limited Docker containers.
- **📊 Live Analytics:** Real-time CPU, RAM, and Disk usage monitoring for all running instances.
- **🎨 Premium UI:** Fully responsive, modern, dark-themed dashboard with fluid micro-animations.

## 🛠️ Technology Stack
* **Frontend:** Vanilla JS, HTML5, Modern CSS (Glassmorphism, Animations)
* **Backend:** Node.js, Express, SQLite/PostgreSQL
* **Networking/Proxy:** Rust (`oxideproxy`), eBPF
* **Containerization:** Docker, Docker Compose
* **OS Support:** Debian / Ubuntu / Proxmox LXC

## 🖥️ Supported Services & Games

### 🎮 Game Servers
| Game | Engine | Status |
|---|---|---|
| **FiveM** (GTA V) | FXServer | ✅ Fully Supported |
| **Rust** | Unity | ✅ Fully Supported |
| **Minecraft** | Java/Bedrock | ✅ Fully Supported |
| **Counter-Strike 2** | Source 2 | ✅ Fully Supported |
| **Valheim** | Unity | ✅ Fully Supported |
| **Palworld** | Unreal | ✅ Fully Supported |
| **7 Days to Die** | Unity | ✅ Fully Supported |
| **Ark: Survival Evolved/Ascended** | Unreal | ✅ Fully Supported |
| **Project Zomboid** | Java | ✅ Fully Supported |

### 🛠️ Hosting & Applications
| Service | Environment | Status |
|---|---|---|
| **Discord Bots** | Node.js / Python | ✅ Fully Supported |
| **WordPress & Web Hosting** | Nginx / PHP | ✅ Fully Supported |
| **Dedicated Databases** | MySQL / MariaDB / PostgreSQL | ✅ Fully Supported |

## ⚙️ Installation & Usage
*(Detailed installation guide coming soon...)*

1. Clone the repository to your Linux server:
   ```bash
   git clone https://github.com/Noko34/ragenodes-ultimate.git
   cd ragenodes-ultimate
   ```
2. Install dependencies:
   ```bash
   cd backend && npm install
   ```
3. Start the core panel services using Docker Compose:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
   ```
4. Access the web dashboard at `http://YOUR_SERVER_IP:3000`

## 🛡️ Security & production checklist

Game containers use resource limits, `no-new-privileges`, a minimal capability allowlist and rotated logs. ARK additionally has a bounded process count and a reduced compatibility allowlist; Minecraft authentication is enabled by default. OxideProxy generates a cryptographic CSP nonce for every HTML response, restricts external origins, applies COEP to views that do not embed payments, and limits the admin, Oxide and phpMyAdmin surfaces to the local network. The Oxide control panel is internal-only, requires an authenticated administrator, validates the origin of every mutation, uses only locally hosted browser assets and has no Docker socket or published port. All directly served application pages, including the panel and administration, use same-origin event modules or CSP-safe closure bindings and enforce `script-src-attr 'none'` without `eval`.

Local development deliberately uses HTTP and may use Docker Desktop's rootful socket, but its published panel/API ports bind to `127.0.0.1`. Do not expose that configuration to a public network.

Docker Desktop development disables optional blkio weighting (`DOCKER_BLKIO_WEIGHT=0`) because its cgroup setup may not expose `io.weight`. Production Linux nodes may set a value from 10 to 1000 after verifying that the I/O controller is enabled.

PayPal is disabled when `PAYPAL_CLIENT` or `PAYPAL_SECRET` is empty. Its public client identifier is delivered from the backend only when payments are configured, the SDK is loaded on demand with the response CSP nonce, and non-production environments reject `PAYPAL_MODE=live`. Webhooks default to disabled and cannot be enabled with configured payment credentials until `PAYPAL_WEBHOOK_ID` is present.

Production starts only when all of these conditions are met:

- `NODE_ENV=production`, `PUBLIC_BASE_URL` and every `CORS_ORIGIN` use HTTPS.
- `COOKIE_SECURE=true` and `COOKIE_SAMESITE=Strict`.
- `DOCKER_SOCKET=/run/user/<uid>/docker.sock` points to a rootless Docker daemon.
- Remote Docker nodes use port 2376 with mTLS certificates.
- `ALLOW_INSECURE_DOCKER_NODES=false`.
- Secrets are generated outside Git from `.env.example`; `.env`, certificates, backups and reports remain ignored.

`ALLOW_ROOTFUL_DOCKER_SOCKET=true` is only an explicit break-glass compatibility override. A mounted rootful Docker socket remains equivalent to host-administrator access even when the mount is marked read-only. It is not considered a secure production configuration.

For the Linux development stack, start the security-test services and run the local contracts:

```bash
npm run security:stack
npm run security:containers
npm run security:authz-http
npm run security:browser
npm run security:csp-bindings
npm run security:inline-code
npm run security:secrets
npm run security:routes
```

Before every public release, also run dependency audits and an OWASP ZAP baseline against a staging deployment. These checks reduce risk but do not replace an independent authenticated penetration test. The ARK runtime compatibility test still requires the pinned multi-gigabyte game image and should be performed on a disposable game node before release.

The GitLab pipeline runs the candidate-file secret scan, first-party inline-code checks and CSP closure-binding fixture for every branch and merge request. GitLab Secret Detection remains enabled as an independent scanner.

## 🤝 Contributors
* [@marioscience](https://github.com/marioscience)

## 📜 License
This project is for private/personal use. Please ensure you comply with the respective EULAs and TOS of the game servers (FiveM, SteamCMD, etc.) you intend to host.
