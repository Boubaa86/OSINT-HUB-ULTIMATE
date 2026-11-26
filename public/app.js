const $ = selector => document.querySelector(selector);
let csrfToken = null;
let selectedCaseId = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
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

function showAccount(user) {
  $('#auth-forms').hidden = true;
  $('#account-active').hidden = false;
  $('#cases-panel').hidden = false;
  $('#account-name').textContent = user.displayName || user.display_name || 'Compte connecté';
  $('#account-email').textContent = user.email || '';
}

function showSignedOut() {
  csrfToken = null;
  selectedCaseId = null;
  $('#auth-forms').hidden = false;
  $('#account-active').hidden = true;
  $('#cases-panel').hidden = true;
  $('#case-detail').hidden = true;
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
    const [detail, notes, sources] = await Promise.all([
      apiRequest(`/api/investigations/${encodeURIComponent(id)}`),
      apiRequest(`/api/investigations/${encodeURIComponent(id)}/notes`),
      apiRequest(`/api/investigations/${encodeURIComponent(id)}/sources`)
    ]);
    $('#detail-title').textContent = detail.investigation.title;
    $('#graph-view').hidden = true;
    $('#notes-list').innerHTML = notes.notes.length ? notes.notes.map(note => `<div class="mini-record">${escapeHtml(note.body)}<small>${escapeHtml(new Date(note.created_at).toLocaleString())}</small></div>`).join('') : '<p class="loading">Aucune note.</p>';
    $('#sources-list').innerHTML = sources.sources.length ? sources.sources.map(source => `<div class="mini-record"><b>${escapeHtml(source.source_name)}</b><small>${escapeHtml(source.reliability)} · ${escapeHtml(source.source_url || 'Sans URL')}</small></div>`).join('') : '<p class="loading">Aucune source.</p>';
    $('#case-detail').hidden = false;
    $('#case-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { setAuthMessage(error.message, true); }
}

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
    const data = await apiRequest('/api/osint/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: $('#phone-intel-input').value.trim() })
    });
    box.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) { box.textContent = error.message; }
});

$('#email-intel-form').addEventListener('submit', async event => {
  event.preventDefault();
  const box = $('#email-intel-result');
  box.className = 'result';
  box.textContent = 'Vérification de la syntaxe et des enregistrements MX…';
  try {
    const data = await apiRequest('/api/osint/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#email-intel-input').value.trim() })
    });
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
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="graph-edge"><title>${escapeHtml(evidence)}</title></line>`;
  }).join('');
  const nodeMarkup = graphState.nodes.map(node => {
    const point = graphState.positions[node.id];
    const label = node.display_label.length > 24 ? node.display_label.slice(0, 21) + '…' : node.display_label;
    return `<g class="graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${point.x} ${point.y})" tabindex="0">
      <circle r="27"></circle><text y="45" text-anchor="middle">${escapeHtml(label)}</text>
      <title>${escapeHtml(node.entity_type)} · ${escapeHtml(node.canonical_value)}</title>
    </g>`;
  }).join('');
  svg.innerHTML = `<defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs>
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
$('#export-graph-svg').addEventListener('click', () => {
  const blob = new Blob([new XMLSerializer().serializeToString($('#graph-svg'))], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'intelbase-graph.svg';
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelectorAll('.nav').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const labels = { overview: 'Vue d’ensemble', investigations: 'Mes investigations', graph: 'Graphe Intel — à venir', sources: 'Sources & connecteurs — à venir' };
    $('#page-title').textContent = labels[button.dataset.view] || 'Vue d’ensemble';
    if (button.dataset.view === 'investigations') {
      $('#cases-panel').hidden = false;
      ($('#account-active').hidden ? $('#account-panel') : $('#cases-panel')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.dataset.view === 'graph') {
      if (selectedCaseId) loadGraph();
      else setAuthMessage('Ouvre un dossier, puis utilise « Voir le graphe » pour afficher ses entités sourcées.');
      $('#cases-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.dataset.view === 'sources') {
      setAuthMessage('Le centre de connecteurs API est encore en développement.');
      $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      $('#account-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

loadStatus();
loadModules();
loadSession();
