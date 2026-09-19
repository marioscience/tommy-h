import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT_DIR, 'docs', 'qa', 'qa_state.json');
const README_FILE = path.join(ROOT_DIR, 'README.md');

const PLAYBOOK_FILES = {
  fivem: '01_fivem.md',
  minecraft: '02_minecraft.md',
  rust: '03_rust.md',
  palworld: '04_palworld.md',
  cs2: '05_cs2.md',
  ark: '06_ark.md',
  sdtd: '07_sdtd.md',
  valheim: '08_valheim.md',
  zomboid: '09_project_zomboid.md',
  discordbot: '10_discord_bot.md',
  wordpress: '11_wordpress.md',
  database: '12_database.md',
  chaos: '13_chaos_network.md'
};

/**
 * Helper to fetch GitLab issues if running inside GitLab CI with token
 */
async function fetchGitLabIssues() {
  const apiUrl = process.env.CI_API_V4_URL;
  const projectId = process.env.CI_PROJECT_ID;
  const token = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;

  if (!apiUrl || !projectId || !token) {
    return null;
  }

  try {
    const res = await fetch(`${apiUrl}/projects/${projectId}/issues?labels=qa&per_page=100`, {
      headers: {
        'PRIVATE-TOKEN': token,
        'JOB-TOKEN': token
      }
    });
    if (!res.ok) {
      console.warn(`[sync_qa_readme] GitLab API returned status ${res.status}; falling back to qa_state.json`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[sync_qa_readme] Failed to query GitLab API (${err.message}); falling back to qa_state.json`);
    return null;
  }
}

function computeStatusBadge(completed, total, isDevDone = false) {
  if (total === 0) return { en: '⚪ Pending', es: '⚪ Pendiente' };
  if (completed === 0) return { en: '⚪ Queued', es: '⚪ En Cola' };
  if (completed < total) return { en: `🟡 In Progress (${Math.round((completed / total) * 100)}%)`, es: `🟡 En Progreso (${Math.round((completed / total) * 100)}%)` };
  if (isDevDone) return { en: '🟢 **100% Certified**', es: '🟢 **100% Certificado**' };
  return { en: '🟢 **Gameplay Ready**', es: '🟢 **Listo para Jugadores**' };
}

function renderEnglishSection(state) {
  const roadmapPct = state.roadmap.total_tasks > 0 
    ? Math.round((state.roadmap.completed_tasks / state.roadmap.total_tasks) * 100) 
    : 0;
  
  const roadmapStatus = state.roadmap.completed_tasks === state.roadmap.total_tasks && state.roadmap.total_tasks > 0
    ? '🟢 Completed'
    : state.roadmap.completed_tasks > 0 ? `🟡 Active (${roadmapPct}%)` : '🔵 Planned';

  let out = `<!-- QA_STATUS_EN_START -->\n`;
  out += `### 🧭 Quick Start Guide: How to Run a QA Test\n\n`;
  out += `Anyone on the team can test a game server—even with zero technical background:\n\n`;
  out += `1. **Create the Tracking Issue**: Click **🚀 Start** next to your game in the matrix below (or open the [Testing Playbook](docs/qa/playbooks/en/) and click the 1-click launch button). The issue opens in GitLab with title, labels, and checkboxes pre-filled! (Alternatively, in GitLab go to **Issues $\\rightarrow$ New Issue** and choose the template once merged).\n`;
  out += `2. **🎮 Gamer QA Phase (Non-Technical)**: Open the game's [Testing Playbook](docs/qa/playbooks/en/), deploy the server in the web panel, play the game with a teammate (test driving, combat, hordes, mods), and check off the **Part 1** boxes in the issue.\n`;
  out += `3. **Pass the Baton**: Leave a comment tagging the developers: \`@devs Finished gamer testing! Ready for technical checks.\`\n`;
  out += `4. **⚙️ Dev QA Phase (Developers)**: A developer spends 3 minutes running the terminal/Docker verification commands in **Part 2** (RAM cgroups, port offsets, chaos netem, clean teardown).\n`;
  out += `5. **Sync to README**: Close the issue with label \`qa::certified\`. The table below updates automatically via CI (or run \`npm run sync:qa\`).\n\n`;
  out += `### 🚀 Platform Roadmap & Feature Readiness\n\n`;
  out += `| Feature / Milestone | Checklist Progress | Status | Lead / Auditor | Last Audit |\n`;
  out += `| :--- | :---: | :---: | :---: | :---: |\n`;
  const roadmapPlaybookEn = 'docs/qa/playbooks/en/00_roadmap.md';
  const roadmapLinkEn = (state.roadmap.issue_url && state.roadmap.issue_url.startsWith('http')) 
    ? state.roadmap.issue_url 
    : roadmapPlaybookEn;
  const roadmapStartEn = state.roadmap.new_issue_url_en ? ` • [🚀 Start](${state.roadmap.new_issue_url_en})` : '';
  out += `| 🛠️ [**${state.roadmap.title}**](${roadmapLinkEn})${roadmapStartEn} | \`${state.roadmap.completed_tasks}/${state.roadmap.total_tasks}\` (${roadmapPct}%) | ${roadmapStatus} | ${state.roadmap.auditor} | ${state.roadmap.last_audit} |\n\n`;

  out += `### 🎮 Verified Game Server Engines & QA Matrix\n\n`;
  out += `> 💡 **How testing works**: Tests are split into **🎮 Gamer QA** (tested by in-game players in live sessions) and **⚙️ Dev QA** (deep systems checks on memory cgroups, port forwarding, and adverse netcode). Full testing playbooks: [\`docs/qa/playbooks/en/\`](docs/qa/playbooks/en/).\n\n`;
  out += `| Game Engine | 🎮 Gamer Verified | ⚙️ Dev Engine Audit | Overall Status | Playbook Guide | Tested Version |\n`;
  out += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const g of state.games) {
    const gamerScore = `\`${g.gamer_completed}/${g.gamer_total}\``;
    const devScore = `\`${g.dev_completed}/${g.dev_total}\``;
    const totalDone = g.gamer_completed + g.dev_completed;
    const totalAll = g.gamer_total + g.dev_total;
    const badge = computeStatusBadge(totalDone, totalAll, g.dev_completed === g.dev_total && g.dev_total > 0);
    const fileName = PLAYBOOK_FILES[g.id] || `${g.id}.md`;
    const playbookPath = `docs/qa/playbooks/en/${fileName}`;
    const gameLink = (g.issue_url && g.issue_url.startsWith('http')) ? g.issue_url : playbookPath;
    const startLink = g.new_issue_url_en ? ` • [🚀 Start](${g.new_issue_url_en})` : '';
    const playbookLink = `[📖 Playbook](${playbookPath})${startLink}`;

    out += `| ${g.emoji} [**${g.name}**](${gameLink}) | ${gamerScore} | ${devScore} | ${badge.en} | ${playbookLink} | \`${g.verified_version}\` |\n`;
  }

  out += `\n<!-- QA_STATUS_EN_END -->`;
  return out;
}

function renderSpanishSection(state) {
  const roadmapPct = state.roadmap.total_tasks > 0 
    ? Math.round((state.roadmap.completed_tasks / state.roadmap.total_tasks) * 100) 
    : 0;
  
  const roadmapStatus = state.roadmap.completed_tasks === state.roadmap.total_tasks && state.roadmap.total_tasks > 0
    ? '🟢 Completado'
    : state.roadmap.completed_tasks > 0 ? `🟡 En Progreso (${roadmapPct}%)` : '🔵 Planificado';

  let out = `<!-- QA_STATUS_ES_START -->\n`;
  out += `### 🧭 Primeros Pasos para Iniciar una Prueba de QA (Guía Rápida)\n\n`;
  out += `Cualquier miembro del equipo puede probar un servidor de juego, ¡incluso sin experiencia técnica previa!\n\n`;
  out += `1. **Crear la Tarea en GitLab**: Haz clic en **🚀 Iniciar** al lado de tu juego en la tabla de abajo (o entra a la [Guía de Pruebas](docs/qa/playbooks/es/) y pulsa el botón de 1 clic). ¡La tarea se abrirá en GitLab con título, etiquetas y lista de verificación ya listos! (O en GitLab ve a **Issues $\\rightarrow$ New Issue** y elige la plantilla cuando esté en main).\n`;
  out += `2. **🎮 Fase de Jugador (Sin conocimientos técnicos)**: Abre la [Guía de Pruebas](docs/qa/playbooks/es/) del juego, crea el servidor en el panel web, entra a jugar con un amigo (prueba vehículos, combate, hordas y mods) y marca las casillas de la **Parte 1** en la tarea.\n`;
  out += `3. **Pasar el Relevo**: Escribe un comentario etiquetando a los programadores: \`@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.\`\n`;
  out += `4. **⚙️ Fase Técnica (Programadores)**: Un desarrollador ejecuta en 3 minutos los comandos de terminal de la **Parte 2** (consumo de RAM cgroups, puertos, netcode adverso y limpieza de volúmenes).\n`;
  out += `5. **Sincronizar con el README**: Cierra la tarea con la etiqueta \`qa::certified\`. La tabla de abajo se actualiza automáticamente por GitLab CI (o ejecutando \`npm run sync:qa\`).\n\n`;
  out += `### 🚀 Hoja de Ruta de la Plataforma y Nuevas Funcionalidades\n\n`;
  out += `| Funcionalidad / Hito | Progreso de Lista | Estado | Auditor Responsable | Última Auditoría |\n`;
  out += `| :--- | :---: | :---: | :---: | :---: |\n`;
  const roadmapTitle = state.roadmap.title_es || state.roadmap.title;
  const roadmapPlaybookEs = 'docs/qa/playbooks/es/00_roadmap.md';
  const roadmapLinkEs = (state.roadmap.issue_url && state.roadmap.issue_url.startsWith('http')) 
    ? state.roadmap.issue_url 
    : roadmapPlaybookEs;
  const roadmapStartEs = state.roadmap.new_issue_url_es ? ` • [🚀 Iniciar](${state.roadmap.new_issue_url_es})` : '';
  out += `| 🛠️ [**${roadmapTitle}**](${roadmapLinkEs})${roadmapStartEs} | \`${state.roadmap.completed_tasks}/${state.roadmap.total_tasks}\` (${roadmapPct}%) | ${roadmapStatus} | ${state.roadmap.auditor} | ${state.roadmap.last_audit} |\n\n`;

  out += `### 🎮 Motores de Juego Verificados y Matriz de Control de Calidad (QA)\n\n`;
  out += `> 💡 **Cómo funciona el testing**: Las pruebas están divididas entre **🎮 Pruebas de Jugador** (partidas reales jugando en equipo) y **⚙️ Auditoría Técnica** (consumo de RAM, puertos y netcode adverso). Guías completas paso a paso: [\`docs/qa/playbooks/es/\`](docs/qa/playbooks/es/).\n\n`;
  out += `| Motor de Juego | 🎮 Pruebas de Jugador | ⚙️ Auditoría Técnica | Estado General | Guía de Prueba | Versión Auditada |\n`;
  out += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const g of state.games) {
    const gamerScore = `\`${g.gamer_completed}/${g.gamer_total}\``;
    const devScore = `\`${g.dev_completed}/${g.dev_total}\``;
    const totalDone = g.gamer_completed + g.dev_completed;
    const totalAll = g.gamer_total + g.dev_total;
    const badge = computeStatusBadge(totalDone, totalAll, g.dev_completed === g.dev_total && g.dev_total > 0);
    const fileName = PLAYBOOK_FILES[g.id] || `${g.id}.md`;
    const playbookPath = `docs/qa/playbooks/es/${fileName}`;
    const gameLink = (g.issue_url && g.issue_url.startsWith('http')) ? g.issue_url : playbookPath;
    const startLink = g.new_issue_url_es ? ` • [🚀 Iniciar](${g.new_issue_url_es})` : '';
    const playbookLink = `[📖 Guía](${playbookPath})${startLink}`;

    out += `| ${g.emoji} [**${g.name}**](${gameLink}) | ${gamerScore} | ${devScore} | ${badge.es} | ${playbookLink} | \`${g.verified_version}\` |\n`;
  }

  out += `\n<!-- QA_STATUS_ES_END -->`;
  return out;
}

export async function syncQaToReadme() {
  console.log('[sync_qa_readme] Loading QA state...');
  const rawState = await fs.readFile(STATE_FILE, 'utf8');
  let state = JSON.parse(rawState);

  // Optional: reconcile with GitLab API issues if token present
  const gitlabIssues = await fetchGitLabIssues();
  if (gitlabIssues && Array.isArray(gitlabIssues)) {
    console.log(`[sync_qa_readme] Reconciling with ${gitlabIssues.length} GitLab issues...`);
    for (const issue of gitlabIssues) {
      const match = state.games.find(g => issue.labels.includes(`game::${g.id}`));
      if (match && issue.task_completion_status) {
        match.issue_id = issue.iid;
        match.issue_url = issue.web_url;
        match.last_audit = new Date(issue.updated_at).toISOString().split('T')[0];
        if (issue.assignee) match.auditor = `@${issue.assignee.username}`;
      }
    }
  }

  console.log('[sync_qa_readme] Reading README.md...');
  let readme = await fs.readFile(README_FILE, 'utf8');

  const enBlock = renderEnglishSection(state);
  const esBlock = renderSpanishSection(state);

  // Replace or inject English section
  if (readme.includes('<!-- QA_STATUS_EN_START -->')) {
    readme = readme.replace(
      /<!-- QA_STATUS_EN_START -->[\s\S]*?<!-- QA_STATUS_EN_END -->/,
      enBlock
    );
  } else {
    // Insert after "## 🌟 Key Features" or before "## 🧭 Platform Capability Map"
    const target = '## 🧭 Platform Capability Map';
    if (readme.includes(target)) {
      readme = readme.replace(target, `${enBlock}\n\n${target}`);
    }
  }

  // Replace or inject Spanish section
  if (readme.includes('<!-- QA_STATUS_ES_START -->')) {
    readme = readme.replace(
      /<!-- QA_STATUS_ES_START -->[\s\S]*?<!-- QA_STATUS_ES_END -->/,
      esBlock
    );
  } else {
    const targetEs = '## 🧭 Mapa de Funciones de la Plataforma';
    if (readme.includes(targetEs)) {
      readme = readme.replace(targetEs, `${esBlock}\n\n${targetEs}`);
    } else {
      readme += `\n\n${esBlock}\n`;
    }
  }

  await fs.writeFile(README_FILE, readme, 'utf8');
  console.log('✅ [sync_qa_readme] README.md successfully updated with latest QA and Roadmap status!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncQaToReadme().catch((err) => {
    console.error('❌ [sync_qa_readme] Error:', err);
    process.exit(1);
  });
}
