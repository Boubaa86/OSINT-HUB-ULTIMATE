const $ = selector => document.querySelector(selector);
let csrfToken = null;
let sessionToken = null;
try { sessionToken = sessionStorage.getItem('osint_hub_session') || null; } catch {}
let selectedCaseId = null;
let currentSources = [];
let aiConversationId = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

const API_BASE = String(window.OSINT_CONFIG?.apiBase || '').replace(/\/+$/, '');
function apiUrl(url) {
  if (!API_BASE) return url;
  return new URL(url, API_BASE).toString();
}

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  const response = await fetch(apiUrl(url), {
    ...options,
    headers,
    credentials: API_BASE ? 'omit' : 'same-origin'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}

async function apiMutation(url, method, body) {
  if (!csrfToken) await refreshCsrf();
  return apiRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body)
  });
}

function setAuthMessage(message, isError = false) {
  const node = $('#auth-message');
  node.textContent = message;
  node.classList.toggle('error-text', isError);
}

function applyPreferences(preferences) {
  document.body.classList.toggle('theme-light', preferences.theme === 'light');
  document.querySelector('.shell').classList.toggle('sidebar-collapsed', Boolean(preferences.sidebarCollapsed));
  $('#theme-toggle').textContent = preferences.theme === 'light' ? 'Mode sombre' : 'Mode clair';
  $('#sidebar-toggle').textContent = preferences.sidebarCollapsed ? 'Agrandir' : 'Réduire';
}

async function loadSettings() {
  try {
    const data = await apiRequest('/api/settings');
    applyPreferences(data.preferences);
  } catch {}
}

$('#theme-toggle').addEventListener('click', async () => {
  const theme = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  applyPreferences({ theme, sidebarCollapsed: document.querySelector('.shell').classList.contains('sidebar-collapsed') });
  if ($('#account-active').hidden) return;
  try { await apiMutation('/api/settings', 'PATCH', { theme }); } catch (error) { setAuthMessage(error.message, true); }
});

$('#sidebar-toggle').addEventListener('click', async () => {
  const sidebarCollapsed = !document.querySelector('.shell').classList.contains('sidebar-collapsed');
  applyPreferences({ theme: document.body.classList.contains('theme-light') ? 'light' : 'dark', sidebarCollapsed });
  if ($('#account-active').hidden) return;
  try { await apiMutation('/api/settings', 'PATCH', { sidebarCollapsed }); } catch (error) { setAuthMessage(error.message, true); }
});

async function loadDashboard() {
  try {
    const data = await apiRequest('/api/dashboard/summary');
    $('#stat-investigations').textContent = data.investigations;
    $('#stat-entities').textContent = data.entities;
    $('#stat-reports').textContent = data.reports;
  } catch {
    $('#stat-investigations').textContent = '—';
    $('#stat-entities').textContent = '—';
    $('#stat-reports').textContent = '—';
  }
}

function showAccount(user) {
  $('#auth-forms').hidden = true;
  $('#account-active').hidden = false;
  $('#cases-panel').hidden = false;
  $('#account-name').textContent = user.displayName || user.display_name || 'Compte connecté';
  $('#account-email').textContent = user.email || '';
  $('#admin-nav').hidden = !(Array.isArray(user.roles) && user.roles.includes('admin'));
  loadDashboard();
  loadSettings();
}

function showSignedOut() {
  csrfToken = null;
  sessionToken = null;
  try { sessionStorage.removeItem('osint_hub_session'); } catch {}
  selectedCaseId = null;
  $('#auth-forms').hidden = false;
  $('#account-active').hidden = true;
  $('#cases-panel').hidden = true;
  $('#case-detail').hidden = true;
  $('#integrations-panel').hidden = true;
  $('#threat-panel').hidden = true;
  $('#ai-panel').hidden = true;
  $('#image-panel').hidden = true;
  $('#automation-panel').hidden = true;
  $('#admin-panel').hidden = true;
  $('#admin-nav').hidden = true;
  $('#global-search-results').hidden = true;
}

async function refreshCsrf() {
  const data = await apiRequest('/api/auth/csrf');
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function loadSession() {
  try {
    const data = await apiRequest('/api/auth/me');
    await refreshCsrf();
    showAccount(data.user);
    setAuthMessage('Session sécurisée active. Tes dossiers sont privés.');
    await loadCases();
  } catch {
    showSignedOut();
    setAuthMessage('Connecte-toi ou crée ton compte pour sauvegarder tes dossiers.');
  }
}

async function loadStatus() {
  try {
    const data = await apiRequest('/api/health');
    $('#health').textContent = `API OK · ${data.version}`;
  } catch {
    $('#health').textContent = 'API indisponible';
  }
}

async function loadModules() {
  try {
    const data = await apiRequest('/api/modules');
    const available = data.modules.filter(module => module.status === 'available').length;
    $('#module-count').textContent = available;
    $('#modules').innerHTML = data.modules.map(module => `
      <div class="module">
        <div><b>${escapeHtml(module.name)}</b><small>${escapeHtml(module.scope)}</small></div>
        <span class="state ${module.status === 'available' ? '' : 'planned'}">${module.status === 'available' ? 'DISPONIBLE' : 'À VENIR'}</span>
      </div>`).join('');
  } catch {
    $('#modules').textContent = 'Impossible de charger les modules.';
  }
}


$('#global-search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const output = $('#global-search-output');
  $('#global-search-results').hidden = false;
  output.className = 'result';
  output.textContent = 'Identification du type de recherche et interrogation des sources compatibles…';
  try {
    const data = await apiMutation('/api/search', 'POST', {
      query: $('#global-search-input').value.trim(),
      saveToHistory: $('#save-search-history').checked
    });
    output.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    $('#global-search-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    output.textContent = error.message;
  }
});

$('#load-search-history').addEventListener('click', async () => {
  const list = $('#search-history-list');
  list.hidden = false;
  list.textContent = 'Chargement de l’historique…';
  try {
    const data = await apiRequest('/api/search/history');
    list.innerHTML = data.history.length ? data.history.map(item => `
      <button type="button" class="history-item" data-history-query="${escapeHtml(item.query_value)}">
        <b>${escapeHtml(item.query_type)}</b><span>${escapeHtml(item.query_value)}</span><small>${escapeHtml(new Date(item.created_at).toLocaleString())}</small>
      </button>`).join('') : '<p class="loading">Aucune recherche sauvegardée.</p>';
  } catch (error) { list.textContent = error.message; }
});

$('#search-history-list').addEventListener('click', event => {
  const item = event.target.closest('[data-history-query]');
  if (item) $('#global-search-input').value = item.dataset.historyQuery;
});

$('#dns-form').addEventListener('submit', async event => {
  event.preventDefault();
  const domain = $('#domain').value.trim();
  const box = $('#dns-result');
  box.className = 'result';
  box.textContent = 'Interrogation des DNS publics…';
  try {
    const data = await apiRequest('/api/osint/dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    const rows = Object.entries(data.records).map(([type, values]) => `
      <div class="record"><b>${type}</b>${values.length
        ? escapeHtml(values.map(value => typeof value === 'object' ? JSON.stringify(value) : value).join(' · '))
        : 'Aucun enregistrement trouvé'}</div>`).join('');
    box.innerHTML = `<strong>${escapeHtml(data.domain)}</strong>${rows}
      <small>Source : ${escapeHtml(data.source)} · ${escapeHtml(new Date(data.collectedAt).toLocaleString())}</small>
      <p>${escapeHtml(data.caveat)}</p>`;
  } catch (error) {
    box.textContent = error.message;
  }
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  setAuthMessage('Connexion en cours…');
  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
    });
    csrfToken = data.csrfToken;
    sessionToken = data.sessionToken || null;
    if (sessionToken) {
      try { sessionStorage.setItem('osint_hub_session', sessionToken); } catch {}
    }
    showAccount(data.user);
    setAuthMessage('Connexion réussie.');
    $('#login-password').value = '';
    await loadCases();
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#register-form').addEventListener('submit', async event => {
  event.preventDefault();
  setAuthMessage('Création du compte…');
  try {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: $('#register-name').value,
        email: $('#register-email').value,
        password: $('#register-password').value
      })
    });
    csrfToken = data.csrfToken;
    sessionToken = data.sessionToken || null;
    if (sessionToken) {
      try { sessionStorage.setItem('osint_hub_session', sessionToken); } catch {}
    }
    showAccount(data.user);
    setAuthMessage('Compte créé. Bienvenue !');
    $('#register-password').value = '';
    await loadCases();
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await apiMutation('/api/auth/logout', 'POST', {});
    showSignedOut();
    setAuthMessage('Déconnexion effectuée.');
  } catch (error) { setAuthMessage(error.message, true); }
});

async function loadCases() {
  try {
    const data = await apiRequest('/api/investigations');
    $('#cases-list').innerHTML = data.investigations.length ? data.investigations.map(item => `
      <article class="case-card">
        <div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.status)} · Modifié le ${escapeHtml(new Date(item.updated_at).toLocaleString())}</small></div>
        <div class="case-actions">
          <button type="button" data-open-case="${escapeHtml(item.id)}">Ouvrir</button>
          ${item.status === 'archived' ? '' : `<button type="button" class="secondary-button" data-archive-case="${escapeHtml(item.id)}">Archiver</button>`}
        </div>
      </article>`).join('') : '<p class="loading">Aucun dossier pour le moment. Crée ton premier dossier ci-dessus.</p>';
    $('#investigation-count').textContent = data.investigations.length;
  } catch (error) {
    $('#cases-list').textContent = error.message;
  }
}

$('#case-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await apiMutation('/api/investigations', 'POST', {
      title: $('#case-title').value,
      objective: $('#case-objective').value,
      description: $('#case-description').value
    });
    event.target.reset();
    setAuthMessage('Dossier enregistré.');
    await loadCases();
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#cases-list').addEventListener('click', async event => {
  const openButton = event.target.closest('[data-open-case]');
  const archiveButton = event.target.closest('[data-archive-case]');
  if (openButton) await openCase(openButton.dataset.openCase);
  if (archiveButton) {
    try {
      await apiMutation(`/api/investigations/${encodeURIComponent(archiveButton.dataset.archiveCase)}`, 'PATCH', { status: 'archived' });
      await loadCases();
      setAuthMessage('Dossier archivé. Aucune donnée n’a été supprimée.');
    } catch (error) { setAuthMessage(error.message, true); }
  }
});

async function openCase(id) {
  selectedCaseId = id;
  try {
    const [detail, notes, sources, reports] = await Promise.all([
      apiRequest(`/api/investigations/${encodeURIComponent(id)}`),
      apiRequest(`/api/investigations/${encodeURIComponent(id)}/notes`),
      apiRequest(`/api/investigations/${encodeURIComponent(id)}/sources`),
      apiRequest(`/api/reports/investigations/${encodeURIComponent(id)}`)
    ]);
    $('#detail-title').textContent = detail.investigation.title;
    currentSources = sources.sources;
    $('#graph-view').hidden = true;
    $('#notes-list').innerHTML = notes.notes.length ? notes.notes.map(note => `<div class="mini-record">${escapeHtml(note.body)}<small>${escapeHtml(new Date(note.created_at).toLocaleString())}</small></div>`).join('') : '<p class="loading">Aucune note.</p>';
    $('#sources-list').innerHTML = sources.sources.length ? sources.sources.map(source => `<div class="mini-record"><b>${escapeHtml(source.source_name)}</b><small>${escapeHtml(source.reliability)} · ${escapeHtml(source.source_url || 'Sans URL')}</small></div>`).join('') : '<p class="loading">Aucune source.</p>';
    $('#reports-list').innerHTML = reports.reports.length ? reports.reports.map(report => `<div class="mini-record"><b>${escapeHtml(report.title)}</b><small>${escapeHtml(report.format.toUpperCase())} · ${escapeHtml(new Date(report.created_at).toLocaleString())}</small></div>`).join('') : '<p class="loading">Aucun rapport généré.</p>';
    $('#case-detail').hidden = false;
    $('#case-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { setAuthMessage(error.message, true); }
}


$('#report-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedCaseId) return;
  const format = $('#report-format').value;
  const output = $('#report-message');
  output.textContent = 'Génération du rapport…';
  try {
    if (!csrfToken) await refreshCsrf();
    const response = await fetch(`/api/reports/investigations/${encodeURIComponent(selectedCaseId)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ format })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Erreur HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `osint-report.${format === 'markdown' ? 'md' : format}`;
    link.click();
    URL.revokeObjectURL(url);
    output.textContent = `Rapport ${format.toUpperCase()} généré. Référence : ${response.headers.get('X-Report-Id') || 'enregistrée'}`;
    const reports = await apiRequest(`/api/reports/investigations/${encodeURIComponent(selectedCaseId)}`);
    $('#reports-list').innerHTML = reports.reports.map(report => `<div class="mini-record"><b>${escapeHtml(report.title)}</b><small>${escapeHtml(report.format.toUpperCase())} · ${escapeHtml(new Date(report.created_at).toLocaleString())}</small></div>`).join('');
  } catch (error) { output.textContent = error.message; }
});

$('#close-case-detail').addEventListener('click', () => {
  selectedCaseId = null;
  $('#case-detail').hidden = true;
});

$('#note-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedCaseId) return;
  try {
    await apiMutation(`/api/investigations/${encodeURIComponent(selectedCaseId)}/notes`, 'POST', { body: $('#note-body').value });
    $('#note-body').value = '';
    await openCase(selectedCaseId);
    setAuthMessage('Note enregistrée.');
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#source-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedCaseId) return;
  try {
    await apiMutation(`/api/investigations/${encodeURIComponent(selectedCaseId)}/sources`, 'POST', {
      sourceName: $('#source-name').value,
      sourceUrl: $('#source-url').value || null,
      sourceType: 'web',
      reliability: 'unknown'
    });
    $('#source-form').reset();
    await openCase(selectedCaseId);
    setAuthMessage('Source ajoutée au dossier.');
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#refresh-cases').addEventListener('click', loadCases);


async function runIntelLookup(inputSelector, resultSelector, pathBuilder) {
  const target = $(inputSelector).value.trim();
  const box = $(resultSelector);
  box.className = 'result';
  box.textContent = 'Analyse des sources publiques…';
  try {
    const data = await apiRequest(pathBuilder(target));
    box.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) {
    box.textContent = error.message;
  }
}

$('#domain-intel-form').addEventListener('submit', event => {
  event.preventDefault();
  runIntelLookup('#domain-intel-input', '#domain-intel-result', value => `/api/osint/domain/${encodeURIComponent(value)}`);
});

$('#phone-intel-form').addEventListener('submit', async event => {
  event.preventDefault();
  const box = $('#phone-intel-result');
  box.className = 'result';
  box.textContent = 'Lecture des métadonnées de numérotation…';
  try {
    const data = await apiMutation('/api/osint/phone', 'POST', { phone: $('#phone-intel-input').value.trim() });
    box.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) { box.textContent = error.message; }
});

$('#email-intel-form').addEventListener('submit', async event => {
  event.preventDefault();
  const box = $('#email-intel-result');
  box.className = 'result';
  box.textContent = 'Vérification de la syntaxe et des enregistrements MX…';
  try {
    const data = await apiMutation('/api/osint/email', 'POST', { email: $('#email-intel-input').value.trim() });
    box.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) { box.textContent = error.message; }
});

$('#ip-intel-form').addEventListener('submit', event => {
  event.preventDefault();
  runIntelLookup('#ip-intel-input', '#ip-intel-result', value => `/api/osint/ip/${encodeURIComponent(value)}`);
});


const graphState = { nodes: [], links: [], positions: {}, panX: 0, panY: 0, scale: 1, dragging: null, panning: null };

function renderGraphSvg() {
  const svg = $('#graph-svg');
  const lineMarkup = graphState.links.map(link => {
    const from = graphState.positions[link.from_entity_id];
    const to = graphState.positions[link.to_entity_id];
    if (!from || !to) return '';
    const evidence = `${link.relation_type} · confiance ${Math.round(Number(link.confidence || 0) * 100)}% · ${link.source_name || 'source'}`;
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="graph-edge" stroke="#3b809b" stroke-width="2" marker-end="url(#graph-arrow)"><title>${escapeHtml(evidence)}</title></line>`;
  }).join('');
  const nodeMarkup = graphState.nodes.map(node => {
    const point = graphState.positions[node.id];
    const label = node.display_label.length > 24 ? node.display_label.slice(0, 21) + '…' : node.display_label;
    return `<g class="graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${point.x} ${point.y})" tabindex="0">
      <circle r="27" fill="#123f59" stroke="#3ad7ec" stroke-width="2"></circle><text y="45" text-anchor="middle" fill="#e8f7ff" font-size="12" font-family="system-ui,sans-serif">${escapeHtml(label)}</text>
      <title>${escapeHtml(node.entity_type)} · ${escapeHtml(node.canonical_value)}</title>
    </g>`;
  }).join('');
  svg.innerHTML = `<rect x="0" y="0" width="900" height="560" rx="8" fill="#081522"></rect>
    <defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#6bcde0"></path></marker></defs>
    <g id="graph-world" transform="translate(${graphState.panX} ${graphState.panY}) scale(${graphState.scale})">${lineMarkup}${nodeMarkup}</g>`;
  $('#graph-message').textContent = `${graphState.nodes.length} entité(s) · ${graphState.links.length} relation(s) sourcée(s)`;
}

async function loadGraph() {
  if (!selectedCaseId) {
    setAuthMessage('Ouvre un dossier avant de consulter son graphe.', true);
    return;
  }
  try {
    const data = await apiRequest(`/api/investigations/${encodeURIComponent(selectedCaseId)}/graph`);
    graphState.nodes = data.entities;
    graphState.links = data.relationships;
    const entityOptions = graphState.nodes.map(node => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.display_label)}</option>`).join('');
    $('#relation-from').innerHTML = entityOptions;
    $('#relation-to').innerHTML = entityOptions;
    $('#relation-source').innerHTML = currentSources.map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.source_name)}</option>`).join('');
    graphState.positions = {};
    graphState.panX = 0;
    graphState.panY = 0;
    graphState.scale = 1;
    const count = graphState.nodes.length;
    graphState.nodes.forEach((node, index) => {
      const angle = count > 1 ? (Math.PI * 2 * index) / count : 0;
      const radius = Math.min(210, 95 + count * 7);
      graphState.positions[node.id] = {
        x: 450 + Math.cos(angle) * radius,
        y: 265 + Math.sin(angle) * radius
      };
    });
    $('#graph-view').hidden = false;
    renderGraphSvg();
  } catch (error) {
    setAuthMessage(error.message, true);
  }
}

const graphSvg = $('#graph-svg');
graphSvg.addEventListener('pointerdown', event => {
  const node = event.target.closest('[data-node-id]');
  if (node) {
    graphState.dragging = node.dataset.nodeId;
  } else {
    graphState.panning = { x: event.clientX, y: event.clientY, panX: graphState.panX, panY: graphState.panY };
  }
  graphSvg.setPointerCapture(event.pointerId);
});
graphSvg.addEventListener('pointermove', event => {
  if (graphState.dragging) {
    const point = graphSvg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(graphSvg.getScreenCTM().inverse());
    graphState.positions[graphState.dragging] = {
      x: (local.x - graphState.panX) / graphState.scale,
      y: (local.y - graphState.panY) / graphState.scale
    };
    renderGraphSvg();
  } else if (graphState.panning) {
    graphState.panX = graphState.panning.panX + event.clientX - graphState.panning.x;
    graphState.panY = graphState.panning.panY + event.clientY - graphState.panning.y;
    renderGraphSvg();
  }
});
function endGraphPointer(event) {
  graphState.dragging = null;
  graphState.panning = null;
  if (graphSvg.hasPointerCapture(event.pointerId)) graphSvg.releasePointerCapture(event.pointerId);
}
graphSvg.addEventListener('pointerup', endGraphPointer);
graphSvg.addEventListener('pointercancel', endGraphPointer);
graphSvg.addEventListener('wheel', event => {
  event.preventDefault();
  graphState.scale = Math.max(0.45, Math.min(2.5, graphState.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
  renderGraphSvg();
}, { passive: false });


$('#entity-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedCaseId) return;
  try {
    await apiMutation(`/api/investigations/${encodeURIComponent(selectedCaseId)}/entities`, 'POST', {
      entityType: $('#entity-type').value,
      canonicalValue: $('#entity-value').value.trim(),
      displayLabel: $('#entity-label').value.trim()
    });
    $('#entity-form').reset();
    await loadGraph();
    setAuthMessage('Entité ajoutée à IntelBase.');
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#relationship-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedCaseId) return;
  try {
    await apiMutation(`/api/investigations/${encodeURIComponent(selectedCaseId)}/relationships`, 'POST', {
      fromEntityId: $('#relation-from').value,
      toEntityId: $('#relation-to').value,
      relationType: $('#relation-type').value,
      sourceId: $('#relation-source').value,
      confidence: Number($('#relation-confidence').value),
      rationale: $('#relation-rationale').value.trim()
    });
    $('#relation-rationale').value = '';
    await loadGraph();
    setAuthMessage('Relation enregistrée avec sa source et sa justification.');
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#show-graph').addEventListener('click', loadGraph);
$('#export-graph-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ nodes: graphState.nodes, relationships: graphState.links }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'intelbase-graph.json';
  link.click();
  URL.revokeObjectURL(url);
});

$('#export-graph-csv').addEventListener('click', () => {
  const rows = [
    ['record_type', 'id', 'entity_type', 'value', 'label', 'from_entity_id', 'to_entity_id', 'relation_type', 'confidence', 'source_name'],
    ...graphState.nodes.map(node => ['entity', node.id, node.entity_type, node.canonical_value, node.display_label, '', '', '', '', '']),
    ...graphState.links.map(link => ['relationship', link.id, '', '', '', link.from_entity_id, link.to_entity_id, link.relation_type, link.confidence, link.source_name || ''])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'intelbase-graph.csv';
  link.click();
  URL.revokeObjectURL(url);
});

$('#export-graph-png').addEventListener('click', () => {
  const svgText = new XMLSerializer().serializeToString($('#graph-svg'));
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1120;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) {
        const pngUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = 'intelbase-graph.png';
        link.click();
        URL.revokeObjectURL(pngUrl);
      }
      URL.revokeObjectURL(svgUrl);
    }, 'image/png');
  };
  image.onerror = () => URL.revokeObjectURL(svgUrl);
  image.src = svgUrl;
});

$('#export-graph-svg').addEventListener('click', () => {
  const blob = new Blob([new XMLSerializer().serializeToString($('#graph-svg'))], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'intelbase-graph.svg';
  link.click();
  URL.revokeObjectURL(url);
});


async function loadProviders() {
  const list = $('#providers-list');
  list.textContent = 'Chargement des fournisseurs…';
  try {
    const data = await apiRequest('/api/integrations');
    list.innerHTML = data.providers.map(provider => `
      <article class="provider-card" data-provider-card="${escapeHtml(provider.id)}">
        <div class="provider-top"><div><b>${escapeHtml(provider.name)}</b><small>${escapeHtml(provider.capabilities.join(' · '))}</small></div>
          <span class="provider-status ${provider.configured ? 'configured' : ''}">${provider.configured ? 'CLÉ DÉTECTÉE' : 'NON CONFIGURÉ'}</span>
        </div>
        <small class="provider-vars">${provider.configuration.map(item => `${escapeHtml(item.variable)} : ${item.configured ? 'présente' : 'absente'}`).join(' · ')}</small>
        <div class="provider-actions">
          ${provider.configured && provider.testable ? `<button type="button" data-test-provider="${escapeHtml(provider.id)}">Tester la connexion</button>` : provider.configured ? '<span class="loading">Test manuel requis</span>' : '<span class="loading">Ajoute la clé dans les variables Render</span>'}
        </div>
        <div class="provider-result" role="status"></div>
      </article>`).join('');
  } catch (error) { list.textContent = error.message; }
}

$('#providers-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-test-provider]');
  if (!button) return;
  const providerId = button.dataset.testProvider;
  const card = button.closest('[data-provider-card]');
  const output = card.querySelector('.provider-result');
  button.disabled = true;
  button.textContent = 'Test en cours…';
  output.textContent = '';
  try {
    const result = await apiMutation(`/api/integrations/${encodeURIComponent(providerId)}/test`, 'POST', {});
    output.textContent = `État : ${result.status} · HTTP ${result.httpStatus ?? '—'} · ${result.latencyMs ?? '—'} ms`;
  } catch (error) { output.textContent = error.message; }
  button.disabled = false;
  button.textContent = 'Tester à nouveau';
});

$('#refresh-providers').addEventListener('click', loadProviders);


async function runThreatLookup(path) {
  const output = $('#threat-output');
  output.className = 'result';
  output.textContent = 'Interrogation des fournisseurs de réputation configurés…';
  try {
    const data = await apiRequest(path);
    output.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) { output.textContent = error.message; }
}

$('#threat-ip-form').addEventListener('submit', event => {
  event.preventDefault();
  runThreatLookup(`/api/threat/ip/${encodeURIComponent($('#threat-ip').value.trim())}`);
});
$('#threat-domain-form').addEventListener('submit', event => {
  event.preventDefault();
  runThreatLookup(`/api/threat/domain/${encodeURIComponent($('#threat-domain').value.trim())}`);
});
$('#threat-hash-form').addEventListener('submit', event => {
  event.preventDefault();
  runThreatLookup(`/api/threat/hash/${encodeURIComponent($('#threat-hash').value.trim())}`);
});


function renderAiMessages(messages) {
  const container = $('#ai-messages');
  container.innerHTML = messages.length ? messages.map(message => `
    <article class="ai-message ${message.role === 'assistant' ? 'assistant' : 'user'}">
      <b>${message.role === 'assistant' ? 'Assistant IA' : 'Vous'}</b>
      <p>${escapeHtml(message.content)}</p>
      <small>${escapeHtml(new Date(message.created_at).toLocaleString())}</small>
    </article>`).join('') : '<p class="loading">Aucun message dans cette conversation.</p>';
  container.scrollTop = container.scrollHeight;
}

async function loadAiConversations() {
  try {
    const data = await apiRequest('/api/ai/conversations');
    $('#ai-conversation-select').innerHTML = '<option value="">Choisir une conversation…</option>' + data.conversations.map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
    if (aiConversationId && data.conversations.some(item => item.id === aiConversationId)) {
      $('#ai-conversation-select').value = aiConversationId;
      await loadAiConversation(aiConversationId);
    } else if (data.conversations.length) {
      aiConversationId = data.conversations[0].id;
      $('#ai-conversation-select').value = aiConversationId;
      await loadAiConversation(aiConversationId);
    }
  } catch (error) { $('#ai-status').textContent = error.message; }
}

async function loadAiConversation(id) {
  if (!id) return;
  try {
    const data = await apiRequest(`/api/ai/conversations/${encodeURIComponent(id)}`);
    aiConversationId = id;
    renderAiMessages(data.messages);
  } catch (error) { $('#ai-status').textContent = error.message; }
}

$('#ai-conversation-select').addEventListener('change', event => {
  aiConversationId = event.target.value || null;
  if (aiConversationId) loadAiConversation(aiConversationId);
  else renderAiMessages([]);
});

$('#new-ai-conversation').addEventListener('click', async () => {
  try {
    const data = await apiMutation('/api/ai/conversations', 'POST', { title: 'Nouvelle conversation' });
    aiConversationId = data.conversation.id;
    await loadAiConversations();
    $('#ai-conversation-select').value = aiConversationId;
    renderAiMessages([]);
    $('#ai-message-input').focus();
  } catch (error) { $('#ai-status').textContent = error.message; }
});

$('#ai-message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#ai-message-input').value.trim();
  if (!message) return;
  const includeCase = $('#ai-include-case').checked;
  if (includeCase && !selectedCaseId) {
    $('#ai-status').textContent = 'Ouvre un dossier avant de demander son analyse.';
    return;
  }
  const button = event.submitter || $('#ai-message-form button[type="submit"]');
  button.disabled = true;
  $('#ai-status').textContent = 'Analyse en cours…';
  try {
    if (!aiConversationId) {
      const created = await apiMutation('/api/ai/conversations', 'POST', { title: message.slice(0, 70) });
      aiConversationId = created.conversation.id;
    }
    const payload = { message };
    if (includeCase) payload.investigationId = selectedCaseId;
    const result = await apiMutation(`/api/ai/conversations/${encodeURIComponent(aiConversationId)}/messages`, 'POST', payload);
    $('#ai-message-input').value = '';
    await loadAiConversations();
    await loadAiConversation(aiConversationId);
    $('#ai-status').textContent = 'Réponse reçue. Vérifie toujours les sources citées.';
  } catch (error) {
    $('#ai-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});


async function loadImageCases() {
  try {
    const data = await apiRequest('/api/investigations');
    $('#image-case-select').innerHTML = '<option value="">Aucun dossier</option>' + data.investigations.map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
    if (selectedCaseId) $('#image-case-select').value = selectedCaseId;
  } catch (error) { $('#image-output').textContent = error.message; }
}

$('#image-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('#image-file').files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    $('#image-output').textContent = 'Image limitée à 8 Mo.';
    return;
  }
  const output = $('#image-output');
  output.className = 'result';
  output.textContent = 'Analyse des métadonnées et empreintes…';
  try {
    if (!csrfToken) await refreshCsrf();
    const formData = new FormData();
    formData.append('image', file, file.name);
    if ($('#image-case-select').value) formData.append('investigationId', $('#image-case-select').value);
    const response = await fetch(apiUrl('/api/osint/image'), {
      method: 'POST',
      credentials: API_BASE ? 'omit' : 'same-origin',
      headers: {
        'X-CSRF-Token': csrfToken,
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
      },
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
    output.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) { output.textContent = error.message; }
});


async function loadAutomations() {
  const list = $('#automation-list');
  list.textContent = 'Chargement des tâches…';
  try {
    const data = await apiRequest('/api/automations');
    list.innerHTML = data.tasks.length ? data.tasks.map(task => `
      <article class="automation-card" data-task-card="${escapeHtml(task.id)}">
        <div><b>${escapeHtml(task.config.domain)}</b><small>${task.task_type === 'dns_change' ? 'Surveillance DNS' : 'Certificate Transparency'} · ${escapeHtml(task.frequency)}</small></div>
        <span class="automation-state">${task.enabled ? 'ACTIVÉE' : 'DÉSACTIVÉE'} · ${escapeHtml(task.last_status || 'jamais exécutée')}</span>
        <small>Prochaine exécution : ${task.next_run_at ? escapeHtml(new Date(task.next_run_at).toLocaleString()) : '—'}</small>
        <div class="automation-actions">
          <button type="button" data-run-task="${escapeHtml(task.id)}">Exécuter maintenant</button>
          <button type="button" class="secondary-button" data-toggle-task="${escapeHtml(task.id)}" data-enabled="${task.enabled ? 'true' : 'false'}">${task.enabled ? 'Désactiver' : 'Activer'}</button>
          <button type="button" class="secondary-button" data-view-runs="${escapeHtml(task.id)}">Historique</button>
        </div>
        <div class="automation-runs"></div>
      </article>`).join('') : '<p class="loading">Aucune surveillance créée.</p>';
  } catch (error) { list.textContent = error.message; }
}

async function loadNotifications() {
  const list = $('#notifications-list');
  list.textContent = 'Chargement des notifications…';
  try {
    const data = await apiRequest('/api/notifications');
    list.innerHTML = data.notifications.length ? data.notifications.map(item => `
      <article class="notification-item ${item.read_at ? '' : 'unread'}" data-notification="${escapeHtml(item.id)}">
        <div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.body)}</p><small>${escapeHtml(new Date(item.created_at).toLocaleString())}</small></div>
        ${item.read_at ? '<span>Lu</span>' : `<button type="button" data-mark-read="${escapeHtml(item.id)}">Marquer comme lu</button>`}
      </article>`).join('') : '<p class="loading">Aucune notification.</p>';
  } catch (error) { list.textContent = error.message; }
}

$('#automation-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await apiMutation('/api/automations', 'POST', {
      taskType: $('#automation-type').value,
      domain: $('#automation-domain').value.trim(),
      frequency: $('#automation-frequency').value,
      authorized: $('#automation-authorized').checked
    });
    $('#automation-form').reset();
    await loadAutomations();
  } catch (error) { $('#automation-list').textContent = error.message; }
});

$('#automation-list').addEventListener('click', async event => {
  const runButton = event.target.closest('[data-run-task]');
  const toggleButton = event.target.closest('[data-toggle-task]');
  const historyButton = event.target.closest('[data-view-runs]');
  try {
    if (runButton) {
      runButton.disabled = true;
      runButton.textContent = 'Exécution…';
      const result = await apiMutation(`/api/automations/${encodeURIComponent(runButton.dataset.runTask)}/run`, 'POST', {});
      await loadAutomations();
      await loadNotifications();
      setAuthMessage(result.result.status === 'completed' ? 'Surveillance exécutée.' : 'La surveillance a échoué.', result.result.status !== 'completed');
    } else if (historyButton) {
      const card = historyButton.closest('[data-task-card]');
      const data = await apiRequest(`/api/automations/${encodeURIComponent(historyButton.dataset.viewRuns)}/runs`);
      card.querySelector('.automation-runs').innerHTML = data.runs.length ? data.runs.map(run => `<small>${escapeHtml(run.status)} · ${run.changed ? 'changement détecté' : 'aucun changement'} · ${escapeHtml(new Date(run.finished_at).toLocaleString())}</small>`).join('<br>') : '<small>Aucune exécution.</small>';
    } else if (toggleButton) {
      await apiMutation(`/api/automations/${encodeURIComponent(toggleButton.dataset.toggleTask)}`, 'PATCH', {
        enabled: toggleButton.dataset.enabled !== 'true'
      });
      await loadAutomations();
    }
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#notifications-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-mark-read]');
  if (!button) return;
  try {
    await apiMutation(`/api/notifications/${encodeURIComponent(button.dataset.markRead)}/read`, 'PATCH', {});
    await loadNotifications();
  } catch (error) { setAuthMessage(error.message, true); }
});

$('#refresh-automations').addEventListener('click', loadAutomations);
$('#refresh-notifications').addEventListener('click', loadNotifications);


async function loadAdmin() {
  try {
    const [overview, users, audit] = await Promise.all([
      apiRequest('/api/admin/overview'),
      apiRequest('/api/admin/users'),
      apiRequest('/api/admin/audit')
    ]);
    $('#admin-overview').innerHTML = [
      ['Utilisateurs', overview.users.total],
      ['Actifs', overview.users.active],
      ['Dossiers', overview.investigations],
      ['Rapports', overview.reports],
      ['Automatisations actives', overview.automations.enabled],
      ['Échecs 24 h', overview.failedAutomationRunsLast24h]
    ].map(([label, value]) => `<article><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></article>`).join('');
    $('#admin-users').innerHTML = users.users.map(user => `
      <article class="admin-user" data-admin-user="${escapeHtml(user.id)}">
        <div><b>${escapeHtml(user.display_name)}</b><small>${escapeHtml(user.email)} · ${escapeHtml(user.status)}</small></div>
        <div class="admin-user-controls">
          <select data-role-select aria-label="Rôle de ${escapeHtml(user.email)}">
            <option value="user" ${user.roles.includes('admin') ? '' : user.roles.includes('analyst') ? '' : 'selected'}>Utilisateur</option>
            <option value="analyst" ${user.roles.includes('analyst') ? 'selected' : ''}>Analyste</option>
            <option value="admin" ${user.roles.includes('admin') ? 'selected' : ''}>Administrateur</option>
          </select>
          <button type="button" data-save-role>Enregistrer rôle</button>
          <button type="button" class="secondary-button" data-toggle-status data-status="${escapeHtml(user.status)}">${user.status === 'active' ? 'Désactiver' : 'Activer'}</button>
        </div>
      </article>`).join('');
    $('#admin-audit').innerHTML = audit.events.map(item => `
      <div class="audit-item"><b>${escapeHtml(item.action)}</b><span>${escapeHtml(item.actor_email || 'Système')} · ${escapeHtml(item.resource_type || '')} · ${escapeHtml(new Date(item.created_at).toLocaleString())}</span></div>`).join('') || '<p class="loading">Aucun événement.</p>';
  } catch (error) { $('#admin-overview').textContent = error.message; }
}

$('#admin-users').addEventListener('click', async event => {
  const card = event.target.closest('[data-admin-user]');
  if (!card) return;
  try {
    if (event.target.closest('[data-save-role]')) {
      const role = card.querySelector('[data-role-select]').value;
      await apiMutation(`/api/admin/users/${encodeURIComponent(card.dataset.adminUser)}/roles`, 'PATCH', { roles: [role] });
      await loadAdmin();
    } else if (event.target.closest('[data-toggle-status]')) {
      const status = event.target.dataset.status === 'active' ? 'disabled' : 'active';
      await apiMutation(`/api/admin/users/${encodeURIComponent(card.dataset.adminUser)}/status`, 'PATCH', { status });
      await loadAdmin();
    }
  } catch (error) { setAuthMessage(error.message, true); }
});
$('#refresh-admin').addEventListener('click', loadAdmin);

document.querySelectorAll('.nav').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const labels = { overview: 'Vue d’ensemble', investigations: 'Mes investigations', graph: 'IntelBase Pro', sources: 'API Center', threat: 'Threat Intelligence', ai: 'Assistant IA', image: 'Image Intelligence', automation: 'Automation', admin: 'Administration' };
    $('#page-title').textContent = labels[button.dataset.view] || 'Vue d’ensemble';
    if (button.dataset.view === 'investigations') {
      $('#cases-panel').hidden = false;
      ($('#account-active').hidden ? $('#account-panel') : $('#cases-panel')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.dataset.view === 'graph') {
      if (selectedCaseId) loadGraph();
      else setAuthMessage('Ouvre un dossier, puis utilise « Voir le graphe » pour afficher ses entités sourcées.');
      $('#cases-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.dataset.view === 'admin') {
      if ($('#admin-nav').hidden) {
        setAuthMessage('Accès administrateur requis.');
      } else {
        $('#admin-panel').hidden = false;
        loadAdmin();
        $('#admin-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (button.dataset.view === 'automation') {
      if ($('#account-active').hidden) {
        setAuthMessage('Connecte-toi pour gérer les automatisations.');
        $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('#automation-panel').hidden = false;
        loadAutomations();
        loadNotifications();
        $('#automation-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (button.dataset.view === 'image') {
      if ($('#account-active').hidden) {
        setAuthMessage('Connecte-toi pour utiliser Image Intelligence.');
        $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('#image-panel').hidden = false;
        loadImageCases();
        $('#image-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (button.dataset.view === 'ai') {
      if ($('#account-active').hidden) {
        setAuthMessage('Connecte-toi pour utiliser l’assistant IA.');
        $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('#ai-panel').hidden = false;
        loadAiConversations();
        $('#ai-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (button.dataset.view === 'threat') {
      if ($('#account-active').hidden) {
        setAuthMessage('Connecte-toi pour utiliser Threat Intelligence.');
        $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('#threat-panel').hidden = false;
        $('#threat-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (button.dataset.view === 'sources') {
      if ($('#account-active').hidden) {
        setAuthMessage('Connecte-toi pour consulter le centre API.');
        $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('#integrations-panel').hidden = false;
        loadProviders();
        $('#integrations-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

loadStatus();
loadModules();
loadSession();
