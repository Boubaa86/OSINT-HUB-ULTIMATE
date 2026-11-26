const $ = selector => document.querySelector(selector);
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
      alert('Cette fonction n’est pas encore disponible dans V1.');
    }
  });
});
