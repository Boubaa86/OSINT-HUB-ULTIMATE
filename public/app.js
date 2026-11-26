const $ = selector => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function loadStatus() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('API indisponible');
    const data = await response.json();
    $('#health').textContent = `API OK · ${data.version}`;
  } catch {
    $('#health').textContent = 'API indisponible';
  }
}

async function loadModules() {
  try {
    const response = await fetch('/api/modules');
    if (!response.ok) throw new Error('Chargement impossible');
    const data = await response.json();
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
    const response = await fetch('/api/osint/dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur de recherche');

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

document.querySelectorAll('.nav').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const labels = {
      overview: 'Vue d’ensemble',
      investigations: 'Investigations — à développer',
      graph: 'Graphe Intel — à développer',
      sources: 'Sources & connecteurs — à développer'
    };
    $('#page-title').textContent = labels[button.dataset.view] || 'Vue d’ensemble';
    if (button.dataset.view !== 'overview') {
      alert('Cette fonction n’est pas encore disponible dans V1. Aucun résultat fictif ne sera affiché.');
    }
  });
});

loadStatus();
loadModules();
